/**
 * Archivo: src/lib/phase4Domain.test.ts
 * Responsabilidad: Pruebas unitarias deterministas para validaciones de cobros,
 *   pagos parciales, excedentes de crédito separado, reversión auditada,
 *   numeración correlativa de recibos y totales separados BOB vs USD.
 * Cumplimiento LuchoRentas.md: §4.6, RF-033 a RF-037, DEC-01 y DEC-12.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReceiptNumber,
  summarizeCollectionsByCurrency,
  validateCollectionInput,
  validateReversalInput,
} from './phase4Domain';
import type { ReceivableCharge, RentPayment, TenantCredit } from '../types/domain';

const sampleCharge: ReceivableCharge = {
  id: 'cxc-1',
  tenantId: 't1',
  contractId: 'ctr-1',
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
  paidAmount: 200,
  adjustedAmount: 0,
  currency: 'BOB',
  status: 'partially_paid',
  generationMode: 'manual_period',
  voidReason: '',
  notes: '',
  createdAt: '',
  updatedAt: '',
};

test('RF-034 permite pago parcial y calcula correctamente saldo restante sin cerrar obligación', () => {
  const res = validateCollectionInput({
    charge: sampleCharge,
    receivedAmount: 400,
    appliedAmount: 400,
    effectiveAt: '2026-11-20T11:15:00-04:00',
  });
  assert.equal(res.valid, true);
  if (res.valid) {
    assert.equal(res.currentBalance, 1000);
    assert.equal(res.remainingAfter, 600);
    assert.equal(res.creditExcess, 0);
    assert.equal(res.isPartial, true);
  }

  const partial350 = validateCollectionInput({
    charge: { ...sampleCharge, paidAmount: 0, status: 'pending' },
    receivedAmount: 350,
    appliedAmount: 350,
    effectiveAt: '2026-11-20T15:00:00-04:00',
  });
  assert.equal(partial350.valid, true);
  if (partial350.valid) {
    assert.equal(partial350.currentBalance, 1200);
    assert.equal(partial350.remainingAfter, 850);
    assert.equal(partial350.creditExcess, 0);
    assert.equal(partial350.isPartial, true);
  }
});

test('§4.6 bloquea aplicación mayor al saldo o mayor al importe recibido y separa excedente como crédito', () => {
  const overBalance = validateCollectionInput({
    charge: sampleCharge,
    receivedAmount: 1200,
    appliedAmount: 1100,
    effectiveAt: '2026-11-20T11:15:00-04:00',
  });
  assert.equal(overBalance.valid, false);

  const overReceived = validateCollectionInput({
    charge: sampleCharge,
    receivedAmount: 500,
    appliedAmount: 600,
    effectiveAt: '2026-11-20T11:15:00-04:00',
  });
  assert.equal(overReceived.valid, false);

  const withExcess = validateCollectionInput({
    charge: sampleCharge,
    receivedAmount: 1200,
    appliedAmount: 1000,
    effectiveAt: '2026-11-20T11:15:00-04:00',
  });
  assert.equal(withExcess.valid, true);
  if (withExcess.valid) {
    assert.equal(withExcess.remainingAfter, 0);
    assert.equal(withExcess.creditExcess, 200);
  }
});

test('RF-037 impide doble reversión o reversión de crédito ya utilizado y exige motivo', () => {
  const payment: RentPayment = {
    id: 'pay-1',
    tenantId: 't1',
    propertyId: 'p1',
    unitId: 'u1',
    tenantPersonId: 'inq-1',
    entryKind: 'collection',
    status: 'confirmed',
    effectiveAt: '2026-11-20T11:15:00-04:00',
    receivedAmount: 1200,
    appliedAmount: 1000,
    creditAmount: 200,
    currency: 'BOB',
    paymentMethod: 'cash',
    referenceCode: '',
    notes: '',
    collectedByUserId: 'u-1',
    collectedByName: 'Edgar Mercado',
    reversedPaymentId: null,
    reversalReason: '',
    createdAt: '',
  };

  const usedCredit: TenantCredit = {
    id: 'cred-1',
    tenantId: 't1',
    tenantPersonId: 'inq-1',
    sourcePaymentId: 'pay-1',
    currency: 'BOB',
    originalAmount: 200,
    remainingAmount: 50,
    notes: '',
    createdAt: '',
  };

  assert.equal(
    validateReversalInput({ payment, reason: '', credits: [] }).valid,
    false
  );
  assert.equal(
    validateReversalInput({ payment, reason: 'Error de captura', credits: [usedCredit] }).valid,
    false
  );
  assert.equal(
    validateReversalInput({ payment, reason: 'Error de captura', credits: [] }).valid,
    true
  );
});

test('DEC-12 y DEC-01 formato correlativo de recibo y totales separados BOB / USD', () => {
  assert.equal(formatReceiptNumber(1), 'REC-000001');
  assert.equal(formatReceiptNumber(42), 'REC-000042');

  const payments: RentPayment[] = [
    {
      id: 'p1',
      tenantId: 't1',
      propertyId: 'prop1',
      unitId: 'u1',
      tenantPersonId: 'inq1',
      entryKind: 'collection',
      status: 'confirmed',
      effectiveAt: '2026-11-20T11:00:00-04:00',
      receivedAmount: 1000,
      appliedAmount: 1000,
      creditAmount: 0,
      currency: 'BOB',
      paymentMethod: 'cash',
      referenceCode: '',
      notes: '',
      collectedByUserId: null,
      collectedByName: 'Edgar',
      reversedPaymentId: null,
      reversalReason: '',
      createdAt: '',
    },
    {
      id: 'p2',
      tenantId: 't1',
      propertyId: 'prop1',
      unitId: 'u2',
      tenantPersonId: 'inq2',
      entryKind: 'collection',
      status: 'confirmed',
      effectiveAt: '2026-11-20T11:05:00-04:00',
      receivedAmount: 250,
      appliedAmount: 250,
      creditAmount: 0,
      currency: 'USD',
      paymentMethod: 'bank_transfer',
      referenceCode: 'TRF-901',
      notes: '',
      collectedByUserId: null,
      collectedByName: 'Edgar',
      reversedPaymentId: null,
      reversalReason: '',
      createdAt: '',
    },
    {
      id: 'p3',
      tenantId: 't1',
      propertyId: 'prop1',
      unitId: 'u1',
      tenantPersonId: 'inq1',
      entryKind: 'collection',
      status: 'reversed',
      effectiveAt: '2026-11-20T11:10:00-04:00',
      receivedAmount: 500,
      appliedAmount: 500,
      creditAmount: 0,
      currency: 'BOB',
      paymentMethod: 'cash',
      referenceCode: '',
      notes: '',
      collectedByUserId: null,
      collectedByName: 'Edgar',
      reversedPaymentId: null,
      reversalReason: 'Duplicado',
      createdAt: '',
    },
  ];

  const summary = summarizeCollectionsByCurrency(payments);
  assert.equal(summary.BOB.confirmedTotalReceived, 1000);
  assert.equal(summary.BOB.reversedCount, 1);
  assert.equal(summary.USD.confirmedTotalReceived, 250);
});
