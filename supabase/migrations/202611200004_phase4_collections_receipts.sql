-- ============================================================================
-- Archivo: supabase/migrations/202611200004_phase4_collections_receipts.sql
-- Responsabilidad: Esquema SQL de Fase 4 para LuchoRentas (cobros inmutables,
--   aplicaciones a cuentas por cobrar, créditos separados por excedente,
--   reversiones compensatorias vinculadas, contador correlativo sin huecos y
--   recibos internos no fiscales con RLS multi-tenant y RPCs transaccionales).
-- Cumplimiento LuchoRentas.md: RF-033 a RF-037 (CA-033 a CA-037), §4.6, §8.7,
--   §10.2, §11.3 (confirm_rent_payment, issue_rent_receipt, reverse_rent_payment),
--   DEC-01 (monedas separadas BOB/USD), DEC-12 (recibos correlativos no fiscales).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tipos enumerados de Fase 4
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.payment_method AS ENUM ('cash', 'bank_transfer', 'qr', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('confirmed', 'reversed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_entry_kind AS ENUM ('collection', 'reversal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.allocation_kind AS ENUM ('payment', 'credit_application', 'reversal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.receipt_status AS ENUM ('valid', 'voided_by_reversal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Tablas transaccionales de Cobros, Aplicaciones, Créditos y Recibos
-- ----------------------------------------------------------------------------

-- Contador correlativo atómico por tenant y tipo de documento (DEC-12 / CA-035)
CREATE TABLE IF NOT EXISTS public.receipt_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  doc_type text NOT NULL DEFAULT 'rent_receipt',
  last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_receipt_counter_tenant_type UNIQUE (tenant_id, doc_type)
);

-- Registro inmutable de cobros y reversiones compensatorias (§4.6)
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  property_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  tenant_person_id uuid NOT NULL,
  entry_kind public.payment_entry_kind NOT NULL DEFAULT 'collection',
  status public.payment_status NOT NULL DEFAULT 'confirmed',
  effective_at timestamptz NOT NULL DEFAULT now(),
  received_amount numeric(14,2) NOT NULL CHECK (received_amount > 0),
  applied_amount numeric(14,2) NOT NULL CHECK (applied_amount >= 0 AND applied_amount <= received_amount),
  credit_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  currency public.currency_code NOT NULL,
  payment_method public.payment_method NOT NULL DEFAULT 'cash',
  reference_code text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  collected_by_user_id uuid REFERENCES public.profiles(id),
  collected_by_name text NOT NULL DEFAULT '',
  idempotency_key text DEFAULT NULL,
  reversed_payment_id uuid DEFAULT NULL,
  reversal_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payments_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT chk_payment_split CHECK (applied_amount + credit_amount = received_amount),
  CONSTRAINT fk_payments_unit
    FOREIGN KEY (tenant_id, property_id, unit_id)
    REFERENCES public.property_units (tenant_id, property_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_payments_person
    FOREIGN KEY (tenant_id, tenant_person_id)
    REFERENCES public.people (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_payments_reversed
    FOREIGN KEY (tenant_id, reversed_payment_id)
    REFERENCES public.payments (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency
  ON public.payments (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_single_reversal
  ON public.payments (tenant_id, reversed_payment_id)
  WHERE reversed_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_tenant_effective
  ON public.payments (tenant_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_property
  ON public.payments (tenant_id, property_id, effective_at DESC);

-- Aplicaciones explícitas de cobros, créditos o reversiones a CxC
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  receivable_charge_id uuid NOT NULL,
  allocation_kind public.allocation_kind NOT NULL DEFAULT 'payment',
  allocated_amount numeric(14,2) NOT NULL CHECK (allocated_amount <> 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_alloc_payment
    FOREIGN KEY (tenant_id, payment_id)
    REFERENCES public.payments (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_alloc_receivable
    FOREIGN KEY (tenant_id, receivable_charge_id)
    REFERENCES public.receivable_charges (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_charge
  ON public.payment_allocations (tenant_id, receivable_charge_id, created_at);

-- Créditos separados por excedentes (nunca se aplican automáticamente, §4.6)
CREATE TABLE IF NOT EXISTS public.tenant_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tenant_person_id uuid NOT NULL,
  source_payment_id uuid NOT NULL,
  currency public.currency_code NOT NULL,
  original_amount numeric(14,2) NOT NULL CHECK (original_amount > 0),
  remaining_amount numeric(14,2) NOT NULL CHECK (remaining_amount >= 0 AND remaining_amount <= original_amount),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_credits_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_credits_person
    FOREIGN KEY (tenant_id, tenant_person_id)
    REFERENCES public.people (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_credits_payment
    FOREIGN KEY (tenant_id, source_payment_id)
    REFERENCES public.payments (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE TRIGGER trg_tenant_credits_updated_at
  BEFORE UPDATE ON public.tenant_credits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Recibos correlativos internos no fiscales (DEC-12 / RF-035 / RF-036)
CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  property_id uuid NOT NULL,
  doc_type text NOT NULL DEFAULT 'rent_receipt',
  sequence_number bigint NOT NULL CHECK (sequence_number >= 1),
  receipt_number text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  tenant_name text NOT NULL,
  tenant_person_name text NOT NULL,
  property_name text NOT NULL,
  unit_name text NOT NULL,
  concept_period text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency public.currency_code NOT NULL,
  payment_method public.payment_method NOT NULL,
  collected_by_name text NOT NULL,
  notes text NOT NULL DEFAULT '',
  non_fiscal_legend text NOT NULL DEFAULT 'COMPROBANTE INTERNO NO FISCAL — LUCHORENTAS',
  status public.receipt_status NOT NULL DEFAULT 'valid',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_receipts_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_receipts_payment UNIQUE (tenant_id, payment_id),
  CONSTRAINT uq_receipts_seq UNIQUE (tenant_id, doc_type, sequence_number),
  CONSTRAINT uq_receipts_number UNIQUE (tenant_id, receipt_number),
  CONSTRAINT fk_receipts_payment
    FOREIGN KEY (tenant_id, payment_id)
    REFERENCES public.payments (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_receipts_tenant_issued
  ON public.receipts (tenant_id, issued_at DESC);

-- ----------------------------------------------------------------------------
-- 3. RLS obligatorio (aislamiento multi-tenant y alcance por casa DEC-13)
-- ----------------------------------------------------------------------------

ALTER TABLE public.receipt_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

-- RECEIPT_COUNTERS: lectura para usuarios con acceso a cobros; escritura solo vía RPC
CREATE POLICY receipt_counters_select_authorized
  ON public.receipt_counters FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'collections', 'view', NULL));

-- PAYMENTS: inmutables desde cliente (solo SELECT vía RLS; mutación vía RPC)
CREATE POLICY payments_select_authorized
  ON public.payments FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'collections', 'view', property_id));

-- PAYMENT_ALLOCATIONS
CREATE POLICY payment_allocations_select_authorized
  ON public.payment_allocations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.payments py
      WHERE py.id = payment_id
        AND py.tenant_id = payment_allocations.tenant_id
        AND public.current_user_has_permission(py.tenant_id, 'collections', 'view', py.property_id)
    )
  );

-- TENANT_CREDITS
CREATE POLICY tenant_credits_select_authorized
  ON public.tenant_credits FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'collections', 'view', NULL));

-- RECEIPTS
CREATE POLICY receipts_select_authorized
  ON public.receipts FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'collections', 'view', property_id));

-- ----------------------------------------------------------------------------
-- 4. RPCs Transaccionales de Fase 4 (§11.3)
-- ----------------------------------------------------------------------------

-- Emisión/consulta idempotente de recibo para un cobro confirmado (DEC-12 / RF-035)
CREATE OR REPLACE FUNCTION public.issue_rent_receipt(
  p_tenant_id uuid,
  p_payment_id uuid
)
RETURNS public.receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_payment public.payments;
  v_existing public.receipts;
  v_seq bigint;
  v_num text;
  v_tenant_name text;
  v_person_name text;
  v_prop_name text;
  v_unit_name text;
  v_concept text;
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado en el tenant activo.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'collections', 'view', v_payment.property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para consultar o emitir este recibo.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.receipts
  WHERE tenant_id = p_tenant_id AND payment_id = p_payment_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  IF v_payment.entry_kind <> 'collection' THEN
    RAISE EXCEPTION 'No corresponde emitir recibo de cobro para una reversión.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.receipt_counters (tenant_id, doc_type, last_number)
  VALUES (p_tenant_id, 'rent_receipt', 1)
  ON CONFLICT (tenant_id, doc_type) DO UPDATE
    SET last_number = public.receipt_counters.last_number + 1,
        updated_at = now()
  RETURNING last_number INTO v_seq;

  v_num := 'REC-' || lpad(v_seq::text, 6, '0');

  SELECT name INTO v_tenant_name FROM public.tenants WHERE id = p_tenant_id;
  SELECT full_name INTO v_person_name FROM public.people WHERE id = v_payment.tenant_person_id AND tenant_id = p_tenant_id;
  SELECT name INTO v_prop_name FROM public.properties WHERE id = v_payment.property_id AND tenant_id = p_tenant_id;
  SELECT code || ' — ' || name INTO v_unit_name FROM public.property_units WHERE id = v_payment.unit_id AND tenant_id = p_tenant_id;

  SELECT string_agg(
    'Alquiler período ' || to_char(rc.period_start, 'DD/MM/YYYY') || ' al ' || to_char(rc.period_end, 'DD/MM/YYYY'),
    ', '
  )
  INTO v_concept
  FROM public.payment_allocations pa
  JOIN public.receivable_charges rc ON rc.id = pa.receivable_charge_id AND rc.tenant_id = pa.tenant_id
  WHERE pa.tenant_id = p_tenant_id AND pa.payment_id = p_payment_id;

  INSERT INTO public.receipts (
    tenant_id, payment_id, property_id, doc_type, sequence_number, receipt_number,
    issued_at, tenant_name, tenant_person_name, property_name, unit_name,
    concept_period, amount, currency, payment_method, collected_by_name, notes, status
  )
  VALUES (
    p_tenant_id, p_payment_id, v_payment.property_id, 'rent_receipt', v_seq, v_num,
    v_payment.effective_at, COALESCE(v_tenant_name, 'Administración'), COALESCE(v_person_name, 'Inquilino'),
    COALESCE(v_prop_name, 'Inmueble'), COALESCE(v_unit_name, 'Unidad'),
    COALESCE(v_concept, 'Cobro de alquiler mensual'), v_payment.received_amount, v_payment.currency,
    v_payment.payment_method, v_payment.collected_by_name, v_payment.notes,
    CASE WHEN v_payment.status = 'reversed' THEN 'voided_by_reversal'::public.receipt_status ELSE 'valid'::public.receipt_status END
  )
  RETURNING * INTO v_existing;

  RETURN v_existing;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_rent_receipt(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_rent_receipt(uuid, uuid) TO authenticated;

-- Confirmar cobro completo o parcial + aplicación + recibo correlativo en una sola transacción (RF-033..RF-035)
CREATE OR REPLACE FUNCTION public.confirm_rent_payment(
  p_tenant_id uuid,
  p_receivable_charge_id uuid,
  p_effective_at timestamptz,
  p_received_amount numeric,
  p_applied_amount numeric,
  p_payment_method public.payment_method DEFAULT 'cash',
  p_reference_code text DEFAULT '',
  p_notes text DEFAULT '',
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_charge public.receivable_charges;
  v_balance numeric(14,2);
  v_credit numeric(14,2);
  v_new_paid numeric(14,2);
  v_new_status public.receivable_status;
  v_payment public.payments;
  v_receipt public.receipts;
BEGIN
  IF p_idempotency_key IS NOT NULL AND char_length(trim(p_idempotency_key)) > 0 THEN
    SELECT * INTO v_payment
    FROM public.payments
    WHERE tenant_id = p_tenant_id AND idempotency_key = trim(p_idempotency_key);

    IF FOUND THEN
      v_receipt := public.issue_rent_receipt(p_tenant_id, v_payment.id);
      RETURN jsonb_build_object('payment', to_jsonb(v_payment), 'receipt', to_jsonb(v_receipt));
    END IF;
  END IF;

  SELECT * INTO v_charge
  FROM public.receivable_charges
  WHERE id = p_receivable_charge_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta por cobrar no encontrada en el tenant activo.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'collections', 'create', v_charge.property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para registrar cobros en esta casa.' USING ERRCODE = '42501';
  END IF;

  IF v_charge.status = 'voided' THEN
    RAISE EXCEPTION 'No se puede registrar un cobro sobre una obligación anulada.' USING ERRCODE = '22023';
  END IF;

  v_balance := v_charge.amount - v_charge.paid_amount - v_charge.adjusted_amount;
  IF v_balance <= 0 THEN
    RAISE EXCEPTION 'Esta cuenta por cobrar ya se encuentra pagada en su totalidad.' USING ERRCODE = '22023';
  END IF;

  IF p_received_amount IS NULL OR p_received_amount <= 0 THEN
    RAISE EXCEPTION 'El importe recibido debe ser mayor a 0.' USING ERRCODE = '22023';
  END IF;

  IF p_applied_amount IS NULL OR p_applied_amount <= 0 THEN
    RAISE EXCEPTION 'El monto aplicado a la obligación debe ser mayor a 0.' USING ERRCODE = '22023';
  END IF;

  IF p_applied_amount > p_received_amount THEN
    RAISE EXCEPTION 'El monto aplicado no puede superar el importe recibido.' USING ERRCODE = '22023';
  END IF;

  IF p_applied_amount > v_balance THEN
    RAISE EXCEPTION 'El monto aplicado (%) no puede superar el saldo pendiente (%).', p_applied_amount, v_balance USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(full_name, email, 'Operador') INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor;

  v_credit := round(p_received_amount - p_applied_amount, 2);

  INSERT INTO public.payments (
    tenant_id, property_id, unit_id, tenant_person_id, entry_kind, status,
    effective_at, received_amount, applied_amount, credit_amount, currency,
    payment_method, reference_code, notes, collected_by_user_id, collected_by_name, idempotency_key
  )
  VALUES (
    p_tenant_id, v_charge.property_id, v_charge.unit_id, v_charge.tenant_person_id,
    'collection', 'confirmed', COALESCE(p_effective_at, now()),
    round(p_received_amount, 2), round(p_applied_amount, 2), v_credit, v_charge.currency,
    p_payment_method, COALESCE(trim(p_reference_code), ''), COALESCE(trim(p_notes), ''),
    v_actor, COALESCE(v_actor_name, 'Operador'), NULLIF(trim(COALESCE(p_idempotency_key, '')), '')
  )
  RETURNING * INTO v_payment;

  INSERT INTO public.payment_allocations (
    tenant_id, payment_id, receivable_charge_id, allocation_kind, allocated_amount, notes, created_by
  )
  VALUES (
    p_tenant_id, v_payment.id, v_charge.id, 'payment', round(p_applied_amount, 2),
    COALESCE(trim(p_notes), ''), v_actor
  );

  IF v_credit > 0 THEN
    INSERT INTO public.tenant_credits (
      tenant_id, tenant_person_id, source_payment_id, currency, original_amount, remaining_amount, notes
    )
    VALUES (
      p_tenant_id, v_charge.tenant_person_id, v_payment.id, v_charge.currency,
      v_credit, v_credit, 'Excedente de cobro pendiente de aplicación manual autorizada'
    );
  END IF;

  v_new_paid := round(v_charge.paid_amount + p_applied_amount, 2);
  v_new_status := CASE
    WHEN v_new_paid + v_charge.adjusted_amount >= v_charge.amount THEN 'paid'::public.receivable_status
    ELSE 'partially_paid'::public.receivable_status
  END;

  UPDATE public.receivable_charges
  SET paid_amount = v_new_paid,
      status = v_new_status
  WHERE id = v_charge.id AND tenant_id = p_tenant_id;

  -- Emite recibo correlativo dentro de la misma transacción (CA-035)
  v_receipt := public.issue_rent_receipt(p_tenant_id, v_payment.id);

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'payment.confirmed', 'payments', v_payment.id,
    jsonb_build_object(
      'receipt_number', v_receipt.receipt_number,
      'receivable_charge_id', v_charge.id,
      'received_amount', v_payment.received_amount,
      'applied_amount', v_payment.applied_amount,
      'credit_amount', v_payment.credit_amount,
      'currency', v_payment.currency
    )
  );

  RETURN jsonb_build_object('payment', to_jsonb(v_payment), 'receipt', to_jsonb(v_receipt));
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_rent_payment(uuid, uuid, timestamptz, numeric, numeric, public.payment_method, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_rent_payment(uuid, uuid, timestamptz, numeric, numeric, public.payment_method, text, text, text) TO authenticated;

-- Revertir cobro confirmado mediante movimiento inverso auditado sin borrar el original (RF-037 / CA-037)
CREATE OR REPLACE FUNCTION public.reverse_rent_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_reason text
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_orig public.payments;
  v_reversal public.payments;
  v_alloc record;
  v_charge public.receivable_charges;
  v_new_paid numeric(14,2);
  v_credit record;
BEGIN
  SELECT * INTO v_orig
  FROM public.payments
  WHERE id = p_payment_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado en el tenant activo.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'collections', 'reverse', v_orig.property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para revertir cobros en esta casa.' USING ERRCODE = '42501';
  END IF;

  IF v_orig.entry_kind <> 'collection' THEN
    RAISE EXCEPTION 'No se puede revertir un movimiento de reversión.' USING ERRCODE = '22023';
  END IF;

  IF v_orig.status = 'reversed' THEN
    RAISE EXCEPTION 'Este cobro ya fue revertido anteriormente.' USING ERRCODE = '22023';
  END IF;

  IF char_length(trim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Debes ingresar el motivo de la reversión.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_credit
  FROM public.tenant_credits
  WHERE tenant_id = p_tenant_id AND source_payment_id = v_orig.id
  FOR UPDATE;

  IF FOUND AND v_credit.remaining_amount < v_credit.original_amount THEN
    RAISE EXCEPTION 'El excedente generado por este cobro ya fue utilizado parcialmente y no puede revertirse directamente.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(full_name, email, 'Operador') INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor;

  -- Conservar el cobro original intacto y marcar estado reversed
  UPDATE public.payments
  SET status = 'reversed',
      reversal_reason = trim(p_reason)
  WHERE id = v_orig.id AND tenant_id = p_tenant_id;

  INSERT INTO public.payments (
    tenant_id, property_id, unit_id, tenant_person_id, entry_kind, status,
    effective_at, received_amount, applied_amount, credit_amount, currency,
    payment_method, reference_code, notes, collected_by_user_id, collected_by_name,
    reversed_payment_id, reversal_reason
  )
  VALUES (
    p_tenant_id, v_orig.property_id, v_orig.unit_id, v_orig.tenant_person_id,
    'reversal', 'confirmed', now(), v_orig.received_amount, v_orig.applied_amount,
    v_orig.credit_amount, v_orig.currency, v_orig.payment_method, v_orig.reference_code,
    'Reversión compensatoria de cobro', v_actor, COALESCE(v_actor_name, 'Operador'),
    v_orig.id, trim(p_reason)
  )
  RETURNING * INTO v_reversal;

  FOR v_alloc IN
    SELECT * FROM public.payment_allocations
    WHERE tenant_id = p_tenant_id AND payment_id = v_orig.id AND allocation_kind = 'payment'
  LOOP
    SELECT * INTO v_charge
    FROM public.receivable_charges
    WHERE id = v_alloc.receivable_charge_id AND tenant_id = p_tenant_id
    FOR UPDATE;

    INSERT INTO public.payment_allocations (
      tenant_id, payment_id, receivable_charge_id, allocation_kind, allocated_amount, notes, created_by
    )
    VALUES (
      p_tenant_id, v_reversal.id, v_charge.id, 'reversal', -v_alloc.allocated_amount,
      trim(p_reason), v_actor
    );

    v_new_paid := GREATEST(0, round(v_charge.paid_amount - v_alloc.allocated_amount, 2));
    UPDATE public.receivable_charges
    SET paid_amount = v_new_paid,
        status = CASE
          WHEN v_charge.status = 'voided' THEN 'voided'::public.receivable_status
          WHEN v_new_paid = 0 THEN 'pending'::public.receivable_status
          WHEN v_new_paid + v_charge.adjusted_amount >= v_charge.amount THEN 'paid'::public.receivable_status
          ELSE 'partially_paid'::public.receivable_status
        END
    WHERE id = v_charge.id AND tenant_id = p_tenant_id;
  END LOOP;

  IF v_credit.id IS NOT NULL THEN
    UPDATE public.tenant_credits
    SET remaining_amount = 0,
        notes = COALESCE(notes, '') || ' [Anulado por reversión]'
    WHERE id = v_credit.id AND tenant_id = p_tenant_id;
  END IF;

  UPDATE public.receipts
  SET status = 'voided_by_reversal'
  WHERE tenant_id = p_tenant_id AND payment_id = v_orig.id;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'payment.reversed', 'payments', v_orig.id,
    jsonb_build_object('reversal_payment_id', v_reversal.id, 'reason', trim(p_reason), 'amount', v_orig.applied_amount)
  );

  RETURN v_reversal;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_rent_payment(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_rent_payment(uuid, uuid, text) TO authenticated;

-- Aplicar saldo de crédito por excedente mediante acción autorizada y auditada (§4.6)
CREATE OR REPLACE FUNCTION public.apply_tenant_credit(
  p_tenant_id uuid,
  p_credit_id uuid,
  p_receivable_charge_id uuid,
  p_amount numeric,
  p_notes text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_credit public.tenant_credits;
  v_charge public.receivable_charges;
  v_balance numeric(14,2);
  v_new_paid numeric(14,2);
BEGIN
  SELECT * INTO v_credit
  FROM public.tenant_credits
  WHERE id = p_credit_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Crédito de excedente no encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_charge
  FROM public.receivable_charges
  WHERE id = p_receivable_charge_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta por cobrar no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'collections', 'create', v_charge.property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para aplicar créditos en esta casa.' USING ERRCODE = '42501';
  END IF;

  IF v_credit.tenant_person_id <> v_charge.tenant_person_id THEN
    RAISE EXCEPTION 'El crédito pertenece a un inquilino diferente.' USING ERRCODE = '22023';
  END IF;

  IF v_credit.currency <> v_charge.currency THEN
    RAISE EXCEPTION 'No se permite compensar créditos y obligaciones en monedas distintas (% vs %).', v_credit.currency, v_charge.currency USING ERRCODE = '22023';
  END IF;

  v_balance := v_charge.amount - v_charge.paid_amount - v_charge.adjusted_amount;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_credit.remaining_amount OR p_amount > v_balance THEN
    RAISE EXCEPTION 'Importe de aplicación de crédito inválido respecto al saldo disponible.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tenant_credits
  SET remaining_amount = round(remaining_amount - p_amount, 2)
  WHERE id = v_credit.id AND tenant_id = p_tenant_id;

  INSERT INTO public.payment_allocations (
    tenant_id, payment_id, receivable_charge_id, allocation_kind, allocated_amount, notes, created_by
  )
  VALUES (
    p_tenant_id, v_credit.source_payment_id, v_charge.id, 'credit_application', round(p_amount, 2),
    COALESCE(NULLIF(trim(p_notes), ''), 'Aplicación manual de crédito por excedente'), v_actor
  );

  v_new_paid := round(v_charge.paid_amount + p_amount, 2);
  UPDATE public.receivable_charges
  SET paid_amount = v_new_paid,
      status = CASE
        WHEN v_new_paid + v_charge.adjusted_amount >= v_charge.amount THEN 'paid'::public.receivable_status
        ELSE 'partially_paid'::public.receivable_status
      END
  WHERE id = v_charge.id AND tenant_id = p_tenant_id;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'credit.applied', 'tenant_credits', v_credit.id,
    jsonb_build_object('receivable_charge_id', v_charge.id, 'amount', p_amount, 'currency', v_credit.currency)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_tenant_credit(uuid, uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_tenant_credit(uuid, uuid, uuid, numeric, text) TO authenticated;
