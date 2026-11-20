/**
 * Archivo: src/pages/CollectionsPage.tsx
 * Responsabilidad: Módulo de Operación Financiera (Modelo C) para Cobros, Aplicaciones,
 *   Créditos por Excedente separados, Reversiones Compensatorias y Recibos Correlativos
 *   descargables en Imagen PNG y PDF con leyenda no fiscal.
 * Cumplimiento LuchoRentas.md: RF-033 a RF-037 (CA-033 a CA-037), §4.6, DEC-01 (BOB/USD),
 *   DEC-12 (recibos internos no fiscales), DEC-13 (alcance por casa) y America/La_Paz.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Coins,
  Download,
  FileImage,
  FileText,
  Lock,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePhase2 } from '../lib/phase2Store';
import { deriveReceivableState, getLaPazTodayIso, roundCurrency2 } from '../lib/phase3Domain';
import { usePhase3 } from '../lib/phase3Store';
import { summarizeCollectionsByCurrency, validateCollectionInput } from '../lib/phase4Domain';
import { usePhase4 } from '../lib/phase4Store';
import { formatBoliviaDateTime, formatCurrencyAmount } from '../lib/rbac';
import { downloadReceiptAsPdf, downloadReceiptAsPng } from '../lib/receiptRenderer';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type PaymentMethod,
  type RentReceipt,
  type TenantCredit,
} from '../types/domain';

function getLaPazDateTimeLocalInput(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

function toBoliviaIsoTimestamp(localInput: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localInput)) {
    return `${localInput}:00-04:00`;
  }
  return localInput;
}

export function CollectionsPage({
  initialChargeId,
  onConsumeInitialCharge,
}: {
  initialChargeId?: string | null;
  onConsumeInitialCharge?: () => void;
}) {
  const { activeTenant, currentUser, canDo } = useAuth();
  const { properties, units, people } = usePhase2();
  const { contracts, receivables } = usePhase3();
  const {
    payments,
    credits,
    receipts,
    confirmPayment,
    reversePayment,
    applyCredit,
    getReceiptForPayment,
  } = usePhase4();

  const canCreateGlobal = canDo('collections', 'create');
  const todayLaPaz = getLaPazTodayIso();

  const [activeTab, setActiveTab] = useState<'collections' | 'credits'>('collections');
  const [searchTerm, setSearchTerm] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod>('all');
  const [monthFilter, setMonthFilter] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal Registrar Cobro (Modelo C)
  const [isCollectOpen, setIsCollectOpen] = useState(false);
  const [selectedChargeId, setSelectedChargeId] = useState('');
  const [effectiveAtInput, setEffectiveAtInput] = useState(getLaPazDateTimeLocalInput());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [receivedAmountInput, setReceivedAmountInput] = useState('');
  const [appliedAmountInput, setAppliedAmountInput] = useState('');
  const [referenceCode, setReferenceCode] = useState('');
  const [notes, setNotes] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [collectError, setCollectError] = useState<string | null>(null);
  const [isSubmittingCollect, setIsSubmittingCollect] = useState(false);

  // Modal Recibo Correlativo (PNG y PDF)
  const [activeReceipt, setActiveReceipt] = useState<RentReceipt | null>(null);

  // Modal Reversión Auditada (RF-037)
  const [reverseTargetId, setReverseTargetId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [isSubmittingReverse, setIsSubmittingReverse] = useState(false);

  // Modal Aplicar Crédito por Excedente (§4.6)
  const [creditTarget, setCreditTarget] = useState<TenantCredit | null>(null);
  const [creditChargeId, setCreditChargeId] = useState('');
  const [creditApplyAmount, setCreditApplyAmount] = useState('');
  const [creditApplyNotes, setCreditApplyNotes] = useState('');
  const [creditError, setCreditError] = useState<string | null>(null);
  const [isSubmittingCredit, setIsSubmittingCredit] = useState(false);

  // Obligaciones pendientes cobrables
  const collectibleCharges = useMemo(() => {
    return receivables
      .map((r) => {
        const derived = deriveReceivableState(r, todayLaPaz);
        const prop = properties.find((p) => p.id === r.propertyId);
        const unit = units.find((u) => u.id === r.unitId);
        const renter = people.find((pe) => pe.id === r.tenantPersonId);
        const ctr = contracts.find((c) => c.id === r.contractId);
        return {
          charge: r,
          ...derived,
          propertyName: prop?.name ?? 'Casa',
          unitLabel: unit ? `${unit.code} · ${unit.name}` : 'Unidad',
          renterName: renter?.fullName ?? 'Inquilino',
          contractCode: ctr?.contractCode ?? 'CTR',
        };
      })
      .filter(
        (item) =>
          item.charge.status !== 'voided' &&
          item.balance > 0 &&
          canDo('collections', 'create', item.charge.propertyId)
      )
      .sort((a, b) => a.charge.dueDate.localeCompare(b.charge.dueDate));
  }, [canDo, contracts, people, properties, receivables, todayLaPaz, units]);

  const openCollectionModal = (preselectedChargeId?: string) => {
    const chosen =
      collectibleCharges.find((c) => c.charge.id === preselectedChargeId) ??
      collectibleCharges[0];
    setSelectedChargeId(chosen?.charge.id ?? '');
    setEffectiveAtInput(getLaPazDateTimeLocalInput());
    setPaymentMethod('cash');
    setReceivedAmountInput(chosen ? chosen.balance.toFixed(2) : '');
    setAppliedAmountInput(chosen ? chosen.balance.toFixed(2) : '');
    setReferenceCode('');
    setNotes('');
    setIdempotencyKey(crypto.randomUUID());
    setCollectError(null);
    setIsCollectOpen(true);
  };

  useEffect(() => {
    if (!initialChargeId) return;
    if (collectibleCharges.some((c) => c.charge.id === initialChargeId)) {
      openCollectionModal(initialChargeId);
    }
    onConsumeInitialCharge?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChargeId]);

  const selectedChargeItem = useMemo(
    () => collectibleCharges.find((c) => c.charge.id === selectedChargeId) ?? null,
    [collectibleCharges, selectedChargeId]
  );

  const liveCollectionPreview = useMemo(() => {
    if (!selectedChargeItem) return null;
    const rec = Number(receivedAmountInput);
    const app = Number(appliedAmountInput);
    return validateCollectionInput({
      charge: selectedChargeItem.charge,
      receivedAmount: rec,
      appliedAmount: app,
      effectiveAt: toBoliviaIsoTimestamp(effectiveAtInput),
    });
  }, [appliedAmountInput, effectiveAtInput, receivedAmountInput, selectedChargeItem]);

  const summary = useMemo(() => summarizeCollectionsByCurrency(payments), [payments]);

  const activeCredits = useMemo(
    () => credits.filter((c) => c.remainingAmount > 0),
    [credits]
  );

  const enrichedPayments = useMemo(() => {
    return payments
      .map((p) => {
        const prop = properties.find((pr) => pr.id === p.propertyId);
        const unit = units.find((u) => u.id === p.unitId);
        const renter = people.find((pe) => pe.id === p.tenantPersonId);
        const receipt = getReceiptForPayment(p.id);
        return {
          payment: p,
          propertyName: prop?.name ?? 'Casa',
          unitLabel: unit ? `${unit.code} · ${unit.name}` : 'Unidad',
          renterName: renter?.fullName ?? 'Inquilino',
          receipt,
        };
      })
      .sort((a, b) => b.payment.effectiveAt.localeCompare(a.payment.effectiveAt));
  }, [getReceiptForPayment, payments, people, properties, units]);

  const filteredPayments = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return enrichedPayments.filter((item) => {
      if (propertyFilter !== 'all' && item.payment.propertyId !== propertyFilter) return false;
      if (methodFilter !== 'all' && item.payment.paymentMethod !== methodFilter) return false;
      if (monthFilter) {
        const laPazMonth = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/La_Paz',
          year: 'numeric',
          month: '2-digit',
        }).format(new Date(item.payment.effectiveAt));
        if (!laPazMonth.startsWith(monthFilter)) return false;
      }
      if (!q) return true;
      return (
        item.renterName.toLowerCase().includes(q) ||
        item.propertyName.toLowerCase().includes(q) ||
        item.payment.collectedByName.toLowerCase().includes(q) ||
        item.payment.referenceCode.toLowerCase().includes(q) ||
        (item.receipt?.receiptNumber.toLowerCase().includes(q) ?? false)
      );
    });
  }, [enrichedPayments, methodFilter, monthFilter, propertyFilter, searchTerm]);

  const handleChargeSelectionChange = (nextChargeId: string) => {
    setSelectedChargeId(nextChargeId);
    const chosen = collectibleCharges.find((c) => c.charge.id === nextChargeId);
    if (chosen) {
      setReceivedAmountInput(chosen.balance.toFixed(2));
      setAppliedAmountInput(chosen.balance.toFixed(2));
    }
    setCollectError(null);
  };

  const handleConfirmCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChargeItem || isSubmittingCollect) return;
    setCollectError(null);
    setIsSubmittingCollect(true);

    const res = await confirmPayment({
      receivableChargeId: selectedChargeItem.charge.id,
      effectiveAt: toBoliviaIsoTimestamp(effectiveAtInput),
      receivedAmount: Number(receivedAmountInput),
      appliedAmount: Number(appliedAmountInput),
      paymentMethod,
      referenceCode,
      notes,
      idempotencyKey,
    });

    setIsSubmittingCollect(false);
    if (!res.ok || !res.data) {
      setCollectError(res.error ?? 'No se pudo confirmar el cobro.');
      return;
    }

    setIsCollectOpen(false);
    setFeedback({
      type: 'success',
      text: `Cobro confirmado y recibo correlativo ${res.data.receipt.receiptNumber} emitido correctamente.`,
    });
    setActiveReceipt(res.data.receipt);
  };

  const handleReverseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseTargetId || isSubmittingReverse) return;
    setReverseError(null);
    setIsSubmittingReverse(true);

    const res = await reversePayment({
      paymentId: reverseTargetId,
      reason: reverseReason,
    });

    setIsSubmittingReverse(false);
    if (!res.ok) {
      setReverseError(res.error ?? 'No se pudo revertir el cobro.');
      return;
    }

    setReverseTargetId(null);
    setReverseReason('');
    setFeedback({
      type: 'success',
      text: 'Cobro revertido mediante asiento compensatorio auditado. El recibo asociado fue marcado como anulado por reversión.',
    });
  };

  const eligibleChargesForCredit = useMemo(() => {
    if (!creditTarget) return [];
    return collectibleCharges.filter(
      (item) =>
        item.charge.tenantPersonId === creditTarget.tenantPersonId &&
        item.charge.currency === creditTarget.currency
    );
  }, [collectibleCharges, creditTarget]);

  const openCreditApplyModal = (credit: TenantCredit) => {
    const firstEligible = collectibleCharges.find(
      (item) =>
        item.charge.tenantPersonId === credit.tenantPersonId &&
        item.charge.currency === credit.currency
    );
    setCreditTarget(credit);
    setCreditChargeId(firstEligible?.charge.id ?? '');
    if (firstEligible) {
      const suggested = Math.min(credit.remainingAmount, firstEligible.balance);
      setCreditApplyAmount(roundCurrency2(suggested).toFixed(2));
    } else {
      setCreditApplyAmount('');
    }
    setCreditApplyNotes('');
    setCreditError(null);
  };

  const handleApplyCreditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditTarget || !creditChargeId || isSubmittingCredit) return;
    setCreditError(null);
    setIsSubmittingCredit(true);

    const res = await applyCredit({
      creditId: creditTarget.id,
      receivableChargeId: creditChargeId,
      amount: Number(creditApplyAmount),
      notes: creditApplyNotes,
    });

    setIsSubmittingCredit(false);
    if (!res.ok) {
      setCreditError(res.error ?? 'No se pudo aplicar el crédito.');
      return;
    }

    setCreditTarget(null);
    setFeedback({
      type: 'success',
      text: 'Crédito por excedente aplicado manualmente sobre la cuenta por cobrar seleccionada.',
    });
  };

  const pendingCreditTotals = useMemo(() => {
    let bob = 0;
    let usd = 0;
    for (const c of activeCredits) {
      if (c.currency === 'BOB') bob = roundCurrency2(bob + c.remainingAmount);
      else usd = roundCurrency2(usd + c.remainingAmount);
    }
    return { bob, usd };
  }, [activeCredits]);

  return (
    <div className="space-y-6">
      {/* Encabezado Modelo C */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Modelo C · Cobros inmutables, pagos parciales y recibos correlativos PNG / PDF (RF-033 a RF-037)
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Cobros y Recibos
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Espacio activo: <strong className="font-semibold text-slate-900 dark:text-slate-100">{activeTenant?.name}</strong>
            {' · '}
            Zona horaria: <span className="font-mono-tabular text-xs">America/La_Paz</span>
          </p>
        </div>

        {canCreateGlobal ? (
          <button
            type="button"
            onClick={() => openCollectionModal()}
            disabled={collectibleCharges.length === 0}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Registrar cobro</span>
          </button>
        ) : (
          <div className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <Lock className="h-3.5 w-3.5" />
            <span>Consulta en solo lectura</span>
          </div>
        )}
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs font-medium ${
            feedback.type === 'error'
              ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Cerrar notificación"
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Resumen financiero separado BOB / USD (DEC-01) */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Cobrado confirmado en Bolivianos (BOB)</p>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
            {formatCurrencyAmount(summary.BOB.confirmedTotalReceived, 'BOB')}
          </p>
          <p className="mt-1 font-mono-tabular text-xs text-slate-600 dark:text-slate-400">
            {summary.BOB.confirmedCount} cobro(s) válido(s) · {summary.BOB.reversedCount} revertido(s)
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Cobrado confirmado en Dólares (USD)</p>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
            {formatCurrencyAmount(summary.USD.confirmedTotalReceived, 'USD')}
          </p>
          <p className="mt-1 font-mono-tabular text-xs text-slate-600 dark:text-slate-400">
            {summary.USD.confirmedCount} cobro(s) válido(s) · {summary.USD.reversedCount} revertido(s)
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Recibos y créditos por excedente</p>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
            {receipts.length} recibo(s)
          </p>
          <p className="mt-1 font-mono-tabular text-xs text-slate-600 dark:text-slate-400">
            Crédito separado: {formatCurrencyAmount(pendingCreditTotals.bob, 'BOB')} · {formatCurrencyAmount(pendingCreditTotals.usd, 'USD')}
          </p>
        </div>
      </section>

      {/* Sub-navegación Cobros vs Créditos por Excedente (§4.6) */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="tablist"
          aria-label="Secciones del módulo de cobros"
          className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900 self-start"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'collections'}
            onClick={() => setActiveTab('collections')}
            className={`min-h-8 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'collections'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            Historial de Cobros y Recibos ({payments.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'credits'}
            onClick={() => setActiveTab('credits')}
            className={`min-h-8 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'credits'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            Créditos por Excedente ({activeCredits.length})
          </button>
        </div>

        {activeTab === 'collections' && (
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[200px] flex-1 sm:flex-initial">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                aria-label="Buscar cobro o recibo"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Recibo, inquilino o cobrador..."
                className="w-full min-h-10 rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            <select
              aria-label="Filtrar cobros por casa"
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">Todas las casas</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por método de pago"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as 'all' | PaymentMethod)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">Todos los métodos</option>
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>

            <input
              type="month"
              aria-label="Filtrar por mes de cobro"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        )}
      </div>

      {/* Tabla principal de Cobros y Recibos */}
      {activeTab === 'collections' ? (
        filteredPayments.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
            <Receipt className="mx-auto h-7 w-7 text-slate-400" />
            <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              No hay cobros registrados en esta vista
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {collectibleCharges.length > 0
                ? 'Tienes cuentas por cobrar pendientes. Usa "Registrar cobro" para recibir pagos y emitir recibos correlativos.'
                : 'Genera primero una cuenta por cobrar activa en el módulo Cuentas por Cobrar.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Comprobante</th>
                    <th className="px-4 py-3 font-medium">Fecha y hora (BO)</th>
                    <th className="px-4 py-3 font-medium">Inquilino y Casa</th>
                    <th className="px-4 py-3 font-medium">Método / Cobrador</th>
                    <th className="px-4 py-3 font-medium text-right">Recibido</th>
                    <th className="px-4 py-3 font-medium text-right">Aplicado</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredPayments.map(({ payment, propertyName, unitLabel, renterName, receipt }) => {
                    const isReversal = payment.entryKind === 'reversal';
                    const canReverseThis =
                      !isReversal &&
                      payment.status === 'confirmed' &&
                      canDo('collections', 'reverse', payment.propertyId);

                    return (
                      <tr
                        key={payment.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          {isReversal ? (
                            <span className="font-mono-tabular font-semibold text-red-700 dark:text-red-400">
                              Reversión
                            </span>
                          ) : (
                            <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                              {receipt?.receiptNumber ?? 'Pendiente'}
                            </span>
                          )}
                          {payment.referenceCode && (
                            <div className="mt-0.5 font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                              Ref: {payment.referenceCode}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatBoliviaDateTime(payment.effectiveAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {renterName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {propertyName} · {unitLabel}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                          <div>{PAYMENT_METHOD_LABELS[payment.paymentMethod]}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Por: {payment.collectedByName}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {isReversal ? '− ' : ''}
                          {formatCurrencyAmount(payment.receivedAmount, payment.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular whitespace-nowrap">
                          <div className="text-slate-700 dark:text-slate-300">
                            {formatCurrencyAmount(payment.appliedAmount, payment.currency)}
                          </div>
                          {payment.creditAmount > 0 && (
                            <div className="text-[11px] text-sky-700 dark:text-sky-400">
                              +{formatCurrencyAmount(payment.creditAmount, payment.currency)} crédito
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isReversal ? (
                            <span className="font-semibold text-red-700 dark:text-red-400">
                              Asiento de reversión
                            </span>
                          ) : (
                            <span
                              className={`font-semibold ${
                                payment.status === 'confirmed'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-red-700 dark:text-red-400'
                              }`}
                            >
                              {PAYMENT_STATUS_LABELS[payment.status]}
                            </span>
                          )}
                          {payment.reversalReason && (
                            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                              {payment.reversalReason}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            {receipt && (
                              <button
                                type="button"
                                onClick={() => setActiveReceipt(receipt)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Download className="h-3 w-3" />
                                <span>Recibo</span>
                              </button>
                            )}
                            {canReverseThis && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReverseTargetId(payment.id);
                                  setReverseReason('');
                                  setReverseError(null);
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>Revertir</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        /* Sección de Créditos por Excedente (§4.6) */
        credits.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
            <Coins className="mx-auto h-7 w-7 text-slate-400" />
            <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              No existen créditos por excedente registrados
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Cuando un inquilino entrega un importe mayor al saldo de una obligación, el excedente queda separado aquí sin aplicarse automáticamente (§4.6).
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Inquilino</th>
                    <th className="px-4 py-3 font-medium">Fecha registro</th>
                    <th className="px-4 py-3 font-medium">Notas</th>
                    <th className="px-4 py-3 font-medium text-right">Original</th>
                    <th className="px-4 py-3 font-medium text-right">Saldo disponible</th>
                    <th className="px-4 py-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {credits.map((c) => {
                    const renterName =
                      people.find((p) => p.id === c.tenantPersonId)?.fullName ?? 'Inquilino';
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                          {renterName}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-slate-600 dark:text-slate-400">
                          {formatBoliviaDateTime(c.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {c.notes}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                          {formatCurrencyAmount(c.originalAmount, c.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                          {formatCurrencyAmount(c.remainingAmount, c.currency)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {c.remainingAmount > 0 && canCreateGlobal ? (
                            <button
                              type="button"
                              onClick={() => openCreditApplyModal(c)}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                            >
                              <span>Aplicar manualmente</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">
                              {c.remainingAmount === 0 ? 'Saldado / Anulado' : 'Solo lectura'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Modal Registrar Cobro (Modelo C) */}
      {isCollectOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="collect-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="collect-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Registrar cobro de alquiler (Modelo C)
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Emite recibo correlativo automático en la misma transacción. Los registros confirmados no se editan; en caso de error se revierten.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCollectOpen(false)}
                aria-label="Cerrar modal de cobro"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmCollection} className="mt-5 space-y-4">
              <div>
                <label htmlFor="col-charge" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  1. Cuenta por cobrar pendiente
                </label>
                <select
                  id="col-charge"
                  value={selectedChargeId}
                  onChange={(e) => handleChargeSelectionChange(e.target.value)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {collectibleCharges.map((item) => (
                    <option key={item.charge.id} value={item.charge.id}>
                      {item.renterName} · {item.propertyName} ({item.unitLabel}) · {item.charge.periodStart}→{item.charge.periodEnd} · Saldo:{' '}
                      {formatCurrencyAmount(item.balance, item.charge.currency)}
                    </option>
                  ))}
                </select>
              </div>

              {selectedChargeItem && (
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] font-mono-tabular dark:border-slate-800 dark:bg-slate-950">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Inquilino:</span>{' '}
                    <strong className="text-slate-900 dark:text-slate-100">{selectedChargeItem.renterName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Vencimiento:</span>{' '}
                    <strong className="text-slate-900 dark:text-slate-100">{selectedChargeItem.charge.dueDate}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Importe emitido:</span>{' '}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {formatCurrencyAmount(selectedChargeItem.charge.amount, selectedChargeItem.charge.currency)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Saldo pendiente:</span>{' '}
                    <strong className="text-emerald-700 dark:text-emerald-400">
                      {formatCurrencyAmount(selectedChargeItem.balance, selectedChargeItem.charge.currency)}
                    </strong>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="col-datetime" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Fecha y hora efectiva (Bolivia)
                  </label>
                  <input
                    id="col-datetime"
                    type="datetime-local"
                    value={effectiveAtInput}
                    onChange={(e) => setEffectiveAtInput(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label htmlFor="col-method" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Método de pago
                  </label>
                  <select
                    id="col-method"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="col-received" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Importe recibido ({selectedChargeItem?.charge.currency ?? 'BOB'})
                  </label>
                  <input
                    id="col-received"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={receivedAmountInput}
                    onChange={(e) => setReceivedAmountInput(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="col-applied" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Monto aplicado a esta cuenta
                    </label>
                    {selectedChargeItem && (
                      <button
                        type="button"
                        onClick={() => setAppliedAmountInput(selectedChargeItem.balance.toFixed(2))}
                        className="text-[11px] font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                      >
                        Aplicar saldo ({selectedChargeItem.balance.toFixed(2)})
                      </button>
                    )}
                  </div>
                  <input
                    id="col-applied"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={appliedAmountInput}
                    onChange={(e) => setAppliedAmountInput(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              {selectedChargeItem && liveCollectionPreview && (
                <div
                  className={`rounded-lg border p-3 text-xs ${
                    liveCollectionPreview.valid
                      ? 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950'
                      : 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300'
                  }`}
                >
                  {liveCollectionPreview.valid ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between font-mono-tabular">
                        <span className="text-slate-600 dark:text-slate-400">Saldo resultante de la obligación:</span>
                        <strong className="text-slate-900 dark:text-slate-100">
                          {formatCurrencyAmount(
                            liveCollectionPreview.remainingAfter,
                            selectedChargeItem.charge.currency
                          )}{' '}
                          ({liveCollectionPreview.isPartial ? 'Parcialmente pagada' : 'Pagada total'})
                        </strong>
                      </div>
                      {liveCollectionPreview.creditExcess > 0 && (
                        <p className="text-[11px] font-medium text-sky-700 dark:text-sky-400">
                          Excedente de{' '}
                          {formatCurrencyAmount(
                            liveCollectionPreview.creditExcess,
                            selectedChargeItem.charge.currency
                          )}
                          : se registrará como crédito separado pendiente de autorización manual (§4.6).
                        </p>
                      )}
                    </div>
                  ) : (
                    <span>{liveCollectionPreview.error}</span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="col-collector" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Quién cobró / registró
                  </label>
                  <input
                    id="col-collector"
                    type="text"
                    readOnly
                    value={currentUser?.fullName ?? 'Operador'}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                  />
                </div>
                <div>
                  <label htmlFor="col-ref" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Nro. referencia / comprobante banco (Opcional)
                  </label>
                  <input
                    id="col-ref"
                    type="text"
                    value={referenceCode}
                    onChange={(e) => setReferenceCode(e.target.value)}
                    placeholder="Ej. TRF-84920"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="col-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Observación para el recibo (Opcional)
                </label>
                <input
                  id="col-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej. Pago puntual en oficina / abono parcial acordado..."
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {collectError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {collectError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCollectOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!liveCollectionPreview?.valid || isSubmittingCollect}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{isSubmittingCollect ? 'Confirmando...' : 'Confirmar cobro y emitir recibo'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Vista Previa y Descarga de Recibo PNG / PDF (RF-036 / DEC-12) */}
      {activeReceipt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="receipt-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <p className="font-mono-tabular text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  {activeReceipt.receiptNumber} ·{' '}
                  {activeReceipt.status === 'voided_by_reversal' ? 'ANULADO POR REVERSIÓN' : 'EMITIDO VÁLIDO'}
                </p>
                <h2 id="receipt-modal-title" className="mt-0.5 text-base font-semibold text-slate-900 dark:text-slate-100">
                  Recibo Correlativo Interno (DEC-12)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveReceipt(null)}
                aria-label="Cerrar recibo"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {activeReceipt.tenantName}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    RECIBO DE COBRO DE ALQUILER
                  </div>
                </div>
                <div className="text-right font-mono-tabular">
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {activeReceipt.receiptNumber}
                  </div>
                  <div
                    className={`text-[11px] font-semibold ${
                      activeReceipt.status === 'voided_by_reversal'
                        ? 'text-red-700 dark:text-red-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {activeReceipt.status === 'voided_by_reversal' ? 'Anulado por reversión' : 'Válido'}
                  </div>
                </div>
              </div>

              <div className="my-4 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Importe recibido ({activeReceipt.currency})
                </div>
                <div className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
                  {formatCurrencyAmount(activeReceipt.amount, activeReceipt.currency)}
                </div>
              </div>

              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Fecha y hora (BO):</dt>
                  <dd className="font-mono-tabular font-medium text-slate-900 dark:text-slate-100 text-right">
                    {formatBoliviaDateTime(activeReceipt.issuedAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Inquilino:</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100 text-right">
                    {activeReceipt.tenantPersonName}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Casa / Unidad:</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100 text-right">
                    {activeReceipt.propertyName} · {activeReceipt.unitName}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Concepto:</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100 text-right">
                    {activeReceipt.conceptPeriod}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Método:</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100 text-right">
                    {PAYMENT_METHOD_LABELS[activeReceipt.paymentMethod]}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Cobrado por:</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100 text-right">
                    {activeReceipt.collectedByName}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Observación:</dt>
                  <dd className="text-slate-700 dark:text-slate-300 text-right">
                    {activeReceipt.notes || 'Sin observaciones'}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 border-t border-slate-200 pt-3 text-center text-[11px] font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-400">
                {activeReceipt.nonFiscalLegend}
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => downloadReceiptAsPng(activeReceipt)}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <FileImage className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span>Descargar Imagen PNG</span>
              </button>
              <button
                type="button"
                onClick={() => downloadReceiptAsPdf(activeReceipt)}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <FileText className="h-4 w-4" />
                <span>Descargar PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Reversión Compensatoria Auditada (RF-037) */}
      {reverseTargetId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reverse-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="reverse-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Revertir cobro confirmado (RF-037)
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  El cobro original nunca se elimina. Se creará un asiento de reversión, se recalculará el saldo pendiente de la CxC y el recibo quedará marcado como anulado por reversión.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReverseTargetId(null)}
                aria-label="Cerrar modal de reversión"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleReverseSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="rev-reason" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Motivo obligatorio de reversión
                </label>
                <textarea
                  id="rev-reason"
                  rows={2}
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="Ej. Transferencia rechazada o cobro aplicado a unidad incorrecta..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {reverseError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {reverseError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReverseTargetId(null)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReverse}
                  className="min-h-10 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {isSubmittingReverse ? 'Revirtiendo...' : 'Confirmar reversión'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Aplicar Crédito por Excedente (§4.6 / DEC-01) */}
      {creditTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="credit-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="credit-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Aplicar crédito por excedente (§4.6)
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Disponible: <strong className="font-mono-tabular">{formatCurrencyAmount(creditTarget.remainingAmount, creditTarget.currency)}</strong>. Solo aplicable al mismo inquilino y moneda ({creditTarget.currency}).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreditTarget(null)}
                aria-label="Cerrar modal de aplicación de crédito"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleApplyCreditSubmit} className="mt-5 space-y-4">
              {eligibleChargesForCredit.length === 0 ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                  Este inquilino no tiene cuentas por cobrar pendientes en {creditTarget.currency}. El crédito permanecerá resguardado hasta la próxima obligación.
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="cred-charge" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Cuenta por cobrar destino ({creditTarget.currency})
                    </label>
                    <select
                      id="cred-charge"
                      value={creditChargeId}
                      onChange={(e) => {
                        setCreditChargeId(e.target.value);
                        const ch = eligibleChargesForCredit.find((x) => x.charge.id === e.target.value);
                        if (ch) {
                          setCreditApplyAmount(
                            roundCurrency2(Math.min(creditTarget.remainingAmount, ch.balance)).toFixed(2)
                          );
                        }
                      }}
                      className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      {eligibleChargesForCredit.map((item) => (
                        <option key={item.charge.id} value={item.charge.id}>
                          {item.propertyName} ({item.unitLabel}) · {item.charge.periodStart}→{item.charge.periodEnd} · Saldo:{' '}
                          {formatCurrencyAmount(item.balance, item.charge.currency)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="cred-amt" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Monto a aplicar ({creditTarget.currency})
                    </label>
                    <input
                      id="cred-amt"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={creditApplyAmount}
                      onChange={(e) => setCreditApplyAmount(e.target.value)}
                      className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label htmlFor="cred-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Observación de aplicación
                    </label>
                    <input
                      id="cred-notes"
                      type="text"
                      value={creditApplyNotes}
                      onChange={(e) => setCreditApplyNotes(e.target.value)}
                      placeholder="Ej. Aplicación autorizada sobre mensualidad actual"
                      className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                </>
              )}

              {creditError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {creditError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreditTarget(null)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cerrar
                </button>
                {eligibleChargesForCredit.length > 0 && (
                  <button
                    type="submit"
                    disabled={isSubmittingCredit}
                    className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {isSubmittingCredit ? 'Aplicando...' : 'Aplicar crédito'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
