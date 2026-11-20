/**
 * Archivo: src/lib/rbac.test.ts
 * Responsabilidad: Pruebas unitarias deterministas de control de acceso por roles (RBAC),
 *   aislamiento multi-tenant y utilidades de moneda/zona horaria (America/La_Paz, BOB/USD).
 * Cumplimiento LuchoRentas.md: Valida CA-003 (aislamiento), CA-004 (permisos por rol y casa)
 *   y reglas de moneda/zona horaria.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessModule,
  canExecuteAction,
  formatCurrencyAmount,
  validateTenantMutation,
} from './rbac';
import type { RolePermissionRule, TenantMembership } from '../types/domain';

const tenantAMembershipOwner: TenantMembership = {
  id: 'm-1',
  tenantId: 'tenant-a',
  userId: 'u-1',
  role: 'tenant_owner',
  status: 'active',
  allowedPropertyIds: null,
  createdAt: '2026-11-20T00:00:00Z',
  updatedAt: '2026-11-20T00:00:00Z',
};

const tenantAMembershipCollector: TenantMembership = {
  id: 'm-2',
  tenantId: 'tenant-a',
  userId: 'u-2',
  role: 'collector',
  status: 'active',
  allowedPropertyIds: ['prop-1'],
  createdAt: '2026-11-20T00:00:00Z',
  updatedAt: '2026-11-20T00:00:00Z',
};

const inactiveMembership: TenantMembership = {
  ...tenantAMembershipOwner,
  id: 'm-3',
  status: 'inactive',
};

test('tenant_owner tiene acceso total dentro de su tenant activo sobre todos los módulos ABM y operativos', () => {
  const modulesAndActions = [
    ['dashboard', 'view'],
    ['properties', 'view'],
    ['properties', 'manage'],
    ['people', 'view'],
    ['people', 'manage'],
    ['contracts', 'view'],
    ['contracts', 'manage'],
    ['receivables', 'view'],
    ['receivables', 'generate'],
    ['collections', 'view'],
    ['collections', 'create'],
    ['collections', 'reverse'],
    ['expenses', 'view'],
    ['expenses', 'manage'],
    ['cash', 'view'],
    ['cash', 'reconcile'],
    ['reports', 'view'],
    ['reports', 'export'],
    ['users_permissions', 'view'],
    ['users_permissions', 'manage'],
  ] as const;

  const ownerWithScopedArray: TenantMembership = {
    ...tenantAMembershipOwner,
    allowedPropertyIds: ['prop-1'],
  };

  for (const [mod, act] of modulesAndActions) {
    assert.equal(canAccessModule(tenantAMembershipOwner, mod), true);
    assert.equal(canExecuteAction(tenantAMembershipOwner, mod, act), true);
    assert.equal(canExecuteAction(ownerWithScopedArray, mod, act, 'prop-99'), true);
  }
});

test('membresía inactiva no puede acceder ni operar (CA-004)', () => {
  assert.equal(canAccessModule(inactiveMembership, 'dashboard'), false);
  const check = validateTenantMutation({
    membership: inactiveMembership,
    targetTenantId: 'tenant-a',
    moduleId: 'collections',
    action: 'create',
  });
  assert.equal(check.allowed, false);
  if (!check.allowed) {
    assert.equal(check.code, 'UNAUTHENTICATED');
  }
});

test('aislamiento multi-tenant bloquea operaciones sobre otro tenant_id (CA-003)', () => {
  const check = validateTenantMutation({
    membership: tenantAMembershipOwner,
    targetTenantId: 'tenant-b',
    moduleId: 'properties',
    action: 'manage',
  });
  assert.equal(check.allowed, false);
  if (!check.allowed) {
    assert.equal(check.code, 'TENANT_MISMATCH');
  }
});

test('cobrador respeta permisos por módulo y alcance opcional por casa (DEC-13)', () => {
  assert.equal(canExecuteAction(tenantAMembershipCollector, 'collections', 'create', 'prop-1'), true);
  assert.equal(canExecuteAction(tenantAMembershipCollector, 'collections', 'create', 'prop-2'), false);
  assert.equal(canExecuteAction(tenantAMembershipCollector, 'users_permissions', 'manage'), false);
});

test('reglas personalizadas por tenant sobrescriben permisos por defecto del rol', () => {
  const customRules: RolePermissionRule[] = [
    {
      id: 'r-1',
      tenantId: 'tenant-a',
      role: 'collector',
      moduleId: 'reports',
      actionId: 'view',
      allowed: true,
    },
  ];
  assert.equal(canAccessModule(tenantAMembershipCollector, 'reports', customRules), true);
  assert.equal(canAccessModule(tenantAMembershipCollector, 'reports', []), false);
});

test('formato explícito y separado para BOB y USD', () => {
  assert.match(formatCurrencyAmount(1500, 'BOB'), /^Bs /);
  assert.match(formatCurrencyAmount(450, 'USD'), /^\$us /);
});
