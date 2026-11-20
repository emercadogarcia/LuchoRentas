-- ============================================================================
-- Archivo: supabase/migrations/202611200009_roles_permissions_complete_fix.sql
-- Responsabilidad: Consolidación completa e idempotente de Roles, Permisos,
--   Perfiles y Creación de Tenants acorde 100% al PRD LuchoRentas v1.1:
--   1. Sincroniza auth.users -> public.profiles (evita errores de FK en create_tenant).
--   2. Refuerza create_tenant() para autocurar perfil del creador, registrar
--      membresía activa 'tenant_owner' (allowed_property_ids = NULL) y sembrar
--      la matriz completa en tenant_role_permissions sin piezas sueltas.
--   3. Repara membresías de todos los creadores existentes (tenants.created_by)
--      como 'tenant_owner' activo y completa sus reglas base de permisos.
--   4. Garantiza permisos totales ('tenant_owner') en el tenant
--      9da65374-97a4-4ce7-8033-f1c44dfde23a para emercadogarcia@outlook.com y
--      dev.emercado@gmail.com (sin romper aislamiento multi-tenant CA-003).
-- Cumplimiento LuchoRentas.md: §4.1, §5, §5.1, RF-001..RF-005, DEC-13, §11.3.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Backfill de perfiles para TODOS los usuarios de auth.users
-- ----------------------------------------------------------------------------
INSERT INTO public.profiles (id, full_name, email)
SELECT
  u.id,
  CASE
    WHEN NULLIF(trim(u.raw_user_meta_data ->> 'full_name'), '') IS NOT NULL
      AND char_length(trim(u.raw_user_meta_data ->> 'full_name')) >= 2
      THEN trim(u.raw_user_meta_data ->> 'full_name')
    WHEN char_length(trim(split_part(u.email, '@', 1))) >= 2
      THEN trim(split_part(u.email, '@', 1))
    ELSE 'Usuario LuchoRentas'
  END,
  lower(trim(u.email))
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = COALESCE(NULLIF(trim(public.profiles.full_name), ''), EXCLUDED.full_name);

-- ----------------------------------------------------------------------------
-- 2. Reforzar create_tenant() para garantizar perfil del creador, rol
--    tenant_owner (allowed_property_ids = NULL) y matriz completa PRD §5/§8
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tenant(
  p_name text,
  p_default_currency public.currency_code DEFAULT 'BOB'
)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_clean_name text := trim(p_name);
  v_slug text;
  v_tenant public.tenants;
  v_user_email text;
  v_user_full_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticación requerida para crear un espacio de trabajo.' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_clean_name) < 2 THEN
    RAISE EXCEPTION 'El nombre del espacio debe tener al menos 2 caracteres.' USING ERRCODE = '22023';
  END IF;

  -- Autocuración obligatoria: asegurar que el usuario autenticado exista en public.profiles
  SELECT
    lower(trim(COALESCE(u.email, ''))),
    CASE
      WHEN NULLIF(trim(u.raw_user_meta_data ->> 'full_name'), '') IS NOT NULL
        AND char_length(trim(u.raw_user_meta_data ->> 'full_name')) >= 2
        THEN trim(u.raw_user_meta_data ->> 'full_name')
      WHEN char_length(trim(split_part(COALESCE(u.email, ''), '@', 1))) >= 2
        THEN trim(split_part(COALESCE(u.email, ''), '@', 1))
      ELSE 'Propietario LuchoRentas'
    END
  INTO v_user_email, v_user_full_name
  FROM auth.users u
  WHERE u.id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la identidad del usuario en auth.users.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (v_user_id, v_user_full_name, v_user_email)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(NULLIF(trim(public.profiles.full_name), ''), EXCLUDED.full_name);

  v_slug := regexp_replace(lower(v_clean_name), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  IF char_length(v_slug) < 2 THEN
    v_slug := 'espacio';
  END IF;
  v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);

  INSERT INTO public.tenants (name, slug, timezone, default_currency, is_active, created_by)
  VALUES (v_clean_name, v_slug, 'America/La_Paz', p_default_currency, true, v_user_id)
  RETURNING * INTO v_tenant;

  -- RF-002 / CA-002 / DEC-13: El creador queda como Propietario principal (tenant_owner)
  -- con estado active y allowed_property_ids = NULL (todas las casas y todos los módulos)
  INSERT INTO public.tenant_memberships (
    tenant_id,
    user_id,
    role,
    status,
    allowed_property_ids,
    invited_by
  )
  VALUES (v_tenant.id, v_user_id, 'tenant_owner', 'active', NULL, v_user_id)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role = 'tenant_owner',
        status = 'active',
        allowed_property_ids = NULL,
        updated_at = now();

  -- Semilla inicial estricta según PRD §5 y §8 para roles configurables
  -- (tenant_owner tiene acceso total incondicional en current_user_has_permission)
  INSERT INTO public.tenant_role_permissions (tenant_id, role, module_id, action_id, allowed)
  VALUES
    -- Administrador
    (v_tenant.id, 'admin', 'dashboard', 'view', true),
    (v_tenant.id, 'admin', 'properties', 'view', true),
    (v_tenant.id, 'admin', 'properties', 'manage', true),
    (v_tenant.id, 'admin', 'people', 'view', true),
    (v_tenant.id, 'admin', 'people', 'manage', true),
    (v_tenant.id, 'admin', 'contracts', 'view', true),
    (v_tenant.id, 'admin', 'contracts', 'manage', true),
    (v_tenant.id, 'admin', 'receivables', 'view', true),
    (v_tenant.id, 'admin', 'receivables', 'generate', true),
    (v_tenant.id, 'admin', 'collections', 'view', true),
    (v_tenant.id, 'admin', 'collections', 'create', true),
    (v_tenant.id, 'admin', 'collections', 'reverse', true),
    (v_tenant.id, 'admin', 'expenses', 'view', true),
    (v_tenant.id, 'admin', 'expenses', 'manage', true),
    (v_tenant.id, 'admin', 'cash', 'view', true),
    (v_tenant.id, 'admin', 'cash', 'reconcile', true),
    (v_tenant.id, 'admin', 'reports', 'view', true),
    (v_tenant.id, 'admin', 'reports', 'export', true),
    (v_tenant.id, 'admin', 'users_permissions', 'view', true),
    (v_tenant.id, 'admin', 'users_permissions', 'manage', false),
    -- Cobrador
    (v_tenant.id, 'collector', 'dashboard', 'view', true),
    (v_tenant.id, 'collector', 'properties', 'view', true),
    (v_tenant.id, 'collector', 'people', 'view', true),
    (v_tenant.id, 'collector', 'receivables', 'view', true),
    (v_tenant.id, 'collector', 'collections', 'view', true),
    (v_tenant.id, 'collector', 'collections', 'create', true),
    (v_tenant.id, 'collector', 'cash', 'view', true),
    -- Operador financiero
    (v_tenant.id, 'finance_operator', 'dashboard', 'view', true),
    (v_tenant.id, 'finance_operator', 'properties', 'view', true),
    (v_tenant.id, 'finance_operator', 'people', 'view', true),
    (v_tenant.id, 'finance_operator', 'expenses', 'view', true),
    (v_tenant.id, 'finance_operator', 'expenses', 'manage', true),
    (v_tenant.id, 'finance_operator', 'cash', 'view', true),
    (v_tenant.id, 'finance_operator', 'cash', 'reconcile', true),
    (v_tenant.id, 'finance_operator', 'reports', 'view', true),
    (v_tenant.id, 'finance_operator', 'reports', 'export', true),
    -- Consulta
    (v_tenant.id, 'viewer', 'dashboard', 'view', true),
    (v_tenant.id, 'viewer', 'properties', 'view', true),
    (v_tenant.id, 'viewer', 'receivables', 'view', true),
    (v_tenant.id, 'viewer', 'reports', 'view', true)
  ON CONFLICT (tenant_id, role, module_id, action_id) DO NOTHING;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_tenant.id,
    v_user_id,
    'tenant.created',
    'tenants',
    v_tenant.id,
    jsonb_build_object(
      'name', v_tenant.name,
      'currency', v_tenant.default_currency,
      'timezone', v_tenant.timezone,
      'owner_role', 'tenant_owner'
    )
  );

  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant(text, public.currency_code) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tenant(text, public.currency_code) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Reparación de todos los tenants existentes:
--    - Todo creador (tenants.created_by) queda como tenant_owner activo sin restricción
--    - Todo tenant recibe su matriz completa de permisos base si le faltara
-- ----------------------------------------------------------------------------
INSERT INTO public.tenant_memberships (
  tenant_id,
  user_id,
  role,
  status,
  allowed_property_ids,
  invited_by
)
SELECT
  t.id,
  t.created_by,
  'tenant_owner'::public.tenant_role,
  'active'::public.membership_status,
  NULL,
  t.created_by
FROM public.tenants t
JOIN public.profiles p ON p.id = t.created_by
ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET role = 'tenant_owner',
      status = 'active',
      allowed_property_ids = NULL,
      updated_at = now();

INSERT INTO public.tenant_role_permissions (tenant_id, role, module_id, action_id, allowed)
SELECT t.id, r.role, r.module_id, r.action_id, r.allowed
FROM public.tenants t
CROSS JOIN (
  VALUES
    ('admin'::public.tenant_role, 'dashboard', 'view', true),
    ('admin'::public.tenant_role, 'properties', 'view', true),
    ('admin'::public.tenant_role, 'properties', 'manage', true),
    ('admin'::public.tenant_role, 'people', 'view', true),
    ('admin'::public.tenant_role, 'people', 'manage', true),
    ('admin'::public.tenant_role, 'contracts', 'view', true),
    ('admin'::public.tenant_role, 'contracts', 'manage', true),
    ('admin'::public.tenant_role, 'receivables', 'view', true),
    ('admin'::public.tenant_role, 'receivables', 'generate', true),
    ('admin'::public.tenant_role, 'collections', 'view', true),
    ('admin'::public.tenant_role, 'collections', 'create', true),
    ('admin'::public.tenant_role, 'collections', 'reverse', true),
    ('admin'::public.tenant_role, 'expenses', 'view', true),
    ('admin'::public.tenant_role, 'expenses', 'manage', true),
    ('admin'::public.tenant_role, 'cash', 'view', true),
    ('admin'::public.tenant_role, 'cash', 'reconcile', true),
    ('admin'::public.tenant_role, 'reports', 'view', true),
    ('admin'::public.tenant_role, 'reports', 'export', true),
    ('admin'::public.tenant_role, 'users_permissions', 'view', true),
    ('admin'::public.tenant_role, 'users_permissions', 'manage', false),
    ('collector'::public.tenant_role, 'dashboard', 'view', true),
    ('collector'::public.tenant_role, 'properties', 'view', true),
    ('collector'::public.tenant_role, 'people', 'view', true),
    ('collector'::public.tenant_role, 'receivables', 'view', true),
    ('collector'::public.tenant_role, 'collections', 'view', true),
    ('collector'::public.tenant_role, 'collections', 'create', true),
    ('collector'::public.tenant_role, 'cash', 'view', true),
    ('finance_operator'::public.tenant_role, 'dashboard', 'view', true),
    ('finance_operator'::public.tenant_role, 'properties', 'view', true),
    ('finance_operator'::public.tenant_role, 'people', 'view', true),
    ('finance_operator'::public.tenant_role, 'expenses', 'view', true),
    ('finance_operator'::public.tenant_role, 'expenses', 'manage', true),
    ('finance_operator'::public.tenant_role, 'cash', 'view', true),
    ('finance_operator'::public.tenant_role, 'cash', 'reconcile', true),
    ('finance_operator'::public.tenant_role, 'reports', 'view', true),
    ('finance_operator'::public.tenant_role, 'reports', 'export', true),
    ('viewer'::public.tenant_role, 'dashboard', 'view', true),
    ('viewer'::public.tenant_role, 'properties', 'view', true),
    ('viewer'::public.tenant_role, 'receivables', 'view', true),
    ('viewer'::public.tenant_role, 'reports', 'view', true)
) AS r(role, module_id, action_id, allowed)
ON CONFLICT (tenant_id, role, module_id, action_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. Asignar permisos totales (tenant_owner) en el tenant
--    9da65374-97a4-4ce7-8033-f1c44dfde23a a emercadogarcia@outlook.com y
--    dev.emercado@gmail.com (sin alterar el aislamiento de otros tenants)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_target_tenant_id CONSTANT uuid := '9da65374-97a4-4ce7-8033-f1c44dfde23a';
  v_tenant_row public.tenants%ROWTYPE;
  v_emails text[] := ARRAY[
    'emercadogarcia@outlook.com',
    'dev.emercado@gmail.com'
  ];
  v_email text;
  v_user_id uuid;
  v_membership_id uuid;
BEGIN
  SELECT * INTO v_tenant_row
  FROM public.tenants
  WHERE id = v_target_tenant_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'AVISO: El tenant % no existe todavía en public.tenants. Cada tenant creado vía create_tenant() ya otorga tenant_owner a su creador.', v_target_tenant_id;
    RETURN;
  END IF;

  IF NOT v_tenant_row.is_active THEN
    UPDATE public.tenants
    SET is_active = true, updated_at = now()
    WHERE id = v_target_tenant_id;
  END IF;

  FOREACH v_email IN ARRAY v_emails LOOP
    SELECT u.id INTO v_user_id
    FROM auth.users u
    WHERE lower(trim(u.email)) = lower(trim(v_email))
    LIMIT 1;

    IF v_user_id IS NULL THEN
      RAISE NOTICE 'AVISO: El correo % no existe aún en auth.users.', v_email;
      CONTINUE;
    END IF;

    INSERT INTO public.tenant_memberships (
      tenant_id,
      user_id,
      role,
      status,
      allowed_property_ids,
      invited_by
    )
    VALUES (
      v_target_tenant_id,
      v_user_id,
      'tenant_owner',
      'active',
      NULL,
      COALESCE(v_tenant_row.created_by, v_user_id)
    )
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET role = 'tenant_owner',
          status = 'active',
          allowed_property_ids = NULL,
          updated_at = now()
    RETURNING id INTO v_membership_id;

    INSERT INTO public.audit_logs (
      tenant_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      v_target_tenant_id,
      COALESCE(v_tenant_row.created_by, v_user_id),
      'membership.owner_granted',
      'tenant_memberships',
      v_membership_id,
      jsonb_build_object(
        'email', lower(trim(v_email)),
        'role', 'tenant_owner',
        'allowed_property_ids', NULL,
        'source', '202611200009_roles_permissions_complete_fix'
      )
    );

    RAISE NOTICE 'OK: % quedó como tenant_owner activo en el tenant %.', v_email, v_target_tenant_id;
  END LOOP;
END $$;
