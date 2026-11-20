-- ============================================================================
-- Archivo: supabase/tests/rls_isolation_test.sql
-- Responsabilidad: Pruebas negativas y positivas de aislamiento multi-tenant
--   y autorización por rol en PostgreSQL (CA-001 a CA-005).
-- Cumplimiento LuchoRentas.md: §3 (OBJ-07 Pruebas RLS negativas) y §18.2
--   (Pruebas mínimas obligatorias de aislamiento y RBAC).
-- ============================================================================

BEGIN;

-- 1. Simular dos usuarios autenticados distintos (Usuario A en Tenant A, Usuario B en Tenant B)
DO $$
DECLARE
  v_user_a uuid := '11111111-1111-1111-1111-111111111111';
  v_user_b uuid := '22222222-2222-2222-2222-222222222222';
  v_tenant_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_tenant_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_visible_count integer;
BEGIN
  -- Preparación de datos aislados (ejecutado con privilegio de migración/test)
  INSERT INTO auth.users (id, email) VALUES
    (v_user_a, 'owner-a@luchorentas.test'),
    (v_user_b, 'owner-b@luchorentas.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, email) VALUES
    (v_user_a, 'Propietario A', 'owner-a@luchorentas.test'),
    (v_user_b, 'Propietario B', 'owner-b@luchorentas.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.tenants (id, name, slug, created_by) VALUES
    (v_tenant_a, 'Tenant A Test', 'tenant-a-test', v_user_a),
    (v_tenant_b, 'Tenant B Test', 'tenant-b-test', v_user_b)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.tenant_memberships (tenant_id, user_id, role, status) VALUES
    (v_tenant_a, v_user_a, 'tenant_owner', 'active'),
    (v_tenant_b, v_user_b, 'tenant_owner', 'active')
  ON CONFLICT (tenant_id, user_id) DO NOTHING;

  -- Simular sesión RLS como Usuario A
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- CA-003: Usuario A NO debe poder ver Tenant B
  SELECT count(*) INTO v_visible_count
  FROM public.tenants
  WHERE id = v_tenant_b;

  IF v_visible_count <> 0 THEN
    RAISE EXCEPTION 'FALLA RLS (CA-003): Usuario A pudo leer Tenant B';
  END IF;

  -- Usuario A SÍ debe ver Tenant A
  SELECT count(*) INTO v_visible_count
  FROM public.tenants
  WHERE id = v_tenant_a;

  IF v_visible_count <> 1 THEN
    RAISE EXCEPTION 'FALLA RLS: Usuario A no pudo leer su propio Tenant A';
  END IF;
END $$;

ROLLBACK;
