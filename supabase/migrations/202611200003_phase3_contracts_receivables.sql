-- ============================================================================
-- Archivo: supabase/migrations/202611200003_phase3_contracts_receivables.sql
-- Responsabilidad: Esquema SQL de Fase 3 para LuchoRentas (contratos mensuales,
--   versionado de condiciones/tarifas, cuentas por cobrar idempotentes con
--   aniversario contractual DEC-18 y prorrateo real DEC-05, RLS multi-tenant y RPCs).
-- Cumplimiento LuchoRentas.md: RF-014 (anti doble ocupación), RF-022 a RF-025,
--   RF-030 a RF-032, §4.4, §4.5, DEC-03 (aniversario), DEC-04 (vencimiento al
--   inicio y mora informativa), DEC-05 (prorrateo días reales), DEC-06 (idempotencia),
--   DEC-16 (mensual) y DEC-18 confirmada (conserva día ancla 29/30/31 en meses cortos).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tipos enumerados de Fase 3
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.contract_status AS ENUM ('draft', 'active', 'finalized', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.receivable_status AS ENUM ('pending', 'partially_paid', 'paid', 'voided');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.charge_generation_mode AS ENUM ('automatic_daily', 'manual_period');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Garantizar FK compuesta (tenant_id, property_id, unit_id) desde Fase 2
DO $$ BEGIN
  ALTER TABLE public.property_units
    ADD CONSTRAINT uq_property_units_tenant_prop_id UNIQUE (tenant_id, property_id, id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Tablas de Contratos, Versiones y Cuentas por Cobrar
-- ----------------------------------------------------------------------------

-- Contratos de alquiler mensual
CREATE TABLE IF NOT EXISTS public.rental_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract_code text NOT NULL,
  property_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  tenant_person_id uuid NOT NULL,
  status public.contract_status NOT NULL DEFAULT 'draft',
  billing_frequency text NOT NULL DEFAULT 'monthly' CHECK (billing_frequency = 'monthly'),
  start_date date NOT NULL,
  first_period_start_date date NOT NULL,
  end_date date DEFAULT NULL,
  anchor_day integer NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  monthly_amount numeric(14,2) NOT NULL CHECK (monthly_amount > 0),
  currency public.currency_code NOT NULL DEFAULT 'BOB',
  notes text NOT NULL DEFAULT '',
  finalization_reason text NOT NULL DEFAULT '',
  activated_at timestamptz DEFAULT NULL,
  finalized_at timestamptz DEFAULT NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rental_contracts_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_rental_contracts_code UNIQUE (tenant_id, contract_code),
  CONSTRAINT chk_contract_dates CHECK (
    first_period_start_date >= start_date
    AND (end_date IS NULL OR end_date >= start_date)
  ),
  CONSTRAINT fk_contract_property_unit_tenant
    FOREIGN KEY (tenant_id, property_id, unit_id)
    REFERENCES public.property_units (tenant_id, property_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_contract_tenant_person
    FOREIGN KEY (tenant_id, tenant_person_id)
    REFERENCES public.people (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_rental_contracts_tenant_status
  ON public.rental_contracts (tenant_id, status, property_id);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_unit_status
  ON public.rental_contracts (tenant_id, unit_id, status);

CREATE TRIGGER trg_rental_contracts_updated_at
  BEFORE UPDATE ON public.rental_contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Historial versionado de tarifas y condiciones futuras (RF-024 / CA-024)
CREATE TABLE IF NOT EXISTS public.rental_contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number >= 1),
  effective_from date NOT NULL,
  monthly_amount numeric(14,2) NOT NULL CHECK (monthly_amount > 0),
  currency public.currency_code NOT NULL DEFAULT 'BOB',
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_contract_version_num UNIQUE (tenant_id, contract_id, version_number),
  CONSTRAINT fk_contract_versions_contract
    FOREIGN KEY (tenant_id, contract_id)
    REFERENCES public.rental_contracts (tenant_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contract_versions_effective
  ON public.rental_contract_versions (tenant_id, contract_id, effective_from DESC);

-- Cuentas por cobrar mensuales (snapshot inmutable + saldo derivado)
CREATE TABLE IF NOT EXISTS public.receivable_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  contract_version_id uuid DEFAULT NULL,
  property_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  tenant_person_id uuid NOT NULL,
  period_index integer NOT NULL CHECK (period_index >= 0),
  nominal_period_start date NOT NULL,
  nominal_period_end date NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  calendar_days_divisor integer NOT NULL CHECK (calendar_days_divisor >= 1),
  covered_days integer NOT NULL CHECK (covered_days >= 1),
  is_prorated boolean NOT NULL DEFAULT false,
  base_monthly_amount numeric(14,2) NOT NULL CHECK (base_monthly_amount > 0),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  adjusted_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (adjusted_amount >= 0),
  currency public.currency_code NOT NULL DEFAULT 'BOB',
  status public.receivable_status NOT NULL DEFAULT 'pending',
  generation_mode public.charge_generation_mode NOT NULL DEFAULT 'manual_period',
  void_reason text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_receivable_tenant_id UNIQUE (tenant_id, id),
  -- Idempotencia estricta: impide duplicar obligación del mismo contrato y período (CA-030, CA-031)
  CONSTRAINT uq_receivable_contract_period UNIQUE (tenant_id, contract_id, period_start),
  CONSTRAINT chk_receivable_amounts CHECK (paid_amount + adjusted_amount <= amount),
  CONSTRAINT fk_receivable_contract
    FOREIGN KEY (tenant_id, contract_id)
    REFERENCES public.rental_contracts (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_receivable_unit
    FOREIGN KEY (tenant_id, property_id, unit_id)
    REFERENCES public.property_units (tenant_id, property_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_receivable_person
    FOREIGN KEY (tenant_id, tenant_person_id)
    REFERENCES public.people (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_receivables_tenant_due
  ON public.receivable_charges (tenant_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_receivables_tenant_property
  ON public.receivable_charges (tenant_id, property_id, period_start);

CREATE TRIGGER trg_receivable_charges_updated_at
  BEFORE UPDATE ON public.receivable_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS obligatorio con alcance por módulo y por casa (DEC-13)
-- ----------------------------------------------------------------------------

ALTER TABLE public.rental_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receivable_charges ENABLE ROW LEVEL SECURITY;

-- RENTAL_CONTRACTS
CREATE POLICY rental_contracts_select_authorized
  ON public.rental_contracts FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'contracts', 'view', property_id));

CREATE POLICY rental_contracts_write_authorized
  ON public.rental_contracts FOR ALL
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'contracts', 'manage', property_id))
  WITH CHECK (public.current_user_has_permission(tenant_id, 'contracts', 'manage', property_id));

-- RENTAL_CONTRACT_VERSIONS
CREATE POLICY contract_versions_select_authorized
  ON public.rental_contract_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      WHERE rc.id = contract_id
        AND rc.tenant_id = rental_contract_versions.tenant_id
        AND public.current_user_has_permission(rc.tenant_id, 'contracts', 'view', rc.property_id)
    )
  );

CREATE POLICY contract_versions_write_authorized
  ON public.rental_contract_versions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      WHERE rc.id = contract_id
        AND rc.tenant_id = rental_contract_versions.tenant_id
        AND public.current_user_has_permission(rc.tenant_id, 'contracts', 'manage', rc.property_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rental_contracts rc
      WHERE rc.id = contract_id
        AND rc.tenant_id = rental_contract_versions.tenant_id
        AND public.current_user_has_permission(rc.tenant_id, 'contracts', 'manage', rc.property_id)
    )
  );

-- RECEIVABLE_CHARGES
CREATE POLICY receivables_select_authorized
  ON public.receivable_charges FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'receivables', 'view', property_id));

CREATE POLICY receivables_write_authorized
  ON public.receivable_charges FOR ALL
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'receivables', 'generate', property_id))
  WITH CHECK (public.current_user_has_permission(tenant_id, 'receivables', 'generate', property_id));

-- ----------------------------------------------------------------------------
-- 4. Funciones de Calendario Contractual (DEC-03, DEC-05 y DEC-18 confirmada)
-- ----------------------------------------------------------------------------

-- Ajusta el día ancla (1..31) al último día válido del mes cuando corresponda (DEC-18)
CREATE OR REPLACE FUNCTION public.clamp_anchor_date(
  p_base_year integer,
  p_base_month integer,
  p_month_offset integer,
  p_anchor_day integer
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total_months integer := (p_base_year * 12 + (p_base_month - 1)) + p_month_offset;
  v_year integer := v_total_months / 12;
  v_month integer := (v_total_months % 12) + 1;
  v_first_of_month date := make_date(v_year, v_month, 1);
  v_last_day integer := EXTRACT(DAY FROM (v_first_of_month + interval '1 month' - interval '1 day'))::integer;
BEGIN
  RETURN make_date(v_year, v_month, LEAST(p_anchor_day, v_last_day));
END;
$$;

-- Calcula un período contractual mensual por aniversario + prorrateo por días reales
CREATE OR REPLACE FUNCTION public.calculate_contract_period(
  p_first_period_start date,
  p_anchor_day integer,
  p_period_index integer,
  p_contract_end_date date DEFAULT NULL
)
RETURNS TABLE (
  nominal_start date,
  nominal_end date,
  effective_start date,
  effective_end date,
  calendar_days_divisor integer,
  covered_days integer,
  is_prorated boolean
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_base_year integer := EXTRACT(YEAR FROM p_first_period_start)::integer;
  v_base_month integer := EXTRACT(MONTH FROM p_first_period_start)::integer;
  v_nom_start date;
  v_next_start date;
  v_nom_end date;
  v_eff_start date;
  v_eff_end date;
  v_divisor integer;
  v_covered integer;
BEGIN
  v_nom_start := public.clamp_anchor_date(v_base_year, v_base_month, p_period_index, p_anchor_day);
  v_next_start := public.clamp_anchor_date(v_base_year, v_base_month, p_period_index + 1, p_anchor_day);
  v_nom_end := v_next_start - 1;
  v_eff_start := v_nom_start;

  IF p_contract_end_date IS NOT NULL AND p_contract_end_date < v_nom_end THEN
    v_eff_end := p_contract_end_date;
  ELSE
    v_eff_end := v_nom_end;
  END IF;

  v_divisor := (v_nom_end - v_nom_start) + 1;
  v_covered := GREATEST(0, (v_eff_end - v_eff_start) + 1);

  RETURN QUERY SELECT
    v_nom_start,
    v_nom_end,
    v_eff_start,
    v_eff_end,
    v_divisor,
    v_covered,
    (v_covered < v_divisor);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. RPCs Transaccionales de Fase 3
-- ----------------------------------------------------------------------------

-- Crear contrato (borrador o activación inmediata), versión v1 y auditoría (RF-022, RF-023)
CREATE OR REPLACE FUNCTION public.create_rental_contract(
  p_tenant_id uuid,
  p_property_id uuid,
  p_unit_id uuid,
  p_tenant_person_id uuid,
  p_start_date date,
  p_first_period_start_date date,
  p_end_date date DEFAULT NULL,
  p_monthly_amount numeric DEFAULT 0,
  p_currency public.currency_code DEFAULT 'BOB',
  p_notes text DEFAULT '',
  p_activate_now boolean DEFAULT false
)
RETURNS public.rental_contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_unit public.property_units;
  v_prop public.properties;
  v_contract public.rental_contracts;
  v_code text;
  v_anchor integer := EXTRACT(DAY FROM p_first_period_start_date)::integer;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'contracts', 'manage', p_property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para crear contratos en esta casa.' USING ERRCODE = '42501';
  END IF;

  IF p_monthly_amount IS NULL OR p_monthly_amount <= 0 THEN
    RAISE EXCEPTION 'El importe mensual de alquiler debe ser mayor a 0.' USING ERRCODE = '22023';
  END IF;

  IF p_first_period_start_date < p_start_date THEN
    RAISE EXCEPTION 'El inicio del primer período de cobro no puede ser anterior al inicio del contrato.' USING ERRCODE = '22023';
  END IF;

  IF p_end_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'La fecha de finalización no puede ser anterior al inicio del contrato.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prop FROM public.properties
  WHERE id = p_property_id AND tenant_id = p_tenant_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Casa no encontrada o inactiva en el tenant activo.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_unit FROM public.property_units
  WHERE id = p_unit_id AND property_id = p_property_id AND tenant_id = p_tenant_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unidad no encontrada o inactiva en la casa seleccionada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_prop.rental_mode = 'full_house' AND NOT v_unit.is_default_house_unit THEN
    RAISE EXCEPTION 'Una casa en modalidad Casa completa solo puede contratarse mediante su unidad completa.' USING ERRCODE = '22023';
  END IF;

  IF v_prop.rental_mode = 'by_rooms' AND v_unit.is_default_house_unit THEN
    RAISE EXCEPTION 'Una casa Por cuartos requiere seleccionar un cuarto independiente.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.people pe
    JOIN public.person_roles pr ON pr.tenant_id = pe.tenant_id AND pr.person_id = pe.id
    WHERE pe.id = p_tenant_person_id
      AND pe.tenant_id = p_tenant_id
      AND pe.is_active = true
      AND pr.role = 'tenant_renter'
  ) THEN
    RAISE EXCEPTION 'La persona seleccionada no está activa o no tiene el rol de Inquilino.' USING ERRCODE = '22023';
  END IF;

  v_code := 'CTR-' || to_char((now() AT TIME ZONE 'America/La_Paz')::date, 'YYYYMM') || '-' || upper(substr(gen_random_uuid()::text, 1, 5));

  INSERT INTO public.rental_contracts (
    tenant_id, contract_code, property_id, unit_id, tenant_person_id,
    status, billing_frequency, start_date, first_period_start_date, end_date,
    anchor_day, monthly_amount, currency, notes, created_by
  )
  VALUES (
    p_tenant_id, v_code, p_property_id, p_unit_id, p_tenant_person_id,
    'draft', 'monthly', p_start_date, p_first_period_start_date, p_end_date,
    v_anchor, p_monthly_amount, p_currency, COALESCE(trim(p_notes), ''), v_actor
  )
  RETURNING * INTO v_contract;

  INSERT INTO public.rental_contract_versions (
    tenant_id, contract_id, version_number, effective_from, monthly_amount, currency, notes, created_by
  )
  VALUES (
    p_tenant_id, v_contract.id, 1, p_first_period_start_date, p_monthly_amount, p_currency, 'Condiciones iniciales', v_actor
  );

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'contract.created', 'rental_contracts', v_contract.id,
    jsonb_build_object('contract_code', v_contract.contract_code, 'unit_id', p_unit_id, 'amount', p_monthly_amount, 'currency', p_currency)
  );

  IF p_activate_now THEN
    v_contract := public.activate_rental_contract(p_tenant_id, v_contract.id);
  END IF;

  RETURN v_contract;
END;
$$;

REVOKE ALL ON FUNCTION public.create_rental_contract(uuid, uuid, uuid, uuid, date, date, date, numeric, public.currency_code, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_rental_contract(uuid, uuid, uuid, uuid, date, date, date, numeric, public.currency_code, text, boolean) TO authenticated;

-- Activar contrato impidiendo doble ocupación concurrente y derivando estado 'occupied' (RF-014, CA-014)
CREATE OR REPLACE FUNCTION public.activate_rental_contract(
  p_tenant_id uuid,
  p_contract_id uuid
)
RETURNS public.rental_contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_contract public.rental_contracts;
  v_unit public.property_units;
  v_prop public.properties;
  v_conflict_count integer;
BEGIN
  SELECT * INTO v_contract
  FROM public.rental_contracts
  WHERE id = p_contract_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato no encontrado en el tenant activo.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'contracts', 'manage', v_contract.property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para activar este contrato.' USING ERRCODE = '42501';
  END IF;

  IF v_contract.status <> 'draft' THEN
    RAISE EXCEPTION 'Solo se pueden activar contratos en estado Borrador.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prop FROM public.properties
  WHERE id = v_contract.property_id AND tenant_id = p_tenant_id FOR UPDATE;

  SELECT * INTO v_unit FROM public.property_units
  WHERE id = v_contract.unit_id AND tenant_id = p_tenant_id FOR UPDATE;

  IF v_unit.status = 'out_of_service' THEN
    RAISE EXCEPTION 'La unidad se encuentra fuera de servicio. Habilítala antes de activar el contrato.' USING ERRCODE = '22023';
  END IF;

  -- Validar solapamiento de intervalos en la misma unidad (y en toda la casa si es Casa completa)
  SELECT count(*) INTO v_conflict_count
  FROM public.rental_contracts rc
  WHERE rc.tenant_id = p_tenant_id
    AND rc.id <> v_contract.id
    AND rc.status = 'active'
    AND (
      rc.unit_id = v_contract.unit_id
      OR (v_prop.rental_mode = 'full_house' AND rc.property_id = v_contract.property_id)
    )
    AND daterange(rc.start_date, COALESCE(rc.end_date, 'infinity'::date), '[]')
        && daterange(v_contract.start_date, COALESCE(v_contract.end_date, 'infinity'::date), '[]');

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Conflicto de doble ocupación: ya existe un contrato activo incompatible en ese intervalo.' USING ERRCODE = '23P01';
  END IF;

  UPDATE public.rental_contracts
  SET status = 'active',
      activated_at = now()
  WHERE id = v_contract.id AND tenant_id = p_tenant_id
  RETURNING * INTO v_contract;

  UPDATE public.property_units
  SET status = 'occupied'
  WHERE id = v_contract.unit_id AND tenant_id = p_tenant_id;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'contract.activated', 'rental_contracts', v_contract.id,
    jsonb_build_object('contract_code', v_contract.contract_code, 'unit_id', v_contract.unit_id)
  );

  RETURN v_contract;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_rental_contract(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_rental_contract(uuid, uuid) TO authenticated;

-- Agregar nueva versión de tarifa/condiciones futuras sin alterar cargos previos (RF-024 / CA-024)
CREATE OR REPLACE FUNCTION public.add_contract_version(
  p_tenant_id uuid,
  p_contract_id uuid,
  p_effective_from date,
  p_monthly_amount numeric,
  p_currency public.currency_code,
  p_notes text DEFAULT ''
)
RETURNS public.rental_contract_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_contract public.rental_contracts;
  v_next_num integer;
  v_version public.rental_contract_versions;
BEGIN
  SELECT * INTO v_contract
  FROM public.rental_contracts
  WHERE id = p_contract_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato no encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'contracts', 'manage', v_contract.property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para modificar condiciones del contrato.' USING ERRCODE = '42501';
  END IF;

  IF v_contract.status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION 'No se pueden agregar nuevas condiciones a un contrato finalizado o cancelado.' USING ERRCODE = '22023';
  END IF;

  IF p_monthly_amount IS NULL OR p_monthly_amount <= 0 THEN
    RAISE EXCEPTION 'El nuevo importe mensual debe ser mayor a 0.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_num
  FROM public.rental_contract_versions
  WHERE tenant_id = p_tenant_id AND contract_id = p_contract_id;

  INSERT INTO public.rental_contract_versions (
    tenant_id, contract_id, version_number, effective_from, monthly_amount, currency, notes, created_by
  )
  VALUES (
    p_tenant_id, p_contract_id, v_next_num, p_effective_from, p_monthly_amount, p_currency, COALESCE(trim(p_notes), ''), v_actor
  )
  RETURNING * INTO v_version;

  IF p_effective_from <= (now() AT TIME ZONE 'America/La_Paz')::date THEN
    UPDATE public.rental_contracts
    SET monthly_amount = p_monthly_amount,
        currency = p_currency
    WHERE id = p_contract_id AND tenant_id = p_tenant_id;
  END IF;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'contract.version_added', 'rental_contracts', p_contract_id,
    jsonb_build_object('version_number', v_next_num, 'effective_from', p_effective_from, 'monthly_amount', p_monthly_amount, 'currency', p_currency)
  );

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.add_contract_version(uuid, uuid, date, numeric, public.currency_code, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_contract_version(uuid, uuid, date, numeric, public.currency_code, text) TO authenticated;

-- Finalizar contrato conservando historial y liberando unidad (RF-025 / CA-025)
CREATE OR REPLACE FUNCTION public.finalize_rental_contract(
  p_tenant_id uuid,
  p_contract_id uuid,
  p_effective_end_date date,
  p_reason text
)
RETURNS public.rental_contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_contract public.rental_contracts;
  v_other_active integer;
BEGIN
  SELECT * INTO v_contract
  FROM public.rental_contracts
  WHERE id = p_contract_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato no encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'contracts', 'manage', v_contract.property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para finalizar este contrato.' USING ERRCODE = '42501';
  END IF;

  IF v_contract.status <> 'active' THEN
    RAISE EXCEPTION 'Solo se pueden finalizar contratos activos.' USING ERRCODE = '22023';
  END IF;

  IF char_length(trim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Debes ingresar el motivo de finalización del contrato.' USING ERRCODE = '22023';
  END IF;

  IF p_effective_end_date < v_contract.start_date THEN
    RAISE EXCEPTION 'La fecha efectiva de finalización no puede ser anterior al inicio del contrato.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.rental_contracts
  SET status = 'finalized',
      end_date = p_effective_end_date,
      finalization_reason = trim(p_reason),
      finalized_at = now()
  WHERE id = v_contract.id AND tenant_id = p_tenant_id
  RETURNING * INTO v_contract;

  SELECT count(*) INTO v_other_active
  FROM public.rental_contracts
  WHERE tenant_id = p_tenant_id
    AND unit_id = v_contract.unit_id
    AND status = 'active'
    AND id <> v_contract.id;

  IF v_other_active = 0 THEN
    UPDATE public.property_units
    SET status = 'available'
    WHERE id = v_contract.unit_id AND tenant_id = p_tenant_id AND status = 'occupied';
  END IF;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'contract.finalized', 'rental_contracts', v_contract.id,
    jsonb_build_object('effective_end_date', p_effective_end_date, 'reason', trim(p_reason))
  );

  RETURN v_contract;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_rental_contract(uuid, uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_rental_contract(uuid, uuid, date, text) TO authenticated;

-- Generación idempotente automática (corte del día) o manual controlada de CxC (RF-030, RF-031, DEC-06)
CREATE OR REPLACE FUNCTION public.generate_rent_charges(
  p_tenant_id uuid,
  p_mode public.charge_generation_mode,
  p_contract_id uuid DEFAULT NULL,
  p_period_index integer DEFAULT NULL,
  p_reference_date date DEFAULT NULL,
  p_regularization_reason text DEFAULT ''
)
RETURNS SETOF public.receivable_charges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ref_date date := COALESCE(p_reference_date, (now() AT TIME ZONE 'America/La_Paz')::date);
  v_contract public.rental_contracts;
  v_version public.rental_contract_versions;
  v_idx integer;
  v_period record;
  v_amount numeric(14,2);
  v_charge public.receivable_charges;
  v_exists boolean;
BEGIN
  IF p_mode = 'manual_period' THEN
    IF p_contract_id IS NULL OR p_period_index IS NULL OR p_period_index < 0 THEN
      RAISE EXCEPTION 'La generación manual requiere contrato y número de período válido.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_contract
    FROM public.rental_contracts
    WHERE id = p_contract_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contrato no encontrado en el tenant activo.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.current_user_has_permission(p_tenant_id, 'receivables', 'generate', v_contract.property_id) THEN
      RAISE EXCEPTION 'Acceso denegado para generar cuentas por cobrar en este inmueble.' USING ERRCODE = '42501';
    END IF;

    IF v_contract.status = 'draft' OR v_contract.status = 'cancelled' THEN
      RAISE EXCEPTION 'Solo se pueden generar cuentas por cobrar para contratos activos o finalizados (regularización).' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || v_contract.id::text));

    SELECT * INTO v_period
    FROM public.calculate_contract_period(
      v_contract.first_period_start_date,
      v_contract.anchor_day,
      p_period_index,
      v_contract.end_date
    );

    IF v_period.covered_days <= 0 THEN
      RAISE EXCEPTION 'El período seleccionado queda fuera de la vigencia de finalización del contrato.' USING ERRCODE = '22023';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.receivable_charges
      WHERE tenant_id = p_tenant_id
        AND contract_id = v_contract.id
        AND period_start = v_period.effective_start
    ) INTO v_exists;

    IF v_exists THEN
      RAISE EXCEPTION 'Ya existe una cuenta por cobrar generada para ese contrato y período (%).', v_period.effective_start USING ERRCODE = '23505';
    END IF;

    IF v_period.effective_end < v_ref_date AND char_length(trim(COALESCE(p_regularization_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'Para regularizar manualmente un período anterior debes indicar el motivo.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_version
    FROM public.rental_contract_versions
    WHERE tenant_id = p_tenant_id
      AND contract_id = v_contract.id
      AND effective_from <= v_period.nominal_start
    ORDER BY effective_from DESC, version_number DESC
    LIMIT 1;

    IF NOT FOUND THEN
      v_version.id := NULL;
      v_version.monthly_amount := v_contract.monthly_amount;
      v_version.currency := v_contract.currency;
    END IF;

    IF v_period.covered_days >= v_period.calendar_days_divisor THEN
      v_amount := v_version.monthly_amount;
    ELSE
      v_amount := round((v_version.monthly_amount / v_period.calendar_days_divisor::numeric) * v_period.covered_days::numeric, 2);
    END IF;

    INSERT INTO public.receivable_charges (
      tenant_id, contract_id, contract_version_id, property_id, unit_id, tenant_person_id,
      period_index, nominal_period_start, nominal_period_end, period_start, period_end,
      issue_date, due_date, calendar_days_divisor, covered_days, is_prorated,
      base_monthly_amount, amount, currency, status, generation_mode, notes, created_by
    )
    VALUES (
      p_tenant_id, v_contract.id, v_version.id, v_contract.property_id, v_contract.unit_id, v_contract.tenant_person_id,
      p_period_index, v_period.nominal_start, v_period.nominal_end, v_period.effective_start, v_period.effective_end,
      v_ref_date, v_period.effective_start, v_period.calendar_days_divisor, v_period.covered_days, v_period.is_prorated,
      v_version.monthly_amount, v_amount, v_version.currency, 'pending', 'manual_period',
      COALESCE(NULLIF(trim(p_regularization_reason), ''), 'Generación manual autorizada'), v_actor
    )
    RETURNING * INTO v_charge;

    INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      p_tenant_id, v_actor, 'receivable.generated_manual', 'receivable_charges', v_charge.id,
      jsonb_build_object('contract_id', v_contract.id, 'period_start', v_charge.period_start, 'amount', v_charge.amount, 'currency', v_charge.currency)
    );

    RETURN NEXT v_charge;
    RETURN;
  END IF;

  -- Modo automático diario: evalúa SOLO el período vigente actual a v_ref_date (sin retroactividad automática, DEC-06)
  IF NOT public.current_user_has_permission(p_tenant_id, 'receivables', 'generate', NULL) THEN
    RAISE EXCEPTION 'Acceso denegado para ejecutar la generación diaria de cuentas por cobrar.' USING ERRCODE = '42501';
  END IF;

  FOR v_contract IN
    SELECT *
    FROM public.rental_contracts rc
    WHERE rc.tenant_id = p_tenant_id
      AND rc.status = 'active'
      AND (p_contract_id IS NULL OR rc.id = p_contract_id)
      AND rc.first_period_start_date <= v_ref_date
      AND (rc.end_date IS NULL OR rc.end_date >= rc.first_period_start_date)
      AND public.current_user_has_permission(p_tenant_id, 'receivables', 'generate', rc.property_id)
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || v_contract.id::text));

    -- Buscar el índice del período que contiene v_ref_date
    v_idx := GREATEST(
      0,
      ((EXTRACT(YEAR FROM v_ref_date)::integer - EXTRACT(YEAR FROM v_contract.first_period_start_date)::integer) * 12)
      + (EXTRACT(MONTH FROM v_ref_date)::integer - EXTRACT(MONTH FROM v_contract.first_period_start_date)::integer)
      - 1
    );

    WHILE v_idx <= ((EXTRACT(YEAR FROM v_ref_date)::integer - EXTRACT(YEAR FROM v_contract.first_period_start_date)::integer) * 12)
      + (EXTRACT(MONTH FROM v_ref_date)::integer - EXTRACT(MONTH FROM v_contract.first_period_start_date)::integer) + 1
    LOOP
      SELECT * INTO v_period
      FROM public.calculate_contract_period(
        v_contract.first_period_start_date,
        v_contract.anchor_day,
        v_idx,
        v_contract.end_date
      );

      IF v_period.covered_days > 0
         AND v_ref_date >= v_period.effective_start
         AND v_ref_date <= v_period.effective_end THEN

        SELECT * INTO v_version
        FROM public.rental_contract_versions
        WHERE tenant_id = p_tenant_id
          AND contract_id = v_contract.id
          AND effective_from <= v_period.nominal_start
        ORDER BY effective_from DESC, version_number DESC
        LIMIT 1;

        IF NOT FOUND THEN
          v_version.id := NULL;
          v_version.monthly_amount := v_contract.monthly_amount;
          v_version.currency := v_contract.currency;
        END IF;

        IF v_period.covered_days >= v_period.calendar_days_divisor THEN
          v_amount := v_version.monthly_amount;
        ELSE
          v_amount := round((v_version.monthly_amount / v_period.calendar_days_divisor::numeric) * v_period.covered_days::numeric, 2);
        END IF;

        INSERT INTO public.receivable_charges (
          tenant_id, contract_id, contract_version_id, property_id, unit_id, tenant_person_id,
          period_index, nominal_period_start, nominal_period_end, period_start, period_end,
          issue_date, due_date, calendar_days_divisor, covered_days, is_prorated,
          base_monthly_amount, amount, currency, status, generation_mode, notes, created_by
        )
        VALUES (
          p_tenant_id, v_contract.id, v_version.id, v_contract.property_id, v_contract.unit_id, v_contract.tenant_person_id,
          v_idx, v_period.nominal_start, v_period.nominal_end, v_period.effective_start, v_period.effective_end,
          v_ref_date, v_period.effective_start, v_period.calendar_days_divisor, v_period.covered_days, v_period.is_prorated,
          v_version.monthly_amount, v_amount, v_version.currency, 'pending', 'automatic_daily',
          'Corte diario automático', v_actor
        )
        ON CONFLICT (tenant_id, contract_id, period_start) DO NOTHING
        RETURNING * INTO v_charge;

        IF FOUND THEN
          INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
          VALUES (
            p_tenant_id, v_actor, 'receivable.generated_auto', 'receivable_charges', v_charge.id,
            jsonb_build_object('contract_id', v_contract.id, 'period_start', v_charge.period_start, 'amount', v_charge.amount)
          );
          RETURN NEXT v_charge;
        END IF;

        EXIT;
      END IF;

      v_idx := v_idx + 1;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_rent_charges(uuid, public.charge_generation_mode, uuid, integer, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_rent_charges(uuid, public.charge_generation_mode, uuid, integer, date, text) TO authenticated;

-- Anular cuenta por cobrar sin movimientos aplicados con motivo y trazabilidad (§4.5)
CREATE OR REPLACE FUNCTION public.void_receivable_charge(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_reason text
)
RETURNS public.receivable_charges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_charge public.receivable_charges;
BEGIN
  SELECT * INTO v_charge
  FROM public.receivable_charges
  WHERE id = p_charge_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta por cobrar no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'receivables', 'generate', v_charge.property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para anular obligaciones en esta casa.' USING ERRCODE = '42501';
  END IF;

  IF char_length(trim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Debes registrar el motivo de la anulación.' USING ERRCODE = '22023';
  END IF;

  IF v_charge.status = 'voided' THEN
    RAISE EXCEPTION 'Esta obligación ya se encuentra anulada.' USING ERRCODE = '22023';
  END IF;

  IF v_charge.paid_amount > 0 THEN
    RAISE EXCEPTION 'No se puede anular una obligación con cobros aplicados. Revierte primero el cobro.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.receivable_charges
  SET status = 'voided',
      adjusted_amount = amount,
      void_reason = trim(p_reason)
  WHERE id = v_charge.id AND tenant_id = p_tenant_id
  RETURNING * INTO v_charge;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'receivable.voided', 'receivable_charges', v_charge.id,
    jsonb_build_object('reason', trim(p_reason), 'amount', v_charge.amount, 'currency', v_charge.currency)
  );

  RETURN v_charge;
END;
$$;

REVOKE ALL ON FUNCTION public.void_receivable_charge(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_receivable_charge(uuid, uuid, text) TO authenticated;
