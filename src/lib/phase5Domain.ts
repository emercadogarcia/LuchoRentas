/**
 * Archivo: src/lib/phase5Domain.ts
 * Responsabilidad: Lógica pura de validación y cálculo para Fase 5 (Gastos y Cuentas
 *   por Pagar con eventos diferenciados, pagos parciales/totales a proveedores,
 *   cajas independientes por usuario y moneda, arqueo y validación de adjuntos).
 * Cumplimiento LuchoRentas.md: RF-040 a RF-045, RF-054, RF-055, §4.7, §4.8,
 *   DEC-01 (BOB/USD separados), DEC-07, DEC-08 y DEC-09.
 */
import { roundCurrency2 } from './phase3Domain';
import type {
  CashMovement,
  CashSession,
  CurrencyCode,
  ExpenseItem,
  ExpensePayment,
  ExpenseScope,
} from '../types/domain';

export const DEFAULT_EXPENSE_CATEGORY_NAMES = [
  'Energía eléctrica',
  'Agua potable',
  'Internet',
  'Mantenimiento/reparación',
  'Limpieza',
  'Otros',
] as const;

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;

export function deriveExpenseBalance(expense: ExpenseItem, todayLaPaz: string): {
  balance: number;
  isOverdue: boolean;
} {
  if (expense.status === 'voided' || expense.status === 'paid') {
    return { balance: 0, isOverdue: false };
  }
  const balance = Math.max(0, roundCurrency2(expense.amount - expense.paidAmount));
  const isOverdue =
    balance > 0 &&
    Boolean(expense.dueDate) &&
    (expense.dueDate as string) < todayLaPaz;
  return { balance, isOverdue };
}

export function validateExpenseInput(params: {
  scope: ExpenseScope;
  propertyId: string | null;
  unitId: string | null;
  categoryId: string;
  concept: string;
  expenseDate: string;
  dueDate: string | null;
  amount: number;
}): { valid: true } | { valid: false; error: string } {
  const { scope, propertyId, unitId, categoryId, concept, expenseDate, dueDate, amount } = params;

  if (concept.trim().length < 2) {
    return { valid: false, error: 'El concepto del gasto debe tener al menos 2 caracteres.' };
  }
  if (!categoryId) {
    return { valid: false, error: 'Selecciona una categoría de gasto.' };
  }
  if (!expenseDate) {
    return { valid: false, error: 'La fecha del gasto es obligatoria.' };
  }
  if (dueDate && dueDate < expenseDate) {
    return {
      valid: false,
      error: 'La fecha de vencimiento no puede ser anterior a la fecha del gasto.',
    };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { valid: false, error: 'El importe del gasto debe ser mayor a 0.' };
  }
  if (scope === 'property' && !propertyId) {
    return { valid: false, error: 'Selecciona la casa correspondiente al gasto.' };
  }
  if (scope === 'unit' && (!propertyId || !unitId)) {
    return { valid: false, error: 'Selecciona la casa y el cuarto/unidad específica del gasto.' };
  }
  return { valid: true };
}

export function validateExpensePaymentInput(params: {
  expense: ExpenseItem | undefined;
  cashSession: CashSession | undefined;
  amount: number;
  effectiveAt: string;
}): { valid: true; pendingBalance: number; remainingAfter: number } | { valid: false; error: string } {
  const { expense, cashSession, amount, effectiveAt } = params;

  if (!expense) {
    return { valid: false, error: 'Gasto no encontrado.' };
  }
  if (expense.status === 'voided') {
    return { valid: false, error: 'No se puede pagar un gasto anulado.' };
  }
  if (expense.status === 'pending_approval') {
    return {
      valid: false,
      error: 'El gasto debe ser aprobado antes de confirmar un pago (DEC-09).',
    };
  }
  if (expense.status === 'paid') {
    return { valid: false, error: 'Este gasto ya fue pagado en su totalidad.' };
  }

  const pendingBalance = roundCurrency2(expense.amount - expense.paidAmount);
  if (pendingBalance <= 0) {
    return { valid: false, error: 'El gasto no tiene saldo pendiente por pagar.' };
  }

  if (!effectiveAt || Number.isNaN(new Date(effectiveAt).getTime())) {
    return { valid: false, error: 'Ingresa una fecha y hora efectiva válida.' };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return { valid: false, error: 'El monto a pagar debe ser mayor a 0.' };
  }
  const cleanAmt = roundCurrency2(amount);
  if (cleanAmt > pendingBalance) {
    return {
      valid: false,
      error: `El pago (${cleanAmt.toFixed(2)}) no puede superar el saldo pendiente (${pendingBalance.toFixed(2)}).`,
    };
  }

  if (!cashSession) {
    return {
      valid: false,
      error: `Debes tener una caja abierta en ${expense.currency} para confirmar el egreso (§4.8).`,
    };
  }
  if (cashSession.status !== 'open') {
    return {
      valid: false,
      error: 'No se permiten movimientos ni pagos sobre una caja cerrada (§4.8).',
    };
  }
  if (cashSession.currency !== expense.currency) {
    return {
      valid: false,
      error: `La caja seleccionada (${cashSession.currency}) no coincide con la moneda del gasto (${expense.currency}).`,
    };
  }

  return {
    valid: true,
    pendingBalance,
    remainingAfter: roundCurrency2(pendingBalance - cleanAmt),
  };
}

export function computeCashSessionBalances(
  session: CashSession,
  movements: CashMovement[]
): {
  openingBalance: number;
  totalInflows: number;
  totalOutflows: number;
  expectedBalance: number;
} {
  let inflows = 0;
  let outflows = 0;

  for (const m of movements) {
    if (m.cashSessionId !== session.id) continue;
    if (m.currency !== session.currency) continue;
    if (m.direction === 'inflow') {
      inflows = roundCurrency2(inflows + m.amount);
    } else {
      outflows = roundCurrency2(outflows + m.amount);
    }
  }

  const openingBalance = roundCurrency2(session.openingBalance);
  const expectedBalance = roundCurrency2(openingBalance + inflows - outflows);

  return {
    openingBalance,
    totalInflows: inflows,
    totalOutflows: outflows,
    expectedBalance,
  };
}

export function validateReconciliationInput(params: {
  session: CashSession | undefined;
  expectedBalance: number;
  countedBalance: number;
  differenceReason: string;
}):
  | { valid: true; differenceAmount: number; requiresApproval: boolean }
  | { valid: false; error: string } {
  const { session, expectedBalance, countedBalance, differenceReason } = params;

  if (!session) {
    return { valid: false, error: 'Sesión de caja no encontrada.' };
  }
  if (session.status !== 'open') {
    return { valid: false, error: 'Una caja cerrada no puede arquearse ni modificarse (§4.8).' };
  }
  if (!Number.isFinite(countedBalance) || countedBalance < 0) {
    return { valid: false, error: 'El saldo contado no puede ser negativo.' };
  }

  const diff = roundCurrency2(roundCurrency2(countedBalance) - roundCurrency2(expectedBalance));
  if (diff !== 0 && differenceReason.trim().length < 3) {
    return {
      valid: false,
      error: 'Existe una diferencia de arqueo; debes registrar el motivo explicativo (RF-055).',
    };
  }

  return {
    valid: true,
    differenceAmount: diff,
    requiresApproval: diff !== 0,
  };
}

export function summarizeExpensesByCurrency(
  expenses: ExpenseItem[],
  payments: ExpensePayment[],
  todayLaPaz: string
): Record<
  CurrencyCode,
  {
    pendingPayableBalance: number;
    overduePayableBalance: number;
    pendingApprovalAmount: number;
    confirmedPaidOutflow: number;
    pendingApprovalCount: number;
  }
> {
  const init = () => ({
    pendingPayableBalance: 0,
    overduePayableBalance: 0,
    pendingApprovalAmount: 0,
    confirmedPaidOutflow: 0,
    pendingApprovalCount: 0,
  });

  const out: Record<CurrencyCode, ReturnType<typeof init>> = {
    BOB: init(),
    USD: init(),
  };

  for (const exp of expenses) {
    const bucket = out[exp.currency];
    if (exp.status === 'voided') continue;

    if (exp.status === 'pending_approval') {
      bucket.pendingApprovalAmount = roundCurrency2(bucket.pendingApprovalAmount + exp.amount);
      bucket.pendingApprovalCount += 1;
      continue;
    }

    const { balance, isOverdue } = deriveExpenseBalance(exp, todayLaPaz);
    if (balance > 0) {
      bucket.pendingPayableBalance = roundCurrency2(bucket.pendingPayableBalance + balance);
      if (isOverdue) {
        bucket.overduePayableBalance = roundCurrency2(bucket.overduePayableBalance + balance);
      }
    }
  }

  for (const pay of payments) {
    const bucket = out[pay.currency];
    bucket.confirmedPaidOutflow = roundCurrency2(bucket.confirmedPaidOutflow + pay.amount);
  }

  return out;
}

export function validateAttachmentFile(file: {
  name: string;
  size: number;
  type: string;
}): { valid: true } | { valid: false; error: string } {
  if (file.size <= 0) {
    return { valid: false, error: 'El archivo adjunto está vacío.' };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { valid: false, error: 'El comprobante adjunto no puede superar 5 MB (RF-045).' };
  }
  if (
    !ALLOWED_ATTACHMENT_MIME_TYPES.includes(
      file.type as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number]
    )
  ) {
    return {
      valid: false,
      error: 'Solo se admiten comprobantes en formato PNG, JPG, WEBP o PDF.',
    };
  }
  return { valid: true };
}
