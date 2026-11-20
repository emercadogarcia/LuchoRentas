/**
 * Archivo: src/lib/phase4Domain.ts
 * Responsabilidad: Lógica pura de validación de cobros completos y parciales, cálculo
 *   de excedentes de crédito separado, reversión compensatoria, numeración de recibos
 *   y agregación separada por moneda (BOB / USD).
 * Cumplimiento LuchoRentas.md: RF-033 a RF-037, §4.6, DEC-01 (BOB/USD separados) y DEC-12.
 */
import { deriveReceivableState, getLaPazTodayIso, roundCurrency2 } from './phase3Domain';
import { formatBoliviaDateTime, formatCurrencyAmount } from './rbac';
import {
  PAYMENT_METHOD_LABELS,
  type CurrencyCode,
  type ReceivableCharge,
  type RentPayment,
  type RentReceipt,
  type TenantCredit,
} from '../types/domain';

export function formatReceiptNumber(sequenceNumber: number): string {
  return `REC-${String(sequenceNumber).padStart(6, '0')}`;
}

export interface ReceiptDisplayPayload {
  receiptNumber: string;
  tenantName: string;
  statusLabel: string;
  formattedAmount: string;
  currency: CurrencyCode;
  nonFiscalLegend: string;
  rows: Array<{ label: string; value: string }>;
}

/**
 * Fuente única determinista para renderizado de recibo en PNG y PDF (RF-036 / CA-036).
 */
export function buildReceiptDisplayPayload(receipt: RentReceipt): ReceiptDisplayPayload {
  return {
    receiptNumber: receipt.receiptNumber,
    tenantName: receipt.tenantName,
    statusLabel:
      receipt.status === 'voided_by_reversal' ? 'ANULADO POR REVERSIÓN' : 'EMITIDO VÁLIDO',
    formattedAmount: formatCurrencyAmount(receipt.amount, receipt.currency),
    currency: receipt.currency,
    nonFiscalLegend: receipt.nonFiscalLegend,
    rows: [
      { label: 'Fecha y hora (Bolivia)', value: formatBoliviaDateTime(receipt.issuedAt) },
      { label: 'Inquilino', value: receipt.tenantPersonName },
      { label: 'Casa / Inmueble', value: receipt.propertyName },
      { label: 'Unidad / Cuarto', value: receipt.unitName },
      { label: 'Concepto / Período', value: receipt.conceptPeriod },
      { label: 'Método de pago', value: PAYMENT_METHOD_LABELS[receipt.paymentMethod] },
      { label: 'Cobrado / Registrado por', value: receipt.collectedByName },
      { label: 'Observaciones', value: receipt.notes || 'Sin observaciones' },
    ],
  };
}

export function validateCollectionInput(params: {
  charge: ReceivableCharge | undefined;
  receivedAmount: number;
  appliedAmount: number;
  effectiveAt: string;
}):
  | {
      valid: true;
      currentBalance: number;
      remainingAfter: number;
      creditExcess: number;
      isPartial: boolean;
    }
  | { valid: false; error: string } {
  const { charge, receivedAmount, appliedAmount, effectiveAt } = params;

  if (!charge) {
    return { valid: false, error: 'Selecciona una cuenta por cobrar válida.' };
  }
  if (charge.status === 'voided') {
    return { valid: false, error: 'No se puede cobrar una obligación anulada.' };
  }

  const derived = deriveReceivableState(charge, getLaPazTodayIso());
  if (derived.balance <= 0) {
    return { valid: false, error: 'La obligación seleccionada ya tiene saldo 0.' };
  }

  if (!effectiveAt || Number.isNaN(new Date(effectiveAt).getTime())) {
    return { valid: false, error: 'Ingresa una fecha y hora efectiva válida para el cobro.' };
  }
  if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
    return { valid: false, error: 'El importe recibido debe ser mayor a 0.' };
  }
  if (!Number.isFinite(appliedAmount) || appliedAmount <= 0) {
    return { valid: false, error: 'El monto aplicado a la cuenta debe ser mayor a 0.' };
  }

  const rec = roundCurrency2(receivedAmount);
  const app = roundCurrency2(appliedAmount);

  if (app > rec) {
    return {
      valid: false,
      error: 'El monto aplicado no puede superar el importe recibido del inquilino.',
    };
  }
  if (app > derived.balance) {
    return {
      valid: false,
      error: `El monto aplicado (${app.toFixed(2)}) no puede superar el saldo pendiente (${derived.balance.toFixed(2)}).`,
    };
  }

  const remainingAfter = roundCurrency2(derived.balance - app);
  const creditExcess = roundCurrency2(rec - app);

  return {
    valid: true,
    currentBalance: derived.balance,
    remainingAfter,
    creditExcess,
    isPartial: remainingAfter > 0,
  };
}

export function validateReversalInput(params: {
  payment: RentPayment | undefined;
  reason: string;
  credits: TenantCredit[];
}): { valid: true } | { valid: false; error: string } {
  const { payment, reason, credits } = params;
  if (!payment) {
    return { valid: false, error: 'Cobro no encontrado.' };
  }
  if (payment.entryKind !== 'collection') {
    return { valid: false, error: 'No se puede revertir un asiento de reversión.' };
  }
  if (payment.status === 'reversed') {
    return { valid: false, error: 'Este cobro ya fue revertido anteriormente.' };
  }
  if (reason.trim().length < 3) {
    return { valid: false, error: 'Debes ingresar un motivo válido para revertir el cobro.' };
  }

  const linkedCredit = credits.find((c) => c.sourcePaymentId === payment.id);
  if (linkedCredit && linkedCredit.remainingAmount < linkedCredit.originalAmount) {
    return {
      valid: false,
      error: 'El crédito de excedente generado por este cobro ya fue aplicado y no puede revertirse.',
    };
  }

  return { valid: true };
}

export function summarizeCollectionsByCurrency(
  payments: RentPayment[]
): Record<
  CurrencyCode,
  {
    confirmedTotalReceived: number;
    confirmedTotalApplied: number;
    confirmedCount: number;
    reversedCount: number;
  }
> {
  const init = () => ({
    confirmedTotalReceived: 0,
    confirmedTotalApplied: 0,
    confirmedCount: 0,
    reversedCount: 0,
  });

  const out: Record<CurrencyCode, ReturnType<typeof init>> = {
    BOB: init(),
    USD: init(),
  };

  for (const p of payments) {
    if (p.entryKind !== 'collection') continue;
    const bucket = out[p.currency];
    if (p.status === 'confirmed') {
      bucket.confirmedTotalReceived = roundCurrency2(
        bucket.confirmedTotalReceived + p.receivedAmount
      );
      bucket.confirmedTotalApplied = roundCurrency2(
        bucket.confirmedTotalApplied + p.appliedAmount
      );
      bucket.confirmedCount += 1;
    } else {
      bucket.reversedCount += 1;
    }
  }

  return out;
}
