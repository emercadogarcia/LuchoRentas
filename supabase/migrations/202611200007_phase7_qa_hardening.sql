-- ============================================================================
-- Archivo: supabase/migrations/202611200007_phase7_qa_hardening.sql
-- Responsabilidad: Hardening y auditoría de integridad QA de Fase 7 para
--   LuchoRentas (RPC transaccional de verificación de invariantes financieras,
--   estructurales y multi-tenant sobre el espacio activo).
-- Cumplimiento LuchoRentas.md: §10.1 (seguridad), §10.2 (integridad financiera),
--   §18.2 (pruebas mínimas obligatorias) y §18.3 (Definition of Done).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RPC de Verificación Viva de Invariantes Financieras y Estructurales QA
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_tenant_qa_integrity_checks(
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_today_lp date := (now() AT TIME ZONE 'America/La_Paz')::date;
  v_bad_owner_sums integer := 0;
  v_double_occupied_units integer := 0;
  v_collections_without_receipt integer := 0;
  v_invalid_receivables integer := 0;
  v_duplicate_open_cash integer := 0;
  v_mismatched_cash_currency integer := 0;
  v_unapproved_expense_outflows integer := 0;
  v_checks jsonb;
  v_passed_count integer := 0;
  v_total_checks integer := 7;
BEGIN
  IF NOT (
    public.current_user_is_tenant_owner(p_tenant_id)
    OR public.current_user_has_permission(p_tenant_id, 'users_permissions', 'view', NULL)
    OR public.current_user_has_permission(p_tenant_id, 'reports', 'view', NULL)
  ) THEN
    RAISE EXCEPTION 'Permiso denegado para ejecutar la auditoría de integridad del espacio.';
  END IF;

  -- Check 1: Copropietarios vigentes por inmueble suman exactamente 100.00% (DEC-10)
  SELECT count(*) INTO v_bad_owner_sums
  FROM (
    SELECT po.property_id, sum(po.ownership_percent) AS total_pct
    FROM public.property_owners po
    JOIN public.properties pr ON pr.tenant_id = po.tenant_id AND pr.id = po.property_id
    WHERE po.tenant_id = p_tenant_id
      AND pr.is_active = true
      AND po.effective_from <= v_today_lp
      AND (po.effective_to IS NULL OR po.effective_to >= v_today_lp)
    GROUP BY po.property_id
    HAVING round(sum(po.ownership_percent), 2) <> 100.00
  ) t;

  -- Check 2: Ninguna unidad tiene más de 1 contrato activo simultáneo (RF-014)
  SELECT count(*) INTO v_double_occupied_units
  FROM (
    SELECT rc.unit_id
    FROM public.rental_contracts rc
    WHERE rc.tenant_id = p_tenant_id
      AND rc.status = 'active'
    GROUP BY rc.unit_id
    HAVING count(*) > 1
  ) t;

  -- Check 3: Todo cobro confirmado/revertido de tipo collection tiene recibo correlativo 1:1 (RF-035)
  SELECT count(*) INTO v_collections_without_receipt
  FROM public.payments py
  LEFT JOIN public.receipts rec
    ON rec.tenant_id = py.tenant_id
    AND rec.payment_id = py.id
  WHERE py.tenant_id = p_tenant_id
    AND py.entry_kind = 'collection'
    AND rec.id IS NULL;

  -- Check 4: Ninguna CxC tiene aplicado + ajustado > importe ni saldos negativos (§10.2)
  SELECT count(*) INTO v_invalid_receivables
  FROM public.receivable_charges ch
  WHERE ch.tenant_id = p_tenant_id
    AND (
      ch.amount <= 0
      OR ch.paid_amount < 0
      OR ch.adjusted_amount < 0
      OR (ch.paid_amount + ch.adjusted_amount) > ch.amount
    );

  -- Check 5: Máximo 1 sesión de caja abierta por usuario y moneda (DEC-07 / DEC-01)
  SELECT count(*) INTO v_duplicate_open_cash
  FROM (
    SELECT cs.owner_user_id, cs.currency
    FROM public.cash_sessions cs
    WHERE cs.tenant_id = p_tenant_id
      AND cs.status = 'open'
    GROUP BY cs.owner_user_id, cs.currency
    HAVING count(*) > 1
  ) t;

  -- Check 6: Consistencia estricta de moneda entre cash_movements y cash_sessions (DEC-01)
  SELECT count(*) INTO v_mismatched_cash_currency
  FROM public.cash_movements cm
  JOIN public.cash_sessions cs
    ON cs.tenant_id = cm.tenant_id
    AND cs.id = cm.cash_session_id
  WHERE cm.tenant_id = p_tenant_id
    AND cm.currency <> cs.currency;

  -- Check 7: Todo egreso en caja por pago de gasto corresponde a un gasto aprobado/pagado (DEC-09)
  SELECT count(*) INTO v_unapproved_expense_outflows
  FROM public.cash_movements cm
  LEFT JOIN public.expense_payments ep
    ON ep.tenant_id = cm.tenant_id
    AND ep.id = cm.source_id
  LEFT JOIN public.expenses ex
    ON ex.tenant_id = ep.tenant_id
    AND ex.id = ep.expense_id
  WHERE cm.tenant_id = p_tenant_id
    AND cm.source_type = 'expense_payment'
    AND (
      ep.id IS NULL
      OR ex.id IS NULL
      OR ex.status NOT IN ('approved', 'partially_paid', 'paid')
    );

  v_checks := jsonb_build_array(
    jsonb_build_object(
      'id', 'qa-owners-100',
      'label', 'Copropietarios vigentes por casa suman 100.00% (DEC-10)',
      'passed', v_bad_owner_sums = 0,
      'detail', CASE WHEN v_bad_owner_sums = 0
        THEN 'Todas las casas con propietarios vigentes suman exactamente 100%.'
        ELSE format('%s inmueble(s) presentan suma distinta de 100%%.', v_bad_owner_sums)
      END
    ),
    jsonb_build_object(
      'id', 'qa-no-double-occupancy',
      'label', 'Sin doble ocupación simultánea por unidad (RF-014)',
      'passed', v_double_occupied_units = 0,
      'detail', CASE WHEN v_double_occupied_units = 0
        THEN 'Cada cuarto o casa completa tiene como máximo 1 contrato activo.'
        ELSE format('%s unidad(es) tienen más de 1 contrato activo.', v_double_occupied_units)
      END
    ),
    jsonb_build_object(
      'id', 'qa-receipts-1to1',
      'label', 'Cada cobro emitido posee su recibo correlativo 1:1 (RF-035)',
      'passed', v_collections_without_receipt = 0,
      'detail', CASE WHEN v_collections_without_receipt = 0
        THEN 'Integridad 1:1 confirmada entre cobros y recibos correlativos.'
        ELSE format('%s cobro(s) sin recibo asociado.', v_collections_without_receipt)
      END
    ),
    jsonb_build_object(
      'id', 'qa-receivables-bounds',
      'label', 'Saldos de CxC dentro de límites válidos (§10.2)',
      'passed', v_invalid_receivables = 0,
      'detail', CASE WHEN v_invalid_receivables = 0
        THEN 'Todas las obligaciones cumplen paid + adjusted <= amount y >= 0.'
        ELSE format('%s obligación(es) con saldos inconsistentes.', v_invalid_receivables)
      END
    ),
    jsonb_build_object(
      'id', 'qa-cash-one-open',
      'label', 'Máximo 1 caja abierta por usuario y moneda (DEC-07)',
      'passed', v_duplicate_open_cash = 0,
      'detail', CASE WHEN v_duplicate_open_cash = 0
        THEN 'Aislamiento correcto por usuario y divisa BOB/USD.'
        ELSE format('%s par(es) usuario/moneda con múltiples cajas abiertas.', v_duplicate_open_cash)
      END
    ),
    jsonb_build_object(
      'id', 'qa-cash-currency-match',
      'label', 'Consistencia estricta BOB/USD entre movimientos y sesiones (DEC-01)',
      'passed', v_mismatched_cash_currency = 0,
      'detail', CASE WHEN v_mismatched_cash_currency = 0
        THEN 'Ningún movimiento mezcla moneda respecto a su sesión de caja.'
        ELSE format('%s movimiento(s) con moneda distinta a su caja.', v_mismatched_cash_currency)
      END
    ),
    jsonb_build_object(
      'id', 'qa-expenses-approved-outflow',
      'label', 'Egresos en caja respaldados únicamente por gastos aprobados/pagados (DEC-09)',
      'passed', v_unapproved_expense_outflows = 0,
      'detail', CASE WHEN v_unapproved_expense_outflows = 0
        THEN 'Todos los egresos provienen de pagos confirmados sobre gastos autorizados.'
        ELSE format('%s egreso(s) sin gasto aprobado válido.', v_unapproved_expense_outflows)
      END
    )
  );

  SELECT count(*) INTO v_passed_count
  FROM jsonb_array_elements(v_checks) elem
  WHERE (elem->>'passed')::boolean = true;

  RETURN jsonb_build_object(
    'checkedAt', now(),
    'tenantId', p_tenant_id,
    'passedCount', v_passed_count,
    'totalChecks', v_total_checks,
    'checks', v_checks
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_tenant_qa_integrity_checks(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_tenant_qa_integrity_checks(uuid) TO authenticated;
