-- ============================================================================
-- Archivo: supabase/migrations/202611200002_phase2_properties_people.sql
-- Responsabilidad: Esquema SQL de Fase 2 para LuchoRentas (casas, modalidades de
--   alquiler, unidades/cuartos, personas multi-rol, propietarios por casa con
--   participaciones históricas y suma 100%, políticas RLS tenant-safe y RPCs).
-- Cumplimiento LuchoRentas.md: RF-010 a RF-014 (CA-010 a CA-014), RF-020, RF-021,
--   RF-044, §4.2 (modalidad y estados de unidad), §4.3 (personas multi-rol),
--   §4.9 / DEC-10 (copropietarios 100% vigente), §11.4 (FKs compuestas tenant-safe).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tipos enumerados de Fase 2
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.rental_mode AS ENUM ('full_house', 'by_rooms');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.unit_status AS ENUM ('available', 'occupied', 'out_of_service');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.person_type AS ENUM ('individual', 'company');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.person_business_role AS ENUM (
    'tenant_renter',
    'property_owner',
    'supplier',
    'contact'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Tablas maestras tenant-safe (FKs compuestas por tenant_id)
-- ----------------------------------------------------------------------------

-- Casas / Inmuebles
CREATE TABLE IF NOT EXISTS public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  address text NOT NULL CHECK (char_length(trim(address)) >= 3),
  description text NOT NULL DEFAULT '',
  rental_mode public.rental_mode NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_properties_tenant_id UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_properties_tenant_active
  ON public.properties (tenant_id, is_active);

CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Unidades alquilables (casa completa lógica única o cuartos independientes)
CREATE TABLE IF NOT EXISTS public.property_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL,
  code text NOT NULL CHECK (char_length(trim(code)) >= 1),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  is_default_house_unit boolean NOT NULL DEFAULT false,
  status public.unit_status NOT NULL DEFAULT 'available',
  reference_rent numeric(14,2) CHECK (reference_rent IS NULL OR reference_rent >= 0),
  currency public.currency_code NOT NULL DEFAULT 'BOB',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_property_units_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_property_units_code_per_property UNIQUE (tenant_id, property_id, code),
  CONSTRAINT fk_property_units_property_tenant
    FOREIGN KEY (tenant_id, property_id)
    REFERENCES public.properties (tenant_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_property_units_tenant_property
  ON public.property_units (tenant_id, property_id, status);

CREATE TRIGGER trg_property_units_updated_at
  BEFORE UPDATE ON public.property_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Personas (ficha única por persona dentro del tenant)
CREATE TABLE IF NOT EXISTS public.people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) >= 2),
  person_type public.person_type NOT NULL DEFAULT 'individual',
  document_id text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  whatsapp text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_people_tenant_id UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_people_tenant_active
  ON public.people (tenant_id, is_active);

CREATE TRIGGER trg_people_updated_at
  BEFORE UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Roles de negocio de cada persona (inquilino, propietario, proveedor, contacto)
CREATE TABLE IF NOT EXISTS public.person_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  person_id uuid NOT NULL,
  role public.person_business_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_person_role_unique UNIQUE (tenant_id, person_id, role),
  CONSTRAINT fk_person_roles_person_tenant
    FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.people (tenant_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_person_roles_tenant_role
  ON public.person_roles (tenant_id, role);

-- Relación casa <-> propietario externo con histórico de vigencias (DEC-10)
CREATE TABLE IF NOT EXISTS public.property_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL,
  person_id uuid NOT NULL,
  ownership_percent numeric(5,2) NOT NULL CHECK (ownership_percent > 0 AND ownership_percent <= 100),
  effective_from date NOT NULL DEFAULT (now() AT TIME ZONE 'America/La_Paz')::date,
  effective_to date DEFAULT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_property_owner_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT fk_property_owners_property_tenant
    FOREIGN KEY (tenant_id, property_id)
    REFERENCES public.properties (tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_property_owners_person_tenant
    FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.people (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_property_owners_tenant_prop_active
  ON public.property_owners (tenant_id, property_id, effective_to);

CREATE TRIGGER trg_property_owners_updated_at
  BEFORE UPDATE ON public.property_owners
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS obligatorio con aislamiento multi-tenant y alcance por casa (DEC-13)
-- ----------------------------------------------------------------------------

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_owners ENABLE ROW LEVEL SECURITY;

-- PROPERTIES
CREATE POLICY properties_select_authorized
  ON public.properties FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'properties', 'view', id));

CREATE POLICY properties_write_authorized
  ON public.properties FOR ALL
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'properties', 'manage', id))
  WITH CHECK (public.current_user_has_permission(tenant_id, 'properties', 'manage', NULL));

-- PROPERTY_UNITS
CREATE POLICY property_units_select_authorized
  ON public.property_units FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'properties', 'view', property_id));

CREATE POLICY property_units_write_authorized
  ON public.property_units FOR ALL
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'properties', 'manage', property_id))
  WITH CHECK (public.current_user_has_permission(tenant_id, 'properties', 'manage', property_id));

-- PEOPLE
CREATE POLICY people_select_authorized
  ON public.people FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'people', 'view', NULL));

CREATE POLICY people_write_authorized
  ON public.people FOR ALL
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'people', 'manage', NULL))
  WITH CHECK (public.current_user_has_permission(tenant_id, 'people', 'manage', NULL));

-- PERSON_ROLES
CREATE POLICY person_roles_select_authorized
  ON public.person_roles FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'people', 'view', NULL));

CREATE POLICY person_roles_write_authorized
  ON public.person_roles FOR ALL
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'people', 'manage', NULL))
  WITH CHECK (public.current_user_has_permission(tenant_id, 'people', 'manage', NULL));

-- PROPERTY_OWNERS
CREATE POLICY property_owners_select_authorized
  ON public.property_owners FOR SELECT
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'properties', 'view', property_id));

CREATE POLICY property_owners_write_authorized
  ON public.property_owners FOR ALL
  TO authenticated
  USING (public.current_user_has_permission(tenant_id, 'properties', 'manage', property_id))
  WITH CHECK (public.current_user_has_permission(tenant_id, 'properties', 'manage', property_id));

-- ----------------------------------------------------------------------------
-- 4. RPCs Transaccionales de Fase 2
-- ----------------------------------------------------------------------------

-- Crear casa + unidad lógica automática si rental_mode = 'full_house' (CA-010, CA-011)
CREATE OR REPLACE FUNCTION public.create_property(
  p_tenant_id uuid,
  p_name text,
  p_address text,
  p_rental_mode public.rental_mode,
  p_description text DEFAULT '',
  p_reference_rent numeric DEFAULT NULL,
  p_currency public.currency_code DEFAULT 'BOB'
)
RETURNS public.properties
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_prop public.properties;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'properties', 'manage', NULL) THEN
    RAISE EXCEPTION 'Acceso denegado para crear inmuebles en este tenant.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.properties (tenant_id, name, address, description, rental_mode, created_by)
  VALUES (p_tenant_id, trim(p_name), trim(p_address), COALESCE(trim(p_description), ''), p_rental_mode, v_actor)
  RETURNING * INTO v_prop;

  IF p_rental_mode = 'full_house' THEN
    INSERT INTO public.property_units (
      tenant_id, property_id, code, name, is_default_house_unit, status, reference_rent, currency
    )
    VALUES (
      p_tenant_id, v_prop.id, 'CASA-COMPLETA', trim(p_name) || ' (Casa completa)', true, 'available', p_reference_rent, p_currency
    );
  END IF;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id,
    v_actor,
    'property.created',
    'properties',
    v_prop.id,
    jsonb_build_object('name', v_prop.name, 'rental_mode', p_rental_mode)
  );

  RETURN v_prop;
END;
$$;

REVOKE ALL ON FUNCTION public.create_property(uuid, text, text, public.rental_mode, text, numeric, public.currency_code) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_property(uuid, text, text, public.rental_mode, text, numeric, public.currency_code) TO authenticated;

-- Cambiar modalidad validando que no existan unidades ocupadas incompatibles (§4.2)
CREATE OR REPLACE FUNCTION public.update_property_rental_mode(
  p_tenant_id uuid,
  p_property_id uuid,
  p_new_mode public.rental_mode
)
RETURNS public.properties
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_prop public.properties;
  v_occupied_count integer;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'properties', 'manage', p_property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para modificar este inmueble.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop
  FROM public.properties
  WHERE id = p_property_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inmueble no encontrado en el tenant activo.' USING ERRCODE = 'P0002';
  END IF;

  IF v_prop.rental_mode = p_new_mode THEN
    RETURN v_prop;
  END IF;

  SELECT count(*) INTO v_occupied_count
  FROM public.property_units
  WHERE tenant_id = p_tenant_id AND property_id = p_property_id AND status = 'occupied';

  IF v_occupied_count > 0 THEN
    RAISE EXCEPTION 'No se puede cambiar la modalidad mientras existan unidades ocupadas o contratos activos.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.properties
  SET rental_mode = p_new_mode
  WHERE id = p_property_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_prop;

  IF p_new_mode = 'full_house' THEN
    UPDATE public.property_units
    SET is_active = false
    WHERE tenant_id = p_tenant_id AND property_id = p_property_id AND is_default_house_unit = false;

    INSERT INTO public.property_units (
      tenant_id, property_id, code, name, is_default_house_unit, status, currency
    )
    VALUES (
      p_tenant_id, p_property_id, 'CASA-COMPLETA', v_prop.name || ' (Casa completa)', true, 'available', 'BOB'
    )
    ON CONFLICT (tenant_id, property_id, code) DO UPDATE
      SET is_active = true, status = 'available';
  END IF;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'property.mode_updated', 'properties', p_property_id,
    jsonb_build_object('new_mode', p_new_mode)
  );

  RETURN v_prop;
END;
$$;

REVOKE ALL ON FUNCTION public.update_property_rental_mode(uuid, uuid, public.rental_mode) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_property_rental_mode(uuid, uuid, public.rental_mode) TO authenticated;

-- Guardar participaciones vigentes de propietarios exigiendo suma 100.00% (DEC-10)
CREATE OR REPLACE FUNCTION public.save_property_owners(
  p_tenant_id uuid,
  p_property_id uuid,
  p_owners jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_total numeric := 0;
  v_item jsonb;
  v_person_id uuid;
  v_pct numeric(5,2);
  v_today date := (now() AT TIME ZONE 'America/La_Paz')::date;
BEGIN
  IF NOT public.current_user_has_permission(p_tenant_id, 'properties', 'manage', p_property_id) THEN
    RAISE EXCEPTION 'Acceso denegado para gestionar propietarios de esta casa.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_owners) <> 'array' THEN
    RAISE EXCEPTION 'Formato de propietarios inválido.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_owners) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_owners)
    LOOP
      v_pct := (v_item ->> 'ownership_percent')::numeric(5,2);
      IF v_pct <= 0 OR v_pct > 100 THEN
        RAISE EXCEPTION 'Cada participación debe estar entre 0.01%% y 100%%.' USING ERRCODE = '22023';
      END IF;
      v_total := v_total + v_pct;
    END LOOP;

    IF v_total <> 100.00 THEN
      RAISE EXCEPTION 'La suma de participaciones vigentes de los copropietarios debe ser exactamente 100%% (actual: %s%%).', v_total USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Cerrar vigencias anteriores sin borrar historial
  UPDATE public.property_owners
  SET effective_to = v_today
  WHERE tenant_id = p_tenant_id
    AND property_id = p_property_id
    AND effective_to IS NULL;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_owners)
  LOOP
    v_person_id := (v_item ->> 'person_id')::uuid;
    v_pct := (v_item ->> 'ownership_percent')::numeric(5,2);

    IF NOT EXISTS (
      SELECT 1 FROM public.person_roles
      WHERE tenant_id = p_tenant_id AND person_id = v_person_id AND role = 'property_owner'
    ) THEN
      RAISE EXCEPTION 'La persona seleccionada no posee el rol de Propietario en este tenant.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.property_owners (
      tenant_id, property_id, person_id, ownership_percent, effective_from, effective_to, notes
    )
    VALUES (
      p_tenant_id, p_property_id, v_person_id, v_pct, v_today, NULL, COALESCE(v_item ->> 'notes', '')
    );
  END LOOP;

  INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_tenant_id, v_actor, 'property.owners_updated', 'properties', p_property_id,
    jsonb_build_object('owners_count', jsonb_array_length(p_owners))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_property_owners(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_property_owners(uuid, uuid, jsonb) TO authenticated;
