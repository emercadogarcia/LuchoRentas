/**
 * Archivo: src/pages/ReceivablesPage.tsx
 * Responsabilidad: Módulo de Operación Financiera (Modelo C) para Cuentas por Cobrar:
 *   corte automático diario idempotente (sin retroactividad automática, DEC-06),
 *   generación manual controlada con vista previa de prorrateo (DEC-05 / CA-031),
 *   consulta de saldos derivados separados en BOB/USD (DEC-01), morosidad informativa
 *   sin multas/intereses (DEC-04) y anulación auditada con motivo (§4.5).
 * Cumplimiento LuchoRentas.md: RF-030 a RF-032 (CA-030 a CA-032), §4.5, DEC-01, DEC-04, DEC-05, DEC-06.
 */
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CalendarCheck,
  ClipboardList,
  Lock,
  Plus,
  Receipt,
  Search,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePhase2 } from '../lib/phase2Store';
import {
  computeContractPeriod,
  deriveReceivableState,
  findPeriodIndexCoveringDate,
  getLaPazTodayIso,
  resolveContractVersionForDate,
  summarizeReceivablesByCurrency,
} from '../lib/phase3Domain';
import { usePhase3 } from '../lib/phase3Store';
import { formatCurrencyAmount } from '../lib/rbac';
import {
  RECEIVABLE_STATUS_LABELS,
  type ReceivableEffectiveStatus,
} from '../types/domain';

export function ReceivablesPage({
  onCollectCharge,
}: {
  onCollectCharge?: (chargeId: string) => void;
}) {
  const { activeTenant, canDo } = useAuth();
  const { properties, units, people } = usePhase2();
  const { contracts, versions, receivables, generateReceivables, voidReceivable } = usePhase3();

  const canGenerate = canDo('receivables', 'generate');
  const todayLaPaz = getLaPazTodayIso();

  const [searchTerm, setSearchTerm] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ReceivableEffectiveStatus>('all');
  const [monthFilter, setMonthFilter] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal Generación Manual Controlada (RF-031)
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [manualContractId, setManualContractId] = useState('');
  const [manualPeriodIndex, setManualPeriodIndex] = useState(0);
  const [manualReason, setManualReason] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  // Modal Corte Diario Automático Idempotente (RF-030)
  const [isAutoOpen, setIsAutoOpen] = useState(false);
  const [autoRefDate, setAutoRefDate] = useState(todayLaPaz);
  const [autoError, setAutoError] = useState<string | null>(null);

  // Modal Anular Obligación (§4.5)
  const [voidTargetId, setVoidTargetId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);

  const summary = useMemo(
    () => summarizeReceivablesByCurrency(receivables, todayLaPaz),
    [receivables, todayLaPaz]
  );

  const enrichedReceivables = useMemo(() => {
    return receivables.map((r) => {
      const derived = deriveReceivableState(r, todayLaPaz);
      const prop = properties.find((p) => p.id === r.propertyId);
      const unit = units.find((u) => u.id === r.unitId);
      const renter = people.find((pe) => pe.id === r.tenantPersonId);
      const ctr = contracts.find((c) => c.id === r.contractId);
      return {
        ...r,
        ...derived,
        propertyName: prop?.name ?? 'Casa',
        unitLabel: unit ? `${unit.code} · ${unit.name}` : 'Unidad',
        renterName: renter?.fullName ?? 'Inquilino',
        contractCode: ctr?.contractCode ?? 'CTR',
      };
    });
  }, [contracts, people, properties, receivables, todayLaPaz, units]);

  const filteredReceivables = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return enrichedReceivables.filter((item) => {
      if (propertyFilter !== 'all' && item.propertyId !== propertyFilter) return false;
      if (statusFilter !== 'all' && item.effectiveStatus !== statusFilter) return false;
      if (monthFilter && !item.periodStart.startsWith(monthFilter)) return false;
      if (!q) return true;
      return (
        item.renterName.toLowerCase().includes(q) ||
        item.contractCode.toLowerCase().includes(q) ||
        item.propertyName.toLowerCase().includes(q) ||
        item.unitLabel.toLowerCase().includes(q)
      );
    });
  }, [enrichedReceivables, monthFilter, propertyFilter, searchTerm, statusFilter]);

  const billableContracts = useMemo(
    () => contracts.filter((c) => c.status === 'active' || c.status === 'finalized'),
    [contracts]
  );

  const manualSelectedContract = useMemo(
    () => billableContracts.find((c) => c.id === manualContractId) ?? billableContracts[0] ?? null,
    [billableContracts, manualContractId]
  );

  const manualPreview = useMemo(() => {
    if (!manualSelectedContract) return null;
    const base = computeContractPeriod({
      firstPeriodStartDate: manualSelectedContract.firstPeriodStartDate,
      anchorDay: manualSelectedContract.anchorDay,
      periodIndex: manualPeriodIndex,
      contractEndDate: manualSelectedContract.endDate,
      monthlyAmount: manualSelectedContract.monthlyAmount,
      currency: manualSelectedContract.currency,
    });
    if (!base) return null;
    const ver = resolveContractVersionForDate(
      versions,
      manualSelectedContract.id,
      base.nominalStart,
      manualSelectedContract.monthlyAmount,
      manualSelectedContract.currency
    );
    const computed = computeContractPeriod({
      firstPeriodStartDate: manualSelectedContract.firstPeriodStartDate,
      anchorDay: manualSelectedContract.anchorDay,
      periodIndex: manualPeriodIndex,
      contractEndDate: manualSelectedContract.endDate,
      monthlyAmount: ver.monthlyAmount,
      currency: ver.currency,
      versionId: ver.versionId,
    });
    if (!computed) return null;
    const alreadyExists = receivables.some(
      (r) =>
        r.contractId === manualSelectedContract.id && r.periodStart === computed.effectiveStart
    );
    const isPastRegularization = computed.effectiveEnd < todayLaPaz;
    return { computed, alreadyExists, isPastRegularization };
  }, [manualPeriodIndex, manualSelectedContract, receivables, todayLaPaz, versions]);

  const autoEligiblePreview = useMemo(() => {
    const active = contracts.filter((c) => c.status === 'active');
    return active
      .map((ctr) => {
        const idx = findPeriodIndexCoveringDate(
          ctr.firstPeriodStartDate,
          ctr.anchorDay,
          autoRefDate,
          ctr.endDate
        );
        if (idx === null) return null;
        const period = computeContractPeriod({
          firstPeriodStartDate: ctr.firstPeriodStartDate,
          anchorDay: ctr.anchorDay,
          periodIndex: idx,
          contractEndDate: ctr.endDate,
          monthlyAmount: ctr.monthlyAmount,
          currency: ctr.currency,
        });
        if (!period) return null;
        const alreadyGenerated = receivables.some(
          (r) => r.contractId === ctr.id && r.periodStart === period.effectiveStart
        );
        const renter = people.find((p) => p.id === ctr.tenantPersonId)?.fullName ?? 'Inquilino';
        return { ctr, period, alreadyGenerated, renter };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [autoRefDate, contracts, people, receivables]);

  const openManualModal = () => {
    setManualContractId(billableContracts[0]?.id ?? '');
    setManualPeriodIndex(0);
    setManualReason('');
    setManualError(null);
    setIsManualOpen(true);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSelectedContract) return;
    setManualError(null);

    const res = await generateReceivables({
      mode: 'manual_period',
      contractId: manualSelectedContract.id,
      periodIndex: manualPeriodIndex,
      referenceDate: todayLaPaz,
      regularizationReason: manualReason,
    });

    if (!res.ok) {
      setManualError(res.error ?? 'No se pudo emitir la cuenta por cobrar.');
      return;
    }

    setIsManualOpen(false);
    setFeedback({
      type: 'success',
      text: `Cuenta por cobrar generada para ${manualSelectedContract.contractCode} (período P${manualPeriodIndex + 1}).`,
    });
  };

  const handleAutoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAutoError(null);

    const res = await generateReceivables({
      mode: 'automatic_daily',
      referenceDate: autoRefDate,
    });

    if (!res.ok) {
      setAutoError(res.error ?? 'Error al ejecutar el corte diario.');
      return;
    }

    const count = res.data?.generatedCount ?? 0;
    setIsAutoOpen(false);
    setFeedback({
      type: 'success',
      text:
        count > 0
          ? `Corte diario ejecutado (${autoRefDate}): se generaron ${count} obligación(es) nueva(s) sin duplicados.`
          : `Corte diario ejecutado (${autoRefDate}): todas las obligaciones elegibles ya estaban emitidas (idempotencia verificada).`,
    });
  };

  const handleVoidSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTargetId) return;
    setVoidError(null);

    const res = await voidReceivable(voidTargetId, voidReason);
    if (!res.ok) {
      setVoidError(res.error ?? 'No se pudo anular la obligación.');
      return;
    }

    setVoidTargetId(null);
    setVoidReason('');
    setFeedback({
      type: 'success',
      text: 'Obligación anulada con motivo auditado. El registro histórico permanece intacto.',
    });
  };

  return (
    <div className="space-y-6">
      {/* Encabezado Modelo C */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Modelo C · Generación idempotente, saldos derivados y mora informativa (DEC-04 / DEC-06)
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Cuentas por Cobrar
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Espacio activo: <strong className="font-semibold text-slate-900 dark:text-slate-100">{activeTenant?.name}</strong>
            {' · '}
            Fecha Bolivia: <span className="font-mono-tabular text-xs">{todayLaPaz}</span>
          </p>
        </div>

        {canGenerate ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setAutoRefDate(todayLaPaz);
                setAutoError(null);
                setIsAutoOpen(true);
              }}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <CalendarCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Ejecutar corte diario</span>
            </button>
            <button
              type="button"
              onClick={openManualModal}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Generar período manual</span>
            </button>
          </div>
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

      {/* Resumen separado por moneda BOB / USD (DEC-01) */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Saldo pendiente en Bolivianos (BOB)</p>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
            {formatCurrencyAmount(summary.BOB.totalPendingBalance, 'BOB')}
          </p>
          <p className="mt-1 font-mono-tabular text-xs text-slate-600 dark:text-slate-400">
            Por vencer: {formatCurrencyAmount(summary.BOB.pendingNotOverdue, 'BOB')} · Vencido:{' '}
            <span className={summary.BOB.overdueBalance > 0 ? 'font-semibold text-red-700 dark:text-red-400' : ''}>
              {formatCurrencyAmount(summary.BOB.overdueBalance, 'BOB')}
            </span>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Saldo pendiente en Dólares (USD)</p>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
            {formatCurrencyAmount(summary.USD.totalPendingBalance, 'USD')}
          </p>
          <p className="mt-1 font-mono-tabular text-xs text-slate-600 dark:text-slate-400">
            Por vencer: {formatCurrencyAmount(summary.USD.pendingNotOverdue, 'USD')} · Vencido:{' '}
            <span className={summary.USD.overdueBalance > 0 ? 'font-semibold text-red-700 dark:text-red-400' : ''}>
              {formatCurrencyAmount(summary.USD.overdueBalance, 'USD')}
            </span>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Inquilinos con mora informativa</p>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
            {summary.uniqueDelinquentTenantsCount}
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Mora informativa desde el día siguiente al vencimiento; sin multas ni intereses (DEC-04).
          </p>
        </div>
      </section>

      {/* Filtros de consulta (RF-032) */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              aria-label="Buscar cuenta por cobrar"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar inquilino, contrato o casa..."
              className="w-full min-h-10 rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>

          <select
            aria-label="Filtrar por casa"
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

          <input
            type="month"
            aria-label="Filtrar por mes de inicio de período"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          {monthFilter && (
            <button
              type="button"
              onClick={() => setMonthFilter('')}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              Limpiar mes
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label="Filtrar por estado de cuenta por cobrar"
          className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900"
        >
          {(['all', 'pending', 'overdue', 'partially_paid', 'paid', 'voided'] as const).map(
            (st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`min-h-8 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {st === 'all' ? 'Todas' : RECEIVABLE_STATUS_LABELS[st]}
              </button>
            )
          )}
        </div>
      </div>

      {/* Tabla de Cuentas por Cobrar */}
      {filteredReceivables.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <ClipboardList className="mx-auto h-7 w-7 text-slate-400" />
          <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            No hay cuentas por cobrar registradas
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Activa un contrato mensual y ejecuta el corte diario automático o genera un período manualmente.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Período / Contrato</th>
                  <th className="px-4 py-3 font-medium">Inquilino</th>
                  <th className="px-4 py-3 font-medium">Casa y Unidad</th>
                  <th className="px-4 py-3 font-medium">Vencimiento</th>
                  <th className="px-4 py-3 font-medium text-right">Importe</th>
                  <th className="px-4 py-3 font-medium text-right">Saldo</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredReceivables.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                        {item.periodStart} → {item.periodEnd}
                      </div>
                      <div className="mt-0.5 font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                        {item.contractCode} · {item.coveredDays}/{item.calendarDaysDivisor} días
                        {item.isProrated ? ' (Prorrateo)' : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                      {item.renterName}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <div>{item.propertyName}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {item.unitLabel}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono-tabular">
                      <div className="text-slate-900 dark:text-slate-100">{item.dueDate}</div>
                      {item.daysOverdue > 0 && (
                        <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-red-700 dark:text-red-400">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Mora informativa: {item.daysOverdue} día(s)</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {formatCurrencyAmount(item.amount, item.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {formatCurrencyAmount(item.balance, item.currency)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          item.effectiveStatus === 'paid'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : item.effectiveStatus === 'overdue'
                              ? 'text-red-700 dark:text-red-400'
                              : item.effectiveStatus === 'partially_paid'
                                ? 'text-sky-700 dark:text-sky-400'
                                : item.effectiveStatus === 'voided'
                                  ? 'text-slate-400 line-through dark:text-slate-500'
                                  : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {RECEIVABLE_STATUS_LABELS[item.effectiveStatus]}
                      </span>
                      {item.voidReason && (
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {item.voidReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2">
                        {onCollectCharge &&
                          item.effectiveStatus !== 'voided' &&
                          item.balance > 0 &&
                          canDo('collections', 'create', item.propertyId) && (
                            <button
                              type="button"
                              onClick={() => onCollectCharge(item.id)}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                            >
                              <Receipt className="h-3 w-3" />
                              <span>Cobrar</span>
                            </button>
                          )}
                        {canGenerate &&
                          item.effectiveStatus !== 'voided' &&
                          item.paidAmount === 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setVoidTargetId(item.id);
                                setVoidReason('');
                                setVoidError(null);
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <Ban className="h-3 w-3" />
                              <span>Anular</span>
                            </button>
                          )}
                        {!(
                          (onCollectCharge &&
                            item.effectiveStatus !== 'voided' &&
                            item.balance > 0 &&
                            canDo('collections', 'create', item.propertyId)) ||
                          (canGenerate &&
                            item.effectiveStatus !== 'voided' &&
                            item.paidAmount === 0)
                        ) && (
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Corte Diario Automático Idempotente (RF-030, DEC-06) */}
      {isAutoOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="auto-gen-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="auto-gen-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Ejecutar corte diario automático de CxC (RF-030)
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Proceso idempotente protegido contra duplicados. Evalúa solo el período vigente a la fecha seleccionada, sin generar cargos históricos retroactivos (DEC-06).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAutoOpen(false)}
                aria-label="Cerrar modal de corte diario"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAutoSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="auto-ref-date" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Fecha de corte (America/La_Paz)
                </label>
                <input
                  id="auto-ref-date"
                  type="date"
                  value={autoRefDate}
                  onChange={(e) => setAutoRefDate(e.target.value)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Contratos activos evaluados para el corte ({autoEligiblePreview.length})
                </div>
                {autoEligiblePreview.length === 0 ? (
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    No existen contratos activos cuyo período vigente cubra la fecha {autoRefDate}.
                  </p>
                ) : (
                  <div className="mt-2 space-y-1.5 text-[11px] font-mono-tabular">
                    {autoEligiblePreview.map(({ ctr, period, alreadyGenerated, renter }) => (
                      <div key={ctr.id} className="flex items-center justify-between gap-2">
                        <span className="text-slate-700 dark:text-slate-300 truncate">
                          {ctr.contractCode} ({renter}) · {period.effectiveStart}→{period.effectiveEnd}
                        </span>
                        <span
                          className={`shrink-0 font-semibold ${
                            alreadyGenerated
                              ? 'text-slate-400 dark:text-slate-500'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {alreadyGenerated
                            ? 'Ya emitida'
                            : formatCurrencyAmount(period.calculatedAmount, period.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {autoError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {autoError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAutoOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Confirmar corte diario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Generación Manual Controlada (RF-031 / CA-031) */}
      {isManualOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-gen-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="manual-gen-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Generar cuenta por cobrar manual (RF-031)
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Revisa período, divisor de días y cálculo antes de confirmar. Bloquea períodos ya emitidos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsManualOpen(false)}
                aria-label="Cerrar modal de generación manual"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="man-contract" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Contrato
                </label>
                <select
                  id="man-contract"
                  value={manualSelectedContract?.id ?? ''}
                  onChange={(e) => setManualContractId(e.target.value)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {billableContracts.length === 0 ? (
                    <option value="">No hay contratos activos o finalizados</option>
                  ) : (
                    billableContracts.map((c) => {
                      const renter = people.find((p) => p.id === c.tenantPersonId)?.fullName ?? 'Inquilino';
                      return (
                        <option key={c.id} value={c.id}>
                          {c.contractCode} — {renter} ({formatCurrencyAmount(c.monthlyAmount, c.currency)})
                        </option>
                      );
                    })
                  )}
                </select>
              </div>

              <div>
                <label htmlFor="man-period" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Período mensual (desde inicio de cobro)
                </label>
                <select
                  id="man-period"
                  value={manualPeriodIndex}
                  onChange={(e) => setManualPeriodIndex(Number(e.target.value))}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {Array.from({ length: 12 }, (_, idx) => (
                    <option key={idx} value={idx}>
                      Período #{idx + 1} (índice {idx})
                    </option>
                  ))}
                </select>
              </div>

              {manualPreview ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    Vista previa del cálculo (DEC-05 / DEC-18)
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 font-mono-tabular text-[11px]">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Período:</span>{' '}
                      <strong className="text-slate-900 dark:text-slate-100">
                        {manualPreview.computed.effectiveStart} → {manualPreview.computed.effectiveEnd}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Vencimiento:</span>{' '}
                      <strong className="text-slate-900 dark:text-slate-100">
                        {manualPreview.computed.dueDate}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Divisor / Días:</span>{' '}
                      <strong className="text-slate-900 dark:text-slate-100">
                        {manualPreview.computed.coveredDays} / {manualPreview.computed.calendarDaysDivisor} días
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Importe:</span>{' '}
                      <strong className="text-emerald-700 dark:text-emerald-400">
                        {formatCurrencyAmount(
                          manualPreview.computed.calculatedAmount,
                          manualPreview.computed.currency
                        )}
                      </strong>
                    </div>
                  </div>
                  {manualPreview.alreadyExists && (
                    <p className="mt-2 text-xs font-semibold text-red-700 dark:text-red-400">
                      Este período ya tiene una cuenta por cobrar generada (duplicado bloqueado).
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                  El período seleccionado queda fuera de la vigencia del contrato o no hay contrato seleccionado.
                </div>
              )}

              <div>
                <label htmlFor="man-reason" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Motivo / Observación {manualPreview?.isPastRegularization ? '(Obligatorio por regularización histórica)' : '(Opcional)'}
                </label>
                <input
                  id="man-reason"
                  type="text"
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  placeholder="Ej. Regularización de mes anterior o emisión anticipada..."
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {manualError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {manualError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsManualOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!manualPreview || manualPreview.alreadyExists}
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Confirmar emisión
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Anulación Controlada (§4.5) */}
      {voidTargetId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="void-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="void-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Anular cuenta por cobrar
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  La obligación no se elimina físicamente; queda marcada como anulada con motivo y trazabilidad (§4.5).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVoidTargetId(null)}
                aria-label="Cerrar modal de anulación"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleVoidSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="void-reason" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Motivo obligatorio de anulación
                </label>
                <textarea
                  id="void-reason"
                  rows={2}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="Ej. Error en fecha de corte o acuerdo de condonación..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {voidError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {voidError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVoidTargetId(null)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500"
                >
                  Confirmar anulación
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
