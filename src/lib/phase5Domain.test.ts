/**
 * Archivo: src/lib/phase5Domain.test.ts
 * Responsabilidad: Pruebas unitarias deterministas de Fase 5 para separación entre
 *   registro/aprobación/pago de gastos (DEC-09), bloqueo de caja cerrada o moneda
 *   distinta (§4.8 / DEC-01), balance esperado de caja, arqueo con diferencia
 *   obligatoria (RF-055) y totales separados BOB vs USD.
 * Cumplimiento LuchoRentas.md: RF-040 a RF-045, RF-055, DEC-01, DEC-07, DEC-08, DEC-09.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCashSessionBalances,
  summarizeExpensesByCurrency,
  validateAttachmentFile,
  validateExpensePaymentInput,
  validateReconciliationInput,
} from './phase5Domain';
import type { CashMovement, CashSession, ExpenseItem, ExpensePayment } from '../types/domain';

const baseSessionBob: CashSession = {
  id: 'sess-1',
  tenantId: 't1',
  cashAccountId: 'acc-1',
  ownerUserId: 'u1',
  ownerName: 'Edgar Mercado',
  currency: 'BOB',
  status: 'open',
  openedAt: '2026-11-20T09:00:00-04:00',
  openingBalance: 500,
  closedAt: null,
  closingExpectedBalance: null,
  closingCountedBalance: null,
  notes: '',
};

const baseExpenseBob: ExpenseItem = {
  id: 'exp-1',
  tenantId: 't1',
  expenseCode: 'GAS-202611-0001',
  scope: 'property',
  propertyId: 'prop-1',
  unitId: null,
  categoryId: 'cat-1',
  supplierPersonId: 'sup-1',
  concept: 'Reparación de plomería baño',
  expenseDate: '2026-11-15',
  dueDate: '2026-11-18',
  amount: 350,
  paidAmount: 0,
  currency: 'BOB',
  status: 'pending_approval',
  notes: '',
  evidenceName: '',
  evidencePath: '',
  approvedBy: null,
  approvedAt: null,
  voidReason: '',
  createdAt: '',
  updatedAt: '',
};

test('DEC-09 bloquea pago de gasto no aprobado y valida pago parcial sobre caja abierta en misma moneda', () => {
  const unapprovedCheck = validateExpensePaymentInput({
    expense: baseExpenseBob,
    cashSession: baseSessionBob,
    amount: 200,
    effectiveAt: '2026-11-20T10:00:00-04:00',
  });
  assert.equal(unapprovedCheck.valid, false);

  const approvedExpense: ExpenseItem = { ...baseExpenseBob, status: 'approved' };
  const partialCheck = validateExpensePaymentInput({
    expense: approvedExpense,
    cashSession: baseSessionBob,
    amount: 150,
    effectiveAt: '2026-11-20T10:00:00-04:00',
  });
  assert.equal(partialCheck.valid, true);
  if (partialCheck.valid) {
    assert.equal(partialCheck.pendingBalance, 350);
    assert.equal(partialCheck.remainingAfter, 200);
  }
});

test('§4.8 y DEC-01 rechazan movimientos en caja cerrada o moneda distinta', () => {
  const approvedUsd: ExpenseItem = { ...baseExpenseBob, status: 'approved', currency: 'USD' };
  const currencyMismatch = validateExpensePaymentInput({
    expense: approvedUsd,
    cashSession: baseSessionBob,
    amount: 100,
    effectiveAt: '2026-11-20T10:00:00-04:00',
  });
  assert.equal(currencyMismatch.valid, false);

  const closedSession: CashSession = { ...baseSessionBob, status: 'closed' };
  const approvedBob: ExpenseItem = { ...baseExpenseBob, status: 'approved' };
  const closedCheck = validateExpensePaymentInput({
    expense: approvedBob,
    cashSession: closedSession,
    amount: 100,
    effectiveAt: '2026-11-20T10:00:00-04:00',
  });
  assert.equal(closedCheck.valid, false);
});

test('§4.8 y RF-055 calculan saldo esperado y exigen motivo cuando existe diferencia de arqueo', () => {
  const movements: CashMovement[] = [
    {
      id: 'm1',
      tenantId: 't1',
      cashAccountId: 'acc-1',
      cashSessionId: 'sess-1',
      currency: 'BOB',
      direction: 'inflow',
      sourceType: 'rent_collection',
      sourceId: 'pay-1',
      linkedMovementId: null,
      effectiveAt: '2026-11-20T09:30:00-04:00',
      amount: 1200,
      notes: '',
      createdBy: 'u1',
      createdByName: 'Edgar',
      createdAt: '',
    },
    {
      id: 'm2',
      tenantId: 't1',
      cashAccountId: 'acc-1',
      cashSessionId: 'sess-1',
      currency: 'BOB',
      direction: 'outflow',
      sourceType: 'expense_payment',
      sourceId: 'ep-1',
      linkedMovementId: null,
      effectiveAt: '2026-11-20T10:15:00-04:00',
      amount: 250,
      notes: '',
      createdBy: 'u1',
      createdByName: 'Edgar',
      createdAt: '',
    },
  ];

  const balances = computeCashSessionBalances(baseSessionBob, movements);
  assert.equal(balances.openingBalance, 500);
  assert.equal(balances.totalInflows, 1200);
  assert.equal(balances.totalOutflows, 250);
  assert.equal(balances.expectedBalance, 1450);

  const diffWithoutReason = validateReconciliationInput({
    session: baseSessionBob,
    expectedBalance: balances.expectedBalance,
    countedBalance: 1400,
    differenceReason: '',
  });
  assert.equal(diffWithoutReason.valid, false);

  const diffWithReason = validateReconciliationInput({
    session: baseSessionBob,
    expectedBalance: balances.expectedBalance,
    countedBalance: 1400,
    differenceReason: 'Faltante por cambio mal entregado',
  });
  assert.equal(diffWithReason.valid, true);
  if (diffWithReason.valid) {
    assert.equal(diffWithReason.differenceAmount, -50);
    assert.equal(diffWithReason.requiresApproval, true);
  }
});

test('DEC-09 y DEC-01 resumen separa gastos pendientes por aprobar, CxP aprobada y egresos efectivos por moneda', () => {
  const expenses: ExpenseItem[] = [
    baseExpenseBob, // 350 BOB pending_approval (no entra a CxP aprobada ni a egresos)
    { ...baseExpenseBob, id: 'exp-2', status: 'partially_paid', amount: 400, paidAmount: 100, dueDate: '2026-11-10' },
    { ...baseExpenseBob, id: 'exp-3', currency: 'USD', status: 'approved', amount: 120, paidAmount: 0, dueDate: '2026-11-25' },
  ];
  const payments: ExpensePayment[] = [
    {
      id: 'ep-1',
      tenantId: 't1',
      expenseId: 'exp-2',
      cashSessionId: 'sess-1',
      effectiveAt: '2026-11-20T10:15:00-04:00',
      amount: 100,
      currency: 'BOB',
      paymentMethod: 'cash',
      referenceCode: '',
      notes: '',
      paidByUserId: 'u1',
      paidByName: 'Edgar',
      createdAt: '',
    },
  ];

  const summary = summarizeExpensesByCurrency(expenses, payments, '2026-11-20');
  assert.equal(summary.BOB.pendingApprovalAmount, 350);
  assert.equal(summary.BOB.pendingPayableBalance, 300);
  assert.equal(summary.BOB.overduePayableBalance, 300);
  assert.equal(summary.BOB.confirmedPaidOutflow, 100);
  assert.equal(summary.USD.pendingPayableBalance, 120);
  assert.equal(summary.USD.confirmedPaidOutflow, 0);
});

test('RF-045 valida tipo MIME y tamaño máximo de comprobante adjunto', () => {
  assert.equal(
    validateAttachmentFile({ name: 'factura.pdf', size: 1024 * 500, type: 'application/pdf' }).valid,
    true
  );
  assert.equal(
    validateAttachmentFile({ name: 'script.exe', size: 1024, type: 'application/x-msdownload' }).valid,
    false
  );
  assert.equal(
    validateAttachmentFile({ name: 'grande.png', size: 8 * 1024 * 1024, type: 'image/png' }).valid,
    false
  );
});
