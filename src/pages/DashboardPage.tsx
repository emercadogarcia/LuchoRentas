/**
 * Archivo: src/pages/DashboardPage.tsx
 * Responsabilidad: Dashboard Ejecutivo (Modelo A) con filtro global de Mes y Año
 *   (por defecto período actual America/La_Paz), 4 KPIs financieros con detalle
 *   consultable, 4 micro-indicadores operativos de unidades y 2 tablas compactas
 *   de hasta 5 movimientos recientes (cobros y pagos realizados).
 * Cumplimiento LuchoRentas.md: §9.1–§9.5, RF-050 a RF-053 (CA-050 a CA-053), §15,
 *   DEC-01 (BOB/USD separados), DEC-14 (5 filas por tabla) y DEC-15.
 */
import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Eye,
  Receipt,
  RefreshCw,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { BOLIVIA_MONTH_LABELS } from '../lib/phase6Domain';
import { usePhase6 } from '../lib/phase6Store';
import { formatBoliviaDateTime, formatCurrencyAmount } from '../lib/rbac';
import {
  EXPENSE_STATUS_LABELS,
  RENTAL_MODE_LABELS,
  type AppModuleId,
} from '../types/domain';

type DrilldownKind =
  | 'collections'
  | 'receivables'
  | 'payables'
  | 'occupancy'
  | 'recent_collections'
  | 'recent_payments'
  | null;

export function DashboardPage({
  onNavigate,
}: {
  onNavigate: (moduleId: AppModuleId) => void;
}) {
  const { activeTenant, canDo } = useAuth();
  const {
    selectedMonth,
    selectedYear,
    setPeriod,
    dashboard,
    schemaHealth,
    refreshSchemaHealth,
  } = usePhase6();

  const [drilldown, setDrilldown] = useState<DrilldownKind>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const canCreateCollection = canDo('collections', 'create');
  const canManageExpense = canDo('expenses', 'manage');
  const canViewReceivables = canDo('receivables', 'view');
  const canViewReports = canDo('reports', 'view');

  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  const handleRecheck = async () => {
    setCheckingHealth(true);
    await refreshSchemaHealth();
    setCheckingHealth(false);
  };

  return (
    <div className="space-y-6">
      {/* Encabezado Modelo A con filtro global Mes/Año y acciones frecuentes (§9.1, §9.2) */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Dashboard Ejecutivo · {activeTenant?.name ?? 'Espacio'} · Monedas separadas BOB / USD
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Resumen operativo de {BOLIVIA_MONTH_LABELS[selectedMonth - 1]} {selectedYear}
          </h1>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Cierre de corte:{' '}
            <span className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
              {dashboard.effectiveCloseIso}
            </span>
            {' · '}Zona horaria America/La_Paz
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <label htmlFor="dash-month" className="sr-only">
              Mes del período
            </label>
            <select
              id="dash-month"
              value={selectedMonth}
              onChange={(e) => setPeriod(Number(e.target.value), selectedYear)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {BOLIVIA_MONTH_LABELS.map((label, idx) => (
                <option key={label} value={idx + 1}>
                  {label}
                </option>
              ))}
            </select>

            <label htmlFor="dash-year" className="sr-only">
              Año del período
            </label>
            <select
              id="dash-year"
              value={selectedYear}
              onChange={(e) => setPeriod(selectedMonth, Number(e.target.value))}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {canCreateCollection && (
            <button
              type="button"
              onClick={() => onNavigate('collections')}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0"
            >
              <Receipt className="h-3.5 w-3.5" />
              <span>Registrar cobro</span>
            </button>
          )}
          {canManageExpense && (
            <button
              type="button"
              onClick={() => onNavigate('expenses')}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <CreditCard className="h-3.5 w-3.5" />
              <span>Registrar gasto</span>
            </button>
          )}
          {canViewReceivables && (
            <button
              type="button"
              onClick={() => onNavigate('receivables')}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <span>Ver CxC</span>
            </button>
          )}
        </div>
      </div>

      {/* Verificación de integridad de tablas/datos en Supabase cuando aplica */}
      {schemaHealth.checked && !schemaHealth.ready && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/60 dark:bg-amber-950/30"
        >
          <div className="flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">
                Validación de base de datos pendiente en Supabase
              </p>
              <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                {schemaHealth.errorMessage ??
                  `Tablas faltantes detectadas: ${schemaHealth.missingTables.join(', ')}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleRecheck()}
            disabled={checkingHealth}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checkingHealth ? 'animate-spin' : ''}`} />
            <span>Revalidar datos</span>
          </button>
        </div>
      )}

      {/* Bloque 1 — Fila financiera: cuatro tarjetas KPI (§9.3) */}
      <section aria-label="Indicadores financieros del período" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* KPI 1: Cobros realizados en el período */}
        <article className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Cobros del período
              </h2>
              <span className="font-mono-tabular text-[11px] text-emerald-700 dark:text-emerald-400">
                {dashboard.allPeriodCollections.length} mov.
              </span>
            </div>
            <div className="mt-3 space-y-1">
              <div className="font-mono-tabular text-xl font-bold text-slate-900 dark:text-slate-50">
                {formatCurrencyAmount(dashboard.collectionsByCurrency.BOB, 'BOB')}
              </div>
              <div className="font-mono-tabular text-sm font-semibold text-slate-600 dark:text-slate-300">
                {formatCurrencyAmount(dashboard.collectionsByCurrency.USD, 'USD')}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Confirmados por fecha efectiva
            </span>
            <button
              type="button"
              onClick={() => setDrilldown('collections')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300 whitespace-nowrap shrink-0"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Detalle</span>
            </button>
          </div>
        </article>

        {/* KPI 2: Cuentas por cobrar */}
        <article className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Cuentas por cobrar (CxC)
              </h2>
              <span className="font-mono-tabular text-[11px] text-amber-700 dark:text-amber-400">
                {dashboard.receivableDetails.filter((r) => r.isOverdue).length} venc.
              </span>
            </div>
            <div className="mt-3 space-y-1">
              <div className="font-mono-tabular text-xl font-bold text-slate-900 dark:text-slate-50">
                {formatCurrencyAmount(dashboard.receivablesByCurrency.BOB.total, 'BOB')}
              </div>
              <div className="font-mono-tabular text-sm font-semibold text-slate-600 dark:text-slate-300">
                {formatCurrencyAmount(dashboard.receivablesByCurrency.USD.total, 'USD')}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
            <span className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
              Vencido BOB: {formatCurrencyAmount(dashboard.receivablesByCurrency.BOB.overdue, 'BOB')}
            </span>
            <button
              type="button"
              onClick={() => setDrilldown('receivables')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300 whitespace-nowrap shrink-0"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Detalle</span>
            </button>
          </div>
        </article>

        {/* KPI 3: Cuentas por pagar */}
        <article className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Cuentas por pagar (CxP)
              </h2>
              <span className="font-mono-tabular text-[11px] text-red-700 dark:text-red-400">
                {dashboard.payableDetails.filter((p) => p.isOverdue).length} venc.
              </span>
            </div>
            <div className="mt-3 space-y-1">
              <div className="font-mono-tabular text-xl font-bold text-slate-900 dark:text-slate-50">
                {formatCurrencyAmount(dashboard.payablesByCurrency.BOB.total, 'BOB')}
              </div>
              <div className="font-mono-tabular text-sm font-semibold text-slate-600 dark:text-slate-300">
                {formatCurrencyAmount(dashboard.payablesByCurrency.USD.total, 'USD')}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
            <span className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
              Vencido BOB: {formatCurrencyAmount(dashboard.payablesByCurrency.BOB.overdue, 'BOB')}
            </span>
            <button
              type="button"
              onClick={() => setDrilldown('payables')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300 whitespace-nowrap shrink-0"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Detalle</span>
            </button>
          </div>
        </article>

        {/* KPI 4: Porcentaje de ocupación general */}
        <article className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Ocupación general
              </h2>
              <span className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                Al {dashboard.periodEndIso}
              </span>
            </div>
            <div className="mt-3 font-mono-tabular text-3xl font-bold text-slate-900 dark:text-slate-50">
              {dashboard.occupancyPercent.toFixed(1)}%
            </div>
            <p className="mt-1 font-mono-tabular text-xs text-slate-600 dark:text-slate-300">
              {dashboard.occupiedUnitsCount} de {dashboard.totalEnabledUnits} unidades habilitadas
            </p>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Excluye fuera de servicio ({dashboard.excludedOutOfServiceCount})
            </span>
            <button
              type="button"
              onClick={() => setDrilldown('occupancy')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300 whitespace-nowrap shrink-0"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Detalle</span>
            </button>
          </div>
        </article>
      </section>

      {/* Bloque 2 — Fila operativa de unidades: cuatro micro-indicadores (§9.4 / CA-052) */}
      <section aria-label="Indicadores operativos de unidades" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Total unidades habilitadas</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
            {dashboard.totalEnabledUnits}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Unidades ocupadas</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-bold text-emerald-700 dark:text-emerald-400">
            {dashboard.occupiedUnitsCount}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Unidades libres</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
            {dashboard.availableUnitsCount}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Inquilinos morosos únicos</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-bold text-red-700 dark:text-red-400">
            {dashboard.delinquentTenantsCount}
          </p>
        </div>
      </section>

      {/* Bloque 3 — Movimientos recientes: dos tablas compactas lado a lado (§9.5, DEC-14: máx. 5 filas) */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Tabla 1: Últimos cobros realizados */}
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Últimos cobros realizados
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Hasta 5 cobros confirmados de {BOLIVIA_MONTH_LABELS[selectedMonth - 1]} {selectedYear}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDrilldown('recent_collections')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0"
            >
              <span>Ver todos ({dashboard.allPeriodCollections.length})</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Inquilino</th>
                  <th className="px-4 py-2.5 font-medium">Casa</th>
                  <th className="px-4 py-2.5 font-medium">Fecha y hora</th>
                  <th className="px-4 py-2.5 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {dashboard.recentCollections.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      Sin cobros confirmados en este período.
                    </td>
                  </tr>
                ) : (
                  dashboard.recentCollections.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {item.tenantPersonName}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {item.propertyName}
                      </td>
                      <td className="px-4 py-2.5 font-mono-tabular text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {formatBoliviaDateTime(item.effectiveAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        {formatCurrencyAmount(item.amount, item.currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tabla 2: Últimos pagos realizados */}
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Últimos pagos realizados
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Hasta 5 egresos confirmados de {BOLIVIA_MONTH_LABELS[selectedMonth - 1]} {selectedYear}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDrilldown('recent_payments')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0"
            >
              <span>Ver todos ({dashboard.allPeriodExpensePayments.length})</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Concepto / Servicio</th>
                  <th className="px-4 py-2.5 font-medium">Categoría</th>
                  <th className="px-4 py-2.5 font-medium">Fecha y hora</th>
                  <th className="px-4 py-2.5 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {dashboard.recentExpensePayments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      Sin pagos de gastos confirmados en este período.
                    </td>
                  </tr>
                ) : (
                  dashboard.recentExpensePayments.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                        {item.concept}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {item.categoryName}
                      </td>
                      <td className="px-4 py-2.5 font-mono-tabular text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {formatBoliviaDateTime(item.effectiveAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {formatCurrencyAmount(item.amount, item.currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pie contextual rápido hacia Reportes Modelo D y estado de datos */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            {schemaHealth.mode === 'supabase'
              ? 'Fuente en vivo PostgreSQL Supabase'
              : 'Vista previa local persistente'}
            {' · '}
            {schemaHealth.counts.properties} casas · {schemaHealth.counts.activeContracts} contratos activos ·{' '}
            {schemaHealth.counts.payments} cobros confirmados
          </span>
        </div>
        {canViewReports && (
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <span>Abrir Reportes por Casa y Propietario</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Modal de detalle (Drill-down obligatorio §9.3, §9.5 y §15) */}
      {drilldown && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Detalle de indicador del dashboard"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
        >
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-white flex flex-col dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {BOLIVIA_MONTH_LABELS[selectedMonth - 1]} {selectedYear} · Corte {dashboard.effectiveCloseIso}
                </p>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">
                  {drilldown === 'collections' || drilldown === 'recent_collections'
                    ? 'Detalle de cobros confirmados del período'
                    : drilldown === 'receivables'
                      ? 'Detalle de Cuentas por Cobrar (Vencido vs. No vencido)'
                      : drilldown === 'payables'
                        ? 'Detalle de Cuentas por Pagar al cierre'
                        : drilldown === 'occupancy'
                          ? 'Detalle de ocupación por unidad habilitada'
                          : 'Detalle de pagos de gastos realizados'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDrilldown(null)}
                aria-label="Cerrar detalle"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {(drilldown === 'collections' || drilldown === 'recent_collections') && (
                <>
                  <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Total BOB: </span>
                      <span className="font-mono-tabular font-bold text-slate-900 dark:text-slate-50">
                        {formatCurrencyAmount(dashboard.collectionsByCurrency.BOB, 'BOB')}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Total USD: </span>
                      <span className="font-mono-tabular font-bold text-slate-900 dark:text-slate-50">
                        {formatCurrencyAmount(dashboard.collectionsByCurrency.USD, 'USD')}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          <th className="py-2 pr-3 font-medium">Fecha y hora</th>
                          <th className="py-2 pr-3 font-medium">Inquilino</th>
                          <th className="py-2 pr-3 font-medium">Casa / Unidad</th>
                          <th className="py-2 pr-3 font-medium">Método</th>
                          <th className="py-2 text-right font-medium">Monto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {dashboard.allPeriodCollections.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-slate-500">
                              Sin cobros confirmados en este período.
                            </td>
                          </tr>
                        ) : (
                          dashboard.allPeriodCollections.map((c) => (
                            <tr key={c.id}>
                              <td className="py-2 pr-3 font-mono-tabular text-slate-600 dark:text-slate-400">
                                {formatBoliviaDateTime(c.effectiveAt)}
                              </td>
                              <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                                {c.tenantPersonName}
                              </td>
                              <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                                {c.propertyName} · {c.unitName}
                              </td>
                              <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                                {c.paymentMethod}
                              </td>
                              <td className="py-2 text-right font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400">
                                {formatCurrencyAmount(c.amount, c.currency)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {drilldown === 'receivables' && (
                <>
                  <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 text-xs sm:grid-cols-2 dark:border-slate-800">
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-200">Desglose BOB</p>
                      <p className="mt-1 font-mono-tabular text-slate-600 dark:text-slate-300">
                        No vencido: {formatCurrencyAmount(dashboard.receivablesByCurrency.BOB.notOverdue, 'BOB')} · Vencido:{' '}
                        <span className="text-red-700 dark:text-red-400">
                          {formatCurrencyAmount(dashboard.receivablesByCurrency.BOB.overdue, 'BOB')}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-200">Desglose USD</p>
                      <p className="mt-1 font-mono-tabular text-slate-600 dark:text-slate-300">
                        No vencido: {formatCurrencyAmount(dashboard.receivablesByCurrency.USD.notOverdue, 'USD')} · Vencido:{' '}
                        <span className="text-red-700 dark:text-red-400">
                          {formatCurrencyAmount(dashboard.receivablesByCurrency.USD.overdue, 'USD')}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          <th className="py-2 pr-3 font-medium">Vencimiento</th>
                          <th className="py-2 pr-3 font-medium">Inquilino</th>
                          <th className="py-2 pr-3 font-medium">Casa / Unidad</th>
                          <th className="py-2 pr-3 font-medium">Estado</th>
                          <th className="py-2 text-right font-medium">Saldo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {dashboard.receivableDetails.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-slate-500">
                              Sin saldos pendientes de alquiler para este período.
                            </td>
                          </tr>
                        ) : (
                          dashboard.receivableDetails.map((r) => (
                            <tr key={r.id}>
                              <td className="py-2 pr-3 font-mono-tabular text-slate-600 dark:text-slate-400">
                                {r.dueDate}
                              </td>
                              <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                                {r.tenantPersonName}
                              </td>
                              <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                                {r.propertyName} · {r.unitName}
                              </td>
                              <td className="py-2 pr-3">
                                <span
                                  className={`font-semibold ${
                                    r.isOverdue
                                      ? 'text-red-700 dark:text-red-400'
                                      : 'text-amber-700 dark:text-amber-400'
                                  }`}
                                >
                                  {r.isOverdue ? 'Vencido' : 'No vencido'}
                                </span>
                              </td>
                              <td className="py-2 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                                {formatCurrencyAmount(r.balance, r.currency)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {drilldown === 'payables' && (
                <>
                  <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 text-xs sm:grid-cols-2 dark:border-slate-800">
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-200">CxP BOB</p>
                      <p className="mt-1 font-mono-tabular text-slate-600 dark:text-slate-300">
                        Vencido: {formatCurrencyAmount(dashboard.payablesByCurrency.BOB.overdue, 'BOB')} · Por aprobar:{' '}
                        {formatCurrencyAmount(dashboard.payablesByCurrency.BOB.pendingApproval, 'BOB')}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-200">CxP USD</p>
                      <p className="mt-1 font-mono-tabular text-slate-600 dark:text-slate-300">
                        Vencido: {formatCurrencyAmount(dashboard.payablesByCurrency.USD.overdue, 'USD')} · Por aprobar:{' '}
                        {formatCurrencyAmount(dashboard.payablesByCurrency.USD.pendingApproval, 'USD')}
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          <th className="py-2 pr-3 font-medium">Concepto</th>
                          <th className="py-2 pr-3 font-medium">Categoría / Casa</th>
                          <th className="py-2 pr-3 font-medium">Vence</th>
                          <th className="py-2 pr-3 font-medium">Estado</th>
                          <th className="py-2 text-right font-medium">Saldo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {dashboard.payableDetails.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-slate-500">
                              Sin cuentas por pagar pendientes al cierre del período.
                            </td>
                          </tr>
                        ) : (
                          dashboard.payableDetails.map((p) => (
                            <tr key={p.id}>
                              <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                                {p.concept}
                              </td>
                              <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                                {p.categoryName} · {p.propertyName}
                              </td>
                              <td className="py-2 pr-3 font-mono-tabular text-slate-600 dark:text-slate-400">
                                {p.dueDate ?? '—'}
                              </td>
                              <td className="py-2 pr-3">
                                <span
                                  className={`font-semibold ${
                                    p.isOverdue
                                      ? 'text-red-700 dark:text-red-400'
                                      : 'text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {p.isOverdue ? 'Vencido · ' : ''}
                                  {EXPENSE_STATUS_LABELS[p.status]}
                                </span>
                              </td>
                              <td className="py-2 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                                {formatCurrencyAmount(p.balance, p.currency)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {drilldown === 'occupancy' && (
                <div className="overflow-x-auto">
                  <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
                    Fórmula: ({dashboard.occupiedUnitsCount} ocupadas / {dashboard.totalEnabledUnits} habilitadas) × 100 ={' '}
                    <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                      {dashboard.occupancyPercent.toFixed(1)}%
                    </span>
                    . Unidades fuera de servicio excluidas: {dashboard.excludedOutOfServiceCount}.
                  </p>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <th className="py-2 pr-3 font-medium">Casa</th>
                        <th className="py-2 pr-3 font-medium">Unidad / Cuarto</th>
                        <th className="py-2 pr-3 font-medium">Modalidad</th>
                        <th className="py-2 pr-3 font-medium">Estado al cierre</th>
                        <th className="py-2 font-medium">Inquilino</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {dashboard.unitDetails.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-500">
                            No hay unidades habilitadas registradas.
                          </td>
                        </tr>
                      ) : (
                        dashboard.unitDetails.map((u) => (
                          <tr key={u.unitId}>
                            <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                              {u.propertyName}
                            </td>
                            <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">
                              {u.unitName}
                            </td>
                            <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">
                              {RENTAL_MODE_LABELS[u.rentalMode]}
                            </td>
                            <td className="py-2 pr-3">
                              <span
                                className={`font-semibold ${
                                  u.stateAtClose === 'occupied'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {u.stateAtClose === 'occupied' ? 'Ocupada' : 'Libre'}
                              </span>
                            </td>
                            <td className="py-2 text-slate-600 dark:text-slate-300">
                              {u.tenantPersonName}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {drilldown === 'recent_payments' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <th className="py-2 pr-3 font-medium">Fecha y hora</th>
                        <th className="py-2 pr-3 font-medium">Concepto / Servicio</th>
                        <th className="py-2 pr-3 font-medium">Categoría</th>
                        <th className="py-2 pr-3 font-medium">Casa</th>
                        <th className="py-2 text-right font-medium">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {dashboard.allPeriodExpensePayments.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-500">
                            Sin egresos pagados en este período.
                          </td>
                        </tr>
                      ) : (
                        dashboard.allPeriodExpensePayments.map((ep) => (
                          <tr key={ep.id}>
                            <td className="py-2 pr-3 font-mono-tabular text-slate-600 dark:text-slate-400">
                              {formatBoliviaDateTime(ep.effectiveAt)}
                            </td>
                            <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                              {ep.concept}
                            </td>
                            <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                              {ep.categoryName}
                            </td>
                            <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                              {ep.propertyName}
                            </td>
                            <td className="py-2 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                              {formatCurrencyAmount(ep.amount, ep.currency)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 dark:border-slate-800">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {drilldown === 'receivables' && canViewReceivables && (
                  <button
                    type="button"
                    onClick={() => {
                      setDrilldown(null);
                      onNavigate('receivables');
                    }}
                    className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    Ir al módulo completo de Cuentas por Cobrar
                  </button>
                )}
                {drilldown === 'payables' && canManageExpense && (
                  <button
                    type="button"
                    onClick={() => {
                      setDrilldown(null);
                      onNavigate('expenses');
                    }}
                    className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    Ir al módulo completo de Gastos y CxP
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDrilldown(null)}
                className="min-h-9 rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
