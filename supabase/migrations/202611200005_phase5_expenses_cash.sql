-- ============================================================================
-- Archivo: supabase/migrations/202611200005_phase5_expenses_cash.sql
-- Responsabilidad: Esquema SQL de Fase 5 para LuchoRentas (Categorías de gasto,
--   Gastos/Cuentas por Pagar con registro/aprobación/pago diferenciados, Pagos a
--   proveedores, Cajas independientes por usuario y moneda BOB/USD, Movimientos
--   inmutables y compensatorios, Arqueos con aprobación de diferencias, Cierre
--   definitivo de caja y Adjuntos privados con RLS y RPCs transaccionales).
-- Cumplimiento LuchoRentas.md: RF-040 a RF-045, RF-054, RF-055, §4.7, §4.8,
--   §10.1, §10.2, §11.3 (create_expense, confirm_expense_payment, open_cash_session,
--   record_cash_reconciliation, close_cash_session), DEC-01, DEC-07, DEC-08, DEC-09, DEC-13.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tipos enumerados de Fase 5
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.expense_scope AS ENUM ('property', 'unit', 'tenant_general');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.expense_status AS ENUM (
    'pending_approval',
    'approved',
    'partially_paid',
    'paid',
    'voided'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.cash_session_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.cash_movement_direction AS ENUM ('inflow', 'outflow');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.cash_movement_source AS ENUM (
    'opening',
    'rent_collection',
    'collection_reversal',
    'expense_payment',
    'manual_adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.reconciliation_status AS ENUM (
    'balanced',
    'pending_approval',
    'approved'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Tablas de Gastos y Cuentas por Pagar (§4.7 / DEC-09)
-- ----------------------------------------------------------------------------

-- Categorías de gasto por tenant (RF-041 / CA-041)
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  is_system_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_expense_categories_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_expense_categories_tenant_name UNIQUE (tenant_id, name)
);

CREATE TRIGGER trg_expense_categories_updated_at
  BEFORE UPDATE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Gastos / Cuentas por Pagar (registro, aprobación y pago diferenciados)
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  expense_code text NOT NULL,
  scope public.expense_scope NOT NULL,
  property_id uuid DEFAULT NULL,
  unit_id uuid DEFAULT NULL,
  category_id uuid NOT NULL,
  supplier_person_id uuid DEFAULT NULL,
  concept text NOT NULL CHECK (char_length(trim(concept)) >= 2),
  expense_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/La_Paz')::date,
  due_date date DEFAULT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0 AND paid_amount <= amount),
  currency public.currency_code NOT NULL DEFAULT 'BOB',
  status public.expense_status NOT NULL DEFAULT 'pending_approval',
  notes text NOT NULL DEFAULT '',
  evidence_name text NOT NULL DEFAULT '',
  evidence_path text NOT NULL DEFAULT '',
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz DEFAULT NULL,
  void_reason text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_expenses_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_expenses_code UNIQUE (tenant_id, expense_code),
  CONSTRAINT chk_expense_scope_refs CHECK (
    (scope = 'tenant_general' AND property_id IS NULL AND unit_id IS NULL)
    OR (scope = 'property' AND property_id IS NOT NULL AND unit_id IS NULL)
    OR (scope = 'unit' AND property_id IS NOT NULL AND unit_id IS NOT NULL)
  ),
  CONSTRAINT fk_expenses_property
    FOREIGN KEY (tenant_id, property_id)
    REFERENCES public.properties (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_unit
    FOREIGN KEY (tenant_id, property_id, unit_id)
    REFERENCES public.property_units (tenant_id, property_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_category
    FOREIGN KEY (tenant_id, category_id)
    REFERENCES public.expense_categories (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_supplier
    FOREIGN KEY (tenant_id, supplier_person_id)
    REFERENCES public.people (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date
  ON public.expenses (tenant_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_status
  ON public.expenses (tenant_id, status, due_date);

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Tablas de Caja Independiente por Usuario y Moneda, Movimientos y Arqueos (§4.8)
-- ----------------------------------------------------------------------------

-- Cajas lógicas independientes por usuario y moneda (DEC-07)
CREATE TABLE IF NOT EXISTS public.cash_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  owner_name text NOT NULL,
  currency public.currency_code NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cash_accounts_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_cash_accounts_user_currency UNIQUE (tenant_id, owner_user_id, currency),
  CONSTRAINT uq_cash_accounts_tenant_id_currency UNIQUE (tenant_id, id, currency)
);

CREATE TRIGGER trg_cash_accounts_updated_at
  BEFORE UPDATE ON public.cash_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sesiones de caja (apertura, operación y cierre definitivo sin reapertura)
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cash_account_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  owner_name text NOT NULL,
  currency public.currency_code NOT NULL,
  status public.cash_session_status NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_balance numeric(14,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  closed_at timestamptz DEFAULT NULL,
  closing_expected_balance numeric(14,2) DEFAULT NULL,
  closing_counted_balance numeric(14,2) DEFAULT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cash_sessions_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_cash_sessions_tenant_id_curr UNIQUE (tenant_id, id, currency),
  CONSTRAINT fk_cash_sessions_account
    FOREIGN KEY (tenant_id, cash_account_id, currency)
    REFERENCES public.cash_accounts (tenant_id, id, currency)
    ON DELETE RESTRICT
);

-- Máximo una caja abierta por usuario y moneda dentro del mismo tenant (DEC-07)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_sessions_one_open_per_user_currency
  ON public.cash_sessions (tenant_id, owner_user_id, currency)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant_opened
  ON public.cash_sessions (tenant_id, opened_at DESC);

CREATE TRIGGER trg_cash_sessions_updated_at
  BEFORE UPDATE ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Pagos confirmados de gastos/proveedores (solo estos generan egreso real DEC-09)
CREATE TABLE IF NOT EXISTS public.expense_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL,
  cash_session_id uuid NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency public.currency_code NOT NULL,
  payment_method public.payment_method NOT NULL DEFAULT 'cash',
  reference_code text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  paid_by_user_id uuid REFERENCES public.profiles(id),
  paid_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_expense_payments_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_expense_payments_expense
    FOREIGN KEY (tenant_id, expense_id)
    REFERENCES public.expenses (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_expense_payments_session
    FOREIGN KEY (tenant_id, cash_session_id, currency)
    REFERENCES public.cash_sessions (tenant_id, id, currency)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_expense_payments_tenant_effective
  ON public.expense_payments (tenant_id, effective_at DESC);

-- Libro inmutable de movimientos de caja por moneda (§4.8 / §10.2)
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cash_account_id uuid NOT NULL,
  cash_session_id uuid NOT NULL,
  currency public.currency_code NOT NULL,
  direction public.cash_movement_direction NOT NULL,
  source_type public.cash_movement_source NOT NULL,
  source_id uuid DEFAULT NULL,
  linked_movement_id uuid DEFAULT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id),
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cash_movements_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_cash_movements_session
    FOREIGN KEY (tenant_id, cash_session_id, currency)
    REFERENCES public.cash_sessions (tenant_id, id, currency)
    ON DELETE RESTRICT,
  CONSTRAINT fk_cash_movements_linked
    FOREIGN KEY (tenant_id, linked_movement_id)
    REFERENCES public.cash_movements (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_session
  ON public.cash_movements (tenant_id, cash_session_id, effective_at DESC);

-- Arqueos y conciliaciones de caja con aprobación de diferencias (RF-055 / DEC-08)
CREATE TABLE IF NOT EXISTS public.cash_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cash_session_id uuid NOT NULL,
  currency public.currency_code NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  expected_balance numeric(14,2) NOT NULL,
  counted_balance numeric(14,2) NOT NULL CHECK (counted_balance >= 0),
  difference_amount numeric(14,2) NOT NULL,
  difference_reason text NOT NULL DEFAULT '',
  evidence_note text NOT NULL DEFAULT '',
  status public.reconciliation_status NOT NULL,
  recorded_by uuid REFERENCES public.profiles(id),
  recorded_by_name text NOT NULL DEFAULT '',
  approved_by uuid REFERENCES public.profiles(id),
  approved_by_name text NOT NULL DEFAULT '',
  approved_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_cash_reconciliations_session
    FOREIGN KEY (tenant_id, cash_session_id, currency)
    REFERENCES public.cash_sessions (tenant_id, id, currency)
    ON DELETE RESTRICT
);

-- Metadatos de comprobantes adjuntos privados (RF-045 / CA-045)
CREATE TABLE IF NOT EXISTS public.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  storage_path text NOT NULL,
  uploaded_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Bucket privado para comprobantes (RF-045)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'luchorentas-attachments',
  'luchorentas-attachments',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. RLS obligatorio (aislamiento multi-tenant, alcance por casa y caja por usuario)
-- ----------------------------------------------------------------------------

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- EXPENSE_CATEGORIES
CREATE POLICY expense_categories_select_authorized
  ON public.expense_categories FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'expenses', 'view', NULL));

-- EXPENSES: respeta alcance por casa DEC-13 cuando está asociado a una propiedad
CREATE POLICY expenses_select_authorized
  ON public.expenses FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'expenses', 'view', property_id));

-- EXPENSE_PAYMENTS
CREATE POLICY expense_payments_select_authorized
  ON public.expense_payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id
        AND e.tenant_id = expense_payments.tenant_id
        AND public.current_user_has_permission(e.tenant_id, 'expenses', 'view', e.property_id)
    )
  );

-- CASH_ACCOUNTS / SESSIONS / MOVEMENTS / RECONCILIATIONS:
-- Quien tiene cash:reconcile ve todas las cajas del tenant; quien solo tiene cash:view ve su propia caja (§4.8)
CREATE POLICY cash_accounts_select_authorized
  ON public.cash_accounts FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_permission(tenant_id, 'cash', 'reconcile', NULL)
    OR (
      owner_user_id = auth.uid()
      AND public.current_user_has_permission(tenant_id, 'cash', 'view', NULL)
    )
  );

CREATE POLICY cash_sessions_select_authorized
  ON public.cash_sessions FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_permission(tenant_id, 'cash', 'reconcile', NULL)
    OR (
      owner_user_id = auth.uid()
      AND public.current_user_has_permission(tenant_id, 'cash', 'view', NULL)
    )
  );

CREATE POLICY cash_movements_select_authorized
  ON public.cash_movements FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_permission(tenant_id, 'cash', 'reconcile', NULL)
    OR EXISTS (
      SELECT 1 FROM public.cash_sessions cs
      WHERE cs.id = cash_session_id
        AND cs.tenant_id = cash_movements.tenant_id
        AND cs.owner_user_id = auth.uid()
        AND public.current_user_has_permission(cs.tenant_id, 'cash', 'view', NULL)
    )
  );

CREATE POLICY cash_reconciliations_select_authorized
  ON public.cash_reconciliations FOR SELECT
  TO authenticated
  USING (
    public.current_user_has_permission(tenant_id, 'cash', 'reconcile', NULL)
    OR EXISTS (
      SELECT 1 FROM public.cash_sessions cs
      WHERE cs.id = cash_session_id
        AND cs.tenant_id = cash_reconciliations.tenant_id
        AND cs.owner_user_id = auth.uid()
        AND public.current_user_has_permission(cs.tenant_id, 'cash', 'view', NULL)
    )
  );

-- ATTACHMENTS
CREATE POLICY attachments_select_authorized
  ON public.attachments FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'expenses', 'view', NULL));

CREATE POLICY attachments_insert_authorized
  ON public.attachments FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_has_permission(tenant_id, 'expenses', 'manage', NULL));

-- Políticas de Storage privado por prefijo tenant_id/
DO $$ BEGIN
  CREATE POLICY luchorentas_storage_select
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'luchorentas-attachments'
      AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
      AND public.current_user_has_permission(((storage.foldername(name))[1])::uuid, 'expenses', 'view', NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY luchorentas_storage_insert
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'luchorentas-attachments'
      AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
      AND public.current_user_has_permission(((storage.foldername(name))[1])::uuid, 'expenses', 'manage', NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Semilla automática de categorías iniciales para tenants existentes y RPCs
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_default_expense_categories(p_tenant_id uuid)
RETURNS SETOF public.expense_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT (
    public.current_user_has_permission(p_tenant_id, 'expenses', 'view', NULL)
    OR public.current_user_has_permission(p_tenant_id, 'expenses', 'manage', NULL)
  ) THEN
    RAISE EXCEPTION 'Acceso denegado a categorías de gasto.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.expense_categories (tenant_id, name, is_system_default)
  VALUES
    (p_tenant_id, 'Energía eléctrica', true),
    (p_tenant_id, 'Agua potable', true),
    (p_tenant_id, 'Internet', true),
    (p_tenant_id, 'Mantenimiento/reparación', true),
    (p_tenant_id, 'Limpieza', true),
    (p_tenant_id, 'Otros', true)
  ON CONFLICT (tenant_id, name) DO NOTHING;

  RETURN QUERY
  SELECT * FROM public.expense_categories
  WHERE tenant_id = p_tenant_id AND is_active = true
  ORDER BY is_system_default DESC, name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_default_expense_categories(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_default_expense_categories(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_expense_category(
  p_tenant_id uuid,
  p_name text
)
RETURNS public.expense_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cat public.expense_categories;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'expenses', 'manage', NULL) THEN
    RAISE EXCEPTION 'Acceso denegado para crear categorías de gasto.' USING ERRCODE = '42501';
  END IF;

  IF char_length(trim(COALESCE(p_name, ''))) < 2 THEN
    RAISE EXCEPTION 'El nombre de la categoría debe tener al menos 2 caracteres.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.expense_categories (tenant_id, name, is_system_default)
  VALUES (p_tenant_id, trim(p_name), false)
  RETURNING * INTO v_cat;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (p_tenant_id, v_actor, 'expense_category.created', 'expense_categories', v_cat.id, jsonb_build_object('name', v_cat.name));

  RETURN v_cat;
END;
$$;

REVOKE ALL ON FUNCTION public.create_expense_category(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_expense_category(uuid, text) TO authenticated;

-- Registrar gasto (RF-040 / DEC-09: nace en pending_approval sin generar egreso de caja)
CREATE OR REPLACE FUNCTION public.create_expense(
  p_tenant_id uuid,
  p_scope public.expense_scope,
  p_property_id uuid,
  p_unit_id uuid,
  p_category_id uuid,
  p_supplier_person_id uuid,
  p_concept text,
  p_expense_date date,
  p_due_date date,
  p_amount numeric,
  p_currency public.currency_code,
  p_notes text DEFAULT '',
  p_evidence_name text DEFAULT '',
  p_evidence_path text DEFAULT ''
)
RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_code text;
  v_exp public.expenses;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'expenses', 'manage', p_property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para registrar gastos en este ámbito.' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El importe del gasto debe ser mayor a 0.' USING ERRCODE = '22023';
  END IF;

  IF char_length(trim(COALESCE(p_concept, ''))) < 2 THEN
    RAISE EXCEPTION 'El concepto del gasto es obligatorio.' USING ERRCODE = '22023';
  END IF;

  IF p_supplier_person_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.person_roles
      WHERE tenant_id = p_tenant_id AND person_id = p_supplier_person_id AND role = 'supplier'
    ) THEN
      RAISE EXCEPTION 'La persona seleccionada no posee el rol de Proveedor en este tenant.' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_code := 'GAS-' || to_char(COALESCE(p_expense_date, (now() AT TIME ZONE 'America/La_Paz')::date), 'YYYYMM') || '-' || upper(substr(gen_random_uuid()::text, 1, 4));

  INSERT INTO public.expenses (
    tenant_id, expense_code, scope, property_id, unit_id, category_id, supplier_person_id,
    concept, expense_date, due_date, amount, paid_amount, currency, status, notes,
    evidence_name, evidence_path, created_by
  )
  VALUES (
    p_tenant_id, v_code, p_scope, p_property_id, p_unit_id, p_category_id, p_supplier_person_id,
    trim(p_concept), COALESCE(p_expense_date, (now() AT TIME ZONE 'America/La_Paz')::date), p_due_date,
    round(p_amount, 2), 0, p_currency, 'pending_approval', COALESCE(trim(p_notes), ''),
    COALESCE(trim(p_evidence_name), ''), COALESCE(trim(p_evidence_path), ''), v_actor
  )
  RETURNING * INTO v_exp;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'expense.created', 'expenses', v_exp.id,
    jsonb_build_object('expense_code', v_exp.expense_code, 'amount', v_exp.amount, 'currency', v_exp.currency, 'scope', v_exp.scope)
  );

  RETURN v_exp;
END;
$$;

REVOKE ALL ON FUNCTION public.create_expense(uuid, public.expense_scope, uuid, uuid, uuid, uuid, text, date, date, numeric, public.currency_code, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_expense(uuid, public.expense_scope, uuid, uuid, uuid, uuid, text, date, date, numeric, public.currency_code, text, text, text) TO authenticated;

-- Aprobar gasto (evento diferenciado del registro y del pago, DEC-09)
CREATE OR REPLACE FUNCTION public.approve_expense(
  p_tenant_id uuid,
  p_expense_id uuid
)
RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_exp public.expenses;
BEGIN
  SELECT * INTO v_exp
  FROM public.expenses
  WHERE id = p_expense_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gasto no encontrado en el tenant activo.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'expenses', 'manage', v_exp.property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para aprobar este gasto.' USING ERRCODE = '42501';
  END IF;

  IF v_exp.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Solo pueden aprobarse gastos en estado Pendiente de aprobación.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.expenses
  SET status = 'approved',
      approved_by = v_actor,
      approved_at = now()
  WHERE id = v_exp.id AND tenant_id = p_tenant_id
  RETURNING * INTO v_exp;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (p_tenant_id, v_actor, 'expense.approved', 'expenses', v_exp.id, jsonb_build_object('expense_code', v_exp.expense_code));

  RETURN v_exp;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_expense(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_expense(uuid, uuid) TO authenticated;

-- Anular gasto sin pagos aplicados con motivo obligatorio (§4.7)
CREATE OR REPLACE FUNCTION public.void_expense(
  p_tenant_id uuid,
  p_expense_id uuid,
  p_reason text
)
RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_exp public.expenses;
BEGIN
  SELECT * INTO v_exp
  FROM public.expenses
  WHERE id = p_expense_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gasto no encontrado en el tenant activo.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'expenses', 'manage', v_exp.property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para anular este gasto.' USING ERRCODE = '42501';
  END IF;

  IF v_exp.status = 'voided' THEN
    RAISE EXCEPTION 'Este gasto ya se encuentra anulado.' USING ERRCODE = '22023';
  END IF;

  IF v_exp.paid_amount > 0 THEN
    RAISE EXCEPTION 'No se puede anular un gasto que ya tiene pagos confirmados.' USING ERRCODE = '22023';
  END IF;

  IF char_length(trim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Debes indicar el motivo de anulación del gasto.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.expenses
  SET status = 'voided',
      void_reason = trim(p_reason)
  WHERE id = v_exp.id AND tenant_id = p_tenant_id
  RETURNING * INTO v_exp;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (p_tenant_id, v_actor, 'expense.voided', 'expenses', v_exp.id, jsonb_build_object('reason', trim(p_reason)));

  RETURN v_exp;
END;
$$;

REVOKE ALL ON FUNCTION public.void_expense(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_expense(uuid, uuid, text) TO authenticated;

-- Abrir sesión de caja independiente por usuario y moneda (DEC-07 / §4.8)
CREATE OR REPLACE FUNCTION public.open_cash_session(
  p_tenant_id uuid,
  p_currency public.currency_code,
  p_opening_balance numeric DEFAULT 0,
  p_notes text DEFAULT ''
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_acc public.cash_accounts;
  v_session public.cash_sessions;
BEGIN
  IF NOT (
    public.current_user_has_permission(p_tenant_id, 'cash', 'view', NULL)
    OR public.current_user_has_permission(p_tenant_id, 'cash', 'reconcile', NULL)
  ) THEN
    RAISE EXCEPTION 'Acceso denegado para abrir caja en este tenant.' USING ERRCODE = '42501';
  END IF;

  IF p_opening_balance IS NULL OR p_opening_balance < 0 THEN
    RAISE EXCEPTION 'El saldo inicial de caja no puede ser negativo.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cash_sessions
    WHERE tenant_id = p_tenant_id AND owner_user_id = v_actor AND currency = p_currency AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una caja abierta en moneda %. Ciérrala antes de abrir una nueva.', p_currency USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(full_name, email, 'Operador') INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor;

  INSERT INTO public.cash_accounts (tenant_id, owner_user_id, owner_name, currency)
  VALUES (p_tenant_id, v_actor, COALESCE(v_actor_name, 'Operador'), p_currency)
  ON CONFLICT (tenant_id, owner_user_id, currency) DO UPDATE
    SET owner_name = EXCLUDED.owner_name,
        is_active = true
  RETURNING * INTO v_acc;

  INSERT INTO public.cash_sessions (
    tenant_id, cash_account_id, owner_user_id, owner_name, currency, status,
    opened_at, opening_balance, notes
  )
  VALUES (
    p_tenant_id, v_acc.id, v_actor, COALESCE(v_actor_name, 'Operador'), p_currency, 'open',
    now(), round(p_opening_balance, 2), COALESCE(trim(p_notes), '')
  )
  RETURNING * INTO v_session;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'cash_session.opened', 'cash_sessions', v_session.id,
    jsonb_build_object('currency', p_currency, 'opening_balance', v_session.opening_balance)
  );

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.open_cash_session(uuid, public.currency_code, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_cash_session(uuid, public.currency_code, numeric, text) TO authenticated;

-- Confirmar pago parcial o total de gasto + generar egreso efectivo en caja abierta (RF-043 / DEC-09)
CREATE OR REPLACE FUNCTION public.confirm_expense_payment(
  p_tenant_id uuid,
  p_expense_id uuid,
  p_cash_session_id uuid,
  p_effective_at timestamptz,
  p_amount numeric,
  p_payment_method public.payment_method DEFAULT 'cash',
  p_reference_code text DEFAULT '',
  p_notes text DEFAULT ''
)
RETURNS public.expense_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_exp public.expenses;
  v_session public.cash_sessions;
  v_pending numeric(14,2);
  v_new_paid numeric(14,2);
  v_payment public.expense_payments;
BEGIN
  SELECT * INTO v_exp
  FROM public.expenses
  WHERE id = p_expense_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gasto no encontrado en el tenant activo.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'expenses', 'manage', v_exp.property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para pagar este gasto.' USING ERRCODE = '42501';
  END IF;

  IF v_exp.status NOT IN ('approved', 'partially_paid') THEN
    RAISE EXCEPTION 'El gasto debe estar Aprobado o Parcialmente pagado antes de confirmar un pago.' USING ERRCODE = '22023';
  END IF;

  v_pending := v_exp.amount - v_exp.paid_amount;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_pending THEN
    RAISE EXCEPTION 'El monto a pagar (%) debe ser mayor a 0 y menor o igual al saldo (%).', p_amount, v_pending USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE id = p_cash_session_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión de caja no encontrada en el tenant activo.' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'No se permiten movimientos en una caja cerrada (§4.8).' USING ERRCODE = '22023';
  END IF;

  IF v_session.currency <> v_exp.currency THEN
    RAISE EXCEPTION 'No se permite pagar un gasto en % desde una caja en % (§4.8 / DEC-01).', v_exp.currency, v_session.currency USING ERRCODE = '22023';
  END IF;

  IF v_session.owner_user_id <> v_actor AND NOT public.current_user_has_permission(p_tenant_id, 'cash', 'reconcile', NULL) THEN
    RAISE EXCEPTION 'No puedes registrar egresos en la caja de otro usuario.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(full_name, email, 'Operador') INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor;

  INSERT INTO public.expense_payments (
    tenant_id, expense_id, cash_session_id, effective_at, amount, currency,
    payment_method, reference_code, notes, paid_by_user_id, paid_by_name
  )
  VALUES (
    p_tenant_id, v_exp.id, v_session.id, COALESCE(p_effective_at, now()),
    round(p_amount, 2), v_exp.currency, p_payment_method,
    COALESCE(trim(p_reference_code), ''), COALESCE(trim(p_notes), ''),
    v_actor, COALESCE(v_actor_name, 'Operador')
  )
  RETURNING * INTO v_payment;

  INSERT INTO public.cash_movements (
    tenant_id, cash_account_id, cash_session_id, currency, direction, source_type,
    source_id, effective_at, amount, notes, created_by, created_by_name
  )
  VALUES (
    p_tenant_id, v_session.cash_account_id, v_session.id, v_exp.currency, 'outflow',
    'expense_payment', v_payment.id, v_payment.effective_at, v_payment.amount,
    'Pago de gasto ' || v_exp.expense_code || ': ' || v_exp.concept,
    v_actor, COALESCE(v_actor_name, 'Operador')
  );

  v_new_paid := round(v_exp.paid_amount + p_amount, 2);
  UPDATE public.expenses
  SET paid_amount = v_new_paid,
      status = CASE
        WHEN v_new_paid >= v_exp.amount THEN 'paid'::public.expense_status
        ELSE 'partially_paid'::public.expense_status
      END
  WHERE id = v_exp.id AND tenant_id = p_tenant_id;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'expense_payment.confirmed', 'expense_payments', v_payment.id,
    jsonb_build_object('expense_id', v_exp.id, 'cash_session_id', v_session.id, 'amount', v_payment.amount, 'currency', v_payment.currency)
  );

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_expense_payment(uuid, uuid, uuid, timestamptz, numeric, public.payment_method, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_expense_payment(uuid, uuid, uuid, timestamptz, numeric, public.payment_method, text, text) TO authenticated;

-- Registrar movimiento compensatorio o ajuste vinculado en caja abierta vigente (§4.8 / DEC-08)
CREATE OR REPLACE FUNCTION public.record_cash_adjustment(
  p_tenant_id uuid,
  p_cash_session_id uuid,
  p_direction public.cash_movement_direction,
  p_amount numeric,
  p_reason text,
  p_linked_movement_id uuid DEFAULT NULL
)
RETURNS public.cash_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_session public.cash_sessions;
  v_linked public.cash_movements;
  v_mov public.cash_movements;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'cash', 'reconcile', NULL) THEN
    RAISE EXCEPTION 'Acceso denegado para registrar ajustes compensatorios de caja.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE id = p_cash_session_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND OR v_session.status <> 'open' THEN
    RAISE EXCEPTION 'El movimiento compensatorio debe registrarse en una caja abierta vigente.' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto del ajuste debe ser mayor a 0.' USING ERRCODE = '22023';
  END IF;

  IF char_length(trim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Debes ingresar un motivo válido para el ajuste compensatorio.' USING ERRCODE = '22023';
  END IF;

  IF p_linked_movement_id IS NOT NULL THEN
    SELECT * INTO v_linked
    FROM public.cash_movements
    WHERE id = p_linked_movement_id AND tenant_id = p_tenant_id;
    IF NOT FOUND OR v_linked.currency <> v_session.currency THEN
      RAISE EXCEPTION 'El movimiento original vinculado debe pertenecer al mismo tenant y moneda.' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT COALESCE(full_name, email, 'Operador') INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor;

  INSERT INTO public.cash_movements (
    tenant_id, cash_account_id, cash_session_id, currency, direction, source_type,
    linked_movement_id, effective_at, amount, notes, created_by, created_by_name
  )
  VALUES (
    p_tenant_id, v_session.cash_account_id, v_session.id, v_session.currency, p_direction,
    'manual_adjustment', p_linked_movement_id, now(), round(p_amount, 2),
    trim(p_reason), v_actor, COALESCE(v_actor_name, 'Operador')
  )
  RETURNING * INTO v_mov;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'cash_movement.adjustment_recorded', 'cash_movements', v_mov.id,
    jsonb_build_object('cash_session_id', v_session.id, 'direction', p_direction, 'amount', v_mov.amount, 'linked_movement_id', p_linked_movement_id)
  );

  RETURN v_mov;
END;
$$;

REVOKE ALL ON FUNCTION public.record_cash_adjustment(uuid, uuid, public.cash_movement_direction, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_cash_adjustment(uuid, uuid, public.cash_movement_direction, numeric, text, uuid) TO authenticated;

-- Arqueo de caja: compara saldo esperado vs contado (RF-055 / DEC-08)
CREATE OR REPLACE FUNCTION public.record_cash_reconciliation(
  p_tenant_id uuid,
  p_cash_session_id uuid,
  p_counted_balance numeric,
  p_difference_reason text DEFAULT '',
  p_evidence_note text DEFAULT ''
)
RETURNS public.cash_reconciliations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_session public.cash_sessions;
  v_inflows numeric(14,2);
  v_outflows numeric(14,2);
  v_expected numeric(14,2);
  v_diff numeric(14,2);
  v_status public.reconciliation_status;
  v_rec public.cash_reconciliations;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'cash', 'reconcile', NULL) THEN
    RAISE EXCEPTION 'Acceso denegado para realizar arqueos de caja.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE id = p_cash_session_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión de caja no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'No se puede arquear una caja ya cerrada.' USING ERRCODE = '22023';
  END IF;

  IF p_counted_balance IS NULL OR p_counted_balance < 0 THEN
    RAISE EXCEPTION 'El saldo contado no puede ser negativo.' USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN direction = 'outflow' THEN amount ELSE 0 END), 0)
  INTO v_inflows, v_outflows
  FROM public.cash_movements
  WHERE tenant_id = p_tenant_id AND cash_session_id = v_session.id;

  v_expected := round(v_session.opening_balance + v_inflows - v_outflows, 2);
  v_diff := round(p_counted_balance - v_expected, 2);

  IF v_diff <> 0 AND char_length(trim(COALESCE(p_difference_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Existe una diferencia de % %. Debes explicar el motivo antes de registrar el arqueo (RF-055).', v_diff, v_session.currency USING ERRCODE = '22023';
  END IF;

  v_status := CASE WHEN v_diff = 0 THEN 'balanced'::public.reconciliation_status ELSE 'pending_approval'::public.reconciliation_status END;

  SELECT COALESCE(full_name, email, 'Operador') INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor;

  INSERT INTO public.cash_reconciliations (
    tenant_id, cash_session_id, currency, reconciled_at, expected_balance,
    counted_balance, difference_amount, difference_reason, evidence_note,
    status, recorded_by, recorded_by_name
  )
  VALUES (
    p_tenant_id, v_session.id, v_session.currency, now(), v_expected,
    round(p_counted_balance, 2), v_diff, COALESCE(trim(p_difference_reason), ''),
    COALESCE(trim(p_evidence_note), ''), v_status, v_actor, COALESCE(v_actor_name, 'Operador')
  )
  RETURNING * INTO v_rec;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'cash_reconciliation.recorded', 'cash_reconciliations', v_rec.id,
    jsonb_build_object('cash_session_id', v_session.id, 'expected', v_expected, 'counted', v_rec.counted_balance, 'difference', v_diff)
  );

  RETURN v_rec;
END;
$$;

REVOKE ALL ON FUNCTION public.record_cash_reconciliation(uuid, uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_cash_reconciliation(uuid, uuid, numeric, text, text) TO authenticated;

-- Aprobar diferencia de arqueo (DEC-08)
CREATE OR REPLACE FUNCTION public.approve_cash_reconciliation(
  p_tenant_id uuid,
  p_reconciliation_id uuid
)
RETURNS public.cash_reconciliations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_rec public.cash_reconciliations;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'cash', 'reconcile', NULL) THEN
    RAISE EXCEPTION 'Acceso denegado para aprobar diferencias de arqueo.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rec
  FROM public.cash_reconciliations
  WHERE id = p_reconciliation_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Arqueo no encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_rec.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Solo pueden aprobarse arqueos con diferencia pendiente.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(full_name, email, 'Operador') INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor;

  UPDATE public.cash_reconciliations
  SET status = 'approved',
      approved_by = v_actor,
      approved_by_name = COALESCE(v_actor_name, 'Operador'),
      approved_at = now()
  WHERE id = v_rec.id AND tenant_id = p_tenant_id
  RETURNING * INTO v_rec;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (p_tenant_id, v_actor, 'cash_reconciliation.approved', 'cash_reconciliations', v_rec.id, jsonb_build_object('difference', v_rec.difference_amount));

  RETURN v_rec;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_cash_reconciliation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_cash_reconciliation(uuid, uuid) TO authenticated;

-- Cierre definitivo de caja (no se reabre ni edita, §4.8 / DEC-08)
CREATE OR REPLACE FUNCTION public.close_cash_session(
  p_tenant_id uuid,
  p_cash_session_id uuid
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.cash_sessions;
  v_last_rec public.cash_reconciliations;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'cash', 'reconcile', NULL) THEN
    RAISE EXCEPTION 'Acceso denegado para cerrar sesiones de caja.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE id = p_cash_session_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión de caja no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'Esta caja ya se encuentra cerrada.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_last_rec
  FROM public.cash_reconciliations
  WHERE tenant_id = p_tenant_id AND cash_session_id = v_session.id
  ORDER BY reconciled_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debes registrar un arqueo antes de cerrar la caja (§4.8).' USING ERRCODE = '22023';
  END IF;

  IF v_last_rec.status = 'pending_approval' THEN
    RAISE EXCEPTION 'La diferencia del último arqueo debe ser aprobada antes de cerrar la caja (DEC-08).' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cash_sessions
  SET status = 'closed',
      closed_at = now(),
      closing_expected_balance = v_last_rec.expected_balance,
      closing_counted_balance = v_last_rec.counted_balance
  WHERE id = v_session.id AND tenant_id = p_tenant_id
  RETURNING * INTO v_session;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'cash_session.closed', 'cash_sessions', v_session.id,
    jsonb_build_object('expected', v_session.closing_expected_balance, 'counted', v_session.closing_counted_balance)
  );

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.close_cash_session(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_cash_session(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Integración automática de Cobros/Reversiones de Fase 4 hacia cash_movements
--    cuando el operador tenga una caja abierta en la misma moneda (§4.8)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_payment_to_cash_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.cash_sessions;
BEGIN
  SELECT * INTO v_session
  FROM public.cash_sessions
  WHERE tenant_id = NEW.tenant_id
    AND owner_user_id = NEW.collected_by_user_id
    AND currency = NEW.currency
    AND status = 'open'
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.cash_movements (
      tenant_id, cash_account_id, cash_session_id, currency, direction, source_type,
      source_id, effective_at, amount, notes, created_by, created_by_name
    )
    VALUES (
      NEW.tenant_id,
      v_session.cash_account_id,
      v_session.id,
      NEW.currency,
      CASE WHEN NEW.entry_kind = 'collection' THEN 'inflow'::public.cash_movement_direction ELSE 'outflow'::public.cash_movement_direction END,
      CASE WHEN NEW.entry_kind = 'collection' THEN 'rent_collection'::public.cash_movement_source ELSE 'collection_reversal'::public.cash_movement_source END,
      NEW.id,
      NEW.effective_at,
      NEW.received_amount,
      CASE WHEN NEW.entry_kind = 'collection' THEN 'Cobro de alquiler registrado' ELSE 'Reversión de cobro: ' || NEW.reversal_reason END,
      NEW.collected_by_user_id,
      NEW.collected_by_name
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_sync_cash_movement ON public.payments;
CREATE TRIGGER trg_payments_sync_cash_movement
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_payment_to_cash_movement();
