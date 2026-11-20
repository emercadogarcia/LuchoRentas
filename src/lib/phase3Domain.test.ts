/**
 * Archivo: src/lib/phase3Domain.test.ts
 * Responsabilidad: Pruebas unitarias deterministas para el motor de Fase 3
 *   (aniversario contractual, regla DEC-18 para días 29/30/31, prorrateo real DEC-05,
 *   versionado de tarifas, anti doble ocupación RF-014, morosidad informativa y monedas separadas).
 * Cumplimiento LuchoRentas.md: §4.4, §4.5, DEC-01, DEC-03, DEC-04, DEC-05, DEC-06 y DEC-18.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeContractPeriod,
  deriveReceivableState,
  findPeriodIndexCoveringDate,
  previewContractSchedule,
  summarizeReceivablesByCurrency,
  validateContractOccupancy,
} from './phase3Domain';
import type { Property, PropertyUnit, ReceivableCharge, RentalContract, RentalContractVersion } from '../types/domain';

test('aniversario contractual estándar (ejemplo literal PRD: inicio 15/01 -> 15/01-14/02 y 15/02-14/03)', () => {
  const schedule = previewContractSchedule({
    firstPeriodStartDate: '2026-01-15',
    endDate: null,
    monthlyAmount: 1500,
    currency: 'BOB',
    maxPeriods: 3,
  });

  assert.equal(schedule[0].nominalStart, '2026-01-15');
  assert.equal(schedule[0].nominalEnd, '2026-02-14');
  assert.equal(schedule[0].calendarDaysDivisor, 31);
  assert.equal(schedule[0].calculatedAmount, 1500);

  assert.equal(schedule[1].nominalStart, '2026-02-15');
  assert.equal(schedule[1].nominalEnd, '2026-03-14');
  assert.equal(schedule[1].calendarDaysDivisor, 28);
  assert.equal(schedule[1].calculatedAmount, 1500);
});

test('DEC-18 confirmada: inicio día 31 usa último día en febrero y recupera día ancla 31 en marzo', () => {
  const scheduleNonLeap = previewContractSchedule({
    firstPeriodStartDate: '2026-01-31',
    endDate: null,
    monthlyAmount: 3100,
    currency: 'BOB',
    maxPeriods: 4,
  });

  // Enero -> 27/02 (28 días), Feb 28 -> 30/03 (31 días), Mar 31 -> 29/04 (30 días), Abr 30 -> 30/05 (31 días)
  assert.equal(scheduleNonLeap[0].nominalStart, '2026-01-31');
  assert.equal(scheduleNonLeap[0].nominalEnd, '2026-02-27');
  assert.equal(scheduleNonLeap[1].nominalStart, '2026-02-28');
  assert.equal(scheduleNonLeap[1].nominalEnd, '2026-03-30');
  assert.equal(scheduleNonLeap[2].nominalStart, '2026-03-31');
  assert.equal(scheduleNonLeap[2].nominalEnd, '2026-04-29');
  assert.equal(scheduleNonLeap[3].nominalStart, '2026-04-30');
  assert.equal(scheduleNonLeap[3].nominalEnd, '2026-05-30');

  // Año bisiesto (2028) usa 29/02 y recupera 31/03
  const scheduleLeap = previewContractSchedule({
    firstPeriodStartDate: '2028-01-31',
    endDate: null,
    monthlyAmount: 2000,
    currency: 'BOB',
    maxPeriods: 3,
  });
  assert.equal(scheduleLeap[0].nominalEnd, '2028-02-28');
  assert.equal(scheduleLeap[1].nominalStart, '2028-02-29');
  assert.equal(scheduleLeap[2].nominalStart, '2028-03-31');
});

test('DEC-05 prorrateo por días reales al finalizar contrato antes del fin del período', () => {
  // Período 15/01/2026 al 14/02/2026 tiene 31 días calendario; finaliza el 24/01/2026 (10 días cubiertos)
  const period = computeContractPeriod({
    firstPeriodStartDate: '2026-01-15',
    anchorDay: 15,
    periodIndex: 0,
    contractEndDate: '2026-01-24',
    monthlyAmount: 3100,
    currency: 'BOB',
  });

  assert.ok(period);
  assert.equal(period.calendarDaysDivisor, 31);
  assert.equal(period.coveredDays, 10);
  assert.equal(period.isProrated, true);
  assert.equal(period.calculatedAmount, 1000);
});

test('RF-024 versionado de tarifa aplica solo a períodos desde su fecha efectiva sin alterar anteriores', () => {
  const versions: RentalContractVersion[] = [
    {
      id: 'v1',
      tenantId: 't1',
      contractId: 'c1',
      versionNumber: 1,
      effectiveFrom: '2026-01-10',
      monthlyAmount: 1200,
      currency: 'BOB',
      notes: 'Inicial',
      createdAt: '2026-01-10T10:00:00-04:00',
    },
    {
      id: 'v2',
      tenantId: 't1',
      contractId: 'c1',
      versionNumber: 2,
      effectiveFrom: '2026-03-01',
      monthlyAmount: 1450,
      currency: 'BOB',
      notes: 'Ajuste anual',
      createdAt: '2026-02-15T10:00:00-04:00',
    },
  ];

  const schedule = previewContractSchedule({
    firstPeriodStartDate: '2026-01-10',
    endDate: null,
    monthlyAmount: 1200,
    currency: 'BOB',
    versions,
    contractId: 'c1',
    maxPeriods: 3,
  });

  assert.equal(schedule[0].calculatedAmount, 1200);
  assert.equal(schedule[1].calculatedAmount, 1200);
  assert.equal(schedule[2].nominalStart, '2026-03-10');
  assert.equal(schedule[2].calculatedAmount, 1450);
});

test('RF-014 bloquea doble ocupación en la misma unidad y permite otros cuartos disponibles', () => {
  const prop: Property = {
    id: 'prop-1',
    tenantId: 't1',
    name: 'Casa Norte',
    address: 'Calle 1',
    description: '',
    rentalMode: 'by_rooms',
    isActive: true,
    createdAt: '',
    updatedAt: '',
  };
  const unit101: PropertyUnit = {
    id: 'u-101',
    tenantId: 't1',
    propertyId: 'prop-1',
    code: 'C-101',
    name: 'Cuarto 101',
    isDefaultHouseUnit: false,
    status: 'occupied',
    referenceRent: 1000,
    currency: 'BOB',
    notes: '',
    isActive: true,
    createdAt: '',
    updatedAt: '',
  };
  const unit102: PropertyUnit = { ...unit101, id: 'u-102', code: 'C-102', status: 'available' };
  const activeContract: RentalContract = {
    id: 'c-active',
    tenantId: 't1',
    contractCode: 'CTR-001',
    propertyId: 'prop-1',
    unitId: 'u-101',
    tenantPersonId: 'per-1',
    status: 'active',
    billingFrequency: 'monthly',
    startDate: '2026-01-01',
    firstPeriodStartDate: '2026-01-01',
    endDate: null,
    anchorDay: 1,
    monthlyAmount: 1000,
    currency: 'BOB',
    notes: '',
    finalizationReason: '',
    activatedAt: '2026-01-01',
    finalizedAt: null,
    createdAt: '',
    updatedAt: '',
  };

  const blocked = validateContractOccupancy({
    candidate: {
      tenantId: 't1',
      propertyId: 'prop-1',
      unitId: 'u-101',
      startDate: '2026-05-01',
      endDate: null,
    },
    property: prop,
    unit: unit101,
    existingContracts: [activeContract],
  });
  assert.equal(blocked.valid, false);

  const allowedOtherRoom = validateContractOccupancy({
    candidate: {
      tenantId: 't1',
      propertyId: 'prop-1',
      unitId: 'u-102',
      startDate: '2026-05-01',
      endDate: null,
    },
    property: prop,
    unit: unit102,
    existingContracts: [activeContract],
  });
  assert.equal(allowedOtherRoom.valid, true);
});

test('DEC-04 y DEC-01: mora informativa desde el día siguiente y totales separados BOB vs USD', () => {
  const charges: ReceivableCharge[] = [
    {
      id: 'r1',
      tenantId: 't1',
      contractId: 'c1',
      contractVersionId: null,
      propertyId: 'p1',
      unitId: 'u1',
      tenantPersonId: 'inq-1',
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
      baseMonthlyAmount: 1200,
      amount: 1200,
      paidAmount: 0,
      adjustedAmount: 0,
      currency: 'BOB',
      status: 'pending',
      generationMode: 'automatic_daily',
      voidReason: '',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'r2',
      tenantId: 't1',
      contractId: 'c2',
      contractVersionId: null,
      propertyId: 'p1',
      unitId: 'u2',
      tenantPersonId: 'inq-1',
      periodIndex: 0,
      nominalPeriodStart: '2026-11-20',
      nominalPeriodEnd: '2026-12-19',
      periodStart: '2026-11-20',
      periodEnd: '2026-12-19',
      issueDate: '2026-11-20',
      dueDate: '2026-11-20',
      calendarDaysDivisor: 30,
      coveredDays: 30,
      isProrated: false,
      baseMonthlyAmount: 250,
      amount: 250,
      paidAmount: 0,
      adjustedAmount: 0,
      currency: 'USD',
      status: 'pending',
      generationMode: 'manual_period',
      voidReason: '',
      notes: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  // El día del vencimiento (2026-11-20): r1 lleva 19 días vencida, r2 sigue pendiente (vence hoy)
  const d1 = deriveReceivableState(charges[0], '2026-11-20');
  const d2 = deriveReceivableState(charges[1], '2026-11-20');
  assert.equal(d1.effectiveStatus, 'overdue');
  assert.equal(d1.daysOverdue, 19);
  assert.equal(d2.effectiveStatus, 'pending');
  assert.equal(d2.daysOverdue, 0);

  const summary = summarizeReceivablesByCurrency(charges, '2026-11-20');
  assert.equal(summary.BOB.overdueBalance, 1200);
  assert.equal(summary.USD.pendingNotOverdue, 250);
  assert.equal(summary.uniqueDelinquentTenantsCount, 1);

  // Corte automático solo identifica período que cubre hoy
  assert.equal(findPeriodIndexCoveringDate('2026-10-15', 15, '2026-11-20', null), 1);
  assert.equal(findPeriodIndexCoveringDate('2026-12-01', 1, '2026-11-20', null), null);
});
