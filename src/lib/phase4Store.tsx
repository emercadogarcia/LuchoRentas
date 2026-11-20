/**
 * Archivo: src/lib/phase4Store.tsx
 * Responsabilidad: Proveedor de estado y operaciones transaccionales de Fase 4
 *   (Cobros confirmados inmutables, pagos parciales, créditos por excedente separados,
 *   reversiones compensatorias auditadas y recibos correlativos no fiscales),
 *   con sincronización inmediata sobre Cuentas por Cobrar (Fase 3) y soporte dual
 *   para Supabase RPCs y vista previa local persistente.
 * Cumplimiento LuchoRentas.md: RF-033 a RF-037 (CA-033 a CA-037), §4.6, DEC-01, DEC-12 y DEC-13.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { usePhase2 } from './phase2Store';
import { roundCurrency2 } from './phase3Domain';
import { usePhase3 } from './phase3Store';
import {
  formatReceiptNumber,
  validateCollectionInput,
  validateReversalInput,
} from './phase4Domain';
import { validateTenantMutation } from './rbac';
import { isSupabaseConfigured, supabase } from './supabase';
import type {
  AllocationKind,
  CurrencyCode,
  PaymentAllocation,
  PaymentEntryKind,
  PaymentMethod,
  PaymentStatus,
  ReceiptStatus,
  ReceivableBaseStatus,
  RentPayment,
  RentReceipt,
  TenantCredit,
} from '../types/domain';

interface Phase4StoreData {
  payments: RentPayment[];
  allocations: PaymentAllocation[];
  credits: TenantCredit[];
  receipts: RentReceipt[];
  counters: Record<string, number>;
}

const STORAGE_KEY = 'luchorentas_phase4_store_v1';
const NON_FISCAL_LEGEND = 'COMPROBANTE INTERNO NO FISCAL — LUCHORENTAS';

interface ActionResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface Phase4ContextValue {
  payments: RentPayment[];
  allocations: PaymentAllocation[];
  credits: TenantCredit[];
  receipts: RentReceipt[];
  isLoading: boolean;
  confirmPayment: (input: {
    receivableChargeId: string;
    effectiveAt: string;
    receivedAmount: number;
    appliedAmount: number;
    paymentMethod: PaymentMethod;
    referenceCode: string;
    notes: string;
    idempotencyKey?: string;
  }) => Promise<ActionResult<{ payment: RentPayment; receipt: RentReceipt }>>;
  reversePayment: (input: {
    paymentId: string;
    reason: string;
  }) => Promise<ActionResult>;
  applyCredit: (input: {
    creditId: string;
    receivableChargeId: string;
    amount: number;
    notes: string;
  }) => Promise<ActionResult>;
  getReceiptForPayment: (paymentId: string) => RentReceipt | undefined;
  refreshPhase4: () => Promise<void>;
}

const Phase4Context = createContext<Phase4ContextValue | null>(null);

function loadPreviewPhase4(): Phase4StoreData {
  const fallback: Phase4StoreData = {
    payments: [],
    allocations: [],
    credits: [],
    receipts: [],
    counters: {},
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Phase4StoreData>;
    return {
      payments: parsed.payments ?? [],
      allocations: parsed.allocations ?? [],
      credits: parsed.credits ?? [],
      receipts: parsed.receipts ?? [],
      counters: parsed.counters ?? {},
    };
  } catch {
    return fallback;
  }
}

function mapPaymentRow(row: Record<string, unknown>): RentPayment {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    propertyId: String(row.property_id),
    unitId: String(row.unit_id),
    tenantPersonId: String(row.tenant_person_id),
    entryKind: (row.entry_kind as PaymentEntryKind) ?? 'collection',
    status: (row.status as PaymentStatus) ?? 'confirmed',
    effectiveAt: String(row.effective_at),
    receivedAmount: Number(row.received_amount),
    appliedAmount: Number(row.applied_amount),
    creditAmount: Number(row.credit_amount ?? 0),
    currency: (row.currency as CurrencyCode) ?? 'BOB',
    paymentMethod: (row.payment_method as PaymentMethod) ?? 'cash',
    referenceCode: String(row.reference_code ?? ''),
    notes: String(row.notes ?? ''),
    collectedByUserId: row.collected_by_user_id ? String(row.collected_by_user_id) : null,
    collectedByName: String(row.collected_by_name ?? 'Operador'),
    reversedPaymentId: row.reversed_payment_id ? String(row.reversed_payment_id) : null,
    reversalReason: String(row.reversal_reason ?? ''),
    createdAt: String(row.created_at),
  };
}

function mapReceiptRow(row: Record<string, unknown>): RentReceipt {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    paymentId: String(row.payment_id),
    propertyId: String(row.property_id),
    docType: 'rent_receipt',
    sequenceNumber: Number(row.sequence_number),
    receiptNumber: String(row.receipt_number),
    issuedAt: String(row.issued_at),
    tenantName: String(row.tenant_name),
    tenantPersonName: String(row.tenant_person_name),
    propertyName: String(row.property_name),
    unitName: String(row.unit_name),
    conceptPeriod: String(row.concept_period),
    amount: Number(row.amount),
    currency: (row.currency as CurrencyCode) ?? 'BOB',
    paymentMethod: (row.payment_method as PaymentMethod) ?? 'cash',
    collectedByName: String(row.collected_by_name ?? 'Operador'),
    notes: String(row.notes ?? ''),
    nonFiscalLegend: String(row.non_fiscal_legend ?? NON_FISCAL_LEGEND),
    status: (row.status as ReceiptStatus) ?? 'valid',
  };
}

export function Phase4Provider({ children }: { children: React.ReactNode }) {
  const { activeTenant, activeMembership, currentUser, tenantPermissions } = useAuth();
  const { properties, units, people } = usePhase2();
  const { receivables, refreshPhase3, syncReceivablePaidAmount } = usePhase3();

  const [store, setStore] = useState<Phase4StoreData>(loadPreviewPhase4);
  const [liveData, setLiveData] = useState<Phase4StoreData>({
    payments: [],
    allocations: [],
    credits: [],
    receipts: [],
    counters: {},
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isSupabaseConfigured) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Ignorar si localStorage está lleno
    }
  }, [store]);

  const loadSupabasePhase4 = useCallback(async (tenantId: string) => {
    if (!supabase) return;
    setIsLoading(true);
    const [{ data: payRows }, { data: allocRows }, { data: credRows }, { data: recRows }] =
      await Promise.all([
        supabase
          .from('payments')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('effective_at', { ascending: false }),
        supabase
          .from('payment_allocations')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false }),
        supabase
          .from('tenant_credits')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false }),
        supabase
          .from('receipts')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('sequence_number', { ascending: false }),
      ]);

    setLiveData({
      payments: ((payRows as Array<Record<string, unknown>>) ?? []).map(mapPaymentRow),
      allocations: ((allocRows as Array<Record<string, unknown>>) ?? []).map((a) => ({
        id: String(a.id),
        tenantId: String(a.tenant_id),
        paymentId: String(a.payment_id),
        receivableChargeId: String(a.receivable_charge_id),
        allocationKind: (a.allocation_kind as AllocationKind) ?? 'payment',
        allocatedAmount: Number(a.allocated_amount),
        notes: String(a.notes ?? ''),
        createdAt: String(a.created_at),
      })),
      credits: ((credRows as Array<Record<string, unknown>>) ?? []).map((c) => ({
        id: String(c.id),
        tenantId: String(c.tenant_id),
        tenantPersonId: String(c.tenant_person_id),
        sourcePaymentId: String(c.source_payment_id),
        currency: (c.currency as CurrencyCode) ?? 'BOB',
        originalAmount: Number(c.original_amount),
        remainingAmount: Number(c.remaining_amount),
        notes: String(c.notes ?? ''),
        createdAt: String(c.created_at),
      })),
      receipts: ((recRows as Array<Record<string, unknown>>) ?? []).map(mapReceiptRow),
      counters: {},
    });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!activeTenant || !activeMembership) {
      setLiveData({ payments: [], allocations: [], credits: [], receipts: [], counters: {} });
      return;
    }
    void loadSupabasePhase4(activeTenant.id);
  }, [activeTenant, activeMembership, loadSupabasePhase4]);

  const refreshPhase4 = useCallback(async () => {
    if (!isSupabaseConfigured || !activeTenant) return;
    await loadSupabasePhase4(activeTenant.id);
  }, [activeTenant, loadSupabasePhase4]);

  const rawData = isSupabaseConfigured ? liveData : store;

  const visiblePropertyIds = useMemo(
    () => new Set(properties.map((p) => p.id)),
    [properties]
  );

  const visiblePayments = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.payments.filter(
      (p) => p.tenantId === activeTenant.id && visiblePropertyIds.has(p.propertyId)
    );
  }, [activeTenant, rawData.payments, visiblePropertyIds]);

  const visiblePaymentIds = useMemo(
    () => new Set(visiblePayments.map((p) => p.id)),
    [visiblePayments]
  );

  const visibleAllocations = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.allocations.filter(
      (a) => a.tenantId === activeTenant.id && visiblePaymentIds.has(a.paymentId)
    );
  }, [activeTenant, rawData.allocations, visiblePaymentIds]);

  const visibleReceipts = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.receipts.filter(
      (r) => r.tenantId === activeTenant.id && visiblePropertyIds.has(r.propertyId)
    );
  }, [activeTenant, rawData.receipts, visiblePropertyIds]);

  const visibleCredits = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.credits.filter(
      (c) =>
        c.tenantId === activeTenant.id &&
        (activeMembership?.allowedPropertyIds === null ||
          visiblePaymentIds.has(c.sourcePaymentId))
    );
  }, [activeMembership?.allowedPropertyIds, activeTenant, rawData.credits, visiblePaymentIds]);

  const confirmPayment: Phase4ContextValue['confirmPayment'] = async (input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const charge = receivables.find((r) => r.id === input.receivableChargeId);
    if (!charge) {
      return { ok: false, error: 'Cuenta por cobrar no encontrada en el espacio activo.' };
    }

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'collections',
      action: 'create',
      propertyId: charge.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const validation = validateCollectionInput({
      charge,
      receivedAmount: input.receivedAmount,
      appliedAmount: input.appliedAmount,
      effectiveAt: input.effectiveAt,
    });
    if (!validation.valid) return { ok: false, error: validation.error };

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('confirm_rent_payment', {
        p_tenant_id: activeTenant.id,
        p_receivable_charge_id: charge.id,
        p_effective_at: new Date(input.effectiveAt).toISOString(),
        p_received_amount: roundCurrency2(input.receivedAmount),
        p_applied_amount: roundCurrency2(input.appliedAmount),
        p_payment_method: input.paymentMethod,
        p_reference_code: input.referenceCode.trim(),
        p_notes: input.notes.trim(),
        p_idempotency_key: input.idempotencyKey?.trim() || null,
      });
      if (error) return { ok: false, error: error.message };

      const payload = data as {
        payment: Record<string, unknown>;
        receipt: Record<string, unknown>;
      };
      await Promise.all([loadSupabasePhase4(activeTenant.id), refreshPhase3()]);
      return {
        ok: true,
        data: {
          payment: mapPaymentRow(payload.payment),
          receipt: mapReceiptRow(payload.receipt),
        },
      };
    }

    // Modo vista previa local: idempotencia si se reintenta con la misma clave
    const cleanKey = input.idempotencyKey?.trim();
    if (cleanKey) {
      const existingPay = store.payments.find(
        (p) => p.tenantId === activeTenant.id && p.referenceCode === `__idem:${cleanKey}`
      );
      if (existingPay) {
        const existingRec = store.receipts.find(
          (r) => r.tenantId === activeTenant.id && r.paymentId === existingPay.id
        );
        if (existingRec) {
          return { ok: true, data: { payment: existingPay, receipt: existingRec } };
        }
      }
    }

    const nowIso = new Date().toISOString();
    const effectiveIso = new Date(input.effectiveAt).toISOString();
    const recAmt = roundCurrency2(input.receivedAmount);
    const appAmt = roundCurrency2(input.appliedAmount);
    const creditExcess = roundCurrency2(recAmt - appAmt);

    const paymentId = `pay-${crypto.randomUUID().slice(0, 8)}`;
    const nextSeq = (store.counters[activeTenant.id] ?? 0) + 1;
    const receiptNumber = formatReceiptNumber(nextSeq);

    const renterName =
      people.find((p) => p.id === charge.tenantPersonId)?.fullName ?? 'Inquilino';
    const propertyName =
      properties.find((p) => p.id === charge.propertyId)?.name ?? 'Inmueble';
    const unit = units.find((u) => u.id === charge.unitId);
    const unitName = unit ? `${unit.code} — ${unit.name}` : 'Unidad';
    const collectorName = currentUser?.fullName ?? 'Operador';

    const newPayment: RentPayment = {
      id: paymentId,
      tenantId: activeTenant.id,
      propertyId: charge.propertyId,
      unitId: charge.unitId,
      tenantPersonId: charge.tenantPersonId,
      entryKind: 'collection',
      status: 'confirmed',
      effectiveAt: effectiveIso,
      receivedAmount: recAmt,
      appliedAmount: appAmt,
      creditAmount: creditExcess,
      currency: charge.currency,
      paymentMethod: input.paymentMethod,
      referenceCode: input.referenceCode.trim(),
      notes: input.notes.trim(),
      collectedByUserId: currentUser?.id ?? null,
      collectedByName: collectorName,
      reversedPaymentId: null,
      reversalReason: '',
      createdAt: nowIso,
    };

    const newAllocation: PaymentAllocation = {
      id: `alloc-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      paymentId,
      receivableChargeId: charge.id,
      allocationKind: 'payment',
      allocatedAmount: appAmt,
      notes: input.notes.trim(),
      createdAt: nowIso,
    };

    const newCredit: TenantCredit | null =
      creditExcess > 0
        ? {
            id: `cred-${crypto.randomUUID().slice(0, 8)}`,
            tenantId: activeTenant.id,
            tenantPersonId: charge.tenantPersonId,
            sourcePaymentId: paymentId,
            currency: charge.currency,
            originalAmount: creditExcess,
            remainingAmount: creditExcess,
            notes: 'Excedente de cobro pendiente de aplicación manual autorizada',
            createdAt: nowIso,
          }
        : null;

    const newReceipt: RentReceipt = {
      id: `rec-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      paymentId,
      propertyId: charge.propertyId,
      docType: 'rent_receipt',
      sequenceNumber: nextSeq,
      receiptNumber,
      issuedAt: effectiveIso,
      tenantName: activeTenant.name,
      tenantPersonName: renterName,
      propertyName,
      unitName,
      conceptPeriod: `Alquiler período ${charge.periodStart} al ${charge.periodEnd}`,
      amount: recAmt,
      currency: charge.currency,
      paymentMethod: input.paymentMethod,
      collectedByName: collectorName,
      notes: input.notes.trim(),
      nonFiscalLegend: NON_FISCAL_LEGEND,
      status: 'valid',
    };

    const nextPaid = roundCurrency2(charge.paidAmount + appAmt);
    const nextStatus: ReceivableBaseStatus =
      nextPaid + charge.adjustedAmount >= charge.amount ? 'paid' : 'partially_paid';

    setStore((prev) => ({
      payments: [newPayment, ...prev.payments],
      allocations: [newAllocation, ...prev.allocations],
      credits: newCredit ? [newCredit, ...prev.credits] : prev.credits,
      receipts: [newReceipt, ...prev.receipts],
      counters: {
        ...prev.counters,
        [activeTenant.id]: nextSeq,
      },
    }));

    syncReceivablePaidAmount(charge.id, nextPaid, nextStatus);

    return { ok: true, data: { payment: newPayment, receipt: newReceipt } };
  };

  const reversePayment: Phase4ContextValue['reversePayment'] = async (input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const orig = visiblePayments.find((p) => p.id === input.paymentId);
    if (!orig) return { ok: false, error: 'Cobro no encontrado.' };

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'collections',
      action: 'reverse',
      propertyId: orig.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const validation = validateReversalInput({
      payment: orig,
      reason: input.reason,
      credits: visibleCredits,
    });
    if (!validation.valid) return { ok: false, error: validation.error };

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('reverse_rent_payment', {
        p_tenant_id: activeTenant.id,
        p_payment_id: orig.id,
        p_reason: input.reason.trim(),
      });
      if (error) return { ok: false, error: error.message };
      await Promise.all([loadSupabasePhase4(activeTenant.id), refreshPhase3()]);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    const reversalId = `pay-${crypto.randomUUID().slice(0, 8)}`;
    const cleanReason = input.reason.trim();

    const reversalEntry: RentPayment = {
      id: reversalId,
      tenantId: activeTenant.id,
      propertyId: orig.propertyId,
      unitId: orig.unitId,
      tenantPersonId: orig.tenantPersonId,
      entryKind: 'reversal',
      status: 'confirmed',
      effectiveAt: nowIso,
      receivedAmount: orig.receivedAmount,
      appliedAmount: orig.appliedAmount,
      creditAmount: orig.creditAmount,
      currency: orig.currency,
      paymentMethod: orig.paymentMethod,
      referenceCode: orig.referenceCode,
      notes: 'Reversión compensatoria de cobro',
      collectedByUserId: currentUser?.id ?? null,
      collectedByName: currentUser?.fullName ?? 'Operador',
      reversedPaymentId: orig.id,
      reversalReason: cleanReason,
      createdAt: nowIso,
    };

    const origAllocs = visibleAllocations.filter(
      (a) => a.paymentId === orig.id && a.allocationKind === 'payment'
    );

    const reversalAllocs: PaymentAllocation[] = origAllocs.map((a) => ({
      id: `alloc-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      paymentId: reversalId,
      receivableChargeId: a.receivableChargeId,
      allocationKind: 'reversal',
      allocatedAmount: -a.allocatedAmount,
      notes: cleanReason,
      createdAt: nowIso,
    }));

    setStore((prev) => ({
      ...prev,
      payments: [
        reversalEntry,
        ...prev.payments.map((p) =>
          p.id === orig.id && p.tenantId === activeTenant.id
            ? { ...p, status: 'reversed' as const, reversalReason: cleanReason }
            : p
        ),
      ],
      allocations: [...reversalAllocs, ...prev.allocations],
      credits: prev.credits.map((c) =>
        c.sourcePaymentId === orig.id && c.tenantId === activeTenant.id
          ? { ...c, remainingAmount: 0, notes: `${c.notes} [Anulado por reversión]` }
          : c
      ),
      receipts: prev.receipts.map((r) =>
        r.paymentId === orig.id && r.tenantId === activeTenant.id
          ? { ...r, status: 'voided_by_reversal' as const }
          : r
      ),
    }));

    for (const alloc of origAllocs) {
      const ch = receivables.find((r) => r.id === alloc.receivableChargeId);
      if (!ch) continue;
      const nextPaid = Math.max(0, roundCurrency2(ch.paidAmount - alloc.allocatedAmount));
      const nextStatus: ReceivableBaseStatus =
        ch.status === 'voided'
          ? 'voided'
          : nextPaid === 0
            ? 'pending'
            : nextPaid + ch.adjustedAmount >= ch.amount
              ? 'paid'
              : 'partially_paid';
      syncReceivablePaidAmount(ch.id, nextPaid, nextStatus);
    }

    return { ok: true };
  };

  const applyCredit: Phase4ContextValue['applyCredit'] = async (input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const credit = visibleCredits.find((c) => c.id === input.creditId);
    const charge = receivables.find((r) => r.id === input.receivableChargeId);

    if (!credit) return { ok: false, error: 'Crédito de excedente no encontrado.' };
    if (!charge) return { ok: false, error: 'Cuenta por cobrar no encontrada.' };

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'collections',
      action: 'create',
      propertyId: charge.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    if (credit.tenantPersonId !== charge.tenantPersonId) {
      return { ok: false, error: 'El crédito pertenece a un inquilino distinto.' };
    }
    if (credit.currency !== charge.currency) {
      return {
        ok: false,
        error: `No se puede aplicar un crédito en ${credit.currency} sobre una cuenta en ${charge.currency}.`,
      };
    }
    if (charge.status === 'voided') {
      return { ok: false, error: 'No se puede aplicar crédito sobre una obligación anulada.' };
    }

    const chargeBalance = roundCurrency2(charge.amount - charge.paidAmount - charge.adjustedAmount);
    const appAmt = roundCurrency2(input.amount);
    if (!Number.isFinite(appAmt) || appAmt <= 0) {
      return { ok: false, error: 'El monto de aplicación debe ser mayor a 0.' };
    }
    if (appAmt > credit.remainingAmount) {
      return { ok: false, error: 'El monto supera el saldo disponible del crédito.' };
    }
    if (appAmt > chargeBalance) {
      return { ok: false, error: 'El monto supera el saldo pendiente de la cuenta por cobrar.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('apply_tenant_credit', {
        p_tenant_id: activeTenant.id,
        p_credit_id: credit.id,
        p_receivable_charge_id: charge.id,
        p_amount: appAmt,
        p_notes: input.notes.trim(),
      });
      if (error) return { ok: false, error: error.message };
      await Promise.all([loadSupabasePhase4(activeTenant.id), refreshPhase3()]);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    const newAlloc: PaymentAllocation = {
      id: `alloc-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      paymentId: credit.sourcePaymentId,
      receivableChargeId: charge.id,
      allocationKind: 'credit_application',
      allocatedAmount: appAmt,
      notes: input.notes.trim() || 'Aplicación manual de crédito por excedente',
      createdAt: nowIso,
    };

    const nextPaid = roundCurrency2(charge.paidAmount + appAmt);
    const nextStatus: ReceivableBaseStatus =
      nextPaid + charge.adjustedAmount >= charge.amount ? 'paid' : 'partially_paid';

    setStore((prev) => ({
      ...prev,
      credits: prev.credits.map((c) =>
        c.id === credit.id && c.tenantId === activeTenant.id
          ? { ...c, remainingAmount: roundCurrency2(c.remainingAmount - appAmt) }
          : c
      ),
      allocations: [newAlloc, ...prev.allocations],
    }));

    syncReceivablePaidAmount(charge.id, nextPaid, nextStatus);
    return { ok: true };
  };

  const getReceiptForPayment = useCallback(
    (paymentId: string) => visibleReceipts.find((r) => r.paymentId === paymentId),
    [visibleReceipts]
  );

  return (
    <Phase4Context.Provider
      value={{
        payments: visiblePayments,
        allocations: visibleAllocations,
        credits: visibleCredits,
        receipts: visibleReceipts,
        isLoading,
        confirmPayment,
        reversePayment,
        applyCredit,
        getReceiptForPayment,
        refreshPhase4,
      }}
    >
      {children}
    </Phase4Context.Provider>
  );
}

export function usePhase4(): Phase4ContextValue {
  const ctx = useContext(Phase4Context);
  if (!ctx) {
    throw new Error('usePhase4 debe usarse dentro de Phase4Provider');
  }
  return ctx;
}
