/**
 * Archivo: src/pages/ExpensesPage.tsx
 * Responsabilidad: Módulo de Operación Financiera (Modelo C) para Gastos y Cuentas
 *   por Pagar: categorías configurables por tenant, registro separado de aprobación
 *   y pago (DEC-09), pagos parciales/totales vinculados a caja abierta, adjuntos
 *   privados validados (RF-045) y resumen separado en BOB/USD (DEC-01).
 * Cumplimiento LuchoRentas.md: RF-040 a RF-045 (CA-040 a CA-045), §4.7, DEC-01, DEC-09 y DEC-13.
 */
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Check,
  CreditCard,
  FileUp,
  Lock,
  Paperclip,
  Plus,
  Search,
  Tag,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePhase2 } from '../lib/phase2Store';
import { getLaPazTodayIso, roundCurrency2 } from '../lib/phase3Domain';
import {
  deriveExpenseBalance,
  summarizeExpensesByCurrency,
  validateAttachmentFile,
} from '../lib/phase5Domain';
import { usePhase5 } from '../lib/phase5Store';
import { formatBoliviaDateTime, formatCurrencyAmount } from '../lib/rbac';
import {
  EXPENSE_SCOPE_LABELS,
  EXPENSE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type CurrencyCode,
  type ExpenseItem,
  type ExpenseScope,
  type ExpenseStatus,
  type PaymentMethod,
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

export function ExpensesPage() {
  const { activeTenant, currentUser, canDo } = useAuth();
  const { properties, units, people } = usePhase2();
  const {
    categories,
    expenses,
    expensePayments,
    cashSessions,
    createCategory,
    createExpense,
    approveExpense,
    voidExpense,
    confirmExpensePayment,
    openCashSession,
    getAttachmentSignedUrl,
  } = usePhase5();

  const canManage = canDo('expenses', 'manage');
  const todayLaPaz = getLaPazTodayIso();

  const [activeTab, setActiveTab] = useState<'expenses' | 'payments'>('expenses');
  const [searchTerm, setSearchTerm] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ExpenseStatus>('all');
  const [monthFilter, setMonthFilter] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [signedAttachmentLink, setSignedAttachmentLink] = useState<{
    name: string;
    url: string;
  } | null>(null);

  // Modal Registrar Gasto (RF-040)
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [scope, setScope] = useState<ExpenseScope>('property');
  const [propertyId, setPropertyId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierPersonId, setSupplierPersonId] = useState('');
  const [concept, setConcept] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayLaPaz);
  const [dueDate, setDueDate] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(activeTenant?.defaultCurrency ?? 'BOB');
  const [notes, setNotes] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  // Modal Nueva Categoría (RF-041)
  const [isCatOpen, setIsCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [catError, setCatError] = useState<string | null>(null);

  // Modal Pagar Gasto / Proveedor (RF-043 / DEC-09)
  const [payTarget, setPayTarget] = useState<ExpenseItem | null>(null);
  const [paySessionId, setPaySessionId] = useState('');
  const [payDateTime, setPayDateTime] = useState(getLaPazDateTimeLocalInput());
  const [payAmountInput, setPayAmountInput] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payReference, setPayReference] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);

  // Modal Anular Gasto
  const [voidTargetId, setVoidTargetId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);

  const suppliers = useMemo(
    () => people.filter((p) => p.isActive && p.roles.includes('supplier')),
    [people]
  );

  const unitsForSelectedProperty = useMemo(
    () => units.filter((u) => u.propertyId === propertyId && u.isActive),
    [propertyId, units]
  );

  const summary = useMemo(
    () => summarizeExpensesByCurrency(expenses, expensePayments, todayLaPaz),
    [expensePayments, expenses, todayLaPaz]
  );

  const enrichedExpenses = useMemo(() => {
    return expenses.map((e) => {
      const derived = deriveExpenseBalance(e, todayLaPaz);
      const prop = e.propertyId ? properties.find((p) => p.id === e.propertyId) : null;
      const unit = e.unitId ? units.find((u) => u.id === e.unitId) : null;
      const cat = categories.find((c) => c.id === e.categoryId);
      const supplier = e.supplierPersonId
        ? people.find((p) => p.id === e.supplierPersonId)
        : null;
      return {
        expense: e,
        ...derived,
        propertyName: prop?.name ?? (e.scope === 'tenant_general' ? 'Gasto general' : 'Casa'),
        unitLabel: unit ? `${unit.code} · ${unit.name}` : '',
        categoryName: cat?.name ?? 'Categoría',
        supplierName: supplier?.fullName ?? 'Sin proveedor',
      };
    });
  }, [categories, expenses, people, properties, todayLaPaz, units]);

  const filteredExpenses = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return enrichedExpenses.filter((item) => {
      if (propertyFilter !== 'all' && item.expense.propertyId !== propertyFilter) return false;
      if (categoryFilter !== 'all' && item.expense.categoryId !== categoryFilter) return false;
      if (supplierFilter !== 'all' && item.expense.supplierPersonId !== supplierFilter) return false;
      if (statusFilter !== 'all' && item.expense.status !== statusFilter) return false;
      if (monthFilter && !item.expense.expenseDate.startsWith(monthFilter)) return false;
      if (!q) return true;
      return (
        item.expense.concept.toLowerCase().includes(q) ||
        item.expense.expenseCode.toLowerCase().includes(q) ||
        item.categoryName.toLowerCase().includes(q) ||
        item.supplierName.toLowerCase().includes(q) ||
        item.propertyName.toLowerCase().includes(q)
      );
    });
  }, [
    categoryFilter,
    enrichedExpenses,
    monthFilter,
    propertyFilter,
    searchTerm,
    statusFilter,
    supplierFilter,
  ]);

  const openCreateModal = () => {
    const firstProp = properties.find((p) => p.isActive && canDo('expenses', 'manage', p.id));
    setScope(firstProp ? 'property' : 'tenant_general');
    setPropertyId(firstProp?.id ?? '');
    const firstUnit = units.find((u) => u.propertyId === firstProp?.id && u.isActive);
    setUnitId(firstUnit?.id ?? '');
    setCategoryId(categories[0]?.id ?? '');
    setSupplierPersonId('');
    setConcept('');
    setExpenseDate(todayLaPaz);
    setDueDate('');
    setAmountInput('');
    setCurrency(activeTenant?.defaultCurrency ?? 'BOB');
    setNotes('');
    setAttachmentFile(null);
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setAttachmentFile(null);
      return;
    }
    const check = validateAttachmentFile(file);
    if (!check.valid) {
      setCreateError(check.error);
      e.target.value = '';
      setAttachmentFile(null);
      return;
    }
    setCreateError(null);
    setAttachmentFile(file);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingCreate) return;
    setCreateError(null);
    setIsSubmittingCreate(true);

    const res = await createExpense({
      scope,
      propertyId: scope === 'tenant_general' ? null : propertyId || null,
      unitId: scope === 'unit' ? unitId || null : null,
      categoryId,
      supplierPersonId: supplierPersonId || null,
      concept,
      expenseDate,
      dueDate: dueDate || null,
      amount: Number(amountInput),
      currency,
      notes,
      attachmentFile,
    });

    setIsSubmittingCreate(false);
    if (!res.ok) {
      setCreateError(res.error ?? 'No se pudo registrar el gasto.');
      return;
    }

    setIsCreateOpen(false);
    setFeedback({
      type: 'success',
      text: `Gasto ${res.data?.expenseCode ?? ''} registrado como Pendiente de aprobación (sin generar salida de caja hasta aprobar y pagar).`,
    });
  };

  const handleApprove = async (exp: ExpenseItem) => {
    const res = await approveExpense(exp.id);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo aprobar el gasto.' });
      return;
    }
    setFeedback({
      type: 'success',
      text: `Gasto ${exp.expenseCode} aprobado para pago. Ahora puedes registrar pagos parciales o totales.`,
    });
  };

  const openSessionsForPayTarget = useMemo(() => {
    if (!payTarget) return [];
    return cashSessions.filter(
      (s) =>
        s.status === 'open' &&
        s.currency === payTarget.currency &&
        (s.ownerUserId === currentUser?.id || canDo('cash', 'reconcile'))
    );
  }, [canDo, cashSessions, currentUser?.id, payTarget]);

  const openPayModal = (exp: ExpenseItem) => {
    const { balance } = deriveExpenseBalance(exp, todayLaPaz);
    const matchingSessions = cashSessions.filter(
      (s) =>
        s.status === 'open' &&
        s.currency === exp.currency &&
        (s.ownerUserId === currentUser?.id || canDo('cash', 'reconcile'))
    );
    setPayTarget(exp);
    setPaySessionId(matchingSessions[0]?.id ?? '');
    setPayDateTime(getLaPazDateTimeLocalInput());
    setPayAmountInput(balance.toFixed(2));
    setPayMethod('cash');
    setPayReference('');
    setPayNotes('');
    setPayError(null);
  };

  const handleQuickOpenCash = async () => {
    if (!payTarget) return;
    setPayError(null);
    const res = await openCashSession({
      currency: payTarget.currency,
      openingBalance: 0,
      notes: 'Apertura rápida desde pago de gasto',
    });
    if (!res.ok || !res.data) {
      setPayError(res.error ?? 'No se pudo abrir la caja.');
      return;
    }
    setPaySessionId(res.data.id);
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget || isSubmittingPay) return;
    setPayError(null);
    setIsSubmittingPay(true);

    const res = await confirmExpensePayment({
      expenseId: payTarget.id,
      cashSessionId: paySessionId,
      effectiveAt: toBoliviaIsoTimestamp(payDateTime),
      amount: Number(payAmountInput),
      paymentMethod: payMethod,
      referenceCode: payReference,
      notes: payNotes,
    });

    setIsSubmittingPay(false);
    if (!res.ok) {
      setPayError(res.error ?? 'No se pudo confirmar el pago.');
      return;
    }

    setPayTarget(null);
    setFeedback({
      type: 'success',
      text: 'Pago confirmado y egreso registrado en la caja abierta correspondiente.',
    });
  };

  const handleVoidSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTargetId) return;
    setVoidError(null);
    const res = await voidExpense(voidTargetId, voidReason);
    if (!res.ok) {
      setVoidError(res.error ?? 'No se pudo anular el gasto.');
      return;
    }
    setVoidTargetId(null);
    setVoidReason('');
    setFeedback({
      type: 'success',
      text: 'Gasto anulado con motivo auditado (§4.7).',
    });
  };

  const handleOpenAttachment = async (name: string, path: string) => {
    const res = await getAttachmentSignedUrl(path);
    if (!res.ok || !res.data) {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo acceder al comprobante.' });
      return;
    }
    setSignedAttachmentLink({ name, url: res.data });
  };

  return (
    <div className="space-y-6">
      {/* Encabezado Modelo C */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Modelo C · Gastos, Cuentas por Pagar y Pagos a Proveedores con flujo Registro → Aprobación → Pago (DEC-09)
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Gastos y Cuentas por Pagar
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Espacio activo: <strong className="font-semibold text-slate-900 dark:text-slate-100">{activeTenant?.name}</strong>
            {' · '}
            Fecha Bolivia: <span className="font-mono-tabular text-xs">{todayLaPaz}</span>
          </p>
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setNewCatName('');
                setCatError(null);
                setIsCatOpen(true);
              }}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Tag className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Nueva categoría</span>
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Registrar gasto</span>
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

      {signedAttachmentLink && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-xs text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
          <span>
            Enlace privado temporal (60 s) generado para <strong>{signedAttachmentLink.name}</strong>:{' '}
            <a
              href={signedAttachmentLink.url}
              target="_blank"
              rel="noopener noreferrer"
              download={signedAttachmentLink.name}
              className="font-semibold underline"
            >
              Descargar / Ver comprobante
            </a>
          </span>
          <button
            type="button"
            onClick={() => setSignedAttachmentLink(null)}
            aria-label="Cerrar enlace"
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Resumen financiero separado BOB / USD (DEC-01 / DEC-09) */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">CxP aprobada por pagar (BOB)</p>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
            {formatCurrencyAmount(summary.BOB.pendingPayableBalance, 'BOB')}
          </p>
          <p className="mt-1 font-mono-tabular text-xs text-slate-600 dark:text-slate-400">
            Pagado efectivo: {formatCurrencyAmount(summary.BOB.confirmedPaidOutflow, 'BOB')} · Vencido:{' '}
            <span className={summary.BOB.overduePayableBalance > 0 ? 'font-semibold text-red-700 dark:text-red-400' : ''}>
              {formatCurrencyAmount(summary.BOB.overduePayableBalance, 'BOB')}
            </span>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">CxP aprobada por pagar (USD)</p>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
            {formatCurrencyAmount(summary.USD.pendingPayableBalance, 'USD')}
          </p>
          <p className="mt-1 font-mono-tabular text-xs text-slate-600 dark:text-slate-400">
            Pagado efectivo: {formatCurrencyAmount(summary.USD.confirmedPaidOutflow, 'USD')} · Vencido:{' '}
            <span className={summary.USD.overduePayableBalance > 0 ? 'font-semibold text-red-700 dark:text-red-400' : ''}>
              {formatCurrencyAmount(summary.USD.overduePayableBalance, 'USD')}
            </span>
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Pendientes de aprobación (sin egreso)</p>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
            {summary.BOB.pendingApprovalCount + summary.USD.pendingApprovalCount} gasto(s)
          </p>
          <p className="mt-1 font-mono-tabular text-xs text-slate-600 dark:text-slate-400">
            {formatCurrencyAmount(summary.BOB.pendingApprovalAmount, 'BOB')} ·{' '}
            {formatCurrencyAmount(summary.USD.pendingApprovalAmount, 'USD')}
          </p>
        </div>
      </section>

      {/* Tabs y filtros */}
      <div className="flex flex-col gap-3">
        <div
          role="tablist"
          aria-label="Vistas de gastos y pagos"
          className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900 self-start"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'expenses'}
            onClick={() => setActiveTab('expenses')}
            className={`min-h-8 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'expenses'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            Gastos y Cuentas por Pagar ({expenses.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'payments'}
            onClick={() => setActiveTab('payments')}
            className={`min-h-8 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'payments'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            Pagos Confirmados ({expensePayments.length})
          </button>
        </div>

        {activeTab === 'expenses' && (
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[200px] flex-1 max-w-xs">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                aria-label="Buscar gasto o código"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Concepto, código o proveedor..."
                className="w-full min-h-10 rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <select
              aria-label="Filtrar por casa"
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">Todas las casas / ámbitos</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por categoría"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por proveedor"
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">Todos los proveedores</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por estado de gasto"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | ExpenseStatus)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">Todos los estados</option>
              {(Object.keys(EXPENSE_STATUS_LABELS) as ExpenseStatus[]).map((st) => (
                <option key={st} value={st}>
                  {EXPENSE_STATUS_LABELS[st]}
                </option>
              ))}
            </select>

            <input
              type="month"
              aria-label="Filtrar por mes de gasto"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        )}
      </div>

      {/* Tabla principal */}
      {activeTab === 'expenses' ? (
        filteredExpenses.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
            <CreditCard className="mx-auto h-7 w-7 text-slate-400" />
            <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              No hay gastos registrados con estos filtros
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Registra servicios básicos, mantenimiento o pagos a proveedores usando "+ Registrar gasto".
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Concepto / Código</th>
                    <th className="px-4 py-3 font-medium">Ámbito / Casa</th>
                    <th className="px-4 py-3 font-medium">Categoría / Proveedor</th>
                    <th className="px-4 py-3 font-medium">Fechas</th>
                    <th className="px-4 py-3 font-medium text-right">Importe</th>
                    <th className="px-4 py-3 font-medium text-right">Saldo CxP</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredExpenses.map(
                    ({
                      expense,
                      balance,
                      isOverdue,
                      propertyName,
                      unitLabel,
                      categoryName,
                      supplierName,
                    }) => {
                      const canManageThis = canDo('expenses', 'manage', expense.propertyId);
                      return (
                        <tr
                          key={expense.id}
                          className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {expense.concept}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                              <span>{expense.expenseCode}</span>
                              {expense.evidenceName && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleOpenAttachment(
                                      expense.evidenceName,
                                      expense.evidencePath
                                    )
                                  }
                                  className="inline-flex items-center gap-1 text-sky-700 hover:underline dark:text-sky-400"
                                >
                                  <Paperclip className="h-3 w-3" />
                                  <span>{expense.evidenceName}</span>
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {propertyName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {EXPENSE_SCOPE_LABELS[expense.scope]}
                              {unitLabel ? ` · ${unitLabel}` : ''}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                            <div>{categoryName}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {supplierName}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono-tabular">
                            <div className="text-slate-900 dark:text-slate-100">
                              {expense.expenseDate}
                            </div>
                            {expense.dueDate && (
                              <div
                                className={`text-[11px] ${
                                  isOverdue
                                    ? 'font-semibold text-red-700 dark:text-red-400'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                Vence: {expense.dueDate}
                                {isOverdue && (
                                  <AlertTriangle className="ml-1 inline h-3 w-3" />
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {formatCurrencyAmount(expense.amount, expense.currency)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatCurrencyAmount(balance, expense.currency)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`font-semibold ${
                                expense.status === 'paid'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : expense.status === 'partially_paid'
                                    ? 'text-sky-700 dark:text-sky-400'
                                    : expense.status === 'approved'
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : expense.status === 'voided'
                                        ? 'text-slate-400 line-through dark:text-slate-500'
                                        : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {EXPENSE_STATUS_LABELS[expense.status]}
                            </span>
                            {expense.voidReason && (
                              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {expense.voidReason}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {canManageThis && expense.status === 'pending_approval' && (
                                <button
                                  type="button"
                                  onClick={() => void handleApprove(expense)}
                                  className="inline-flex items-center gap-1 rounded-md border border-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                                >
                                  <Check className="h-3 w-3" />
                                  <span>Aprobar</span>
                                </button>
                              )}
                              {canManageThis &&
                                (expense.status === 'approved' ||
                                  expense.status === 'partially_paid') && (
                                  <button
                                    type="button"
                                    onClick={() => openPayModal(expense)}
                                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                                  >
                                    <CreditCard className="h-3 w-3" />
                                    <span>Pagar</span>
                                  </button>
                                )}
                              {canManageThis &&
                                expense.status !== 'voided' &&
                                expense.paidAmount === 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setVoidTargetId(expense.id);
                                      setVoidReason('');
                                      setVoidError(null);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                  >
                                    <Ban className="h-3 w-3" />
                                    <span>Anular</span>
                                  </button>
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        /* Historial de pagos confirmados */
        expensePayments.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
            <CreditCard className="mx-auto h-7 w-7 text-slate-400" />
            <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Aún no se han confirmado pagos de gastos
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Un gasto aprobado no genera egreso real en caja hasta que se confirma su pago parcial o total (DEC-09).
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Fecha y hora (BO)</th>
                    <th className="px-4 py-3 font-medium">Gasto</th>
                    <th className="px-4 py-3 font-medium">Método / Referencia</th>
                    <th className="px-4 py-3 font-medium">Pagado por</th>
                    <th className="px-4 py-3 font-medium text-right">Monto egresado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {expensePayments.map((ep) => {
                    const exp = expenses.find((e) => e.id === ep.expenseId);
                    return (
                      <tr key={ep.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-mono-tabular text-slate-700 dark:text-slate-300">
                          {formatBoliviaDateTime(ep.effectiveAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {exp?.concept ?? 'Gasto'}
                          </div>
                          <div className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                            {exp?.expenseCode ?? ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                          <div>{PAYMENT_METHOD_LABELS[ep.paymentMethod]}</div>
                          {ep.referenceCode && (
                            <div className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                              Ref: {ep.referenceCode}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                          {ep.paidByName}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                          {formatCurrencyAmount(ep.amount, ep.currency)}
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

      {/* Modal Registrar Gasto (RF-040 / RF-045) */}
      {isCreateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="expense-create-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="expense-create-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Registrar gasto / cuenta por pagar (RF-040)
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  El registro se crea como Pendiente de aprobación y no reduce caja hasta aprobar y pagar (DEC-09).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                aria-label="Cerrar modal de gasto"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="exp-scope" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Ámbito del gasto (§4.7)
                  </label>
                  <select
                    id="exp-scope"
                    value={scope}
                    onChange={(e) => {
                      const next = e.target.value as ExpenseScope;
                      setScope(next);
                      if (next === 'tenant_general') {
                        setPropertyId('');
                        setUnitId('');
                      } else if (!propertyId && properties[0]) {
                        setPropertyId(properties[0].id);
                      }
                    }}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="property">Casa completa</option>
                    <option value="unit">Cuarto / Unidad específica</option>
                    <option value="tenant_general">Gasto general del espacio</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="exp-cat" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Categoría
                  </label>
                  <select
                    id="exp-cat"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {scope !== 'tenant_general' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="exp-prop" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Casa / Inmueble
                    </label>
                    <select
                      id="exp-prop"
                      value={propertyId}
                      onChange={(e) => {
                        setPropertyId(e.target.value);
                        const firstU = units.find(
                          (u) => u.propertyId === e.target.value && u.isActive
                        );
                        setUnitId(firstU?.id ?? '');
                      }}
                      className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="">Selecciona una casa...</option>
                      {properties
                        .filter((p) => p.isActive && canDo('expenses', 'manage', p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  {scope === 'unit' && (
                    <div>
                      <label htmlFor="exp-unit" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Cuarto / Unidad
                      </label>
                      <select
                        id="exp-unit"
                        value={unitId}
                        onChange={(e) => setUnitId(e.target.value)}
                        className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="">Selecciona unidad...</option>
                        {unitsForSelectedProperty.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code} · {u.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="exp-concept" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Concepto / Descripción
                </label>
                <input
                  id="exp-concept"
                  type="text"
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  placeholder="Ej. Factura CRE noviembre / Reparación grifería cuarto B"
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="exp-supplier" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Proveedor (Opcional)
                  </label>
                  <select
                    id="exp-supplier"
                    value={supplierPersonId}
                    onChange={(e) => setSupplierPersonId(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="">Sin proveedor</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="exp-currency" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Moneda (DEC-01)
                  </label>
                  <select
                    id="exp-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="BOB">BOB — Bolivianos</option>
                    <option value="USD">USD — Dólares</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="exp-amount" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Importe ({currency})
                  </label>
                  <input
                    id="exp-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="0.00"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="exp-date" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Fecha del gasto
                  </label>
                  <input
                    id="exp-date"
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="exp-due" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Vencimiento (Opcional)
                  </label>
                  <input
                    id="exp-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="exp-file" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Comprobante / Factura privada (Opcional · PNG, JPG, WEBP o PDF máx. 5 MB)
                </label>
                <label className="mt-1.5 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 dark:hover:bg-slate-800/60">
                  <FileUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{attachmentFile ? attachmentFile.name : 'Seleccionar archivo de respaldo...'}</span>
                  <input
                    id="exp-file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
              </div>

              <div>
                <label htmlFor="exp-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Observaciones (Opcional)
                </label>
                <input
                  id="exp-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {createError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isSubmittingCreate ? 'Registrando...' : 'Registrar gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Nueva Categoría (RF-041) */}
      {isCatOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cat-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <h2 id="cat-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Nueva categoría de gasto (RF-041)
              </h2>
              <button
                type="button"
                onClick={() => setIsCatOpen(false)}
                aria-label="Cerrar modal de categoría"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setCatError(null);
                const res = await createCategory(newCatName);
                if (!res.ok) {
                  setCatError(res.error ?? 'No se pudo crear la categoría.');
                  return;
                }
                setIsCatOpen(false);
                setFeedback({ type: 'success', text: `Categoría "${res.data?.name}" agregada.` });
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <label htmlFor="new-cat-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Nombre de categoría
                </label>
                <input
                  id="new-cat-name"
                  type="text"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Ej. Impuestos municipales / Jardinería"
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              {catError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {catError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCatOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Guardar categoría
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Registrar Pago de Gasto (RF-043 / DEC-09 / §4.8) */}
      {payTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pay-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="pay-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Confirmar pago de gasto ({payTarget.expenseCode})
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {payTarget.concept} · Saldo por pagar:{' '}
                  <strong className="font-mono-tabular text-slate-900 dark:text-slate-100">
                    {formatCurrencyAmount(
                      roundCurrency2(payTarget.amount - payTarget.paidAmount),
                      payTarget.currency
                    )}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                aria-label="Cerrar modal de pago"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handlePaySubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="pay-session" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Caja abierta de egreso ({payTarget.currency})
                </label>
                {openSessionsForPayTarget.length === 0 ? (
                  <div className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                    <p>
                      No tienes una caja abierta en <strong>{payTarget.currency}</strong>. Para registrar el egreso debes abrir una caja primero (§4.8).
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleQuickOpenCash()}
                      className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-500"
                    >
                      Abrir mi caja en {payTarget.currency} ahora
                    </button>
                  </div>
                ) : (
                  <select
                    id="pay-session"
                    value={paySessionId}
                    onChange={(e) => setPaySessionId(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {openSessionsForPayTarget.map((s) => (
                      <option key={s.id} value={s.id}>
                        Caja de {s.ownerName} ({s.currency}) · Abierta {formatBoliviaDateTime(s.openedAt)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="pay-dt" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Fecha y hora efectiva (Bolivia)
                  </label>
                  <input
                    id="pay-dt"
                    type="datetime-local"
                    value={payDateTime}
                    onChange={(e) => setPayDateTime(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="pay-method" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Método de pago
                  </label>
                  <select
                    id="pay-method"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
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
                  <label htmlFor="pay-amt" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Monto a pagar ({payTarget.currency})
                  </label>
                  <input
                    id="pay-amt"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={payAmountInput}
                    onChange={(e) => setPayAmountInput(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="pay-ref" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Referencia / Nro. recibo proveedor
                  </label>
                  <input
                    id="pay-ref"
                    type="text"
                    value={payReference}
                    onChange={(e) => setPayReference(e.target.value)}
                    placeholder="Ej. FAC-4120"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="pay-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Observación (Opcional)
                </label>
                <input
                  id="pay-notes"
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {payError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {payError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!paySessionId || isSubmittingPay}
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isSubmittingPay ? 'Confirmando...' : 'Confirmar pago y registrar egreso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Anular Gasto */}
      {voidTargetId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="void-exp-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <h2 id="void-exp-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Anular gasto registrado
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              El registro no se elimina físicamente; queda marcado como Anulado con motivo y auditoría.
            </p>
            <form onSubmit={handleVoidSubmit} className="mt-4 space-y-4">
              <textarea
                rows={2}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Motivo obligatorio de anulación..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              {voidError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {voidError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setVoidTargetId(null)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
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
