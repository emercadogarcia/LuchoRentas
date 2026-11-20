/**
 * Archivo: src/lib/rbac.ts
 * Responsabilidad: Lógica pura de control de acceso basado en roles (RBAC) y aislamiento
 *   multi-tenant (Capa 2 Frontend + validación espejo de Capa 1 Backend), además de
 *   utilidades de formato para zona horaria America/La_Paz y monedas separadas BOB/USD.
 * Cumplimiento LuchoRentas.md: §4.1 (aislamiento), §5.1 (reglas de autorización y
 *   alcance por casa DEC-13), §8.7 (nunca mezclar BOB/USD, America/La_Paz).
 */
import type {
  AppModuleId,
  CurrencyCode,
  ModuleAction,
  ModuleCatalogItem,
  PhaseRoadmapItem,
  RolePermissionRule,
  TenantMembership,
  TenantRole,
} from '../types/domain';

export const DEFAULT_ROLE_PERMISSIONS: Record<
  Exclude<TenantRole, 'tenant_owner'>,
  Partial<Record<AppModuleId, ModuleAction[]>>
> = {
  admin: {
    dashboard: ['view'],
    properties: ['view', 'manage'],
    people: ['view', 'manage'],
    contracts: ['view', 'manage'],
    receivables: ['view', 'generate'],
    collections: ['view', 'create', 'reverse'],
    expenses: ['view', 'manage'],
    cash: ['view', 'reconcile'],
    reports: ['view', 'export'],
    users_permissions: ['view'],
  },
  collector: {
    dashboard: ['view'],
    properties: ['view'],
    people: ['view'],
    receivables: ['view'],
    collections: ['view', 'create'],
    cash: ['view'],
  },
  finance_operator: {
    dashboard: ['view'],
    properties: ['view'],
    people: ['view'],
    expenses: ['view', 'manage'],
    cash: ['view', 'reconcile'],
    reports: ['view', 'export'],
  },
  viewer: {
    dashboard: ['view'],
    properties: ['view'],
    receivables: ['view'],
    reports: ['view'],
  },
};

export const MODULE_CATALOG: ModuleCatalogItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard Ejecutivo',
    archetype: 'Modelo A',
    phase: 6,
    description: 'Filtro Mes/Año, 4 KPIs financieros, 4 indicadores de unidades y movimientos recientes.',
    requiredAction: 'view',
  },
  {
    id: 'properties',
    label: 'Casas y Cuartos',
    archetype: 'Modelo B',
    phase: 2,
    description: 'Gestión de casas completas o por cuartos, estado de unidades y propietarios.',
    requiredAction: 'view',
  },
  {
    id: 'people',
    label: 'Personas y Roles',
    archetype: 'Modelo B',
    phase: 2,
    description: 'Fichas únicas de inquilinos, propietarios de inmuebles y proveedores.',
    requiredAction: 'view',
  },
  {
    id: 'contracts',
    label: 'Contratos Mensuales',
    archetype: 'Modelo B',
    phase: 3,
    description: 'Contratos por aniversario contractual, prorrateo real e historial de tarifas.',
    requiredAction: 'view',
  },
  {
    id: 'receivables',
    label: 'Cuentas por Cobrar',
    archetype: 'Modelo C',
    phase: 3,
    description: 'Obligaciones mensuales idempotentes, morosidad informativa y saldos.',
    requiredAction: 'view',
  },
  {
    id: 'collections',
    label: 'Cobros y Recibos',
    archetype: 'Modelo C',
    phase: 4,
    description: 'Cobros parciales/totales con recibo correlativo descargable en PNG y PDF.',
    requiredAction: 'view',
  },
  {
    id: 'expenses',
    label: 'Gastos y CxP',
    archetype: 'Modelo C',
    phase: 5,
    description: 'Mantenimiento, servicios básicos y pagos parciales/totales a proveedores.',
    requiredAction: 'view',
  },
  {
    id: 'cash',
    label: 'Caja y Arqueo',
    archetype: 'Modelo D',
    phase: 5,
    description: 'Cajas por usuario y moneda (BOB/USD), apertura, arqueo, conciliación y cierre.',
    requiredAction: 'view',
  },
  {
    id: 'reports',
    label: 'Reportes Financieros',
    archetype: 'Modelo D',
    phase: 6,
    description: 'Consolidado por período, desglose por Casa y por Propietario sin mezclar monedas.',
    requiredAction: 'view',
  },
  {
    id: 'users_permissions',
    label: 'Usuarios y Permisos',
    archetype: 'Modelo B',
    phase: 1,
    description: 'Membresías del tenant activo, roles, permisos granulares y bitácora RLS.',
    requiredAction: 'view',
  },
];

export const PHASE_ROADMAP: PhaseRoadmapItem[] = [
  {
    phase: 1,
    title: 'Fundación, Auth, Multi-Tenant, Roles y RLS',
    status: 'active',
    scope: 'Estructura base, tema Oscuro/Claro persistente, sesión, cambio de tenant, matriz RBAC doble capa y SQL inicial con RLS.',
    deliverables: ['Esquema SQL + RLS', 'Sesión y Multi-Tenant', 'Control de Roles', 'Tema Oscuro/Claro'],
  },
  {
    phase: 2,
    title: 'Casas, Cuartos y Personas (Inquilinos, Propietarios, Proveedores)',
    status: 'active',
    scope: 'ABM de casas completas o por cuartos, unidades independientes, personas multi-rol y participaciones históricas de propiedad.',
    deliverables: ['Casas y Cuartos', 'Personas y Proveedores', 'Asociación Propietario-Casa'],
  },
  {
    phase: 3,
    title: 'Contratos Mensuales y Cuentas por Cobrar (CxC)',
    status: 'active',
    scope: 'Contratos por aniversario (DEC-18 confirmada), prorrateo real, prevención de doble ocupación, generación diaria idempotente y manual de CxC.',
    deliverables: ['Contratos y Versiones', 'Generación Idempotente CxC', 'Morosidad Informativa'],
  },
  {
    phase: 4,
    title: 'Cobros, Aplicaciones y Recibos Correlativos (PNG y PDF)',
    status: 'active',
    scope: 'Cobros completos/parciales, créditos separados por excedente, reversiones auditadas, numeración correlativa y emisión descargable en PNG y PDF.',
    deliverables: ['Cobros Inmutables', 'Reversiones', 'Recibos PNG / PDF'],
  },
  {
    phase: 5,
    title: 'Gastos, Cuentas por Pagar, Caja por Usuario y Arqueos',
    status: 'active',
    scope: 'Gastos separados en registro/aprobación/pago, cajas independientes por usuario y moneda, arqueo y conciliación.',
    deliverables: ['Gastos y CxP', 'Pagos a Proveedores', 'Caja y Arqueo'],
  },
  {
    phase: 6,
    title: 'Dashboard Ejecutivo y Consolidado por Casa y Propietario',
    status: 'active',
    scope: 'Dashboard Modelo A con filtro Mes/Año, 4 KPIs, 4 indicadores de unidades, movimientos recientes y reportes Modelo D.',
    deliverables: ['Dashboard Mes/Año', 'Reporte por Casa', 'Reporte por Propietario'],
  },
  {
    phase: 7,
    title: 'QA, Seguridad, Restauración y Liberación',
    status: 'active',
    scope: 'Pruebas negativas RLS, auditoría de invariantes financieras, conciliación Dashboard/Reportes, manual operativo y runbook de backup.',
    deliverables: ['Auditoría QA SQL/DOM', 'Pruebas Negativas RLS', 'Manual y Backup/Restore'],
  },
];

/**
 * Evalúa si una membresía activa tiene permiso para ejecutar una acción en un módulo
 * y opcionalmente sobre una casa/propiedad específica (DEC-13).
 */
export function canExecuteAction(
  membership: TenantMembership | null | undefined,
  moduleId: AppModuleId,
  action: ModuleAction,
  propertyId?: string | null,
  customRules?: RolePermissionRule[]
): boolean {
  if (!membership || membership.status !== 'active') {
    return false;
  }

  // §5.1: El propietario del tenant siempre tiene acceso total en su tenant
  if (membership.role === 'tenant_owner') {
    return true;
  }

  // DEC-13: Alcance por casa/inmueble si está restringido
  if (propertyId && membership.allowedPropertyIds !== null) {
    if (!membership.allowedPropertyIds.includes(propertyId)) {
      return false;
    }
  }

  // Si existen reglas personalizadas para el tenant activo, priorizarlas
  if (customRules && customRules.length > 0) {
    const match = customRules.find(
      (r) =>
        r.tenantId === membership.tenantId &&
        r.role === membership.role &&
        r.moduleId === moduleId &&
        r.actionId === action
    );
    if (match) {
      return match.allowed;
    }
  }

  const roleDefaults = DEFAULT_ROLE_PERMISSIONS[membership.role];
  const allowedActions = roleDefaults?.[moduleId] ?? [];
  return allowedActions.includes(action);
}

export function canAccessModule(
  membership: TenantMembership | null | undefined,
  moduleId: AppModuleId,
  customRules?: RolePermissionRule[]
): boolean {
  return canExecuteAction(membership, moduleId, 'view', null, customRules);
}

/**
 * Validación de Capa 1 (Backend/RPC guard) para operaciones dentro de un tenant.
 * Evita confiar en el cliente: verifica pertenencia al tenant y permiso efectivo.
 */
export function validateTenantMutation(params: {
  membership: TenantMembership | null | undefined;
  targetTenantId: string;
  moduleId: AppModuleId;
  action: ModuleAction;
  propertyId?: string | null;
  customRules?: RolePermissionRule[];
}): { allowed: true } | { allowed: false; code: 'UNAUTHENTICATED' | 'TENANT_MISMATCH' | 'FORBIDDEN'; message: string } {
  const { membership, targetTenantId, moduleId, action, propertyId, customRules } = params;

  if (!membership || membership.status !== 'active') {
    return {
      allowed: false,
      code: 'UNAUTHENTICATED',
      message: 'Sesión o membresía inactiva. Acceso denegado por política RLS.',
    };
  }

  if (membership.tenantId !== targetTenantId) {
    return {
      allowed: false,
      code: 'TENANT_MISMATCH',
      message: 'Aislamiento multi-tenant: no puede operar sobre un tenant diferente al activo.',
    };
  }

  if (!canExecuteAction(membership, moduleId, action, propertyId, customRules)) {
    return {
      allowed: false,
      code: 'FORBIDDEN',
      message: `Permiso denegado: el rol "${membership.role}" no tiene autorización para "${moduleId}:${action}".`,
    };
  }

  return { allowed: true };
}

/**
 * Formatea una fecha/hora estrictamente en la zona horaria America/La_Paz.
 */
export function formatBoliviaDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return 'Fecha inválida';
  }
  return new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Obtiene el mes y año actual en America/La_Paz.
 */
export function getCurrentLaPazPeriod(referenceDate = new Date()): { month: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(referenceDate);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? referenceDate.getFullYear());
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? referenceDate.getMonth() + 1);
  return { month, year };
}

/**
 * Formatea montos monetarios explícitos por moneda (BOB o USD), sin mezclar divisas (DEC-01).
 */
export function formatCurrencyAmount(amount: number, currency: CurrencyCode): string {
  const formatted = new Intl.NumberFormat('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency === 'BOB' ? `Bs ${formatted}` : `$us ${formatted}`;
}
