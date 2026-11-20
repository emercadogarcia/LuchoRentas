/**
 * Archivo: src/lib/seedData.ts
 * Responsabilidad: Datos iniciales deterministas para el modo de vista previa local
 *   cuando Supabase aún no tiene credenciales configuradas en el entorno.
 * Cumplimiento LuchoRentas.md: Permite probar aislamiento estricto entre dos tenants
 *   (Inmobiliaria Las Palmas en BOB y Residencial Tunari en USD), membresías multi-tenant
 *   y los 5 roles operativos del PRD en zona horaria America/La_Paz.
 */
import type {
  AuditLogEntry,
  RolePermissionRule,
  Tenant,
  TenantMembership,
  UserProfile,
} from '../types/domain';

export interface DemoAccountPreset {
  email: string;
  password: string;
  label: string;
  roleSummary: string;
  userId: string;
}

export const DEMO_PROFILES: UserProfile[] = [
  {
    id: 'user-owner-1',
    fullName: 'Edgar Mercado',
    email: 'edgar@luchorentas.bo',
    phone: '+59170203103',
  },
  {
    id: 'user-admin-1',
    fullName: 'Lucía Mendoza',
    email: 'lucia@luchorentas.bo',
    phone: '+59171234567',
  },
  {
    id: 'user-collector-1',
    fullName: 'Carlos Mamani',
    email: 'carlos@luchorentas.bo',
    phone: '+59172223344',
  },
  {
    id: 'user-finance-1',
    fullName: 'Valeria Rojas',
    email: 'valeria@luchorentas.bo',
    phone: '+59173334455',
  },
  {
    id: 'user-viewer-1',
    fullName: 'Jorge Salazar',
    email: 'jorge@luchorentas.bo',
    phone: '+59174445566',
  },
];

export const DEMO_ACCOUNT_PRESETS: DemoAccountPreset[] = [
  {
    email: 'edgar@luchorentas.bo',
    password: 'Lucho2026!',
    label: 'Propietario del tenant',
    roleSummary: 'Acceso total (2 tenants)',
    userId: 'user-owner-1',
  },
  {
    email: 'lucia@luchorentas.bo',
    password: 'Lucho2026!',
    label: 'Administrador',
    roleSummary: 'Operación completa sin gestión de roles',
    userId: 'user-admin-1',
  },
  {
    email: 'carlos@luchorentas.bo',
    password: 'Lucho2026!',
    label: 'Cobrador',
    roleSummary: 'CxC, Cobros y Recibos',
    userId: 'user-collector-1',
  },
  {
    email: 'valeria@luchorentas.bo',
    password: 'Lucho2026!',
    label: 'Operador financiero',
    roleSummary: 'Gastos, CxP, Caja y Arqueo',
    userId: 'user-finance-1',
  },
  {
    email: 'jorge@luchorentas.bo',
    password: 'Lucho2026!',
    label: 'Consulta',
    roleSummary: 'Solo lectura',
    userId: 'user-viewer-1',
  },
];

export const SEED_TENANTS: Tenant[] = [
  {
    id: 'tenant-las-palmas',
    name: 'Inmobiliaria Las Palmas',
    slug: 'las-palmas-scz',
    timezone: 'America/La_Paz',
    defaultCurrency: 'BOB',
    isActive: true,
    createdAt: '2026-11-01T14:00:00-04:00',
  },
  {
    id: 'tenant-tunari',
    name: 'Residencial Tunari',
    slug: 'residencial-tunari-cbba',
    timezone: 'America/La_Paz',
    defaultCurrency: 'USD',
    isActive: true,
    createdAt: '2026-11-05T10:30:00-04:00',
  },
];

export const SEED_MEMBERSHIPS: TenantMembership[] = [
  {
    id: 'mem-palmas-owner',
    tenantId: 'tenant-las-palmas',
    userId: 'user-owner-1',
    role: 'tenant_owner',
    status: 'active',
    allowedPropertyIds: null,
    createdAt: '2026-11-01T14:00:00-04:00',
    updatedAt: '2026-11-01T14:00:00-04:00',
    profile: DEMO_PROFILES[0],
  },
  {
    id: 'mem-palmas-admin',
    tenantId: 'tenant-las-palmas',
    userId: 'user-admin-1',
    role: 'admin',
    status: 'active',
    allowedPropertyIds: null,
    createdAt: '2026-11-02T09:15:00-04:00',
    updatedAt: '2026-11-02T09:15:00-04:00',
    profile: DEMO_PROFILES[1],
  },
  {
    id: 'mem-palmas-collector',
    tenantId: 'tenant-las-palmas',
    userId: 'user-collector-1',
    role: 'collector',
    status: 'active',
    allowedPropertyIds: null,
    createdAt: '2026-11-03T11:20:00-04:00',
    updatedAt: '2026-11-03T11:20:00-04:00',
    profile: DEMO_PROFILES[2],
  },
  {
    id: 'mem-palmas-finance',
    tenantId: 'tenant-las-palmas',
    userId: 'user-finance-1',
    role: 'finance_operator',
    status: 'active',
    allowedPropertyIds: null,
    createdAt: '2026-11-04T16:45:00-04:00',
    updatedAt: '2026-11-04T16:45:00-04:00',
    profile: DEMO_PROFILES[3],
  },
  {
    id: 'mem-palmas-viewer',
    tenantId: 'tenant-las-palmas',
    userId: 'user-viewer-1',
    role: 'viewer',
    status: 'active',
    allowedPropertyIds: null,
    createdAt: '2026-11-05T08:30:00-04:00',
    updatedAt: '2026-11-05T08:30:00-04:00',
    profile: DEMO_PROFILES[4],
  },
  // Segundo tenant aislado (Edgar participa como Administrador, Lucía es Propietaria)
  {
    id: 'mem-tunari-owner',
    tenantId: 'tenant-tunari',
    userId: 'user-admin-1',
    role: 'tenant_owner',
    status: 'active',
    allowedPropertyIds: null,
    createdAt: '2026-11-05T10:30:00-04:00',
    updatedAt: '2026-11-05T10:30:00-04:00',
    profile: DEMO_PROFILES[1],
  },
  {
    id: 'mem-tunari-edgar',
    tenantId: 'tenant-tunari',
    userId: 'user-owner-1',
    role: 'admin',
    status: 'active',
    allowedPropertyIds: null,
    createdAt: '2026-11-06T12:00:00-04:00',
    updatedAt: '2026-11-06T12:00:00-04:00',
    profile: DEMO_PROFILES[0],
  },
];

export const SEED_CUSTOM_PERMISSIONS: RolePermissionRule[] = [];

export const SEED_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: 'aud-1',
    tenantId: 'tenant-las-palmas',
    actorUserId: 'user-owner-1',
    actorName: 'Edgar Mercado',
    action: 'tenant.created',
    entityType: 'tenants',
    entityId: 'tenant-las-palmas',
    metadata: { name: 'Inmobiliaria Las Palmas', currency: 'BOB', timezone: 'America/La_Paz' },
    createdAt: '2026-11-01T14:00:00-04:00',
  },
  {
    id: 'aud-2',
    tenantId: 'tenant-las-palmas',
    actorUserId: 'user-owner-1',
    actorName: 'Edgar Mercado',
    action: 'membership.created',
    entityType: 'tenant_memberships',
    entityId: 'mem-palmas-collector',
    metadata: { email: 'carlos@luchorentas.bo', role: 'collector' },
    createdAt: '2026-11-03T11:20:00-04:00',
  },
  {
    id: 'aud-3',
    tenantId: 'tenant-tunari',
    actorUserId: 'user-admin-1',
    actorName: 'Lucía Mendoza',
    action: 'tenant.created',
    entityType: 'tenants',
    entityId: 'tenant-tunari',
    metadata: { name: 'Residencial Tunari', currency: 'USD', timezone: 'America/La_Paz' },
    createdAt: '2026-11-05T10:30:00-04:00',
  },
];
