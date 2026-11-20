/**
 * Archivo: src/lib/phase6Domain.test.ts
 * Responsabilidad: Pruebas unitarias deterministas de Fase 6 (Dashboard Ejecutivo
 *   Modelo A, exclusión de unidades fuera de servicio, conteo único de morosos,
 *   separación BOB/USD, reportes por casa y propietario informativo sin comisiones).
 * Cumplimiento LuchoRentas.md: CA-050 a CA-058, DEC-01, DEC-09, DEC-10 y DEC-11.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportCsv,
  computeExecutiveDashboard,
  computeFinancialReports,
} from './phase6Domain';
import type {
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
} from '../types/domain';

const PROPERTIES: Property[] = [
  {
    id: 'prop-1',
    tenantId: 'ten-1',
    name: 'Casa Equipetrol',
    address: 'Calle 5',
    description: '',
    rentalMode: 'by_rooms',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'prop-2',
    tenantId: 'ten-1',
    name: 'Casa Sin Propietario',
    address: 'Av. Banzer',
    description: '',
    rentalMode: 'full_house',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
];

const UNITS: PropertyUnit[] = [
  {
    id: 'unit-1a',
    tenantId: 'ten-1',
    propertyId: 'prop-1',
    code: 'C-1',
    name: 'Cuarto 1',
    isDefaultHouseUnit: false,
    status: 'occupied',
    referenceRent: 1500,
    currency: 'BOB',
    notes: '',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'unit-1b',
    tenantId: 'ten-1',
    propertyId: 'prop-1',
    code: 'C-2',
    name: 'Cuarto 2',
    isDefaultHouseUnit: false,
    status: 'available',
    referenceRent: 1400,
    currency: 'BOB',
    notes: '',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'unit-1c',
    tenantId: 'ten-1',
    propertyId: 'prop-1',
    code: 'C-3',
    name: 'Cuarto en refacción',
    isDefaultHouseUnit: false,
    status: 'out_of_service',
    referenceRent: 1200,
    currency: 'BOB',
    notes: '',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'unit-2a',
    tenantId: 'ten-1',
    propertyId: 'prop-2',
    code: 'CASA-2',
    name: 'Casa completa',
    isDefaultHouseUnit: true,
    status: 'occupied',
    referenceRent: 600,
    currency: 'USD',
    notes: '',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
];

const PEOPLE: Person[] = [
  {
    id: 'per-inq-1',
    tenantId: 'ten-1',
    fullName: 'Carlos Moroso',
    personType: 'individual',
    documentId: '111',
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    notes: '',
    roles: ['tenant_renter'],
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'per-owner-1',
    tenantId: 'ten-1',
    fullName: 'Lucía Copropietaria',
    personType: 'individual',
    documentId: '222',
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    notes: '',
    roles: ['property_owner'],
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
];

const CONTRACTS: RentalContract[] = [
  {
    id: 'ctr-1',
    tenantId: 'ten-1',
    contractCode: 'CTR-001',
    propertyId: 'prop-1',
    unitId: 'unit-1a',
    tenantPersonId: 'per-inq-1',
    status: 'active',
    billingFrequency: 'monthly',
    startDate: '2026-11-01',
    firstPeriodStartDate: '2026-11-01',
    endDate: null,
    anchorDay: 1,
    monthlyAmount: 1500,
    currency: 'BOB',
    notes: '',
    finalizationReason: '',
    activatedAt: '2026-11-01T12:00:00Z',
    finalizedAt: null,
    createdAt: '2026-11-01T12:00:00Z',
    updatedAt: '2026-11-01T12:00:00Z',
  },
  {
    id: 'ctr-2',
    tenantId: 'ten-1',
    contractCode: 'CTR-002',
    propertyId: 'prop-2',
    unitId: 'unit-2a',
    tenantPersonId: 'per-inq-1',
    status: 'active',
    billingFrequency: 'monthly',
    startDate: '2026-11-01',
    firstPeriodStartDate: '2026-11-01',
    endDate: null,
    anchorDay: 1,
    monthlyAmount: 600,
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
    id: 'cxc-1',
    tenantId: 'ten-1',
    contractId: 'ctr-1',
    contractVersionId: null,
    propertyId: 'prop-1',
    unitId: 'unit-1a',
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
    baseMonthlyAmount: 1500,
    amount: 1500,
    paidAmount: 500,
    adjustedAmount: 0,
    currency: 'BOB',
    status: 'partially_paid',
    generationMode: 'manual_period',
    voidReason: '',
    notes: '',
    createdAt: '2026-11-01T12:00:00Z',
    updatedAt: '2026-11-05T12:00:00Z',
  },
  {
    id: 'cxc-2',
    tenantId: 'ten-1',
    contractId: 'ctr-2',
    contractVersionId: null,
    propertyId: 'prop-2',
    unitId: 'unit-2a',
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
    baseMonthlyAmount: 600,
    amount: 600,
    paidAmount: 0,
    adjustedAmount: 0,
    currency: 'USD',
    status: 'pending',
    generationMode: 'manual_period',
    voidReason: '',
    notes: '',
    createdAt: '2026-11-01T12:00:00Z',
    updatedAt: '2026-11-01T12:00:00Z',
  },
];

const PAYMENTS: RentPayment[] = [
  {
    id: 'pay-1',
    tenantId: 'ten-1',
    propertyId: 'prop-1',
    unitId: 'unit-1a',
    tenantPersonId: 'per-inq-1',
    entryKind: 'collection',
    status: 'confirmed',
    effectiveAt: '2026-11-05T14:00:00Z',
    receivedAmount: 500,
    appliedAmount: 500,
    creditAmount: 0,
    currency: 'BOB',
    paymentMethod: 'cash',
    referenceCode: '',
    notes: '',
    collectedByUserId: 'usr-1',
    collectedByName: 'Cajero',
    reversedPaymentId: null,
    reversalReason: '',
    createdAt: '2026-11-05T14:00:00Z',
  },
];

const ALLOCATIONS: PaymentAllocation[] = [
  {
    id: 'alloc-1',
    tenantId: 'ten-1',
    paymentId: 'pay-1',
    receivableChargeId: 'cxc-1',
    allocationKind: 'payment',
    allocatedAmount: 500,
    notes: '',
    createdAt: '2026-11-05T14:00:00Z',
  },
];

const CATEGORIES: ExpenseCategory[] = [
  {
    id: 'cat-1',
    tenantId: 'ten-1',
    name: 'Energía eléctrica',
    isSystemDefault: true,
    isActive: true,
  },
];

const EXPENSES: ExpenseItem[] = [
  {
    id: 'exp-1',
    tenantId: 'ten-1',
    expenseCode: 'GST-001',
    scope: 'property',
    propertyId: 'prop-1',
    unitId: null,
    categoryId: 'cat-1',
    supplierPersonId: null,
    concept: 'CRE Noviembre',
    expenseDate: '2026-11-10',
    dueDate: '2026-11-15',
    amount: 300,
    paidAmount: 100,
    currency: 'BOB',
    status: 'partially_paid',
    notes: '',
    evidenceName: '',
    evidencePath: '',
    approvedBy: 'usr-1',
    approvedAt: '2026-11-10T12:00:00Z',
    voidReason: '',
    createdAt: '2026-11-10T12:00:00Z',
    updatedAt: '2026-11-12T12:00:00Z',
  },
  {
    id: 'exp-2-unpaid',
    tenantId: 'ten-1',
    expenseCode: 'GST-002',
    scope: 'property',
    propertyId: 'prop-1',
    unitId: null,
    categoryId: 'cat-1',
    supplierPersonId: null,
    concept: 'Mantenimiento pendiente de pago',
    expenseDate: '2026-11-18',
    dueDate: '2026-11-25',
    amount: 200,
    paidAmount: 0,
    currency: 'BOB',
    status: 'approved',
    notes: '',
    evidenceName: '',
    evidencePath: '',
    approvedBy: 'usr-1',
    approvedAt: '2026-11-18T12:00:00Z',
    voidReason: '',
    createdAt: '2026-11-18T12:00:00Z',
    updatedAt: '2026-11-18T12:00:00Z',
  },
];

const EXPENSE_PAYMENTS: ExpensePayment[] = [
  {
    id: 'ep-1',
    tenantId: 'ten-1',
    expenseId: 'exp-1',
    cashSessionId: 'cs-1',
    effectiveAt: '2026-11-12T15:00:00Z',
    amount: 100,
    currency: 'BOB',
    paymentMethod: 'cash',
    referenceCode: '',
    notes: '',
    paidByUserId: 'usr-1',
    paidByName: 'Cajero',
    createdAt: '2026-11-12T15:00:00Z',
  },
];

const OWNERS: PropertyOwnerLink[] = [
  {
    id: 'po-1',
    tenantId: 'ten-1',
    propertyId: 'prop-1',
    personId: 'per-owner-1',
    ownershipPercent: 60,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes: '',
  },
];

test('CA-050 a CA-053: dashboard excluye fuera de servicio, cuenta morosos únicos una vez y separa BOB/USD', () => {
  const dash = computeExecutiveDashboard({
    month: 11,
    year: 2026,
    todayLaPaz: '2026-11-20',
    properties: PROPERTIES,
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

  // 3 unidades habilitadas (unit-1c está out_of_service), 2 ocupadas, 1 libre -> 66.7%
  assert.equal(dash.totalEnabledUnits, 3);
  assert.equal(dash.occupiedUnitsCount, 2);
  assert.equal(dash.availableUnitsCount, 1);
  assert.equal(dash.excludedOutOfServiceCount, 1);
  assert.equal(dash.occupancyPercent, 66.7);

  // Carlos Moroso tiene 2 obligaciones vencidas (BOB y USD), se cuenta una sola vez
  assert.equal(dash.delinquentTenantsCount, 1);

  // Cobros y saldos estrictamente separados por moneda
  assert.equal(dash.collectionsByCurrency.BOB, 500);
  assert.equal(dash.collectionsByCurrency.USD, 0);
  assert.equal(dash.receivablesByCurrency.BOB.overdue, 1000);
  assert.equal(dash.receivablesByCurrency.USD.overdue, 600);

  // CxP: exp-1 (300 - 100 = 200 vencido al 20/11) + exp-2 (200 no vencido) = 400 total
  assert.equal(dash.payablesByCurrency.BOB.total, 400);
  assert.equal(dash.payablesByCurrency.BOB.overdue, 200);
});

test('CA-056, CA-057 y DEC-09: reportes calculan resultado con egresos pagados y atribuyen solo casas con propiedad definida', () => {
  const report = computeFinancialReports({
    month: 11,
    year: 2026,
    properties: PROPERTIES,
    units: UNITS,
    people: PEOPLE,
    propertyOwners: OWNERS,
    contracts: CONTRACTS,
    receivables: RECEIVABLES,
    payments: PAYMENTS,
    allocations: ALLOCATIONS,
    categories: CATEGORIES,
    expenses: EXPENSES,
    expensePayments: EXPENSE_PAYMENTS,
  });

  // Solo los 100 BOB pagados cuentan como egreso (no los 200 aprobados sin pagar)
  assert.equal(report.collectedTotals.BOB, 500);
  assert.equal(report.paidExpensesTotals.BOB, 100);
  assert.equal(report.operatingResultTotals.BOB, 400);

  // Casa 1: cobrado 500 - pagado 100 = 400 BOB
  const prop1 = report.byProperty.find((p) => p.propertyId === 'prop-1');
  assert.ok(prop1);
  assert.equal(prop1.operatingResult.BOB, 400);

  // Lucía tiene 60% de Casa 1 (prop-2 no tiene propietario -> no se le atribuye nada CA-057)
  assert.equal(report.byOwner.length, 1);
  assert.equal(report.byOwner[0].properties.length, 1);
  assert.equal(report.byOwner[0].attributableCollected.BOB, 300);
  assert.equal(report.byOwner[0].attributablePaidExpenses.BOB, 60);
  assert.equal(report.byOwner[0].attributableOperatingResult.BOB, 240);

  const csv = buildReportCsv(report, 'by_owner', 'Mi Espacio');
  assert.match(csv, /Lucía Copropietaria/);
  assert.match(csv, /240\.00/);
});
