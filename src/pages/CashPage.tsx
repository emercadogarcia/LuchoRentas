/**
 * Archivo: src/pages/CashPage.tsx
 * Responsabilidad: Módulo de Arqueo y Conciliación (Modelo D) para Cajas
 *   independientes por usuario y moneda (BOB / USD), apertura, registro inmutable
 *   de entradas/salidas, movimientos compensatorios vinculados, arqueos con
 *   justificación de diferencias y cierre definitivo sin reapertura.
 * Cumplimiento LuchoRentas.md: §4.8, RF-054, RF-055 (CA-054, CA-055), DEC-01, DEC-07, DEC-08.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Lock,
  Plus,
  Scale,
  SlidersHorizontal,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { computeCashSessionBalances } from '../lib/phase5Domain';
import { usePhase5 } from '../lib/phase5Store';
import { formatBoliviaDateTime, formatCurrencyAmount } from '../lib/rbac';
import {
  CASH_MOVEMENT_SOURCE_LABELS,
  RECONCILIATION_STATUS_LABELS,
  type CashMovementDirection,
  type CurrencyCode,
} from '../types/domain';

export function CashPage() {
  const { activeTenant, currentUser, canDo } = useAuth();
  const {
    cashSessions,
    cashMovements,
    cashReconciliations,
    openCashSession,
    recordCashAdjustment,
    recordCashReconciliation,
    approveCashReconciliation,
    closeCashSession,
  } = usePhase5();

  const canReconcile = canDo('cash', 'reconcile');

  const [currencyFilter, setCurrencyFilter] = useState<CurrencyCode>(
    activeTenant?.defaultCurrency ?? 'BOB'
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal Abrir Caja
  const [isOpenCashModal, setIsOpenCashModal] = useState(false);
  const [openCurrency, setOpenCurrency] = useState<CurrencyCode>(
    activeTenant?.defaultCurrency ?? 'BOB'
  );
  const [openingBalanceInput, setOpeningBalanceInput] = useState('0.00');
  const [openNotes, setOpenNotes] = useState('');
  const [openError, setOpenError] = useState<string | null>(null);

  // Modal Movimiento Compensatorio / Ajuste (§4.8 / DEC-08)
  const [isAdjModal, setIsAdjModal] = useState(false);
  const [adjDirection, setAdjDirection] = useState<CashMovementDirection>('inflow');
  const [adjAmountInput, setAdjAmountInput] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjLinkedMovementId, setAdjLinkedMovementId] = useState<string>('');
  const [adjError, setAdjError] = useState<string | null>(null);

  // Modal Arqueo (RF-055)
  const [isRecModal, setIsRecModal] = useState(false);
  const [countedInput, setCountedInput] = useState('');
  const [diffReason, setDiffReason] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [recError, setRecError] = useState<string | null>(null);

  const sessionsInCurrency = useMemo(
    () =>
      cashSessions
        .filter((s) => s.currency === currencyFilter)
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
          return b.openedAt.localeCompare(a.openedAt);
        }),
    [cashSessions, currencyFilter]
  );

  useEffect(() => {
    if (sessionsInCurrency.length === 0) {
      setSelectedSessionId('');
      return;
    }
    if (!sessionsInCurrency.some((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(sessionsInCurrency[0].id);
    }
  }, [selectedSessionId, sessionsInCurrency]);

  const activeSession = useMemo(
    () => sessionsInCurrency.find((s) => s.id === selectedSessionId) ?? null,
    [selectedSessionId, sessionsInCurrency]
  );

  const sessionMovements = useMemo(() => {
    if (!activeSession) return [];
    return cashMovements
      .filter((m) => m.cashSessionId === activeSession.id)
      .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
  }, [activeSession, cashMovements]);

  const sessionReconciliations = useMemo(() => {
    if (!activeSession) return [];
    return cashReconciliations
      .filter((r) => r.cashSessionId === activeSession.id)
      .sort((a, b) => b.reconciledAt.localeCompare(a.reconciledAt));
  }, [activeSession, cashReconciliations]);

  const sessionBalances = useMemo(() => {
    if (!activeSession) {
      return { openingBalance: 0, totalInflows: 0, totalOutflows: 0, expectedBalance: 0 };
    }
    return computeCashSessionBalances(activeSession, cashMovements);
  }, [activeSession, cashMovements]);

  // Resumen independiente por usuario y moneda (nunca mezcla BOB con USD)
  const userCurrencySummary = useMemo(() => {
    return cashSessions
      .filter((s) => s.currency === currencyFilter)
      .map((s) => {
        const b = computeCashSessionBalances(s, cashMovements);
        return { session: s, ...b };
      });
  }, [cashMovements, cashSessions, currencyFilter]);

  const myOpenSessionInCurrency = useMemo(
    () =>
      cashSessions.find(
        (s) =>
          s.ownerUserId === currentUser?.id &&
          s.currency === currencyFilter &&
          s.status === 'open'
      ) ?? null,
    [cashSessions, currencyFilter, currentUser?.id]
  );

  const handleOpenCashSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOpenError(null);
    const res = await openCashSession({
      currency: openCurrency,
      openingBalance: Number(openingBalanceInput),
      notes: openNotes,
    });
    if (!res.ok || !res.data) {
      setOpenError(res.error ?? 'No se pudo abrir la caja.');
      return;
    }
    setCurrencyFilter(openCurrency);
    setSelectedSessionId(res.data.id);
    setIsOpenCashModal(false);
    setFeedback({
      type: 'success',
      text: `Caja abierta en ${openCurrency} con saldo inicial ${formatCurrencyAmount(res.data.openingBalance, openCurrency)}.`,
    });
  };

  const handleAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myOpenSessionInCurrency && (!activeSession || activeSession.status !== 'open')) return;
    setAdjError(null);

    const targetSessionId =
      activeSession?.status === 'open' ? activeSession.id : myOpenSessionInCurrency!.id;

    const res = await recordCashAdjustment({
      cashSessionId: targetSessionId,
      direction: adjDirection,
      amount: Number(adjAmountInput),
      reason: adjReason,
      linkedMovementId: adjLinkedMovementId || null,
    });
    if (!res.ok) {
      setAdjError(res.error ?? 'No se pudo registrar el movimiento compensatorio.');
      return;
    }
    setIsAdjModal(false);
    setFeedback({
      type: 'success',
      text: 'Movimiento compensatorio registrado de forma inmutable en la caja abierta vigente.',
    });
  };

  const handleRecSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;
    setRecError(null);

    const res = await recordCashReconciliation({
      cashSessionId: activeSession.id,
      countedBalance: Number(countedInput),
      differenceReason: diffReason,
      evidenceNote,
    });
    if (!res.ok || !res.data) {
      setRecError(res.error ?? 'No se pudo registrar el arqueo.');
      return;
    }

    setIsRecModal(false);
    setFeedback({
      type: 'success',
      text:
        res.data.differenceAmount === 0
          ? 'Arqueo cuadrado sin diferencias. La caja está lista para cerrarse cuando lo decidas.'
          : `Arqueo registrado con diferencia de ${formatCurrencyAmount(res.data.differenceAmount, res.data.currency)} pendiente de aprobación antes del cierre.`,
    });
  };

  const handleApproveDiff = async (reconciliationId: string) => {
    const res = await approveCashReconciliation(reconciliationId);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo aprobar la diferencia.' });
      return;
    }
    setFeedback({
      type: 'success',
      text: 'Diferencia de arqueo aprobada y auditada (DEC-08).',
    });
  };

  const handleCloseSession = async () => {
    if (!activeSession) return;
    const res = await closeCashSession(activeSession.id);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo cerrar la caja.' });
      return;
    }
    setFeedback({
      type: 'success',
      text: `Caja en ${activeSession.currency} cerrada definitivamente. No admite nuevos movimientos ni reapertura (§4.8).`,
    });
  };

  const openCompensationForMovement = (movementId: string, originalDirection: CashMovementDirection, amount: number) => {
    if (!myOpenSessionInCurrency && (!activeSession || activeSession.status !== 'open')) {
      setFeedback({
        type: 'error',
        text: `Para compensar un movimiento de una caja cerrada primero debes abrir una caja vigente en ${currencyFilter}.`,
      });
      return;
    }
    setAdjDirection(originalDirection === 'inflow' ? 'outflow' : 'inflow');
    setAdjAmountInput(amount.toFixed(2));
    setAdjLinkedMovementId(movementId);
    setAdjReason('');
    setAdjError(null);
    setIsAdjModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Encabezado Modelo D */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Modelo D · Cajas independientes por usuario y moneda, movimientos inmutables y arqueos (§4.8 / DEC-07)
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Caja y Arqueo
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Espacio activo: <strong className="font-semibold text-slate-900 dark:text-slate-100">{activeTenant?.name}</strong>
            {' · '}
            Monedas separadas sin compensación cruzada (BOB / USD)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Seleccionar moneda de caja"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900"
          >
            {(['BOB', 'USD'] as CurrencyCode[]).map((curr) => (
              <button
                key={curr}
                type="button"
                onClick={() => setCurrencyFilter(curr)}
                className={`min-h-8 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  currencyFilter === curr
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {curr}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpenCurrency(currencyFilter);
              setOpeningBalanceInput('0.00');
              setOpenNotes('');
              setOpenError(null);
              setIsOpenCashModal(true);
            }}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Abrir caja ({currencyFilter})</span>
          </button>
        </div>
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

      {/* Selector de sesión de caja en la moneda activa */}
      {sessionsInCurrency.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <Wallet className="mx-auto h-7 w-7 text-slate-400" />
          <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            No existen cajas registradas en {currencyFilter}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Abre una caja independiente para tu usuario en {currencyFilter} con saldo inicial para vincular cobros, pagos de gastos y arqueos.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-1 flex-col gap-1.5 sm:max-w-md">
              <label htmlFor="cash-session-select" className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Sesión de caja seleccionada ({currencyFilter})
              </label>
              <select
                id="cash-session-select"
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {sessionsInCurrency.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.ownerName} · {s.status === 'open' ? 'ABIERTA' : 'CERRADA'} · Apertura{' '}
                    {formatBoliviaDateTime(s.openedAt)}
                  </option>
                ))}
              </select>
            </div>

            {activeSession && canReconcile && activeSession.status === 'open' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdjDirection('inflow');
                    setAdjAmountInput('');
                    setAdjReason('');
                    setAdjLinkedMovementId('');
                    setAdjError(null);
                    setIsAdjModal(true);
                  }}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>Ajuste compensatorio</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCountedInput(sessionBalances.expectedBalance.toFixed(2));
                    setDiffReason('');
                    setEvidenceNote('');
                    setRecError(null);
                    setIsRecModal(true);
                  }}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-emerald-600 bg-white px-3.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500 dark:bg-slate-950 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                >
                  <Scale className="h-3.5 w-3.5" />
                  <span>Realizar arqueo</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCloseSession()}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>Cerrar caja</span>
                </button>
              </div>
            )}

            {activeSession && activeSession.status === 'closed' && (
              <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                <Lock className="h-3.5 w-3.5" />
                <span>
                  Cerrada definitivamente el {activeSession.closedAt ? formatBoliviaDateTime(activeSession.closedAt) : ''}
                </span>
              </div>
            )}
          </div>

          {/* 4 KPIs del cálculo neto visible (Modelo D) */}
          {activeSession && (
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">Saldo inicial ({currencyFilter})</p>
                <p className="mt-2 font-mono-tabular text-xl font-bold text-slate-900 dark:text-slate-50">
                  {formatCurrencyAmount(sessionBalances.openingBalance, currencyFilter)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">Entradas confirmadas</p>
                <p className="mt-2 font-mono-tabular text-xl font-bold text-emerald-700 dark:text-emerald-400">
                  +{formatCurrencyAmount(sessionBalances.totalInflows, currencyFilter)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">Salidas confirmadas</p>
                <p className="mt-2 font-mono-tabular text-xl font-bold text-red-700 dark:text-red-400">
                  −{formatCurrencyAmount(sessionBalances.totalOutflows, currencyFilter)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">Saldo neto esperado en caja</p>
                <p className="mt-2 font-mono-tabular text-xl font-bold text-slate-900 dark:text-slate-50">
                  {formatCurrencyAmount(sessionBalances.expectedBalance, currencyFilter)}
                </p>
              </div>
            </section>
          )}

          {/* Tabla de Movimientos de Caja (Entradas y Salidas) */}
          <section className="space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Movimientos de la sesión ({sessionMovements.length})
            </h2>
            {sessionMovements.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                Aún no hay entradas ni salidas registradas en esta sesión de caja.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[780px] text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-medium">Fecha y hora (BO)</th>
                        <th className="px-4 py-3 font-medium">Tipo / Origen</th>
                        <th className="px-4 py-3 font-medium">Detalle / Nota</th>
                        <th className="px-4 py-3 font-medium">Operador</th>
                        <th className="px-4 py-3 font-medium text-right">Monto</th>
                        <th className="px-4 py-3 font-medium text-right">Compensación</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {sessionMovements.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-3 font-mono-tabular text-slate-700 dark:text-slate-300">
                            {formatBoliviaDateTime(m.effectiveAt)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1 font-semibold ${
                                m.direction === 'inflow'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-red-700 dark:text-red-400'
                              }`}
                            >
                              {m.direction === 'inflow' ? (
                                <ArrowDownLeft className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              )}
                              <span>{CASH_MOVEMENT_SOURCE_LABELS[m.sourceType]}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                            <div>{m.notes || '—'}</div>
                            {m.linkedMovementId && (
                              <div className="font-mono-tabular text-[11px] text-sky-700 dark:text-sky-400">
                                Vinculado a movimiento previo
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                            {m.createdByName}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono-tabular font-semibold ${
                              m.direction === 'inflow'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-red-700 dark:text-red-400'
                            }`}
                          >
                            {m.direction === 'inflow' ? '+' : '−'}
                            {formatCurrencyAmount(m.amount, m.currency)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {canReconcile ? (
                              <button
                                type="button"
                                onClick={() =>
                                  openCompensationForMovement(m.id, m.direction, m.amount)
                                }
                                className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                Compensar
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* Arqueos y Desglose por Usuario y Moneda */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="space-y-3">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Historial de arqueos de la sesión ({sessionReconciliations.length})
              </h2>
              {sessionReconciliations.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  Aún no se ha registrado ningún arqueo en esta sesión.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                  {sessionReconciliations.map((rec) => (
                    <div key={rec.id} className="p-4 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono-tabular text-slate-600 dark:text-slate-400">
                          {formatBoliviaDateTime(rec.reconciledAt)} · {rec.recordedByName}
                        </span>
                        <span
                          className={`font-semibold ${
                            rec.status === 'balanced' || rec.status === 'approved'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {RECONCILIATION_STATUS_LABELS[rec.status]}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 font-mono-tabular">
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Esperado: </span>
                          <strong>{formatCurrencyAmount(rec.expectedBalance, rec.currency)}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Contado: </span>
                          <strong>{formatCurrencyAmount(rec.countedBalance, rec.currency)}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Diferencia: </span>
                          <strong
                            className={
                              rec.differenceAmount === 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-red-700 dark:text-red-400'
                            }
                          >
                            {formatCurrencyAmount(rec.differenceAmount, rec.currency)}
                          </strong>
                        </div>
                      </div>
                      {rec.differenceReason && (
                        <p className="mt-1.5 text-slate-600 dark:text-slate-300">
                          Motivo: {rec.differenceReason}
                        </p>
                      )}
                      {rec.status === 'pending_approval' && canReconcile && (
                        <button
                          type="button"
                          onClick={() => void handleApproveDiff(rec.id)}
                          className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Aprobar diferencia de arqueo</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Desglose por usuario en {currencyFilter}
              </h2>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Usuario</th>
                      <th className="px-4 py-2.5 font-medium">Estado</th>
                      <th className="px-4 py-2.5 font-medium text-right">Saldo esperado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {userCurrencySummary.map(({ session, expectedBalance }) => (
                      <tr key={session.id}>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {session.ownerName}
                          </div>
                          <div className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                            {formatBoliviaDateTime(session.openedAt)}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`font-semibold ${
                              session.status === 'open'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {session.status === 'open' ? 'Abierta' : 'Cerrada'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                          {formatCurrencyAmount(expectedBalance, session.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}

      {/* Modal Abrir Caja */}
      {isOpenCashModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-cash-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="open-cash-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Abrir caja independiente (DEC-07)
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Responsable: <strong>{currentUser?.fullName}</strong>. Cada usuario opera cajas separadas por moneda.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpenCashModal(false)}
                aria-label="Cerrar modal abrir caja"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleOpenCashSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="oc-curr" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Moneda de la caja
                </label>
                <select
                  id="oc-curr"
                  value={openCurrency}
                  onChange={(e) => setOpenCurrency(e.target.value as CurrencyCode)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="BOB">BOB — Bolivianos</option>
                  <option value="USD">USD — Dólares</option>
                </select>
              </div>

              <div>
                <label htmlFor="oc-bal" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Saldo inicial ({openCurrency})
                </label>
                <input
                  id="oc-bal"
                  type="number"
                  step="0.01"
                  min="0"
                  value={openingBalanceInput}
                  onChange={(e) => setOpeningBalanceInput(e.target.value)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="oc-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Observación de apertura (Opcional)
                </label>
                <input
                  id="oc-notes"
                  type="text"
                  value={openNotes}
                  onChange={(e) => setOpenNotes(e.target.value)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {openError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {openError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsOpenCashModal(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Confirmar apertura
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Movimiento Compensatorio (§4.8 / DEC-08) */}
      {isAdjModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="adj-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="adj-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Movimiento compensatorio en caja abierta
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Registra correcciones sin reabrir cajas cerradas ni borrar movimientos previos (§4.8).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAdjModal(false)}
                aria-label="Cerrar modal de ajuste"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAdjustmentSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="adj-dir" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Dirección
                  </label>
                  <select
                    id="adj-dir"
                    value={adjDirection}
                    onChange={(e) => setAdjDirection(e.target.value as CashMovementDirection)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="inflow">Entrada (+)</option>
                    <option value="outflow">Salida (−)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="adj-amt" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Monto ({currencyFilter})
                  </label>
                  <input
                    id="adj-amt"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={adjAmountInput}
                    onChange={(e) => setAdjAmountInput(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="adj-reason" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Motivo explicativo obligatorio
                </label>
                <textarea
                  id="adj-reason"
                  rows={2}
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="Ej. Reposición de fondo / compensación de movimiento previo..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {adjError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {adjError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdjModal(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Registrar movimiento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Arqueo de Caja (RF-055 / DEC-08) */}
      {isRecModal && activeSession && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rec-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="rec-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Arqueo de caja ({activeSession.currency})
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Saldo esperado del sistema:{' '}
                  <strong className="font-mono-tabular text-slate-900 dark:text-slate-100">
                    {formatCurrencyAmount(sessionBalances.expectedBalance, activeSession.currency)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRecModal(false)}
                aria-label="Cerrar modal de arqueo"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRecSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="rec-counted" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Saldo físico contado ({activeSession.currency})
                </label>
                <input
                  id="rec-counted"
                  type="number"
                  step="0.01"
                  min="0"
                  value={countedInput}
                  onChange={(e) => setCountedInput(e.target.value)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-mono-tabular dark:border-slate-800 dark:bg-slate-950">
                Diferencia calculada (Contado − Esperado):{' '}
                <strong>
                  {formatCurrencyAmount(
                    Number(countedInput || 0) - sessionBalances.expectedBalance,
                    activeSession.currency
                  )}
                </strong>
              </div>

              <div>
                <label htmlFor="rec-reason" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Motivo de diferencia (Obligatorio si la diferencia ≠ 0)
                </label>
                <textarea
                  id="rec-reason"
                  rows={2}
                  value={diffReason}
                  onChange={(e) => setDiffReason(e.target.value)}
                  placeholder="Explica cualquier sobrante o faltante..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="rec-ev" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Detalle de conteo / evidencia (Opcional)
                </label>
                <input
                  id="rec-ev"
                  type="text"
                  value={evidenceNote}
                  onChange={(e) => setEvidenceNote(e.target.value)}
                  placeholder="Ej. Detalle de billetes o respaldo bancario"
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {recError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {recError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRecModal(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  <ClipboardCheck className="h-4 w-4" />
                  <span>Registrar arqueo</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
