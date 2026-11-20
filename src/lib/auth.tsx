/**
 * Archivo: src/lib/auth.tsx
 * Responsabilidad: Manejo de sesión, autenticación (Supabase Auth o modo local controlado),
 *   selección y creación de tenant activo (tenant_id), gestión de membresías, matriz de
 *   permisos y bitácora de auditoría con validación de Capa 1 + Capa 2.
 * Cumplimiento LuchoRentas.md: RF-001 a RF-005 (CA-001 a CA-005), §4.1 (aislamiento estricto
 *   sin mezclar datos al cambiar de tenant), §5.1 (desactivación conserva historial).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from './supabase';
import {
  DEMO_ACCOUNT_PRESETS,
  DEMO_PROFILES,
  SEED_AUDIT_LOGS,
  SEED_CUSTOM_PERMISSIONS,
  SEED_MEMBERSHIPS,
  SEED_TENANTS,
} from './seedData';
import {
  DEFAULT_ROLE_PERMISSIONS,
  canAccessModule,
  canExecuteAction,
  validateTenantMutation,
} from './rbac';
import type {
  AppModuleId,
  AuditLogEntry,
  CurrencyCode,
  MembershipStatus,
  ModuleAction,
  RolePermissionRule,
  Tenant,
  TenantMembership,
  TenantRole,
  UserProfile,
} from '../types/domain';

interface LocalPreviewStore {
  profiles: UserProfile[];
  tenants: Tenant[];
  memberships: TenantMembership[];
  customPermissions: RolePermissionRule[];
  auditLogs: AuditLogEntry[];
  activeUserId: string | null;
  activeTenantId: string | null;
}

const PREVIEW_STORAGE_KEY = 'luchorentas_phase1_store_v1';

interface AuthActionResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface AuthContextValue {
  isLoading: boolean;
  isSupabaseLive: boolean;
  currentUser: UserProfile | null;
  myTenants: Tenant[];
  activeTenant: Tenant | null;
  activeMembership: TenantMembership | null;
  tenantMemberships: TenantMembership[];
  tenantPermissions: RolePermissionRule[];
  tenantAuditLogs: AuditLogEntry[];
  signIn: (email: string, password: string) => Promise<AuthActionResult>;
  signUp: (fullName: string, email: string, password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
  switchTenant: (tenantId: string) => void;
  refreshMemberships: () => Promise<void>;
  createTenant: (name: string, defaultCurrency: CurrencyCode) => Promise<AuthActionResult<Tenant>>;
  addOrUpdateMember: (input: {
    fullName: string;
    email: string;
    role: TenantRole;
    allowedPropertyIds?: string[] | null;
  }) => Promise<AuthActionResult>;
  toggleMembershipStatus: (
    membershipId: string,
    nextStatus: MembershipStatus
  ) => Promise<AuthActionResult>;
  updateRolePermission: (
    role: Exclude<TenantRole, 'tenant_owner'>,
    moduleId: AppModuleId,
    actionId: ModuleAction,
    allowed: boolean
  ) => Promise<AuthActionResult>;
  testProtectedMutation: (
    targetTenantId: string,
    moduleId: AppModuleId,
    actionId: ModuleAction
  ) => AuthActionResult<string>;
  canView: (moduleId: AppModuleId) => boolean;
  canDo: (moduleId: AppModuleId, actionId: ModuleAction, propertyId?: string | null) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadInitialPreviewStore(): LocalPreviewStore {
  const autostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const fallback: LocalPreviewStore = {
    profiles: DEMO_PROFILES,
    tenants: SEED_TENANTS,
    memberships: SEED_MEMBERSHIPS,
    customPermissions: SEED_CUSTOM_PERMISSIONS,
    auditLogs: SEED_AUDIT_LOGS,
    activeUserId: autostart ? DEMO_ACCOUNT_PRESETS[0].userId : null,
    activeTenantId: autostart ? SEED_TENANTS[0].id : null,
  };

  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as LocalPreviewStore;
    return {
      ...fallback,
      ...parsed,
      activeUserId: autostart ? DEMO_ACCOUNT_PRESETS[0].userId : parsed.activeUserId,
      activeTenantId: autostart
        ? parsed.activeTenantId ?? SEED_TENANTS[0].id
        : parsed.activeTenantId,
    };
  } catch {
    return fallback;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<LocalPreviewStore>(loadInitialPreviewStore);
  const [isLoading, setIsLoading] = useState<boolean>(isSupabaseConfigured);
  const [liveUser, setLiveUser] = useState<UserProfile | null>(null);
  const [liveTenants, setLiveTenants] = useState<Tenant[]>([]);
  const [liveMemberships, setLiveMemberships] = useState<TenantMembership[]>([]);
  const [livePermissions, setLivePermissions] = useState<RolePermissionRule[]>([]);
  const [liveAuditLogs, setLiveAuditLogs] = useState<AuditLogEntry[]>([]);
  const [liveActiveTenantId, setLiveActiveTenantId] = useState<string | null>(null);
  const liveActiveTenantIdRef = useRef<string | null>(null);
  useEffect(() => {
    liveActiveTenantIdRef.current = liveActiveTenantId;
  }, [liveActiveTenantId]);

  // Persistir almacén local cuando no hay Supabase activo
  useEffect(() => {
    if (isSupabaseConfigured) return;
    try {
      window.localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Ignorar si almacenamiento está lleno o bloqueado
    }
  }, [store]);

  const loadSupabaseTenantData = useCallback(async (userId: string, preferredTenantId?: string | null) => {
    if (!supabase) return;
    const { data: myMemRows, error: memErr } = await supabase
      .from('tenant_memberships')
      .select('id, tenant_id, user_id, role, status, allowed_property_ids, created_at, updated_at, tenants(*)')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (memErr || !myMemRows) {
      setLiveTenants([]);
      setLiveMemberships([]);
      return;
    }

    const tenantsList: Tenant[] = [];
    for (const row of myMemRows as Array<Record<string, unknown>>) {
      const t = row.tenants as Record<string, unknown> | null;
      if (t && t.is_active) {
        tenantsList.push({
          id: String(t.id),
          name: String(t.name),
          slug: String(t.slug),
          timezone: 'America/La_Paz',
          defaultCurrency: (t.default_currency as CurrencyCode) ?? 'BOB',
          isActive: Boolean(t.is_active),
          createdAt: String(t.created_at),
        });
      }
    }

    setLiveTenants(tenantsList);
    const nextTenantId =
      preferredTenantId && tenantsList.some((t) => t.id === preferredTenantId)
        ? preferredTenantId
        : tenantsList[0]?.id ?? null;
    setLiveActiveTenantId(nextTenantId);

    if (!nextTenantId) {
      setLiveMemberships([]);
      setLivePermissions([]);
      setLiveAuditLogs([]);
      return;
    }

    const [
      { data: tenantMems, error: tenantMemsErr },
      { data: permRows },
      { data: auditRows },
    ] = await Promise.all([
      supabase
        .from('tenant_memberships')
        .select('id, tenant_id, user_id, role, status, allowed_property_ids, created_at, updated_at')
        .eq('tenant_id', nextTenantId)
        .order('created_at', { ascending: true }),
      supabase
        .from('tenant_role_permissions')
        .select('*')
        .eq('tenant_id', nextTenantId),
      supabase
        .from('audit_logs')
        .select('*')
        .eq('tenant_id', nextTenantId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const rawMems =
      !tenantMemsErr && Array.isArray(tenantMems) && tenantMems.length > 0
        ? (tenantMems as Array<Record<string, unknown>>)
        : (myMemRows as Array<Record<string, unknown>>).filter(
            (m) => String(m.tenant_id) === nextTenantId
          );

    const profileIds = Array.from(
      new Set([
        userId,
        ...rawMems.map((m) => String(m.user_id)),
        ...((auditRows as Array<Record<string, unknown>>) ?? [])
          .map((a) => (a.actor_user_id ? String(a.actor_user_id) : ''))
          .filter(Boolean),
      ])
    );

    const profilesMap = new Map<string, UserProfile>();
    if (profileIds.length > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone')
        .in('id', profileIds);
      for (const p of (profileRows as Array<Record<string, unknown>>) ?? []) {
        profilesMap.set(String(p.id), {
          id: String(p.id),
          fullName: String(p.full_name),
          email: String(p.email),
          phone: p.phone ? String(p.phone) : undefined,
        });
      }
    }

    setLiveMemberships(
      rawMems.map((m) => ({
        id: String(m.id),
        tenantId: String(m.tenant_id),
        userId: String(m.user_id),
        role: m.role as TenantRole,
        status: m.status as MembershipStatus,
        allowedPropertyIds: (m.allowed_property_ids as string[] | null) ?? null,
        createdAt: String(m.created_at),
        updatedAt: String(m.updated_at),
        profile: profilesMap.get(String(m.user_id)),
      }))
    );

    setLivePermissions(
      ((permRows as Array<Record<string, unknown>>) ?? []).map((r) => ({
        id: String(r.id),
        tenantId: String(r.tenant_id),
        role: r.role as Exclude<TenantRole, 'tenant_owner'>,
        moduleId: r.module_id as AppModuleId,
        actionId: r.action_id as ModuleAction,
        allowed: Boolean(r.allowed),
      }))
    );

    setLiveAuditLogs(
      ((auditRows as Array<Record<string, unknown>>) ?? []).map((a) => {
        const actorId = a.actor_user_id ? String(a.actor_user_id) : null;
        const actorProfile = actorId ? profilesMap.get(actorId) : undefined;
        return {
          id: String(a.id),
          tenantId: String(a.tenant_id),
          actorUserId: actorId,
          actorName: actorProfile?.fullName ?? actorProfile?.email ?? actorId ?? 'Sistema',
          action: String(a.action),
          entityType: String(a.entity_type),
          entityId: a.entity_id ? String(a.entity_id) : null,
          metadata: (a.metadata as Record<string, unknown>) ?? {},
          createdAt: String(a.created_at),
        };
      })
    );
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      try {
        const user = data.session?.user;
        if (user) {
          setLiveUser({
            id: user.id,
            fullName: String(user.user_metadata?.full_name ?? user.email ?? 'Usuario'),
            email: user.email ?? '',
          });
          await loadSupabaseTenantData(user.id, liveActiveTenantIdRef.current);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user;
      if (user) {
        const shouldBlockLoader = event === 'SIGNED_IN' || event === 'INITIAL_SESSION';
        if (shouldBlockLoader && mounted) {
          setIsLoading(true);
        }
        try {
          setLiveUser({
            id: user.id,
            fullName: String(user.user_metadata?.full_name ?? user.email ?? 'Usuario'),
            email: user.email ?? '',
          });
          await loadSupabaseTenantData(user.id, liveActiveTenantIdRef.current);
        } finally {
          if (shouldBlockLoader && mounted) {
            setIsLoading(false);
          }
        }
      } else {
        setLiveUser(null);
        setLiveTenants([]);
        setLiveMemberships([]);
        setLivePermissions([]);
        setLiveAuditLogs([]);
        setLiveActiveTenantId(null);
        if (mounted) {
          setIsLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadSupabaseTenantData]);

  // Estado derivado según modo activo (Supabase Live vs Local Preview)
  const currentUser = useMemo(() => {
    if (isSupabaseConfigured) return liveUser;
    if (!store.activeUserId) return null;
    return store.profiles.find((p) => p.id === store.activeUserId) ?? null;
  }, [liveUser, store.activeUserId, store.profiles]);

  const myTenants = useMemo(() => {
    if (isSupabaseConfigured) return liveTenants;
    if (!currentUser) return [];
    const allowedIds = new Set(
      store.memberships
        .filter((m) => m.userId === currentUser.id && m.status === 'active')
        .map((m) => m.tenantId)
    );
    return store.tenants.filter((t) => t.isActive && allowedIds.has(t.id));
  }, [currentUser, liveTenants, store.memberships, store.tenants]);

  const activeTenant = useMemo(() => {
    if (isSupabaseConfigured) {
      return myTenants.find((t) => t.id === liveActiveTenantId) ?? myTenants[0] ?? null;
    }
    return myTenants.find((t) => t.id === store.activeTenantId) ?? myTenants[0] ?? null;
  }, [liveActiveTenantId, myTenants, store.activeTenantId]);

  // Estricto aislamiento por tenant_id: solo expone membresías, permisos y auditoría del tenant activo (CA-005)
  const tenantMemberships = useMemo(() => {
    if (!activeTenant) return [];
    if (isSupabaseConfigured) return liveMemberships;
    return store.memberships
      .filter((m) => m.tenantId === activeTenant.id)
      .map((m) => ({
        ...m,
        profile: m.profile ?? store.profiles.find((p) => p.id === m.userId),
      }));
  }, [activeTenant, liveMemberships, store.memberships, store.profiles]);

  const activeMembership = useMemo(() => {
    if (!currentUser || !activeTenant) return null;
    return (
      tenantMemberships.find(
        (m) => m.userId === currentUser.id && m.tenantId === activeTenant.id && m.status === 'active'
      ) ?? null
    );
  }, [activeTenant, currentUser, tenantMemberships]);

  const tenantPermissions = useMemo(() => {
    if (!activeTenant) return [];
    if (isSupabaseConfigured) return livePermissions;
    return store.customPermissions.filter((r) => r.tenantId === activeTenant.id);
  }, [activeTenant, livePermissions, store.customPermissions]);

  const tenantAuditLogs = useMemo(() => {
    if (!activeTenant) return [];
    if (isSupabaseConfigured) return liveAuditLogs;
    return store.auditLogs
      .filter((a) => a.tenantId === activeTenant.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [activeTenant, liveAuditLogs, store.auditLogs]);

  const signIn = async (email: string, password: string): Promise<AuthActionResult> => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password.trim()) {
      return { ok: false, error: 'Ingresa tu correo electrónico y contraseña.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }

    const user = store.profiles.find((p) => p.email.toLowerCase() === cleanEmail);
    if (!user) {
      return { ok: false, error: 'Credenciales inválidas. Verifica tu correo o crea una cuenta.' };
    }

    const firstMembership = store.memberships.find(
      (m) => m.userId === user.id && m.status === 'active'
    );

    if (!firstMembership) {
      return {
        ok: false,
        error: 'Tu cuenta fue desactivada o no tiene membresías activas en ningún espacio.',
      };
    }

    setStore((prev) => ({
      ...prev,
      activeUserId: user.id,
      activeTenantId: firstMembership.tenantId,
    }));
    return { ok: true };
  };

  const signUp = async (
    fullName: string,
    email: string,
    password: string
  ): Promise<AuthActionResult> => {
    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (cleanName.length < 2) {
      return { ok: false, error: 'Ingresa tu nombre completo (mínimo 2 caracteres).' };
    }
    if (!cleanEmail.includes('@')) {
      return { ok: false, error: 'Ingresa un correo electrónico válido.' };
    }
    if (password.length < 6) {
      return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { full_name: cleanName } },
      });
      if (error) return { ok: false, error: error.message };
      if (!data.session) {
        return {
          ok: true,
          error:
            'Cuenta creada. Revisa tu bandeja de correo para confirmar tu cuenta antes de ingresar.',
        };
      }
      return { ok: true };
    }

    if (store.profiles.some((p) => p.email.toLowerCase() === cleanEmail)) {
      return { ok: false, error: 'Ya existe un usuario registrado con ese correo.' };
    }

    const nowIso = new Date().toISOString();
    const newUserId = `user-${crypto.randomUUID().slice(0, 8)}`;
    const newTenantId = `tenant-${crypto.randomUUID().slice(0, 8)}`;
    const newProfile: UserProfile = { id: newUserId, fullName: cleanName, email: cleanEmail };
    const newTenant: Tenant = {
      id: newTenantId,
      name: `Espacio de ${cleanName.split(' ')[0]}`,
      slug: `espacio-${newUserId.slice(-6)}`,
      timezone: 'America/La_Paz',
      defaultCurrency: 'BOB',
      isActive: true,
      createdAt: nowIso,
    };
    const newMembership: TenantMembership = {
      id: `mem-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: newTenantId,
      userId: newUserId,
      role: 'tenant_owner',
      status: 'active',
      allowedPropertyIds: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      profile: newProfile,
    };

    setStore((prev) => ({
      ...prev,
      profiles: [...prev.profiles, newProfile],
      tenants: [...prev.tenants, newTenant],
      memberships: [...prev.memberships, newMembership],
      auditLogs: [
        ...prev.auditLogs,
        {
          id: `aud-${crypto.randomUUID().slice(0, 8)}`,
          tenantId: newTenantId,
          actorUserId: newUserId,
          actorName: cleanName,
          action: 'tenant.created',
          entityType: 'tenants',
          entityId: newTenantId,
          metadata: { name: newTenant.name, currency: 'BOB', timezone: 'America/La_Paz' },
          createdAt: nowIso,
        },
      ],
      activeUserId: newUserId,
      activeTenantId: newTenantId,
    }));
    return { ok: true };
  };

  const signOut = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
      return;
    }
    setStore((prev) => ({ ...prev, activeUserId: null, activeTenantId: null }));
  };

  const switchTenant = (tenantId: string) => {
    if (!myTenants.some((t) => t.id === tenantId)) return;
    if (isSupabaseConfigured && liveUser) {
      setLiveActiveTenantId(tenantId);
      void loadSupabaseTenantData(liveUser.id, tenantId);
      return;
    }
    setStore((prev) => ({ ...prev, activeTenantId: tenantId }));
  };

  const refreshMemberships = async () => {
    if (isSupabaseConfigured && liveUser) {
      await loadSupabaseTenantData(liveUser.id, liveActiveTenantIdRef.current);
    }
  };

  const createTenant = async (
    name: string,
    defaultCurrency: CurrencyCode
  ): Promise<AuthActionResult<Tenant>> => {
    const cleanName = name.trim();
    if (cleanName.length < 2) {
      return { ok: false, error: 'El nombre del espacio debe tener al menos 2 caracteres.' };
    }
    if (!currentUser) {
      return { ok: false, error: 'Sesión requerida para crear un tenant.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('create_tenant', {
        p_name: cleanName,
        p_default_currency: defaultCurrency,
      });
      if (error) return { ok: false, error: error.message };
      const created: Tenant = {
        id: String(data.id),
        name: String(data.name),
        slug: String(data.slug),
        timezone: 'America/La_Paz',
        defaultCurrency: data.default_currency as CurrencyCode,
        isActive: Boolean(data.is_active),
        createdAt: String(data.created_at),
      };
      await loadSupabaseTenantData(currentUser.id, created.id);
      return { ok: true, data: created };
    }

    const nowIso = new Date().toISOString();
    const tenantId = `tenant-${crypto.randomUUID().slice(0, 8)}`;
    const slug = `${cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')}-${tenantId.slice(-4)}`;

    const newTenant: Tenant = {
      id: tenantId,
      name: cleanName,
      slug,
      timezone: 'America/La_Paz',
      defaultCurrency,
      isActive: true,
      createdAt: nowIso,
    };

    const ownerMembership: TenantMembership = {
      id: `mem-${crypto.randomUUID().slice(0, 8)}`,
      tenantId,
      userId: currentUser.id,
      role: 'tenant_owner',
      status: 'active',
      allowedPropertyIds: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      profile: currentUser,
    };

    setStore((prev) => ({
      ...prev,
      tenants: [...prev.tenants, newTenant],
      memberships: [...prev.memberships, ownerMembership],
      auditLogs: [
        ...prev.auditLogs,
        {
          id: `aud-${crypto.randomUUID().slice(0, 8)}`,
          tenantId,
          actorUserId: currentUser.id,
          actorName: currentUser.fullName,
          action: 'tenant.created',
          entityType: 'tenants',
          entityId: tenantId,
          metadata: { name: cleanName, currency: defaultCurrency, timezone: 'America/La_Paz' },
          createdAt: nowIso,
        },
      ],
      activeTenantId: tenantId,
    }));

    return { ok: true, data: newTenant };
  };

  const addOrUpdateMember = async (input: {
    fullName: string;
    email: string;
    role: TenantRole;
    allowedPropertyIds?: string[] | null;
  }): Promise<AuthActionResult> => {
    if (!activeTenant || !currentUser) {
      return { ok: false, error: 'No existe un tenant activo.' };
    }

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'users_permissions',
      action: 'manage',
      customRules: tenantPermissions,
    });

    if (!authCheck.allowed) {
      return { ok: false, error: authCheck.message };
    }

    if (input.role === 'tenant_owner' && activeMembership?.role !== 'tenant_owner') {
      return {
        ok: false,
        error: 'Solo un Propietario del tenant puede asignar permisos totales de Propietario del tenant.',
      };
    }

    const cleanName = input.fullName.trim();
    const cleanEmail = input.email.trim().toLowerCase();
    if (!cleanEmail.includes('@')) {
      return { ok: false, error: 'Ingresa un correo electrónico válido.' };
    }
    if (!isSupabaseConfigured) {
      const existingProfile = store.profiles.some((p) => p.email.toLowerCase() === cleanEmail);
      if (!existingProfile && cleanName.length < 2) {
        return { ok: false, error: 'Nombre y correo electrónico válidos son obligatorios.' };
      }
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('add_member_by_email', {
        p_tenant_id: activeTenant.id,
        p_email: cleanEmail,
        p_role: input.role,
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabaseTenantData(currentUser.id, activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => {
      let targetProfile = prev.profiles.find((p) => p.email.toLowerCase() === cleanEmail);
      const nextProfiles = [...prev.profiles];

      if (!targetProfile) {
        targetProfile = {
          id: `user-${crypto.randomUUID().slice(0, 8)}`,
          fullName: cleanName,
          email: cleanEmail,
        };
        nextProfiles.push(targetProfile);
      }

      const existingIdx = prev.memberships.findIndex(
        (m) => m.tenantId === activeTenant.id && m.userId === targetProfile!.id
      );

      const nextMemberships = [...prev.memberships];
      let targetMembershipId = '';
      const resolvedAllowedProperties =
        input.role === 'tenant_owner' ? null : (input.allowedPropertyIds ?? null);

      if (existingIdx >= 0) {
        if (nextMemberships[existingIdx].role === 'tenant_owner') {
          return prev;
        }
        targetMembershipId = nextMemberships[existingIdx].id;
        nextMemberships[existingIdx] = {
          ...nextMemberships[existingIdx],
          role: input.role,
          status: 'active',
          allowedPropertyIds: resolvedAllowedProperties,
          updatedAt: nowIso,
          profile: targetProfile,
        };
      } else {
        targetMembershipId = `mem-${crypto.randomUUID().slice(0, 8)}`;
        nextMemberships.push({
          id: targetMembershipId,
          tenantId: activeTenant.id,
          userId: targetProfile.id,
          role: input.role,
          status: 'active',
          allowedPropertyIds: resolvedAllowedProperties,
          createdAt: nowIso,
          updatedAt: nowIso,
          profile: targetProfile,
        });
      }

      return {
        ...prev,
        profiles: nextProfiles,
        memberships: nextMemberships,
        auditLogs: [
          ...prev.auditLogs,
          {
            id: `aud-${crypto.randomUUID().slice(0, 8)}`,
            tenantId: activeTenant.id,
            actorUserId: currentUser.id,
            actorName: currentUser.fullName,
            action: existingIdx >= 0 ? 'membership.updated' : 'membership.created',
            entityType: 'tenant_memberships',
            entityId: targetMembershipId,
            metadata: { email: cleanEmail, role: input.role },
            createdAt: nowIso,
          },
        ],
      };
    });

    return { ok: true };
  };

  const toggleMembershipStatus = async (
    membershipId: string,
    nextStatus: MembershipStatus
  ): Promise<AuthActionResult> => {
    if (!activeTenant || !currentUser) {
      return { ok: false, error: 'No existe un tenant activo.' };
    }

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'users_permissions',
      action: 'manage',
      customRules: tenantPermissions,
    });

    if (!authCheck.allowed) {
      return { ok: false, error: authCheck.message };
    }

    const target = tenantMemberships.find((m) => m.id === membershipId);
    if (!target) {
      return { ok: false, error: 'Membresía no encontrada en el tenant activo.' };
    }
    if (target.role === 'tenant_owner') {
      return { ok: false, error: 'No es posible desactivar al propietario principal del tenant.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('set_membership_status', {
        p_tenant_id: activeTenant.id,
        p_membership_id: membershipId,
        p_status: nextStatus,
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabaseTenantData(currentUser.id, activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => ({
      ...prev,
      memberships: prev.memberships.map((m) =>
        m.id === membershipId && m.tenantId === activeTenant.id
          ? { ...m, status: nextStatus, updatedAt: nowIso }
          : m
      ),
      auditLogs: [
        ...prev.auditLogs,
        {
          id: `aud-${crypto.randomUUID().slice(0, 8)}`,
          tenantId: activeTenant.id,
          actorUserId: currentUser.id,
          actorName: currentUser.fullName,
          action: 'membership.status_changed',
          entityType: 'tenant_memberships',
          entityId: membershipId,
          metadata: { email: target.profile?.email, newStatus: nextStatus },
          createdAt: nowIso,
        },
      ],
    }));

    return { ok: true };
  };

  const updateRolePermission = async (
    role: Exclude<TenantRole, 'tenant_owner'>,
    moduleId: AppModuleId,
    actionId: ModuleAction,
    allowed: boolean
  ): Promise<AuthActionResult> => {
    if (!activeTenant || !currentUser) {
      return { ok: false, error: 'No existe un tenant activo.' };
    }
    if (activeMembership?.role !== 'tenant_owner') {
      return {
        ok: false,
        error: 'Capa 1 Backend: Solo el propietario del tenant puede modificar la matriz de permisos.',
      };
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from('tenant_role_permissions').upsert(
        {
          tenant_id: activeTenant.id,
          role,
          module_id: moduleId,
          action_id: actionId,
          allowed,
        },
        { onConflict: 'tenant_id,role,module_id,action_id' }
      );
      if (error) return { ok: false, error: error.message };
      await loadSupabaseTenantData(currentUser.id, activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => {
      const idx = prev.customPermissions.findIndex(
        (r) =>
          r.tenantId === activeTenant.id &&
          r.role === role &&
          r.moduleId === moduleId &&
          r.actionId === actionId
      );
      const nextRules = [...prev.customPermissions];
      if (idx >= 0) {
        nextRules[idx] = { ...nextRules[idx], allowed };
      } else {
        nextRules.push({
          id: `perm-${crypto.randomUUID().slice(0, 8)}`,
          tenantId: activeTenant.id,
          role,
          moduleId,
          actionId,
          allowed,
        });
      }
      return {
        ...prev,
        customPermissions: nextRules,
        auditLogs: [
          ...prev.auditLogs,
          {
            id: `aud-${crypto.randomUUID().slice(0, 8)}`,
            tenantId: activeTenant.id,
            actorUserId: currentUser.id,
            actorName: currentUser.fullName,
            action: 'permissions.updated',
            entityType: 'tenant_role_permissions',
            entityId: null,
            metadata: { role, moduleId, actionId, allowed },
            createdAt: nowIso,
          },
        ],
      };
    });

    return { ok: true };
  };

  const testProtectedMutation = (
    targetTenantId: string,
    moduleId: AppModuleId,
    actionId: ModuleAction
  ): AuthActionResult<string> => {
    const check = validateTenantMutation({
      membership: activeMembership,
      targetTenantId,
      moduleId,
      action: actionId,
      customRules: tenantPermissions,
    });
    if (!check.allowed) {
      return { ok: false, error: check.message };
    }
    return {
      ok: true,
      data: `Operación "${moduleId}:${actionId}" autorizada en backend para tenant "${activeTenant?.name}".`,
    };
  };

  const canView = useCallback(
    (moduleId: AppModuleId) => canAccessModule(activeMembership, moduleId, tenantPermissions),
    [activeMembership, tenantPermissions]
  );

  const canDo = useCallback(
    (moduleId: AppModuleId, actionId: ModuleAction, propertyId?: string | null) =>
      canExecuteAction(activeMembership, moduleId, actionId, propertyId, tenantPermissions),
    [activeMembership, tenantPermissions]
  );

  return (
    <AuthContext.Provider
      value={{
        isLoading,
        isSupabaseLive: isSupabaseConfigured,
        currentUser,
        myTenants,
        activeTenant,
        activeMembership,
        tenantMemberships,
        tenantPermissions,
        tenantAuditLogs,
        signIn,
        signUp,
        signOut,
        switchTenant,
        refreshMemberships,
        createTenant,
        addOrUpdateMember,
        toggleMembershipStatus,
        updateRolePermission,
        testProtectedMutation,
        canView,
        canDo,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return ctx;
}

export function isPermissionDefaultAllowed(
  role: Exclude<TenantRole, 'tenant_owner'>,
  moduleId: AppModuleId,
  actionId: ModuleAction,
  customRules: RolePermissionRule[]
): boolean {
  const override = customRules.find(
    (r) => r.role === role && r.moduleId === moduleId && r.actionId === actionId
  );
  if (override) return override.allowed;
  return (DEFAULT_ROLE_PERMISSIONS[role]?.[moduleId] ?? []).includes(actionId);
}
