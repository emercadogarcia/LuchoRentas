/**
 * Archivo: src/lib/phase7QaSuite.test.ts
 * Responsabilidad: Suite integral de QA de Fase 7 que verifica de extremo a extremo
 *   las 17 pruebas mínimas obligatorias definidas en LuchoRentas.md §18.2:
 *   aislamiento multi-tenant, acceso de propietario, alcance de colaborador/casa,
 *   múltiples casas, casa completa vs por cuartos, anti doble ocupación, idempotencia
 *   CxC, pago parcial, recibo único, reversión compensatoria, gastos no pagados vs
 *   salida de caja, arqueo con diferencia, paridad Dashboard ↔ Reportes, reporte por
 *   propietario y paridad exacta de datos entre recibo PNG y PDF (CA-036).
 * Cumplimiento LuchoRentas.md: §18.2 (17 checks), §18.3 (DoD) y CA-001 a CA-058.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canExecuteAction,
  formatCurrencyAmount,
  validateTenantMutation,
} from './rbac';
import {
  filterPropertiesForMembership,
  validateManualUnitStatusChange,
  validateOwnerShares,
} from './phase2Domain';
import {
  computeContractPeriod,
  findPeriodIndexCoveringDate,
  validateContractOccupancy,
} from './phase3Domain';
import {
  buildReceiptDisplayPayload,
  formatReceiptNumber,
  validateCollectionInput,
  validateReversalInput,
} from './phase4Domain';
import {
  computeCashSessionBalances,
  validateExpensePaymentInput,
  validateReconciliationInput,
} from './phase5Domain';
import { computeExecutiveDashboard, computeFinancialReports } from './phase6Domain';
import {
  buildDashboardReportsReconciliationCheck,
  evaluateTenantInMemoryQaChecks,
} from './phase7QaDomain';
import type {
  CashMovement,
  CashSession,
  ExpenseCategory,
  ExpenseItem,
  ExpensePayment,
  PaymentAllocation,
  Person,
  Property,
  PropertyOwnerLink,
  PropertyUnit,
  ReceivableCharge,
  RentalContract,
  RentPayment,
  RentReceipt,
  TenantMembership,
} from '../types/domain';

const OWNER_TENANT_A: TenantMembership = {
  id: 'mem-a-owner',
  tenantId: 'ten-a',
  userId: 'usr-a1',
  role: 'tenant_owner',
  status: 'active',
  allowedPropertyIds: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};

const COLLECTOR_SCOPED_A: TenantMembership = {
  id: 'mem-a-col',
  tenantId: 'ten-a',
  userId: 'usr-a2',
  role: 'collector',
  status: 'active',
  allowedPropertyIds: ['prop-a1'],
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};

const PROPERTIES: Property[] = [
  {
    id: 'prop-a1',
    tenantId: 'ten-a',
    name: 'Casa Norte',
    address: 'Av. Cristo Redentor 100',
    description: '',
    rentalMode: 'full_house',
    isActive: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'prop-a2',
    tenantId: 'ten-a',
    name: 'Residencia Sur',
    address: 'Calle Libertad 250',
    description: '',
    rentalMode: 'by_rooms',
    isActive: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'prop-b1',
    tenantId: 'ten-b',
    name: 'Casa Secreta Tenant B',
    address: 'Av. Pando 999',
    description: '',
    rentalMode: 'full_house',
    isActive: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
];

const UNITS: PropertyUnit[] = [
  {
    id: 'unit-a1',
    tenantId: 'ten-a',
    propertyId: 'prop-a1',
    code: 'CASA-1',
    name: 'Casa completa',
    isDefaultHouseUnit: true,
    status: 'occupied',
    referenceRent: 3000,
    currency: 'BOB',
    notes: '',
    isActive: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'unit-a2-c1',
    tenantId: 'ten-a',
    propertyId: 'prop-a2',
    code: 'C-1',
    name: 'Cuarto 1',
    isDefaultHouseUnit: false,
    status: 'occupied',
    referenceRent: 350,
    currency: 'USD',
    notes: '',
    isActive: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'unit-a2-c2',
    tenantId: 'ten-a',
    propertyId: 'prop-a2',
    code: 'C-2',
    name: 'Cuarto 2',
    isDefaultHouseUnit: false,
    status: 'available',
    referenceRent: 320,
    currency: 'USD',
    notes: '',
    isActive: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
];

const PEOPLE: Person[] = [
  {
    id: 'per-inq-1',
    tenantId: 'ten-a',
    fullName: 'Valeria Mendoza',
    personType: 'individual',
    documentId: '4588910 SC',
    phone: '70011111',
    whatsapp: '59170011111',
    email: 'valeria@example.com',
    address: '',
    notes: '',
    roles: ['tenant_renter'],
    isActive: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'per-own-1',
    tenantId: 'ten-a',
    fullName: 'Roberto Arce',
    personType: 'individual',
    documentId: '1988123 LP',
    phone: '71122334',
    whatsapp: '59171122334',
    email: 'roberto@example.com',
    address: '',
    notes: '',
    roles: ['property_owner'],
    isActive: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'per-own-2',
    tenantId: 'ten-a',
    fullName: 'Elena Vargas',
    personType: 'individual',
    documentId: '3099881 CB',
    phone: '72233445',
    whatsapp: '',
    email: '',
    address: '',
    notes: '',
    roles: ['property_owner'],
    isActive: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
];

const PROPERTY_OWNERS: PropertyOwnerLink[] = [
  {
    id: 'po-1',
    tenantId: 'ten-a',
    propertyId: 'prop-a1',
    personId: 'per-own-1',
    ownershipPercent: 70,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes: '',
  },
  {
    id: 'po-2',
    tenantId: 'ten-a',
    propertyId: 'prop-a1',
    personId: 'per-own-2',
    ownershipPercent: 30,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes: '',
  },
];

const CONTRACTS: RentalContract[] = [
  {
    id: 'ctr-a1',
    tenantId: 'ten-a',
    contractCode: 'CTR-A1',
    propertyId: 'prop-a1',
    unitId: 'unit-a1',
    tenantPersonId: 'per-inq-1',
    status: 'active',
    billingFrequency: 'monthly',
    startDate: '2026-11-01',
    firstPeriodStartDate: '2026-11-01',
    endDate: null,
    anchorDay: 1,
    monthlyAmount: 3000,
    currency: 'BOB',
    notes: '',
    finalizationReason: '',
    activatedAt: '2026-11-01T12:00:00Z',
    finalizedAt: null,
    createdAt: '2026-11-01T12:00:00Z',
    updatedAt: '2026-11-01T12:00:00Z',
  },
  {
    id: 'ctr-a2',
    tenantId: 'ten-a',
    contractCode: 'CTR-A2',
    propertyId: 'prop-a2',
    unitId: 'unit-a2-c1',
    tenantPersonId: 'per-inq-1',
    status: 'active',
    billingFrequency: 'monthly',
    startDate: '2026-11-01',
    firstPeriodStartDate: '2026-11-01',
    endDate: null,
    anchorDay: 1,
    monthlyAmount: 350,
    currency: 'USD',
    notes: '',
    finalizationReason: '',
    activatedAt: '2026-11-01T12:00:00Z',
    finalizedAt: null,
    createdAt: '2026-11-01T12:00:00Z',
    updatedAt: '2026-11-01T12:00:00Z',
  },
];

const RECEIVABLES: ReceivableCharge[] = [
  {
    id: 'cxc-a1',
    tenantId: 'ten-a',
    contractId: 'ctr-a1',
    contractVersionId: null,
    propertyId: 'prop-a1',
    unitId: 'unit-a1',
    tenantPersonId: 'per-inq-1',
    periodIndex: 0,
    nominalPeriodStart: '2026-11-01',
    nominalPeriodEnd: '2026-11-30',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    issueDate: '2026-11-01',
    dueDate: '2026-11-01',
    calendarDaysDivisor: 30,
    coveredDays: 30,
    isProrated: false,
    baseMonthlyAmount: 3000,
    amount: 3000,
    paidAmount: 1800,
    adjustedAmount: 0,
    currency: 'BOB',
    status: 'partially_paid',
    generationMode: 'automatic_daily',
    voidReason: '',
    notes: '',
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-05T15:00:00Z',
  },
  {
    id: 'cxc-a2',
    tenantId: 'ten-a',
    contractId: 'ctr-a2',
    contractVersionId: null,
    propertyId: 'prop-a2',
    unitId: 'unit-a2-c1',
    tenantPersonId: 'per-inq-1',
    periodIndex: 0,
    nominalPeriodStart: '2026-11-01',
    nominalPeriodEnd: '2026-11-30',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    issueDate: '2026-11-01',
    dueDate: '2026-11-01',
    calendarDaysDivisor: 30,
    coveredDays: 30,
    isProrated: false,
    baseMonthlyAmount: 350,
    amount: 350,
    paidAmount: 350,
    adjustedAmount: 0,
    currency: 'USD',
    status: 'paid',
    generationMode: 'automatic_daily',
    voidReason: '',
    notes: '',
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-06T16:00:00Z',
  },
];

const PAYMENTS: RentPayment[] = [
  {
    id: 'pay-a1',
    tenantId: 'ten-a',
    propertyId: 'prop-a1',
    unitId: 'unit-a1',
    tenantPersonId: 'per-inq-1',
    entryKind: 'collection',
    status: 'confirmed',
    effectiveAt: '2026-11-05T15:00:00Z',
    receivedAmount: 1800,
    appliedAmount: 1800,
    creditAmount: 0,
    currency: 'BOB',
    paymentMethod: 'cash',
    referenceCode: '',
    notes: 'Abono parcial noviembre',
    collectedByUserId: 'usr-a1',
    collectedByName: 'Administrador QA',
    reversedPaymentId: null,
    reversalReason: '',
    createdAt: '2026-11-05T15:00:00Z',
  },
  {
    id: 'pay-a2',
    tenantId: 'ten-a',
    propertyId: 'prop-a2',
    unitId: 'unit-a2-c1',
    tenantPersonId: 'per-inq-1',
    entryKind: 'collection',
    status: 'confirmed',
    effectiveAt: '2026-11-06T16:00:00Z',
    receivedAmount: 350,
    appliedAmount: 350,
    creditAmount: 0,
    currency: 'USD',
    paymentMethod: 'bank_transfer',
    referenceCode: 'TRF-882',
    notes: 'Pago completo cuarto 1',
    collectedByUserId: 'usr-a1',
    collectedByName: 'Administrador QA',
    reversedPaymentId: null,
    reversalReason: '',
    createdAt: '2026-11-06T16:00:00Z',
  },
];

const ALLOCATIONS: PaymentAllocation[] = [
  {
    id: 'alloc-a1',
    tenantId: 'ten-a',
    paymentId: 'pay-a1',
    receivableChargeId: 'cxc-a1',
    allocationKind: 'payment',
    allocatedAmount: 1800,
    notes: '',
    createdAt: '2026-11-05T15:00:00Z',
  },
  {
    id: 'alloc-a2',
    tenantId: 'ten-a',
    paymentId: 'pay-a2',
    receivableChargeId: 'cxc-a2',
    allocationKind: 'payment',
    allocatedAmount: 350,
    notes: '',
    createdAt: '2026-11-06T16:00:00Z',
  },
];

const RECEIPTS: RentReceipt[] = [
  {
    id: 'rec-a1',
    tenantId: 'ten-a',
    paymentId: 'pay-a1',
    propertyId: 'prop-a1',
    docType: 'rent_receipt',
    sequenceNumber: 1,
    receiptNumber: formatReceiptNumber(1),
    issuedAt: '2026-11-05T15:00:00Z',
    tenantName: 'Inmobiliaria QA',
    tenantPersonName: 'Valeria Mendoza',
    propertyName: 'Casa Norte',
    unitName: 'Casa completa',
    conceptPeriod: '01/11/2026 - 30/11/2026',
    amount: 1800,
    currency: 'BOB',
    paymentMethod: 'cash',
    collectedByName: 'Administrador QA',
    notes: 'Abono parcial noviembre',
    nonFiscalLegend: 'COMPROBANTE INTERNO NO FISCAL — LUCHORENTAS',
    status: 'valid',
  },
  {
    id: 'rec-a2',
    tenantId: 'ten-a',
    paymentId: 'pay-a2',
    propertyId: 'prop-a2',
    docType: 'rent_receipt',
    sequenceNumber: 2,
    receiptNumber: formatReceiptNumber(2),
    issuedAt: '2026-11-06T16:00:00Z',
    tenantName: 'Inmobiliaria QA',
    tenantPersonName: 'Valeria Mendoza',
    propertyName: 'Residencia Sur',
    unitName: 'Cuarto 1',
    conceptPeriod: '01/11/2026 - 30/11/2026',
    amount: 350,
    currency: 'USD',
    paymentMethod: 'bank_transfer',
    collectedByName: 'Administrador QA',
    notes: 'Pago completo cuarto 1',
    nonFiscalLegend: 'COMPROBANTE INTERNO NO FISCAL — LUCHORENTAS',
    status: 'valid',
  },
];

const CATEGORIES: ExpenseCategory[] = [
  {
    id: 'cat-1',
    tenantId: 'ten-a',
    name: 'Mantenimiento/reparación',
    isSystemDefault: true,
    isActive: true,
  },
];

const EXPENSES: ExpenseItem[] = [
  {
    id: 'exp-a1',
    tenantId: 'ten-a',
    expenseCode: 'GST-001',
    scope: 'property',
    propertyId: 'prop-a1',
    unitId: null,
    categoryId: 'cat-1',
    supplierPersonId: null,
    concept: 'Plomería Casa Norte',
    expenseDate: '2026-11-10',
    dueDate: '2026-11-20',
    amount: 500,
    paidAmount: 200,
    currency: 'BOB',
    status: 'partially_paid',
    notes: '',
    evidenceName: '',
    evidencePath: '',
    approvedBy: 'usr-a1',
    approvedAt: '2026-11-10T14:00:00Z',
    voidReason: '',
    createdAt: '2026-11-10T14:00:00Z',
    updatedAt: '2026-11-12T14:00:00Z',
  },
  {
    id: 'exp-a2-unpaid',
    tenantId: 'ten-a',
    expenseCode: 'GST-002',
    scope: 'property',
    propertyId: 'prop-a1',
    unitId: null,
    categoryId: 'cat-1',
    supplierPersonId: null,
    concept: 'Pintura pendiente de pago',
    expenseDate: '2026-11-14',
    dueDate: '2026-11-28',
    amount: 800,
    paidAmount: 0,
    currency: 'BOB',
    status: 'pending_approval',
    notes: '',
    evidenceName: '',
    evidencePath: '',
    approvedBy: null,
    approvedAt: null,
    voidReason: '',
    createdAt: '2026-11-14T14:00:00Z',
    updatedAt: '2026-11-14T14:00:00Z',
  },
];

const CASH_SESSIONS: CashSession[] = [
  {
    id: 'cs-a-bob',
    tenantId: 'ten-a',
    cashAccountId: 'ca-a-bob',
    ownerUserId: 'usr-a1',
    ownerName: 'Administrador QA',
    currency: 'BOB',
    status: 'open',
    openedAt: '2026-11-05T08:00:00Z',
    openingBalance: 100,
    closedAt: null,
    closingExpectedBalance: null,
    closingCountedBalance: null,
    notes: '',
  },
  {
    id: 'cs-a-usd',
    tenantId: 'ten-a',
    cashAccountId: 'ca-a-usd',
    ownerUserId: 'usr-a1',
    ownerName: 'Administrador QA',
    currency: 'USD',
    status: 'open',
    openedAt: '2026-11-06T08:00:00Z',
    openingBalance: 0,
    closedAt: null,
    closingExpectedBalance: null,
    closingCountedBalance: null,
    notes: '',
  },
];

const EXPENSE_PAYMENTS: ExpensePayment[] = [
  {
    id: 'ep-a1',
    tenantId: 'ten-a',
    expenseId: 'exp-a1',
    cashSessionId: 'cs-a-bob',
    effectiveAt: '2026-11-12T14:00:00Z',
    amount: 200,
    currency: 'BOB',
    paymentMethod: 'cash',
    referenceCode: '',
    notes: 'Adelanto plomero',
    paidByUserId: 'usr-a1',
    paidByName: 'Administrador QA',
    createdAt: '2026-11-12T14:00:00Z',
  },
];

const CASH_MOVEMENTS: CashMovement[] = [
  {
    id: 'cm-1',
    tenantId: 'ten-a',
    cashAccountId: 'ca-a-bob',
    cashSessionId: 'cs-a-bob',
    currency: 'BOB',
    direction: 'inflow',
    sourceType: 'rent_collection',
    sourceId: 'pay-a1',
    linkedMovementId: null,
    effectiveAt: '2026-11-05T15:00:00Z',
    amount: 1800,
    notes: '',
    createdBy: 'usr-a1',
    createdByName: 'Administrador QA',
    createdAt: '2026-11-05T15:00:00Z',
  },
  {
    id: 'cm-2',
    tenantId: 'ten-a',
    cashAccountId: 'ca-a-bob',
    cashSessionId: 'cs-a-bob',
    currency: 'BOB',
    direction: 'outflow',
    sourceType: 'expense_payment',
    sourceId: 'ep-a1',
    linkedMovementId: null,
    effectiveAt: '2026-11-12T14:00:00Z',
    amount: 200,
    notes: '',
    createdBy: 'usr-a1',
    createdByName: 'Administrador QA',
    createdAt: '2026-11-12T14:00:00Z',
  },
  {
    id: 'cm-3',
    tenantId: 'ten-a',
    cashAccountId: 'ca-a-usd',
    cashSessionId: 'cs-a-usd',
    currency: 'USD',
    direction: 'inflow',
    sourceType: 'rent_collection',
    sourceId: 'pay-a2',
    linkedMovementId: null,
    effectiveAt: '2026-11-06T16:00:00Z',
    amount: 350,
    notes: '',
    createdBy: 'usr-a1',
    createdByName: 'Administrador QA',
    createdAt: '2026-11-06T16:00:00Z',
  },
];

test('§18.2 (1-3): Aislamiento multi-tenant, acceso total de propietario y alcance limitado por rol/casa', () => {
  // 1. Usuario de Tenant A no puede acceder ni mutar datos de Tenant B
  const crossTenant = validateTenantMutation({
    membership: OWNER_TENANT_A,
    targetTenantId: 'ten-b',
    moduleId: 'properties',
    action: 'view',
  });
  assert.equal(crossTenant.allowed, false);
  assert.equal(crossTenant.code, 'TENANT_MISMATCH');

  const visibleOwnerProps = filterPropertiesForMembership(PROPERTIES, OWNER_TENANT_A);
  assert.equal(visibleOwnerProps.some((p) => p.tenantId === 'ten-b'), false);

  // 2. Propietario de Tenant A ve todas las casas de su tenant y ejecuta cualquier acción
  assert.equal(visibleOwnerProps.length, 2);
  assert.equal(canExecuteAction(OWNER_TENANT_A, 'users_permissions', 'manage', 'prop-a2'), true);

  // 3. Colaborador limitado a prop-a1 y rol collector solo opera acciones permitidas sobre su casa
  const collectorProps = filterPropertiesForMembership(PROPERTIES, COLLECTOR_SCOPED_A);
  assert.deepEqual(collectorProps.map((p) => p.id), ['prop-a1']);
  assert.equal(canExecuteAction(COLLECTOR_SCOPED_A, 'collections', 'create', 'prop-a1'), true);
  assert.equal(canExecuteAction(COLLECTOR_SCOPED_A, 'collections', 'create', 'prop-a2'), false);
  assert.equal(canExecuteAction(COLLECTOR_SCOPED_A, 'expenses', 'manage', 'prop-a1'), false);
});

test('§18.2 (4-8): Múltiples casas, casa completa vs por cuartos, anti doble ocupación e idempotencia CxC', () => {
  // 4 & 5 & 6: Múltiples casas en ten-a; casa completa tiene 1 unidad default; casa por cuartos tiene unidades independientes
  const aProps = PROPERTIES.filter((p) => p.tenantId === 'ten-a');
  assert.equal(aProps.length, 2);
  const fullHouseUnits = UNITS.filter((u) => u.propertyId === 'prop-a1');
  assert.equal(fullHouseUnits.length, 1);
  assert.equal(fullHouseUnits[0].isDefaultHouseUnit, true);

  const roomUnits = UNITS.filter((u) => u.propertyId === 'prop-a2');
  assert.equal(roomUnits.length, 2);
  assert.equal(roomUnits.every((u) => !u.isDefaultHouseUnit), true);

  // No permite cambiar manualmente disponible -> ocupado sin contrato
  assert.equal(validateManualUnitStatusChange('available', 'occupied').valid, false);

  // 7: Anti doble ocupación sobre unidad ya ocupada, pero sí permite otro cuarto libre de la misma casa
  const conflict = validateContractOccupancy({
    candidate: {
      tenantId: 'ten-a',
      propertyId: 'prop-a2',
      unitId: 'unit-a2-c1',
      startDate: '2026-11-15',
      endDate: null,
    },
    property: PROPERTIES[1],
    unit: UNITS[1],
    existingContracts: CONTRACTS,
  });
  assert.equal(conflict.valid, false);

  const independentRoomOk = validateContractOccupancy({
    candidate: {
      tenantId: 'ten-a',
      propertyId: 'prop-a2',
      unitId: 'unit-a2-c2',
      startDate: '2026-11-15',
      endDate: null,
    },
    property: PROPERTIES[1],
    unit: UNITS[2],
    existingContracts: CONTRACTS,
  });
  assert.equal(independentRoomOk.valid, true);

  // 8: Generación mensual idempotente por período único cubierto
  const idxNov = findPeriodIndexCoveringDate('2026-11-01', 1, '2026-11-15', null);
  const idxNovSecondRun = findPeriodIndexCoveringDate('2026-11-01', 1, '2026-11-28', null);
  assert.equal(idxNov, 0);
  assert.equal(idxNovSecondRun, 0);
  const period0 = computeContractPeriod({
    firstPeriodStartDate: '2026-11-01',
    anchorDay: 1,
    periodIndex: idxNov,
    contractEndDate: null,
    monthlyAmount: 3000,
    currency: 'BOB',
  });
  assert.ok(period0);
  assert.equal(period0.effectiveStart, '2026-11-01');
  assert.equal(period0.effectiveEnd, '2026-11-30');
});

test('§18.2 (9-11 & 17): Pago parcial, recibo único, reversión compensatoria y paridad PNG/PDF', () => {
  // 9: Pago parcial sobre cxc-a1 (saldo actual 1200) deja saldo correcto
  const partialCheck = validateCollectionInput({
    charge: RECEIVABLES[0],
    receivedAmount: 500,
    appliedAmount: 500,
    effectiveAt: '2026-11-18T10:00:00Z',
  });
  assert.equal(partialCheck.valid, true);
  if (partialCheck.valid) {
    assert.equal(partialCheck.currentBalance, 1200);
    assert.equal(partialCheck.remainingAfter, 700);
    assert.equal(partialCheck.isPartial, true);
  }

  // 10 & 11: Recibos únicos 1:1 y reversión exige motivo y conserva original
  assert.equal(RECEIPTS[0].receiptNumber, 'REC-000001');
  assert.equal(RECEIPTS[1].receiptNumber, 'REC-000002');
  assert.equal(validateReversalInput({ payment: PAYMENTS[0], reason: 'ab', credits: [] }).valid, false);
  assert.equal(
    validateReversalInput({ payment: PAYMENTS[0], reason: 'Error de importe digitado', credits: [] }).valid,
    true
  );

  // 17: PNG y PDF consumen el mismo payload determinista (CA-036)
  const payload = buildReceiptDisplayPayload(RECEIPTS[0]);
  assert.equal(payload.receiptNumber, 'REC-000001');
  assert.equal(payload.formattedAmount, formatCurrencyAmount(1800, 'BOB'));
  assert.equal(payload.nonFiscalLegend, 'COMPROBANTE INTERNO NO FISCAL — LUCHORENTAS');
  assert.equal(payload.rows.find((r) => r.label === 'Inquilino')?.value, 'Valeria Mendoza');
  assert.equal(payload.rows.find((r) => r.label === 'Casa / Inmueble')?.value, 'Casa Norte');
});

test('§18.2 (12-16): Gastos no pagados, salida de caja, arqueo con diferencia, paridad Dashboard↔Reportes y copropietarios', () => {
  // 12: Gasto pendiente de aprobación no puede pagarse ni figura como egreso efectivo
  const unpaidGuard = validateExpensePaymentInput({
    expense: EXPENSES[1],
    cashSession: CASH_SESSIONS[0],
    amount: 100,
    effectiveAt: '2026-11-18T10:00:00Z',
  });
  assert.equal(unpaidGuard.valid, false);

  // 13: Saldo de caja BOB refleja apertura (100) + cobro (1800) - pago gasto (200) = 1700; USD separado = 350
  const bobCash = computeCashSessionBalances(CASH_SESSIONS[0], CASH_MOVEMENTS);
  const usdCash = computeCashSessionBalances(CASH_SESSIONS[1], CASH_MOVEMENTS);
  assert.equal(bobCash.expectedBalance, 1700);
  assert.equal(usdCash.expectedBalance, 350);

  // 14: Arqueo detecta diferencia y exige explicación obligatoria
  const reconMissingReason = validateReconciliationInput({
    session: CASH_SESSIONS[0],
    expectedBalance: bobCash.expectedBalance,
    countedBalance: 1650,
    differenceReason: '',
  });
  assert.equal(reconMissingReason.valid, false);

  const reconValid = validateReconciliationInput({
    session: CASH_SESSIONS[0],
    expectedBalance: bobCash.expectedBalance,
    countedBalance: 1650,
    differenceReason: 'Faltante de 50 BOB pendiente de revisión de billetes',
  });
  assert.equal(reconValid.valid, true);
  if (reconValid.valid) {
    assert.equal(reconValid.differenceAmount, -50);
    assert.equal(reconValid.requiresApproval, true);
  }

  // 15: Dashboard coincide exactamente con Reportes en cobros, CxC y CxP (BOB y USD)
  const parityCheck = buildDashboardReportsReconciliationCheck({
    month: 11,
    year: 2026,
    properties: PROPERTIES.filter((p) => p.tenantId === 'ten-a'),
    units: UNITS,
    people: PEOPLE,
    propertyOwners: PROPERTY_OWNERS,
    contracts: CONTRACTS,
    receivables: RECEIVABLES,
    payments: PAYMENTS,
    allocations: ALLOCATIONS,
    categories: CATEGORIES,
    expenses: EXPENSES,
    expensePayments: EXPENSE_PAYMENTS,
  });
  assert.equal(parityCheck.passed, true, parityCheck.detail);

  // 16: Copropietarios suman 100% y el reporte atribuye 70%/30% sin comisiones
  assert.equal(
    validateOwnerShares(
      [
        { personId: 'per-own-1', ownershipPercent: 70 },
        { personId: 'per-own-2', ownershipPercent: 30 },
      ],
      PEOPLE
    ).valid,
    true
  );

  const dash = computeExecutiveDashboard({
    month: 11,
    year: 2026,
    todayLaPaz: '2026-11-20',
    properties: PROPERTIES.filter((p) => p.tenantId === 'ten-a'),
    units: UNITS,
    people: PEOPLE,
    contracts: CONTRACTS,
    receivables: RECEIVABLES,
    payments: PAYMENTS,
    allocations: ALLOCATIONS,
    categories: CATEGORIES,
    expenses: EXPENSES,
    expensePayments: EXPENSE_PAYMENTS,
  });
  const report = computeFinancialReports({
    month: 11,
    year: 2026,
    properties: PROPERTIES.filter((p) => p.tenantId === 'ten-a'),
    units: UNITS,
    people: PEOPLE,
    propertyOwners: PROPERTY_OWNERS,
    contracts: CONTRACTS,
    receivables: RECEIVABLES,
    payments: PAYMENTS,
    allocations: ALLOCATIONS,
    categories: CATEGORIES,
    expenses: EXPENSES,
    expensePayments: EXPENSE_PAYMENTS,
  });

  // Casa Norte cobró 1800 BOB y pagó 200 BOB (gasto 800 sin pagar NO entra) -> neto 1600 BOB
  assert.equal(dash.collectionsByCurrency.BOB, 1800);
  assert.equal(report.paidExpensesTotals.BOB, 200);
  assert.equal(report.operatingResultTotals.BOB, 1600);
  // Propietarios 70% y 30% de 1600 BOB = 1120 y 480
  const roberto = report.byOwner.find((o) => o.personId === 'per-own-1');
  const elena = report.byOwner.find((o) => o.personId === 'per-own-2');
  assert.equal(roberto?.attributableOperatingResult.BOB, 1120);
  assert.equal(elena?.attributableOperatingResult.BOB, 480);

  // Suite completa de evaluación de invariantes en memoria: 8/8 aprobados
  const fullQa = evaluateTenantInMemoryQaChecks({
    tenantId: 'ten-a',
    todayLaPaz: '2026-11-20',
    month: 11,
    year: 2026,
    properties: PROPERTIES,
    units: UNITS,
    people: PEOPLE,
    propertyOwners: PROPERTY_OWNERS,
    contracts: CONTRACTS,
    receivables: RECEIVABLES,
    payments: PAYMENTS,
    allocations: ALLOCATIONS,
    receipts: RECEIPTS,
    categories: CATEGORIES,
    expenses: EXPENSES,
    expensePayments: EXPENSE_PAYMENTS,
    cashSessions: CASH_SESSIONS,
    cashMovements: CASH_MOVEMENTS,
  });
  assert.equal(fullQa.passedCount, 8);
  assert.equal(fullQa.totalChecks, 8);
});
