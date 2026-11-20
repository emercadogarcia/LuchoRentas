-- ============================================================================
-- Archivo: supabase/qa/negative_rls_tests.sql
-- Responsabilidad: Suite transaccional de pruebas negativas de RLS, RBAC y
--   aislamiento multi-tenant para ejecutarse en Supabase SQL Editor sin dejar
--   datos residuales (siempre termina en ROLLBACK).
-- Cumplimiento LuchoRentas.md: §18.2 (Pruebas mínimas obligatorias CA-003,
--   CA-004, CA-005, DEC-13), §10.1 y §12 (TEST/QA).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Preparar dos usuarios ficticios en auth.users / profiles y dos tenants
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_user_a uuid := '11111111-1111-4111-8111-111111111111';
  v_user_b uuid := '22222222-2222-4222-8222-222222222222';
  v_user_c uuid := '33333333-3333-4333-8333-333333333333';
  v_tenant_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_tenant_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_prop_a1 uuid := 'aaaa0001-0001-4001-8001-000000000001';
  v_prop_a2 uuid := 'aaaa0002-0002-4002-8002-000000000002';
  v_prop_b1 uuid := 'bbbb0001-0001-4001-8001-000000000001';
  v_count integer;
  v_denied boolean;
BEGIN
  -- Insertar usuarios mínimos en auth.users si las pruebas corren en DB limpia/QA
  INSERT INTO auth.users (id, email)
  VALUES
    (v_user_a, 'qa_owner_a@luchorentas.test'),
    (v_user_b, 'qa_owner_b@luchorentas.test'),
    (v_user_c, 'qa_collector_scoped@luchorentas.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES
    (v_user_a, 'QA Owner A', 'qa_owner_a@luchorentas.test'),
    (v_user_b, 'QA Owner B', 'qa_owner_b@luchorentas.test'),
    (v_user_c, 'QA Cobrador Casa 1', 'qa_collector_scoped@luchorentas.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.tenants (id, name, slug, timezone, default_currency, created_by)
  VALUES
    (v_tenant_a, 'QA Espacio A', 'qa-espacio-a', 'America/La_Paz', 'BOB', v_user_a),
    (v_tenant_b, 'QA Espacio B', 'qa-espacio-b', 'America/La_Paz', 'USD', v_user_b);

  INSERT INTO public.tenant_memberships (tenant_id, user_id, role, status, allowed_property_ids)
  VALUES
    (v_tenant_a, v_user_a, 'tenant_owner', 'active', NULL),
    (v_tenant_b, v_user_b, 'tenant_owner', 'active', NULL),
    -- Usuario C: Cobrador en Tenant A limitado únicamente a v_prop_a1 (DEC-13)
    (v_tenant_a, v_user_c, 'collector', 'active', ARRAY[v_prop_a1]);

  INSERT INTO public.properties (id, tenant_id, name, address, rental_mode, created_by)
  VALUES
    (v_prop_a1, v_tenant_a, 'Casa QA A1', 'Calle A1', 'full_house', v_user_a),
    (v_prop_a2, v_tenant_a, 'Casa QA A2', 'Calle A2', 'full_house', v_user_a),
    (v_prop_b1, v_tenant_b, 'Casa QA B1', 'Calle B1', 'full_house', v_user_b);

  -- --------------------------------------------------------------------------
  -- PRUEBA NEGATIVA 1 (CA-003): Usuario A no ve inmuebles del Tenant B bajo RLS
  -- --------------------------------------------------------------------------
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_count
  FROM public.properties
  WHERE tenant_id = v_tenant_b;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALLO RLS CA-003: Usuario A pudo consultar % filas de Tenant B.', v_count;
  END IF;

  -- Propietario A sí ve las 2 casas de su propio tenant
  SELECT count(*) INTO v_count
  FROM public.properties
  WHERE tenant_id = v_tenant_a;

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FALLO RLS §18.2: Propietario A debería ver 2 casas y vio %.', v_count;
  END IF;

  -- --------------------------------------------------------------------------
  -- PRUEBA NEGATIVA 2 (DEC-13): Cobrador limitado a Casa A1 no ve Casa A2
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_c::text, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_count
  FROM public.properties
  WHERE tenant_id = v_tenant_a;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALLO DEC-13: Cobrador restringido a 1 casa vio % casas.', v_count;
  END IF;

  -- --------------------------------------------------------------------------
  -- PRUEBA NEGATIVA 3 (CA-005 / §5.1): Cobrador no puede crear gastos ni gestionar casas
  -- --------------------------------------------------------------------------
  v_denied := false;
  BEGIN
    INSERT INTO public.properties (tenant_id, name, address, rental_mode)
    VALUES (v_tenant_a, 'Casa Intrusa', 'Calle X', 'full_house');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'FALLO RBAC CA-005: Cobrador logró insertar propiedad sin permiso manage.';
  END IF;

  -- --------------------------------------------------------------------------
  -- PRUEBA NEGATIVA 4 (CA-004): Membresía desactivada pierde acceso inmediato
  -- --------------------------------------------------------------------------
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.tenant_memberships
  SET status = 'inactive'
  WHERE tenant_id = v_tenant_a AND user_id = v_user_c;

  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_count
  FROM public.properties
  WHERE tenant_id = v_tenant_a;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALLO CA-004: Usuario desactivado conservó acceso a % filas.', v_count;
  END IF;

  RAISE NOTICE 'OK FASE 7: Todas las pruebas negativas de RLS, multi-tenant y DEC-13 pasaron correctamente.';
END $$;

ROLLBACK;
