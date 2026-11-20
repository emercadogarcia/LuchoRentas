/**
 * Archivo: src/pages/ReportsPage.tsx
 * Responsabilidad: Módulo de Reportes Financieros (Modelo D) con consolidado por
 *   período (ingresos vs. egresos pagados), desglose por Casa y reporte informativo
 *   por Propietario (participaciones históricas DEC-10 sin comisiones DEC-11),
 *   con exportación autorizada en CSV y PDF separando BOB y USD.
 * Cumplimiento LuchoRentas.md: RF-054, RF-056 a RF-058 (CA-054, CA-056 a CA-058),
 *   §4.9, §19.2, DEC-01, DEC-09, DEC-10, DEC-11, DEC-13 y DEC-15.
 */
import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Info } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePhase2 } from '../lib/phase2Store';
import { usePhase5 } from '../lib/phase5Store';
import { BOLIVIA_MONTH_LABELS } from '../lib/phase6Domain';
import { usePhase6 } from '../lib/phase6Store';
import { formatBoliviaDateTime, formatCurrencyAmount } from '../lib/rbac';
import { RENTAL_MODE_LABELS, type ReportTabKind } from '../types/domain';

export function ReportsPage() {
  const { activeTenant, canDo } = useAuth();
  const { properties, people } = usePhase2();
  const { categories } = usePhase5();
  const { selectedMonth, selectedYear, setPeriod, computeReports, exportReport } = usePhase6();

  const [activeTab, setActiveTab] = useState<ReportTabKind>('consolidated');
  const [propertyFilter, setPropertyFilter] = useState<string>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [exportStatus, setExportStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const canExport = canDo(
    'reports',
    'export',
    propertyFilter !== 'all' ? propertyFilter : null
  );

  const ownersList = useMemo(
    () =>
      people
        .filter((p) => p.isActive && p.roles.includes('property_owner'))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [people]
  );

  const report = useMemo(
    () =>
      computeReports({
        propertyId: propertyFilter,
        ownerPersonId: ownerFilter,
        categoryId: categoryFilter,
      }),
    [categoryFilter, computeReports, ownerFilter, propertyFilter]
  );

  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExportStatus(null);
    setExporting(true);
    const res = await exportReport({
      format,
      tab: activeTab,
      report,
      propertyId: propertyFilter,
      ownerPersonId: ownerFilter,
    });
    setExporting(false);
    if (!res.ok) {
      setExportStatus({ ok: false, msg: res.error ?? 'No se pudo exportar el reporte.' });
    } else {
      setExportStatus({
        ok: true,
        msg: `Reporte exportado en ${format.toUpperCase()} para ${BOLIVIA_MONTH_LABELS[selectedMonth - 1]} ${selectedYear}.`,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabecera Modelo D con acciones de exportación autorizadas */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Modelo D · {activeTenant?.name ?? 'Espacio'} · Monedas separadas BOB / USD (DEC-01)
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Reportes Financieros y Consolidado
          </h1>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Cobros y egresos agrupados por fecha efectiva del período · Saldos calculados al cierre {report.periodEndIso}.
          </p>
        </div>

        {canExport && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={exporting}
              onClick={() => void handleExport('csv')}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Exportar CSV</span>
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => void handleExport('pdf')}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exportar PDF</span>
            </button>
          </div>
        )}
      </div>

      {exportStatus && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
            exportStatus.ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300'
          }`}
        >
          {exportStatus.msg}
        </div>
      )}

      {/* Filtros transversales de período, casa, propietario y categoría */}
      <section className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <label htmlFor="rep-month" className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
            Mes
          </label>
          <select
            id="rep-month"
            value={selectedMonth}
            onChange={(e) => setPeriod(Number(e.target.value), selectedYear)}
            className="mt-1 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {BOLIVIA_MONTH_LABELS.map((label, idx) => (
              <option key={label} value={idx + 1}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rep-year" className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
            Año
          </label>
          <select
            id="rep-year"
            value={selectedYear}
            onChange={(e) => setPeriod(selectedMonth, Number(e.target.value))}
            className="mt-1 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono-tabular text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rep-property" className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
            Casa / Inmueble
          </label>
          <select
            id="rep-property"
            value={propertyFilter}
            onChange={(e) => setPropertyFilter(e.target.value)}
            className="mt-1 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="all">Todas las casas autorizadas</option>
            {properties
              .filter((p) => p.isActive)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor="rep-owner" className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
            Propietario
          </label>
          <select
            id="rep-owner"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="mt-1 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="all">Todos los propietarios</option>
            {ownersList.map((ow) => (
              <option key={ow.id} value={ow.id}>
                {ow.fullName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rep-category" className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
            Categoría de gasto
          </label>
          <select
            id="rep-category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="mt-1 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="all">Todas las categorías</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Selector de vista Modelo D */}
      <div
        role="tablist"
        aria-label="Tipo de reporte financiero"
        className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-800/80"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'consolidated'}
          onClick={() => setActiveTab('consolidated')}
          className={`min-h-9 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'consolidated'
              ? 'bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-50'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
          }`}
        >
          Consolidado del período
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'by_property'}
          onClick={() => setActiveTab('by_property')}
          className={`min-h-9 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'by_property'
              ? 'bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-50'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
          }`}
        >
          Por Casa ({report.byProperty.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'by_owner'}
          onClick={() => setActiveTab('by_owner')}
          className={`min-h-9 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'by_owner'
              ? 'bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-50'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
          }`}
        >
          Por Propietario ({report.byOwner.length})
        </button>
      </div>

      {/* Pestaña 1: Consolidado Ingresos vs Egresos */}
      {activeTab === 'consolidated' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(['BOB', 'USD'] as const).map((curr) => (
              <div
                key={curr}
                className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Consolidado {curr === 'BOB' ? 'Bolivianos (BOB)' : 'Dólares (USD)'}
                  </h2>
                  <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                    Sin conversión automática
                  </span>
                </div>
                <dl className="mt-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-600 dark:text-slate-400">Entradas (Cobros confirmados)</dt>
                    <dd className="font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatCurrencyAmount(report.collectedTotals[curr], curr)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-600 dark:text-slate-400">Salidas (Gastos pagados)</dt>
                    <dd className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrencyAmount(report.paidExpensesTotals[curr], curr)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 dark:border-slate-800">
                    <dt className="font-semibold text-slate-900 dark:text-slate-100">
                      Resultado operativo neto
                    </dt>
                    <dd
                      className={`font-mono-tabular text-base font-bold ${
                        report.operatingResultTotals[curr] >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {formatCurrencyAmount(report.operatingResultTotals[curr], curr)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <dt>Saldo CxC al cierre / Saldo CxP al cierre</dt>
                    <dd className="font-mono-tabular">
                      {formatCurrencyAmount(report.receivablesClosingTotals[curr], curr)} /{' '}
                      {formatCurrencyAmount(report.payablesClosingTotals[curr], curr)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>

          {/* Desglose por categoría de gasto (RF-054) */}
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Gastos por Categoría (Pagados vs. Saldo pendiente al cierre)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="px-4 py-2.5 font-medium">Categoría</th>
                    <th className="px-4 py-2.5 text-right font-medium">Pagado BOB</th>
                    <th className="px-4 py-2.5 text-right font-medium">CxP BOB</th>
                    <th className="px-4 py-2.5 text-right font-medium">Pagado USD</th>
                    <th className="px-4 py-2.5 text-right font-medium">CxP USD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.byCategory.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        Sin gastos registrados o pagados con los filtros actuales.
                      </td>
                    </tr>
                  ) : (
                    report.byCategory.map((cat) => (
                      <tr key={cat.categoryId}>
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                          {cat.categoryName}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono-tabular text-slate-900 dark:text-slate-100">
                          {formatCurrencyAmount(cat.paidTotals.BOB, 'BOB')}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono-tabular text-slate-600 dark:text-slate-400">
                          {formatCurrencyAmount(cat.pendingTotals.BOB, 'BOB')}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono-tabular text-slate-900 dark:text-slate-100">
                          {formatCurrencyAmount(cat.paidTotals.USD, 'USD')}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono-tabular text-slate-600 dark:text-slate-400">
                          {formatCurrencyAmount(cat.pendingTotals.USD, 'USD')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabla de movimientos confirmados del período (entradas y salidas) */}
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Libro de entradas y salidas confirmadas ({report.movements.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="px-4 py-2.5 font-medium">Fecha y hora</th>
                    <th className="px-4 py-2.5 font-medium">Tipo</th>
                    <th className="px-4 py-2.5 font-medium">Concepto</th>
                    <th className="px-4 py-2.5 font-medium">Casa</th>
                    <th className="px-4 py-2.5 font-medium">Contraparte</th>
                    <th className="px-4 py-2.5 text-right font-medium">Importe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.movements.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        Sin entradas ni salidas confirmadas en {BOLIVIA_MONTH_LABELS[selectedMonth - 1]} {selectedYear}.
                      </td>
                    </tr>
                  ) : (
                    report.movements.map((mov) => (
                      <tr key={mov.id}>
                        <td className="px-4 py-2.5 font-mono-tabular text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {formatBoliviaDateTime(mov.effectiveAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`font-semibold ${
                              mov.kind === 'inflow'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {mov.kind === 'inflow' ? 'Entrada' : 'Salida'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                          {mov.concept} · <span className="font-normal text-slate-500">{mov.categoryOrMethod}</span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                          {mov.propertyName}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                          {mov.partyName}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {mov.kind === 'inflow' ? '+' : '-'} {formatCurrencyAmount(mov.amount, mov.currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Pestaña 2: Reporte por Casa (CA-056) */}
      {activeTab === 'by_property' && (
        <div className="space-y-4">
          {(report.generalTenantExpensesPaid.BOB > 0 || report.generalTenantExpensesPaid.USD > 0) && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <Info className="h-4 w-4 shrink-0 text-slate-500" />
              <span>
                Existen gastos generales del espacio no asignados a una casa específica en este período:{' '}
                <strong className="font-mono-tabular text-slate-900 dark:text-slate-100">
                  {formatCurrencyAmount(report.generalTenantExpensesPaid.BOB, 'BOB')} /{' '}
                  {formatCurrencyAmount(report.generalTenantExpensesPaid.USD, 'USD')}
                </strong>
                .
              </span>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="px-4 py-3 font-medium">Casa / Modalidad</th>
                    <th className="px-4 py-3 font-medium">Ocupación</th>
                    <th className="px-4 py-3 text-right font-medium">Cobros BOB</th>
                    <th className="px-4 py-3 text-right font-medium">Gastos BOB</th>
                    <th className="px-4 py-3 text-right font-medium">Resultado BOB</th>
                    <th className="px-4 py-3 text-right font-medium">Cobros USD</th>
                    <th className="px-4 py-3 text-right font-medium">Gastos USD</th>
                    <th className="px-4 py-3 text-right font-medium">Resultado USD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.byProperty.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                        No hay casas activas que coincidan con el filtro.
                      </td>
                    </tr>
                  ) : (
                    report.byProperty.map((p) => (
                      <tr key={p.propertyId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {p.propertyName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {RENTAL_MODE_LABELS[p.rentalMode]} · CxC pend.:{' '}
                            <span className="font-mono-tabular">
                              {formatCurrencyAmount(p.receivablePending.BOB, 'BOB')} /{' '}
                              {formatCurrencyAmount(p.receivablePending.USD, 'USD')}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-slate-700 dark:text-slate-300">
                          {p.occupiedUnitsCount}/{p.enabledUnitsCount}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular text-emerald-700 dark:text-emerald-400">
                          {formatCurrencyAmount(p.collected.BOB, 'BOB')}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                          {formatCurrencyAmount(p.paidExpenses.BOB, 'BOB')}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular font-bold text-slate-900 dark:text-slate-100">
                          {formatCurrencyAmount(p.operatingResult.BOB, 'BOB')}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular text-emerald-700 dark:text-emerald-400">
                          {formatCurrencyAmount(p.collected.USD, 'USD')}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                          {formatCurrencyAmount(p.paidExpenses.USD, 'USD')}
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular font-bold text-slate-900 dark:text-slate-100">
                          {formatCurrencyAmount(p.operatingResult.USD, 'USD')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Pestaña 3: Reporte Informativo por Propietario (§4.9, CA-057, DEC-10, DEC-11) */}
      {activeTab === 'by_owner' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <strong>Reporte informativo por participación histórica (DEC-10 / DEC-11):</strong>{' '}
              Solo atribuye ingresos cobrados y egresos pagados de casas con relación de propiedad vigente en{' '}
              {BOLIVIA_MONTH_LABELS[selectedMonth - 1]} {selectedYear}. No calcula comisiones de administración ni genera deuda o liquidación automática.
            </p>
          </div>

          {report.byOwner.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              No hay relaciones propietario-casa vigentes para los filtros seleccionados.
            </div>
          ) : (
            <div className="space-y-4">
              {report.byOwner.map((ow) => (
                <article
                  key={ow.personId}
                  className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                    <div>
                      <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">
                        {ow.ownerName}
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {ow.documentId ? `Doc: ${ow.documentId} · ` : ''}
                        {ow.properties.length} casa(s) con participación vigente
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-right font-mono-tabular text-xs">
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Resultado atribuible BOB</p>
                        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                          {formatCurrencyAmount(ow.attributableOperatingResult.BOB, 'BOB')}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Resultado atribuible USD</p>
                        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                          {formatCurrencyAmount(ow.attributableOperatingResult.USD, 'USD')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          <th className="py-2 pr-3 font-medium">Casa</th>
                          <th className="py-2 pr-3 text-right font-medium">Part. %</th>
                          <th className="py-2 pr-3 text-right font-medium">Cobros BOB</th>
                          <th className="py-2 pr-3 text-right font-medium">Gastos BOB</th>
                          <th className="py-2 pr-3 text-right font-medium">Neto BOB</th>
                          <th className="py-2 pr-3 text-right font-medium">Cobros USD</th>
                          <th className="py-2 pr-3 text-right font-medium">Gastos USD</th>
                          <th className="py-2 text-right font-medium">Neto USD</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {ow.properties.map((sh) => (
                          <tr key={sh.propertyId}>
                            <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                              {sh.propertyName}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                              {sh.ownershipPercent.toFixed(2)}%
                            </td>
                            <td className="py-2 pr-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                              {formatCurrencyAmount(sh.collected.BOB, 'BOB')}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                              {formatCurrencyAmount(sh.paidExpenses.BOB, 'BOB')}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                              {formatCurrencyAmount(sh.operatingResult.BOB, 'BOB')}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                              {formatCurrencyAmount(sh.collected.USD, 'USD')}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                              {formatCurrencyAmount(sh.paidExpenses.USD, 'USD')}
                            </td>
                            <td className="py-2 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                              {formatCurrencyAmount(sh.operatingResult.USD, 'USD')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
