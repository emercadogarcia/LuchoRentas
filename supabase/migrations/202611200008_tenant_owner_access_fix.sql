-- ============================================================================
-- Archivo: supabase/migrations/202611200008_tenant_owner_access_fix.sql
-- Responsabilidad: Reparar sincronización auth.users -> public.profiles, asegurar
--   el rol 'tenant_owner' para creadores de tenants, permitir asignación segura
--   de co-propietarios por un tenant_owner en add_member_by_email, y otorgar
--   permisos totales ('tenant_owner') sobre el tenant
--   9da65374-97a4-4ce7-8033-f1c44dfde23a a emercadogarcia@outlook.com y
--   dev.emercadogarcia@gmail.com.
-- Cumplimiento LuchoRentas.md: §5.1 (Propietario del tenant con acceso total),
--   DEC-13 (RBAC doble capa), RF-002, RF-004 y §10.5 (auditoría multi-tenant).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reforzar handle_new_user() para evitar fallos por nombre corto o faltante
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_fallback_name text;
BEGIN
  v_fallback_name := NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), '');
  IF v_fallback_name IS NULL OR char_length(v_fallback_name) < 2 THEN
    v_fallback_name := NULLIF(trim(split_part(COALESCE(NEW.email, ''), '@', 1)), '');
  END IF;
  IF v_fallback_name IS NULL OR char_length(v_fallback_name) < 2 THEN
    v_fallback_name := 'Usuario LuchoRentas';
  END IF;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    v_fallback_name,
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(NULLIF(trim(public.profiles.full_name), ''), EXCLUDED.full_name);

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Backfill idempotente de public.profiles para cuentas previas en auth.users
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
  END AS full_name,
  u.email
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email;

-- ----------------------------------------------------------------------------
-- 3. Garantizar que todo creador de tenant (tenants.created_by) sea tenant_owner
--    y que cada tenant tenga su matriz base en tenant_role_permissions
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

-- Semilla idempotente de permisos base para cualquier tenant existente sin reglas
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
-- 4. Mejorar add_member_by_email para sincronizar perfil desde auth.users y
--    permitir que un tenant_owner actual otorgue rol tenant_owner a co-dueños
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_member_by_email(
  p_tenant_id uuid,
  p_email text,
  p_role public.tenant_role
)
RETURNS public.tenant_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_clean_email text := lower(trim(p_email));
  v_target_user_id uuid;
  v_target_name text;
  v_membership public.tenant_memberships;
BEGIN
  IF NOT (
    public.current_user_is_tenant_owner(p_tenant_id)
    OR public.current_user_has_permission(p_tenant_id, 'users_permissions', 'manage', NULL)
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: no tiene permiso para administrar usuarios en este tenant.' USING ERRCODE = '42501';
  END IF;

  -- Solo un Propietario del tenant puede otorgar el rol Propietario del tenant
  IF p_role = 'tenant_owner' AND NOT public.current_user_is_tenant_owner(p_tenant_id) THEN
    RAISE EXCEPTION 'Solo un Propietario del tenant puede asignar permisos totales de Propietario.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_target_user_id
  FROM public.profiles
  WHERE lower(email) = v_clean_email
  LIMIT 1;

  IF NOT FOUND THEN
    -- Si el usuario existe en auth.users pero aún no tenía espejo en public.profiles, sincronizarlo
    SELECT
      u.id,
      CASE
        WHEN NULLIF(trim(u.raw_user_meta_data ->> 'full_name'), '') IS NOT NULL
          AND char_length(trim(u.raw_user_meta_data ->> 'full_name')) >= 2
          THEN trim(u.raw_user_meta_data ->> 'full_name')
        WHEN char_length(trim(split_part(u.email, '@', 1))) >= 2
          THEN trim(split_part(u.email, '@', 1))
        ELSE 'Usuario LuchoRentas'
      END
    INTO v_target_user_id, v_target_name
    FROM auth.users u
    WHERE lower(u.email) = v_clean_email
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No existe una cuenta registrada con el correo "%". El usuario debe registrarse primero.', trim(p_email) USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.profiles (id, full_name, email)
    VALUES (v_target_user_id, v_target_name, v_clean_email)
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email;
  END IF;

  INSERT INTO public.tenant_memberships (tenant_id, user_id, role, status, allowed_property_ids, invited_by)
  VALUES (
    p_tenant_id,
    v_target_user_id,
    p_role,
    'active',
    CASE WHEN p_role = 'tenant_owner' THEN NULL ELSE NULL END,
    v_actor
  )
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role = CASE
                 WHEN public.tenant_memberships.role = 'tenant_owner'
                   AND NOT public.current_user_is_tenant_owner(p_tenant_id)
                   THEN public.tenant_memberships.role
                 WHEN public.tenant_memberships.role = 'tenant_owner'
                   THEN public.tenant_memberships.role
                 ELSE EXCLUDED.role
               END,
        status = 'active',
        allowed_property_ids = CASE
                                 WHEN EXCLUDED.role = 'tenant_owner' THEN NULL
                                 ELSE public.tenant_memberships.allowed_property_ids
                               END,
        updated_at = now()
  RETURNING * INTO v_membership;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id,
    v_actor,
    'membership.upserted',
    'tenant_memberships',
    v_membership.id,
    jsonb_build_object('email', v_clean_email, 'role', v_membership.role)
  );

  RETURN v_membership;
END;
$$;

REVOKE ALL ON FUNCTION public.add_member_by_email(uuid, text, public.tenant_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_member_by_email(uuid, text, public.tenant_role) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Asignar permisos totales ('tenant_owner') en el tenant específico
--    9da65374-97a4-4ce7-8033-f1c44dfde23a a:
--      - emercadogarcia@outlook.com
--      - dev.emercadogarcia@gmail.com
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_target_tenant_id CONSTANT uuid := '9da65374-97a4-4ce7-8033-f1c44dfde23a';
  v_tenant_row public.tenants%ROWTYPE;
  v_emails text[] := ARRAY[
    'emercadogarcia@outlook.com',
    'dev.emercadogarcia@gmail.com'
  ];
  v_email text;
  v_user_id uuid;
  v_full_name text;
  v_membership_id uuid;
BEGIN
  SELECT * INTO v_tenant_row
  FROM public.tenants
  WHERE id = v_target_tenant_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'AVISO: El tenant % aún no existe en public.tenants. Verifica el UUID o créalo primero.', v_target_tenant_id;
    RETURN;
  END IF;

  IF NOT v_tenant_row.is_active THEN
    UPDATE public.tenants
    SET is_active = true, updated_at = now()
    WHERE id = v_target_tenant_id;
  END IF;

  FOREACH v_email IN ARRAY v_emails LOOP
    SELECT
      u.id,
      CASE
        WHEN NULLIF(trim(u.raw_user_meta_data ->> 'full_name'), '') IS NOT NULL
          AND char_length(trim(u.raw_user_meta_data ->> 'full_name')) >= 2
          THEN trim(u.raw_user_meta_data ->> 'full_name')
        WHEN char_length(trim(split_part(u.email, '@', 1))) >= 2
          THEN trim(split_part(u.email, '@', 1))
        ELSE 'Usuario LuchoRentas'
      END
    INTO v_user_id, v_full_name
    FROM auth.users u
    WHERE lower(trim(u.email)) = lower(trim(v_email))
    LIMIT 1;

    IF v_user_id IS NULL THEN
      RAISE NOTICE 'AVISO: El correo % todavía no existe en auth.users. Cuando se registre, vuelve a ejecutar este script o asígnalo desde Usuarios y Permisos.', v_email;
      CONTINUE;
    END IF;

    INSERT INTO public.profiles (id, full_name, email)
    VALUES (v_user_id, v_full_name, lower(trim(v_email)))
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email;

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
        'source', '202611200008_tenant_owner_access_fix'
      )
    );

    RAISE NOTICE 'OK: % quedó con rol tenant_owner activo (permisos totales) en el tenant %.', v_email, v_target_tenant_id;
  END LOOP;
END $$;
