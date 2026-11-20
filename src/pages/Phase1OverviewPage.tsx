/**
 * Archivo: src/pages/Phase1OverviewPage.tsx
 * Responsabilidad: Vista inicial de Fase 1 que resume el contexto del tenant activo
 *   (moneda, zona horaria America/La_Paz, rol efectivo), presenta el catálogo de los
 *   4 Modelos de Pantalla, el Plan de Fases y permite verificar en vivo la Capa 1 RBAC/RLS.
 * Cumplimiento LuchoRentas.md: Muestra aislamiento estricto por tenant_id, separación BOB/USD
 *   y trazabilidad con el PRD v1.1 sin inventar datos de fases aún no implementadas.
 */
import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePhase6 } from '../lib/phase6Store';
import {
  MODULE_CATALOG,
  PHASE_ROADMAP,
  formatCurrencyAmount,
  getCurrentLaPazPeriod,
} from '../lib/rbac';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type AppModuleId, type ModuleAction } from '../types/domain';

export function Phase1OverviewPage({
  onNavigate,
}: {
  onNavigate: (moduleId: AppModuleId) => void;
}) {
  const { activeTenant, activeMembership, tenantMemberships, testProtectedMutation, canView } =
    useAuth();
  const { schemaHealth, refreshSchemaHealth, qaReport, runningQa, runQaIntegrityChecks } =
    usePhase6();

  const [probeModule, setProbeModule] = useState<AppModuleId>('collections');
  const [probeAction, setProbeAction] = useState<ModuleAction>('create');
  const [probeCrossTenant, setProbeCrossTenant] = useState(false);
  const [probeResult, setProbeResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [checkingDb, setCheckingDb] = useState(false);

  const period = getCurrentLaPazPeriod();
  const activeCount = tenantMemberships.filter((m) => m.status === 'active').length;

  const handleCheckDatabase = async () => {
    setCheckingDb(true);
    await refreshSchemaHealth();
    setCheckingDb(false);
  };

  const handleRunSecurityCheck = () => {
    const targetTenantId = probeCrossTenant
      ? 'tenant-ajeno-bloqueado'
      : (activeTenant?.id ?? 'sin-tenant');
    const res = testProtectedMutation(targetTenantId, probeModule, probeAction);
    setProbeResult({
      ok: res.ok,
      message: res.ok ? (res.data ?? 'Autorizado') : (res.error ?? 'Acceso denegado'),
    });
  };

  return (
    <div className="space-y-8">
      {/* Cabecera contextual */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Fases 1 a 7 Activas · Operación Completa, Auditoría QA y Versión Candidata a Producción
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            {activeTenant?.name ?? 'Sin espacio activo'}
          </h1>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Periodo actual (America/La_Paz):{' '}
            <span className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
              {String(period.month).padStart(2, '0')}/{period.year}
            </span>
            {' · '}
            Moneda base:{' '}
            <span className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
              {activeTenant?.defaultCurrency ?? 'BOB'}
            </span>
            {' · '}
            Rol efectivo:{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {activeMembership ? ROLE_LABELS[activeMembership.role] : 'Sin membresía'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canView('dashboard') && (
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0"
            >
              <span>Dashboard Ejecutivo</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          {canView('reports') && (
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <span>Reportes Financieros</span>
            </button>
          )}
          {canView('collections') && (
            <button
              type="button"
              onClick={() => onNavigate('collections')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <span>Cobros y Recibos</span>
            </button>
          )}
          {canView('expenses') && (
            <button
              type="button"
              onClick={() => onNavigate('expenses')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <span>Gastos y CxP</span>
            </button>
          )}
          {canView('cash') && (
            <button
              type="button"
              onClick={() => onNavigate('cash')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <span>Caja y Arqueo</span>
            </button>
          )}
          {canView('contracts') && (
            <button
              type="button"
              onClick={() => onNavigate('contracts')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <span>Contratos</span>
            </button>
          )}
          {canView('receivables') && (
            <button
              type="button"
              onClick={() => onNavigate('receivables')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <span>Cuentas por Cobrar</span>
            </button>
          )}
          {canView('properties') && (
            <button
              type="button"
              onClick={() => onNavigate('properties')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <span>Casas y Cuartos</span>
            </button>
          )}
          {canView('people') && (
            <button
              type="button"
              onClick={() => onNavigate('people')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <span>Personas</span>
            </button>
          )}
          {canView('users_permissions') && (
            <button
              type="button"
              onClick={() => onNavigate('users_permissions')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <span>Usuarios</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 métricas reales de Fase 1 (sin KPIs ficticios de fases futuras) */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Tenant ID Activo</p>
          <p className="mt-2 truncate font-mono-tabular text-sm font-semibold text-slate-900 dark:text-slate-100">
            {activeTenant?.id ?? '—'}
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Aislamiento RLS estricto
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Miembros Activos</p>
          <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900 dark:text-slate-100">
            {activeCount}
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            De {tenantMemberships.length} membresías totales
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Monedas Soportadas (DEC-01)</p>
          <p className="mt-2 font-mono-tabular text-sm font-semibold text-slate-900 dark:text-slate-100">
            {formatCurrencyAmount(0, 'BOB')} / {formatCurrencyAmount(0, 'USD')}
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Saldos separados por divisa
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">Tu Alcance Actual</p>
          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {activeMembership ? ROLE_LABELS[activeMembership.role] : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
            {activeMembership ? ROLE_DESCRIPTIONS[activeMembership.role] : ''}
          </p>
        </div>
      </section>

      {/* Validación en vivo de tablas y existencia de datos en Supabase */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Validación de Tablas y Datos del Espacio ({schemaHealth.mode === 'supabase' ? 'PostgreSQL Supabase' : 'Modo Local'})
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              Verifica la disponibilidad de todas las entidades de Fases 1 a 6 y el conteo real de registros en el tenant activo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCheckDatabase()}
            disabled={checkingDb}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checkingDb ? 'animate-spin' : ''}`} />
            <span>Validar datos ahora</span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Casas</div>
            <div className="mt-1 font-mono-tabular text-base font-bold text-slate-900 dark:text-slate-100">
              {schemaHealth.counts.properties}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Unidades</div>
            <div className="mt-1 font-mono-tabular text-base font-bold text-slate-900 dark:text-slate-100">
              {schemaHealth.counts.units}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Personas</div>
            <div className="mt-1 font-mono-tabular text-base font-bold text-slate-900 dark:text-slate-100">
              {schemaHealth.counts.people}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Contratos act.</div>
            <div className="mt-1 font-mono-tabular text-base font-bold text-slate-900 dark:text-slate-100">
              {schemaHealth.counts.activeContracts}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">CxC vigentes</div>
            <div className="mt-1 font-mono-tabular text-base font-bold text-slate-900 dark:text-slate-100">
              {schemaHealth.counts.receivables}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Cobros</div>
            <div className="mt-1 font-mono-tabular text-base font-bold text-slate-900 dark:text-slate-100">
              {schemaHealth.counts.payments}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Gastos</div>
            <div className="mt-1 font-mono-tabular text-base font-bold text-slate-900 dark:text-slate-100">
              {schemaHealth.counts.expenses}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Cajas</div>
            <div className="mt-1 font-mono-tabular text-base font-bold text-slate-900 dark:text-slate-100">
              {schemaHealth.counts.cashSessions}
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
          Estado de esquema:{' '}
          <strong className={schemaHealth.ready ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
            {schemaHealth.ready ? 'Todas las tablas y RPCs verificados' : schemaHealth.errorMessage ?? 'Migración pendiente'}
          </strong>
        </p>
      </section>

      {/* Auditoría QA de Integridad Financiera, RLS y Conciliación (Fase 7) */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Auditoría QA, Integridad Financiera y Conciliación (Fase 7)
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              Ejecuta comprobaciones estructurales (§18.2) sobre copropiedad 100%, ocupación única, recibos 1:1, cajas por moneda, gastos aprobados y paridad Dashboard ↔ Reportes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runQaIntegrityChecks()}
            disabled={runningQa}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${runningQa ? 'animate-spin' : ''}`} />
            <span>{runningQa ? 'Auditando...' : 'Ejecutar auditoría QA'}</span>
          </button>
        </div>

        {!qaReport ? (
          <p className="mt-4 text-xs text-slate-600 dark:text-slate-400">
            Presiona <strong className="text-slate-900 dark:text-slate-100">Ejecutar auditoría QA</strong> para validar en vivo las invariantes financieras del espacio activo.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {qaReport.errorMessage && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                {qaReport.errorMessage}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span>
                Origen:{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {qaReport.source === 'supabase_rpc'
                    ? 'PostgreSQL RPC (run_tenant_qa_integrity_checks) + Conciliación UI'
                    : 'Motor local del espacio'}
                </strong>
              </span>
              <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                {qaReport.passedCount}/{qaReport.totalChecks} controles aprobados
              </span>
            </div>

            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {qaReport.checks.map((chk) => (
                <div key={chk.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                  <div className="flex items-start gap-2.5">
                    {chk.passed ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    )}
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {chk.label}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                        {chk.detail}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-semibold whitespace-nowrap shrink-0 ${
                      chk.passed
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {chk.passed ? 'Aprobado' : 'Observado'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Verificador interactivo de Doble Capa RBAC y Aislamiento Multi-Tenant */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Prueba de Autorización Capa 1 (Backend/RLS) y Aislamiento Tenant
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Verifica cómo el guardia transaccional valida membresía, rol y tenant_id antes de ejecutar una mutación.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4 sm:items-end">
          <div>
            <label
              htmlFor="probe-module"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Módulo objetivo
            </label>
            <select
              id="probe-module"
              value={probeModule}
              onChange={(e) => setProbeModule(e.target.value as AppModuleId)}
              className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {MODULE_CATALOG.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="probe-action"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Acción solicitada
            </label>
            <select
              id="probe-action"
              value={probeAction}
              onChange={(e) => setProbeAction(e.target.value as ModuleAction)}
              className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="view">view (Consultar)</option>
              <option value="manage">manage (Crear/Editar)</option>
              <option value="generate">generate (Generar CxC)</option>
              <option value="create">create (Registrar Cobro)</option>
              <option value="reverse">reverse (Revertir)</option>
              <option value="reconcile">reconcile (Arqueo/Cierre)</option>
              <option value="export">export (Exportar)</option>
            </select>
          </div>

          <div className="flex min-h-10 items-center">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={probeCrossTenant}
                onChange={(e) => setProbeCrossTenant(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Simular tenant_id ajeno</span>
            </label>
          </div>

          <button
            type="button"
            onClick={handleRunSecurityCheck}
            className="min-h-10 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            Validar autorización
          </button>
        </div>

        {probeResult && (
          <div
            role="status"
            className={`mt-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium ${
              probeResult.ok
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300'
            }`}
          >
            {probeResult.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <Lock className="h-4 w-4 shrink-0" />
            )}
            <span>{probeResult.message}</span>
          </div>
        )}
      </section>

      {/* Plan de Fases del Proyecto y Modelos de Pantalla */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="lg:col-span-7 space-y-3">
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
            Plan de Ejecución por Fases
          </h2>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {PHASE_ROADMAP.map((item) => (
              <div key={item.phase} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Fase {item.phase}. {item.title}
                  </h3>
                  <span
                    className={`text-xs font-semibold whitespace-nowrap shrink-0 ${
                      item.status === 'active'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {item.status === 'active' ? 'En ejecución' : 'Pendiente confirmación'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{item.scope}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-5 space-y-3">
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
            Modelos de Pantalla por Módulo
          </h2>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {MODULE_CATALOG.map((mod) => {
              const accessible = canView(mod.id);
              return (
                <div key={mod.id} className="flex items-start justify-between gap-3 p-3.5">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {mod.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {mod.archetype} · Fase {mod.phase}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-medium whitespace-nowrap shrink-0 ${
                      accessible
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {accessible ? 'Visible para tu rol' : 'Restringido por rol'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
