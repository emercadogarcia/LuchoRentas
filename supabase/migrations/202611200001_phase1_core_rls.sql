-- ============================================================================
-- Archivo: supabase/migrations/202611200001_phase1_core_rls.sql
-- Responsabilidad: Esquema SQL inicial de Fase 1 para LuchoRentas (identidad,
--   tenants, membresías, permisos granulares, auditoría, funciones helper y
--   políticas RLS multi-tenant + RPCs transaccionales).
-- Cumplimiento LuchoRentas.md: Implementa RF-001 a RF-005, §4.1 (modelo de
--   tenant), §5.1 (reglas de autorización en backend), §10.1 (RLS obligatorio),
--   §10.5 (auditoría), §11.2–§11.4 (UUID, tenant_id, America/La_Paz, BOB/USD).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Tipos enumerados base
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.tenant_role AS ENUM (
    'tenant_owner',
    'admin',
    'collector',
    'finance_operator',
    'viewer'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.currency_code AS ENUM ('BOB', 'USD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.membership_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Función genérica para updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Tablas de Fase 1
-- ----------------------------------------------------------------------------

-- Perfiles de usuario (espejo de auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) >= 2),
  email text NOT NULL,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Espacios de trabajo multi-tenant
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  slug text NOT NULL UNIQUE CHECK (char_length(trim(slug)) >= 2),
  timezone text NOT NULL DEFAULT 'America/La_Paz' CHECK (timezone = 'America/La_Paz'),
  default_currency public.currency_code NOT NULL DEFAULT 'BOB',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Membresías independientes usuario <-> tenant
CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.tenant_role NOT NULL DEFAULT 'viewer',
  status public.membership_status NOT NULL DEFAULT 'active',
  -- Alcance opcional por casa/inmueble (NULL = todas las casas del tenant, DEC-13)
  allowed_property_ids uuid[] DEFAULT NULL,
  invited_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_membership_user UNIQUE (tenant_id, user_id),
  CONSTRAINT uq_tenant_membership_tenant_id UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_status
  ON public.tenant_memberships (user_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_tenant_status
  ON public.tenant_memberships (tenant_id, status);

CREATE TRIGGER trg_tenant_memberships_updated_at
  BEFORE UPDATE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Matriz granular de permisos por rol dentro de cada tenant (DEC-13)
CREATE TABLE IF NOT EXISTS public.tenant_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role public.tenant_role NOT NULL,
  module_id text NOT NULL,
  action_id text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_role_perm UNIQUE (tenant_id, role, module_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_role_perms_tenant_role
  ON public.tenant_role_permissions (tenant_id, role);

CREATE TRIGGER trg_tenant_role_permissions_updated_at
  BEFORE UPDATE ON public.tenant_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Bitácora de auditoría de acciones críticas (§10.5)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.profiles(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
  ON public.audit_logs (tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. Funciones de autorización (Capa 1 Backend, search_path fijado §11.3)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_has_active_membership(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.status = 'active'
      AND t.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_tenant_owner(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'tenant_owner'
      AND tm.status = 'active'
      AND t.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_permission(
  p_tenant_id uuid,
  p_module text,
  p_action text,
  p_property_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role public.tenant_role;
  v_allowed_properties uuid[];
  v_perm_allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT tm.role, tm.allowed_property_ids
  INTO v_role, v_allowed_properties
  FROM public.tenant_memberships tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.tenant_id = p_tenant_id
    AND tm.user_id = auth.uid()
    AND tm.status = 'active'
    AND t.is_active = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- §5.1: El propietario del tenant siempre tiene acceso total en su tenant
  IF v_role = 'tenant_owner' THEN
    RETURN true;
  END IF;

  -- DEC-13: Si el colaborador está restringido a casas específicas, validar alcance
  IF p_property_id IS NOT NULL AND v_allowed_properties IS NOT NULL THEN
    IF NOT (p_property_id = ANY(v_allowed_properties)) THEN
      RETURN false;
    END IF;
  END IF;

  SELECT trp.allowed
  INTO v_perm_allowed
  FROM public.tenant_role_permissions trp
  WHERE trp.tenant_id = p_tenant_id
    AND trp.role = v_role
    AND trp.module_id = p_module
    AND trp.action_id = p_action;

  RETURN COALESCE(v_perm_allowed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.current_user_has_active_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_active_membership(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_is_tenant_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_tenant_owner(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_has_permission(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_permission(uuid, text, text, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Activación de RLS y Políticas estrictas por tabla
-- ----------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES: cada usuario ve su perfil o el de compañeros en un mismo tenant activo
CREATE POLICY profiles_select_own_or_coworker
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.tenant_memberships my_m
      JOIN public.tenant_memberships target_m
        ON target_m.tenant_id = my_m.tenant_id
      WHERE my_m.user_id = auth.uid()
        AND my_m.status = 'active'
        AND target_m.user_id = profiles.id
    )
  );

CREATE POLICY profiles_update_own
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- TENANTS: solo visibles para usuarios con membresía activa
CREATE POLICY tenants_select_member
  ON public.tenants FOR SELECT
  TO authenticated
  USING (public.current_user_has_active_membership(id));

CREATE POLICY tenants_update_owner
  ON public.tenants FOR UPDATE
  TO authenticated
  USING (public.current_user_is_tenant_owner(id))
  WITH CHECK (public.current_user_is_tenant_owner(id));

-- TENANT_MEMBERSHIPS: lectura dentro del tenant; escritura solo propietario o users:manage
CREATE POLICY memberships_select_same_tenant
  ON public.tenant_memberships FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_has_active_membership(tenant_id)
  );

CREATE POLICY memberships_insert_authorized
  ON public.tenant_memberships FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_is_tenant_owner(tenant_id)
    OR public.current_user_has_permission(tenant_id, 'users_permissions', 'manage', NULL)
  );

CREATE POLICY memberships_update_authorized
  ON public.tenant_memberships FOR UPDATE
  TO authenticated
  USING (
    public.current_user_is_tenant_owner(tenant_id)
    OR public.current_user_has_permission(tenant_id, 'users_permissions', 'manage', NULL)
  )
  WITH CHECK (
    public.current_user_is_tenant_owner(tenant_id)
    OR public.current_user_has_permission(tenant_id, 'users_permissions', 'manage', NULL)
  );

-- TENANT_ROLE_PERMISSIONS: lectura para miembros activos; escritura solo tenant_owner
CREATE POLICY role_perms_select_member
  ON public.tenant_role_permissions FOR SELECT
  TO authenticated
  USING (public.current_user_has_active_membership(tenant_id));

CREATE POLICY role_perms_write_owner
  ON public.tenant_role_permissions FOR ALL
  TO authenticated
  USING (public.current_user_is_tenant_owner(tenant_id))
  WITH CHECK (public.current_user_is_tenant_owner(tenant_id));

-- AUDIT_LOGS: inmutable (solo SELECT para usuarios autorizados, sin UPDATE/DELETE)
CREATE POLICY audit_logs_select_authorized
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (
    public.current_user_is_tenant_owner(tenant_id)
    OR public.current_user_has_permission(tenant_id, 'users_permissions', 'view', NULL)
  );

-- ----------------------------------------------------------------------------
-- 6. Trigger para alta automática de perfil desde auth.users
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''), split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 7. RPCs Transaccionales de Fase 1
-- ----------------------------------------------------------------------------

-- Crea un tenant, asigna al creador como tenant_owner, inicializa matriz de permisos y audita
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticación requerida para crear un espacio de trabajo.' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_clean_name) < 2 THEN
    RAISE EXCEPTION 'El nombre del espacio debe tener al menos 2 caracteres.' USING ERRCODE = '22023';
  END IF;

  v_slug := lower(regexp_replace(v_clean_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 6);

  INSERT INTO public.tenants (name, slug, timezone, default_currency, created_by)
  VALUES (v_clean_name, v_slug, 'America/La_Paz', p_default_currency, v_user_id)
  RETURNING * INTO v_tenant;

  INSERT INTO public.tenant_memberships (tenant_id, user_id, role, status, invited_by)
  VALUES (v_tenant.id, v_user_id, 'tenant_owner', 'active', v_user_id);

  -- Semilla inicial de permisos por rol para el tenant
  INSERT INTO public.tenant_role_permissions (tenant_id, role, module_id, action_id, allowed)
  VALUES
    -- Administrador: operación completa excepto reconfigurar propiedad del tenant
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
    -- Cobrador: consulta cuentas y registra cobros/recibos
    (v_tenant.id, 'collector', 'dashboard', 'view', true),
    (v_tenant.id, 'collector', 'properties', 'view', true),
    (v_tenant.id, 'collector', 'people', 'view', true),
    (v_tenant.id, 'collector', 'receivables', 'view', true),
    (v_tenant.id, 'collector', 'collections', 'view', true),
    (v_tenant.id, 'collector', 'collections', 'create', true),
    (v_tenant.id, 'collector', 'cash', 'view', true),
    -- Operador financiero: gastos, pagos, caja y arqueos
    (v_tenant.id, 'finance_operator', 'dashboard', 'view', true),
    (v_tenant.id, 'finance_operator', 'properties', 'view', true),
    (v_tenant.id, 'finance_operator', 'people', 'view', true),
    (v_tenant.id, 'finance_operator', 'expenses', 'view', true),
    (v_tenant.id, 'finance_operator', 'expenses', 'manage', true),
    (v_tenant.id, 'finance_operator', 'cash', 'view', true),
    (v_tenant.id, 'finance_operator', 'cash', 'reconcile', true),
    (v_tenant.id, 'finance_operator', 'reports', 'view', true),
    (v_tenant.id, 'finance_operator', 'reports', 'export', true),
    -- Consulta: solo lectura
    (v_tenant.id, 'viewer', 'dashboard', 'view', true),
    (v_tenant.id, 'viewer', 'properties', 'view', true),
    (v_tenant.id, 'viewer', 'receivables', 'view', true),
    (v_tenant.id, 'viewer', 'reports', 'view', true);

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_tenant.id,
    v_user_id,
    'tenant.created',
    'tenants',
    v_tenant.id,
    jsonb_build_object('name', v_tenant.name, 'currency', v_tenant.default_currency, 'timezone', v_tenant.timezone)
  );

  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant(text, public.currency_code) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tenant(text, public.currency_code) TO authenticated;

-- Desactivar/reactivar membresía conservando historial (§5.1)
CREATE OR REPLACE FUNCTION public.set_membership_status(
  p_tenant_id uuid,
  p_membership_id uuid,
  p_status public.membership_status
)
RETURNS public.tenant_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_target public.tenant_memberships;
  v_owner_count integer;
BEGIN
  IF NOT (
    public.current_user_is_tenant_owner(p_tenant_id)
    OR public.current_user_has_permission(p_tenant_id, 'users_permissions', 'manage', NULL)
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: no tiene permiso para administrar usuarios en este tenant.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target
  FROM public.tenant_memberships
  WHERE id = p_membership_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membresía no encontrada en el tenant activo.' USING ERRCODE = 'P0002';
  END IF;

  IF v_target.role = 'tenant_owner' AND p_status = 'inactive' THEN
    SELECT count(*) INTO v_owner_count
    FROM public.tenant_memberships
    WHERE tenant_id = p_tenant_id AND role = 'tenant_owner' AND status = 'active';

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'No es posible desactivar al único propietario activo del tenant.' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.tenant_memberships
  SET status = p_status
  WHERE id = p_membership_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_target;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id,
    v_actor,
    'membership.status_changed',
    'tenant_memberships',
    v_target.id,
    jsonb_build_object('target_user_id', v_target.user_id, 'new_status', p_status)
  );

  RETURN v_target;
END;
$$;

REVOKE ALL ON FUNCTION public.set_membership_status(uuid, uuid, public.membership_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_membership_status(uuid, uuid, public.membership_status) TO authenticated;

-- Invitar o actualizar rol de un usuario registrado por correo dentro del tenant activo
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
  v_target_user_id uuid;
  v_membership public.tenant_memberships;
BEGIN
  IF NOT (
    public.current_user_is_tenant_owner(p_tenant_id)
    OR public.current_user_has_permission(p_tenant_id, 'users_permissions', 'manage', NULL)
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: no tiene permiso para administrar usuarios en este tenant.' USING ERRCODE = '42501';
  END IF;

  IF p_role = 'tenant_owner' THEN
    RAISE EXCEPTION 'No se puede asignar el rol Propietario principal mediante invitación.' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_target_user_id
  FROM public.profiles
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe una cuenta registrada con el correo "%". El usuario debe registrarse primero.', trim(p_email) USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.tenant_memberships (tenant_id, user_id, role, status, invited_by)
  VALUES (p_tenant_id, v_target_user_id, p_role, 'active', v_actor)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role = CASE WHEN tenant_memberships.role = 'tenant_owner' THEN tenant_memberships.role ELSE EXCLUDED.role END,
        status = 'active',
        updated_at = now()
  RETURNING * INTO v_membership;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id,
    v_actor,
    'membership.upserted',
    'tenant_memberships',
    v_membership.id,
    jsonb_build_object('email', lower(trim(p_email)), 'role', p_role)
  );

  RETURN v_membership;
END;
$$;

REVOKE ALL ON FUNCTION public.add_member_by_email(uuid, text, public.tenant_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_member_by_email(uuid, text, public.tenant_role) TO authenticated;

