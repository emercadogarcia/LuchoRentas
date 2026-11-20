-- ============================================================================
-- Archivo: supabase/migrations/202611200006_phase6_dashboard_reports.sql
-- Responsabilidad: Consultas agregadas y RPCs transaccionales de Fase 6 para
--   LuchoRentas (Dashboard Ejecutivo Modelo A con filtro Mes/Año, Reportes
--   Financieros Modelo D por período, casa y propietario informativo, auditoría
--   de exportación y verificación de salud de esquema/datos por tenant).
-- Cumplimiento LuchoRentas.md: RF-050 a RF-058 (CA-050 a CA-058), §4.9, §9.2–§9.5,
--   §10.3 (agregaciones en PostgreSQL), §11.3 (export_tenant_report), DEC-01,
--   DEC-09, DEC-10, DEC-11, DEC-13, DEC-14 y DEC-15.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Índices adicionales para agregaciones rápidas por fecha y tenant (§10.3)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rental_contracts_tenant_dates
  ON public.rental_contracts (tenant_id, status, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_property_owners_tenant_dates
  ON public.property_owners (tenant_id, person_id, property_id, effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_due_status
  ON public.expenses (tenant_id, status, expense_date, due_date);

-- ----------------------------------------------------------------------------
-- 2. Validación de tablas y presencia de datos del tenant (Salud Fases 1–6)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_luchorentas_schema_health(
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_missing_tables text[] := ARRAY[]::text[];
  v_required_tables text[] := ARRAY[
    'tenants', 'tenant_memberships', 'properties', 'property_units',
    'people', 'property_owners', 'rental_contracts', 'receivable_charges',
    'payments', 'payment_allocations', 'receipts', 'expense_categories',
    'expenses', 'expense_payments', 'cash_sessions', 'cash_movements',
    'cash_reconciliations'
  ];
  v_tbl text;
  v_counts jsonb;
BEGIN
  IF NOT public.current_user_has_active_membership(p_tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado al verificar esquema del tenant.';
  END IF;

  FOREACH v_tbl IN ARRAY v_required_tables LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public'
        AND t.table_name = v_tbl
    ) THEN
      v_missing_tables := array_append(v_missing_tables, v_tbl);
    END IF;
  END LOOP;

  SELECT jsonb_build_object(
    'properties', (SELECT count(*) FROM public.properties p WHERE p.tenant_id = p_tenant_id AND p.is_active = true),
    'units', (SELECT count(*) FROM public.property_units u WHERE u.tenant_id = p_tenant_id AND u.is_active = true),
    'people', (SELECT count(*) FROM public.people pe WHERE pe.tenant_id = p_tenant_id AND pe.is_active = true),
    'activeContracts', (SELECT count(*) FROM public.rental_contracts rc WHERE rc.tenant_id = p_tenant_id AND rc.status = 'active'),
    'receivables', (SELECT count(*) FROM public.receivable_charges ch WHERE ch.tenant_id = p_tenant_id AND ch.status <> 'voided'),
    'payments', (SELECT count(*) FROM public.payments py WHERE py.tenant_id = p_tenant_id AND py.entry_kind = 'collection' AND py.status = 'confirmed'),
    'expenses', (SELECT count(*) FROM public.expenses ex WHERE ex.tenant_id = p_tenant_id AND ex.status <> 'voided'),
    'cashSessions', (SELECT count(*) FROM public.cash_sessions cs WHERE cs.tenant_id = p_tenant_id)
  )
  INTO v_counts;

  RETURN jsonb_build_object(
    'ready', COALESCE(array_length(v_missing_tables, 1), 0) = 0,
    'missingTables', to_jsonb(v_missing_tables),
    'counts', v_counts,
    'checkedAt', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_luchorentas_schema_health(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_luchorentas_schema_health(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC Dashboard Ejecutivo — Modelo A (§9.2–§9.5, RF-050 a RF-053)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_executive_dashboard(
  p_tenant_id uuid,
  p_month integer,
  p_year integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_month_start date;
  v_month_end date;
  v_today_lp date;
  v_close_ref date;
  v_collections jsonb;
  v_receivables jsonb;
  v_payables jsonb;
  v_units_summary jsonb;
  v_recent_collections jsonb;
  v_recent_payments jsonb;
  v_delinquent_tenants integer := 0;
BEGIN
  IF p_month < 1 OR p_month > 12 OR p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'Período Mes/Año inválido.';
  END IF;

  IF NOT public.current_user_has_permission(p_tenant_id, 'dashboard', 'view', NULL) THEN
    RAISE EXCEPTION 'Permiso denegado para consultar el dashboard ejecutivo.';
  END IF;

  v_month_start := make_date(p_year, p_month, 1);
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;
  v_today_lp := (now() AT TIME ZONE 'America/La_Paz')::date;
  v_close_ref := LEAST(v_today_lp, v_month_end);
  IF v_month_end < v_today_lp THEN
    v_close_ref := v_month_end;
  END IF;

  -- Cobros confirmados por fecha efectiva dentro del mes seleccionado (DEC-01 / DEC-15)
  SELECT jsonb_build_object(
    'BOB', COALESCE((
      SELECT sum(py.received_amount)
      FROM public.payments py
      WHERE py.tenant_id = p_tenant_id
        AND py.entry_kind = 'collection'
        AND py.status = 'confirmed'
        AND py.currency = 'BOB'
        AND (py.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
        AND public.current_user_has_permission(p_tenant_id, 'dashboard', 'view', py.property_id)
    ), 0),
    'USD', COALESCE((
      SELECT sum(py.received_amount)
      FROM public.payments py
      WHERE py.tenant_id = p_tenant_id
        AND py.entry_kind = 'collection'
        AND py.status = 'confirmed'
        AND py.currency = 'USD'
        AND (py.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
        AND public.current_user_has_permission(p_tenant_id, 'dashboard', 'view', py.property_id)
    ), 0)
  ) INTO v_collections;

  -- CxC pendiente al cierre del período (diferenciando vencido vs no vencido)
  WITH charge_balances AS (
    SELECT
      rc.id,
      rc.tenant_person_id,
      rc.currency,
      rc.due_date,
      GREATEST(0, rc.amount - rc.adjusted_amount - COALESCE((
        SELECT sum(pa.allocated_amount)
        FROM public.payment_allocations pa
        JOIN public.payments py ON py.tenant_id = pa.tenant_id AND py.id = pa.payment_id
        WHERE pa.tenant_id = rc.tenant_id
          AND pa.receivable_charge_id = rc.id
          AND (py.effective_at AT TIME ZONE 'America/La_Paz')::date <= v_month_end
      ), 0)) AS pending_balance
    FROM public.receivable_charges rc
    WHERE rc.tenant_id = p_tenant_id
      AND rc.status <> 'voided'
      AND rc.due_date BETWEEN v_month_start AND v_month_end
      AND public.current_user_has_permission(p_tenant_id, 'dashboard', 'view', rc.property_id)
  )
  SELECT jsonb_build_object(
    'BOB', jsonb_build_object(
      'total', COALESCE(sum(CASE WHEN currency = 'BOB' THEN pending_balance ELSE 0 END), 0),
      'notOverdue', COALESCE(sum(CASE WHEN currency = 'BOB' AND due_date >= v_close_ref THEN pending_balance ELSE 0 END), 0),
      'overdue', COALESCE(sum(CASE WHEN currency = 'BOB' AND due_date < v_close_ref THEN pending_balance ELSE 0 END), 0)
    ),
    'USD', jsonb_build_object(
      'total', COALESCE(sum(CASE WHEN currency = 'USD' THEN pending_balance ELSE 0 END), 0),
      'notOverdue', COALESCE(sum(CASE WHEN currency = 'USD' AND due_date >= v_close_ref THEN pending_balance ELSE 0 END), 0),
      'overdue', COALESCE(sum(CASE WHEN currency = 'USD' AND due_date < v_close_ref THEN pending_balance ELSE 0 END), 0)
    )
  ),
  COALESCE((
    SELECT count(DISTINCT cb.tenant_person_id)
    FROM charge_balances cb
    WHERE cb.pending_balance > 0
      AND cb.due_date < v_close_ref
  ), 0)
  INTO v_receivables, v_delinquent_tenants
  FROM charge_balances;

  -- CxP pendiente al cierre del período (§9.3 y §15)
  WITH expense_balances AS (
    SELECT
      ex.id,
      ex.currency,
      ex.status,
      ex.due_date,
      GREATEST(0, ex.amount - COALESCE((
        SELECT sum(ep.amount)
        FROM public.expense_payments ep
        WHERE ep.tenant_id = ex.tenant_id
          AND ep.expense_id = ex.id
          AND (ep.effective_at AT TIME ZONE 'America/La_Paz')::date <= v_month_end
      ), 0)) AS pending_balance
    FROM public.expenses ex
    WHERE ex.tenant_id = p_tenant_id
      AND ex.status <> 'voided'
      AND ex.expense_date <= v_month_end
      AND (ex.property_id IS NULL OR public.current_user_has_permission(p_tenant_id, 'dashboard', 'view', ex.property_id))
  )
  SELECT jsonb_build_object(
    'BOB', jsonb_build_object(
      'total', COALESCE(sum(CASE WHEN currency = 'BOB' THEN pending_balance ELSE 0 END), 0),
      'overdue', COALESCE(sum(CASE WHEN currency = 'BOB' AND due_date IS NOT NULL AND due_date < v_close_ref THEN pending_balance ELSE 0 END), 0),
      'pendingApproval', COALESCE(sum(CASE WHEN currency = 'BOB' AND status = 'pending_approval' THEN pending_balance ELSE 0 END), 0)
    ),
    'USD', jsonb_build_object(
      'total', COALESCE(sum(CASE WHEN currency = 'USD' THEN pending_balance ELSE 0 END), 0),
      'overdue', COALESCE(sum(CASE WHEN currency = 'USD' AND due_date IS NOT NULL AND due_date < v_close_ref THEN pending_balance ELSE 0 END), 0),
      'pendingApproval', COALESCE(sum(CASE WHEN currency = 'USD' AND status = 'pending_approval' THEN pending_balance ELSE 0 END), 0)
    )
  ) INTO v_payables
  FROM expense_balances;

  -- Ocupación al último día del mes seleccionado (CA-052: excluye fuera de servicio)
  WITH enabled_units AS (
    SELECT
      u.id,
      u.property_id,
      EXISTS (
        SELECT 1
        FROM public.rental_contracts rc
        WHERE rc.tenant_id = u.tenant_id
          AND rc.unit_id = u.id
          AND rc.status IN ('active', 'finalized')
          AND rc.start_date <= v_month_end
          AND (rc.end_date IS NULL OR rc.end_date >= v_month_end)
      ) AS is_occupied
    FROM public.property_units u
    JOIN public.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
    WHERE u.tenant_id = p_tenant_id
      AND u.is_active = true
      AND p.is_active = true
      AND u.status <> 'out_of_service'
      AND (
        (p.rental_mode = 'full_house' AND u.is_default_house_unit = true)
        OR (p.rental_mode = 'by_rooms' AND u.is_default_house_unit = false)
      )
      AND public.current_user_has_permission(p_tenant_id, 'dashboard', 'view', u.property_id)
  )
  SELECT jsonb_build_object(
    'totalEnabledUnits', count(*),
    'occupiedUnits', count(*) FILTER (WHERE is_occupied),
    'availableUnits', count(*) FILTER (WHERE NOT is_occupied),
    'occupancyPercent', CASE WHEN count(*) > 0 THEN round((count(*) FILTER (WHERE is_occupied)::numeric / count(*)::numeric) * 100, 1) ELSE 0 END,
    'delinquentTenants', v_delinquent_tenants
  ) INTO v_units_summary
  FROM enabled_units;

  -- Últimos 5 cobros del período (DEC-14 / §9.5)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_recent_collections
  FROM (
    SELECT
      py.id,
      pe.full_name AS "tenantName",
      pr.name AS "propertyName",
      py.effective_at AS "effectiveAt",
      py.received_amount AS amount,
      py.currency
    FROM public.payments py
    JOIN public.people pe ON pe.tenant_id = py.tenant_id AND pe.id = py.tenant_person_id
    JOIN public.properties pr ON pr.tenant_id = py.tenant_id AND pr.id = py.property_id
    WHERE py.tenant_id = p_tenant_id
      AND py.entry_kind = 'collection'
      AND py.status = 'confirmed'
      AND (py.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
      AND public.current_user_has_permission(p_tenant_id, 'dashboard', 'view', py.property_id)
    ORDER BY py.effective_at DESC
    LIMIT 5
  ) t;

  -- Últimos 5 pagos de gastos del período (DEC-14 / §9.5)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_recent_payments
  FROM (
    SELECT
      ep.id,
      ex.concept,
      ec.name AS "categoryName",
      ep.effective_at AS "effectiveAt",
      ep.amount,
      ep.currency
    FROM public.expense_payments ep
    JOIN public.expenses ex ON ex.tenant_id = ep.tenant_id AND ex.id = ep.expense_id
    JOIN public.expense_categories ec ON ec.tenant_id = ex.tenant_id AND ec.id = ex.category_id
    WHERE ep.tenant_id = p_tenant_id
      AND (ep.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
      AND (ex.property_id IS NULL OR public.current_user_has_permission(p_tenant_id, 'dashboard', 'view', ex.property_id))
    ORDER BY ep.effective_at DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'month', p_month,
    'year', p_year,
    'collections', v_collections,
    'receivables', v_receivables,
    'payables', v_payables,
    'operational', v_units_summary,
    'recentCollections', v_recent_collections,
    'recentPayments', v_recent_payments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_executive_dashboard(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_executive_dashboard(uuid, integer, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPC Reportes Financieros por Período, Casa y Propietario + Exportación
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_financial_reports(
  p_tenant_id uuid,
  p_month integer,
  p_year integer,
  p_property_id uuid DEFAULT NULL,
  p_owner_person_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_month_start date;
  v_month_end date;
  v_by_property jsonb;
  v_by_owner jsonb;
  v_totals jsonb;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'reports', 'view', p_property_id) THEN
    RAISE EXCEPTION 'Permiso denegado para consultar reportes financieros.';
  END IF;

  v_month_start := make_date(p_year, p_month, 1);
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  -- Desglose por Casa (CA-056)
  WITH authorized_props AS (
    SELECT pr.id, pr.name, pr.rental_mode
    FROM public.properties pr
    WHERE pr.tenant_id = p_tenant_id
      AND pr.is_active = true
      AND (p_property_id IS NULL OR pr.id = p_property_id)
      AND public.current_user_has_permission(p_tenant_id, 'reports', 'view', pr.id)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'propertyId', ap.id,
    'propertyName', ap.name,
    'rentalMode', ap.rental_mode,
    'collectedBob', COALESCE((
      SELECT sum(py.received_amount) FROM public.payments py
      WHERE py.tenant_id = p_tenant_id AND py.property_id = ap.id
        AND py.entry_kind = 'collection' AND py.status = 'confirmed' AND py.currency = 'BOB'
        AND (py.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
    ), 0),
    'collectedUsd', COALESCE((
      SELECT sum(py.received_amount) FROM public.payments py
      WHERE py.tenant_id = p_tenant_id AND py.property_id = ap.id
        AND py.entry_kind = 'collection' AND py.status = 'confirmed' AND py.currency = 'USD'
        AND (py.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
    ), 0),
    'paidExpensesBob', COALESCE((
      SELECT sum(ep.amount)
      FROM public.expense_payments ep
      JOIN public.expenses ex ON ex.tenant_id = ep.tenant_id AND ex.id = ep.expense_id
      WHERE ep.tenant_id = p_tenant_id AND ex.property_id = ap.id AND ep.currency = 'BOB'
        AND (ep.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
    ), 0),
    'paidExpensesUsd', COALESCE((
      SELECT sum(ep.amount)
      FROM public.expense_payments ep
      JOIN public.expenses ex ON ex.tenant_id = ep.tenant_id AND ex.id = ep.expense_id
      WHERE ep.tenant_id = p_tenant_id AND ex.property_id = ap.id AND ep.currency = 'USD'
        AND (ep.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
    ), 0)
  ) ORDER BY ap.name), '[]'::jsonb)
  INTO v_by_property
  FROM authorized_props ap;

  -- Desglose Informativo por Propietario (CA-057 / DEC-10 / DEC-11)
  SELECT COALESCE(jsonb_agg(row_to_json(o)), '[]'::jsonb)
  INTO v_by_owner
  FROM (
    SELECT
      pe.id AS "personId",
      pe.full_name AS "ownerName",
      count(DISTINCT po.property_id) AS "propertiesCount",
      round(COALESCE(sum((
        SELECT COALESCE(sum(py.received_amount), 0)
        FROM public.payments py
        WHERE py.tenant_id = p_tenant_id AND py.property_id = po.property_id
          AND py.entry_kind = 'collection' AND py.status = 'confirmed' AND py.currency = 'BOB'
          AND (py.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
      ) * (po.ownership_percent / 100.0)), 0), 2) AS "attributableCollectedBob",
      round(COALESCE(sum((
        SELECT COALESCE(sum(py.received_amount), 0)
        FROM public.payments py
        WHERE py.tenant_id = p_tenant_id AND py.property_id = po.property_id
          AND py.entry_kind = 'collection' AND py.status = 'confirmed' AND py.currency = 'USD'
          AND (py.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
      ) * (po.ownership_percent / 100.0)), 0), 2) AS "attributableCollectedUsd",
      round(COALESCE(sum((
        SELECT COALESCE(sum(ep.amount), 0)
        FROM public.expense_payments ep
        JOIN public.expenses ex ON ex.tenant_id = ep.tenant_id AND ex.id = ep.expense_id
        WHERE ep.tenant_id = p_tenant_id AND ex.property_id = po.property_id AND ep.currency = 'BOB'
          AND (ep.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
      ) * (po.ownership_percent / 100.0)), 0), 2) AS "attributableExpensesBob",
      round(COALESCE(sum((
        SELECT COALESCE(sum(ep.amount), 0)
        FROM public.expense_payments ep
        JOIN public.expenses ex ON ex.tenant_id = ep.tenant_id AND ex.id = ep.expense_id
        WHERE ep.tenant_id = p_tenant_id AND ex.property_id = po.property_id AND ep.currency = 'USD'
          AND (ep.effective_at AT TIME ZONE 'America/La_Paz')::date BETWEEN v_month_start AND v_month_end
      ) * (po.ownership_percent / 100.0)), 0), 2) AS "attributableExpensesUsd"
    FROM public.property_owners po
    JOIN public.people pe ON pe.tenant_id = po.tenant_id AND pe.id = po.person_id
    WHERE po.tenant_id = p_tenant_id
      AND po.effective_from <= v_month_end
      AND (po.effective_to IS NULL OR po.effective_to >= v_month_start)
      AND (p_property_id IS NULL OR po.property_id = p_property_id)
      AND (p_owner_person_id IS NULL OR po.person_id = p_owner_person_id)
      AND public.current_user_has_permission(p_tenant_id, 'reports', 'view', po.property_id)
    GROUP BY pe.id, pe.full_name
    ORDER BY pe.full_name
  ) o;

  SELECT jsonb_build_object(
    'month', p_month,
    'year', p_year,
    'byProperty', v_by_property,
    'byOwner', v_by_owner
  ) INTO v_totals;

  RETURN v_totals;
END;
$$;

REVOKE ALL ON FUNCTION public.get_financial_reports(uuid, integer, integer, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_financial_reports(uuid, integer, integer, uuid, uuid) TO authenticated;

-- RPC de auditoría y exportación autorizada (§11.3 export_tenant_report / RF-058)
CREATE OR REPLACE FUNCTION public.export_tenant_report(
  p_tenant_id uuid,
  p_report_kind text,
  p_month integer,
  p_year integer,
  p_property_id uuid DEFAULT NULL,
  p_owner_person_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'reports', 'export', p_property_id) THEN
    RAISE EXCEPTION 'Permiso denegado para exportar reportes en este espacio o casa.';
  END IF;

  v_payload := public.get_financial_reports(p_tenant_id, p_month, p_year, p_property_id, p_owner_person_id);

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id,
    auth.uid(),
    'report_exported',
    'financial_report',
    p_property_id,
    jsonb_build_object(
      'report_kind', p_report_kind,
      'month', p_month,
      'year', p_year,
      'property_id', p_property_id,
      'owner_person_id', p_owner_person_id
    )
  );

  RETURN v_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.export_tenant_report(uuid, text, integer, integer, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_tenant_report(uuid, text, integer, integer, uuid, uuid) TO authenticated;
