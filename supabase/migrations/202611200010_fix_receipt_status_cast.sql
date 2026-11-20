-- ============================================================================
-- Archivo: supabase/migrations/202611200010_fix_receipt_status_cast.sql
-- Responsabilidad: Corrección quirúrgica de conversión de tipo enumerado
--   (`public.receipt_status`) dentro de `public.issue_rent_receipt` para evitar
--   el error PostgreSQL `column "status" is of type receipt_status but expression
--   is of type text` al emitir el recibo correlativo en cobros parciales o totales.
-- Cumplimiento LuchoRentas.md: RF-034, RF-035, CA-034, CA-035, DEC-12.
-- ============================================================================

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
    CASE
      WHEN v_payment.status = 'reversed' THEN 'voided_by_reversal'::public.receipt_status
      ELSE 'valid'::public.receipt_status
    END
  )
  RETURNING * INTO v_existing;

  RETURN v_existing;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_rent_receipt(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_rent_receipt(uuid, uuid) TO authenticated;
