/**
 * Archivo: src/lib/phase6Store.tsx
 * Responsabilidad: Proveedor de estado reactivo de Fase 6 para Dashboard Ejecutivo
 *   (filtro global Mes/Año), Reportes Financieros por Casa/Propietario, auditoría
 *   de exportación y validación en vivo del estado de tablas/datos en Supabase.
 * Cumplimiento LuchoRentas.md: RF-050 a RF-058, §9.2–§9.5, §10.3, §11.3, DEC-01, DEC-13.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { usePhase2 } from './phase2Store';
import { usePhase3 } from './phase3Store';
import { usePhase4 } from './phase4Store';
import { usePhase5 } from './phase5Store';
import { computeExecutiveDashboard, computeFinancialReports } from './phase6Domain';
import {
  buildDashboardReportsReconciliationCheck,
  evaluateTenantInMemoryQaChecks,
} from './phase7QaDomain';
import { getLaPazTodayIso } from './phase3Domain';
import { getCurrentLaPazPeriod, validateTenantMutation } from './rbac';
import { downloadReportCsv, downloadReportPdf } from './reportExporter';
import { isSupabaseConfigured, supabase } from './supabase';
import type {
  DashboardData,
  FinancialReportsData,
  QaIntegrityCheckItem,
  QaIntegrityReport,
  ReportTabKind,
  SchemaHealthStatus,
} from '../types/domain';

interface Phase6ContextValue {
  selectedMonth: number;
  selectedYear: number;
  setPeriod: (month: number, year: number) => void;
  dashboard: DashboardData;
  computeReports: (filters?: {
    propertyId?: string;
    ownerPersonId?: string;
    categoryId?: string;
  }) => FinancialReportsData;
  exportReport: (params: {
    format: 'csv' | 'pdf';
    tab: ReportTabKind;
    report: FinancialReportsData;
    propertyId?: string;
    ownerPersonId?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  schemaHealth: SchemaHealthStatus;
  refreshSchemaHealth: () => Promise<void>;
  qaReport: QaIntegrityReport | null;
  runningQa: boolean;
  runQaIntegrityChecks: () => Promise<void>;
}

const Phase6Context = createContext<Phase6ContextValue | null>(null);

const INITIAL_HEALTH: SchemaHealthStatus = {
  checked: false,
  mode: isSupabaseConfigured ? 'supabase' : 'preview',
  ready: !isSupabaseConfigured,
  missingTables: [],
  counts: {
    properties: 0,
    units: 0,
    people: 0,
    activeContracts: 0,
    receivables: 0,
    payments: 0,
    expenses: 0,
    cashSessions: 0,
  },
  errorMessage: null,
  checkedAt: null,
};

export function Phase6Provider({ children }: { children: React.ReactNode }) {
  const initialPeriod = useMemo(() => getCurrentLaPazPeriod(), []);
  const [selectedMonth, setSelectedMonth] = useState(initialPeriod.month);
  const [selectedYear, setSelectedYear] = useState(initialPeriod.year);
  const [schemaHealth, setSchemaHealth] = useState<SchemaHealthStatus>(INITIAL_HEALTH);
  const [qaReport, setQaReport] = useState<QaIntegrityReport | null>(null);
  const [runningQa, setRunningQa] = useState(false);

  const { activeTenant, activeMembership, tenantPermissions } = useAuth();
  const { properties, units, people, propertyOwners } = usePhase2();
  const { contracts, receivables } = usePhase3();
  const { payments, allocations, receipts } = usePhase4();
  const { categories, expenses, expensePayments, cashSessions, cashMovements } = usePhase5();

  const setPeriod = useCallback((month: number, year: number) => {
    setSelectedMonth(month);
    setSelectedYear(year);
  }, []);

  const refreshSchemaHealth = useCallback(async () => {
    if (!activeTenant) {
      setSchemaHealth(INITIAL_HEALTH);
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setSchemaHealth({
        checked: true,
        mode: 'preview',
        ready: true,
        missingTables: [],
        counts: {
          properties: properties.filter((p) => p.isActive).length,
          units: units.filter((u) => u.isActive).length,
          people: people.filter((p) => p.isActive).length,
          activeContracts: contracts.filter((c) => c.status === 'active').length,
          receivables: receivables.filter((r) => r.status !== 'voided').length,
          payments: payments.filter((p) => p.entryKind === 'collection' && p.status === 'confirmed').length,
          expenses: expenses.filter((e) => e.status !== 'voided').length,
          cashSessions: cashSessions.length,
        },
        errorMessage: null,
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    // Validación real contra Supabase PostgreSQL: verifica RPC Fase 6 o respaldo por consultas directas
    const { data, error } = await supabase.rpc('verify_luchorentas_schema_health', {
      p_tenant_id: activeTenant.id,
    });

    if (!error && data && typeof data === 'object') {
      const payload = data as {
        ready?: boolean;
        missingTables?: string[];
        counts?: SchemaHealthStatus['counts'];
        checkedAt?: string;
      };
      setSchemaHealth({
        checked: true,
        mode: 'supabase',
        ready: Boolean(payload.ready),
        missingTables: payload.missingTables ?? [],
        counts: payload.counts ?? INITIAL_HEALTH.counts,
        errorMessage: null,
        checkedAt: payload.checkedAt ?? new Date().toISOString(),
      });
      return;
    }

    // Si aún no se ejecutó la migración 0006, validar al menos las tablas de Fases 1–5
    const checks = await Promise.all([
      supabase.from('properties').select('id', { count: 'exact', head: true }).eq('tenant_id', activeTenant.id),
      supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('tenant_id', activeTenant.id),
      supabase.from('cash_sessions').select('id', { count: 'exact', head: true }).eq('tenant_id', activeTenant.id),
    ]);

    const missingTables: string[] = [];
    if (checks[0].error) missingTables.push('properties');
    if (checks[1].error) missingTables.push('expenses');
    if (checks[2].error) missingTables.push('cash_sessions');

    setSchemaHealth({
      checked: true,
      mode: 'supabase',
      ready: false,
      missingTables,
      counts: {
        properties: properties.filter((p) => p.isActive).length,
        units: units.filter((u) => u.isActive).length,
        people: people.filter((p) => p.isActive).length,
        activeContracts: contracts.filter((c) => c.status === 'active').length,
        receivables: receivables.filter((r) => r.status !== 'voided').length,
        payments: payments.filter((p) => p.entryKind === 'collection' && p.status === 'confirmed').length,
        expenses: expenses.filter((e) => e.status !== 'voided').length,
        cashSessions: cashSessions.length,
      },
      errorMessage:
        error?.message?.includes('verify_luchorentas_schema_health')
          ? 'Falta ejecutar la migración SQL de Fase 6 (202611200006_phase6_dashboard_reports.sql) en Supabase.'
          : error?.message ?? 'No se pudo completar la verificación remota.',
      checkedAt: new Date().toISOString(),
    });
  }, [
    activeTenant,
    cashSessions.length,
    contracts,
    expenses,
    payments,
    people,
    properties,
    receivables,
    units,
  ]);

  useEffect(() => {
    void refreshSchemaHealth();
  }, [refreshSchemaHealth]);

  const dashboard = useMemo<DashboardData>(() => {
    return computeExecutiveDashboard({
      month: selectedMonth,
      year: selectedYear,
      properties,
      units,
      people,
      contracts,
      receivables,
      payments,
      allocations,
      categories,
      expenses,
      expensePayments,
    });
  }, [
    allocations,
    categories,
    contracts,
    expensePayments,
    expenses,
    payments,
    people,
    properties,
    receivables,
    selectedMonth,
    selectedYear,
    units,
  ]);

  const computeReports = useCallback(
    (filters?: {
      propertyId?: string;
      ownerPersonId?: string;
      categoryId?: string;
    }): FinancialReportsData => {
      return computeFinancialReports({
        month: selectedMonth,
        year: selectedYear,
        propertyIdFilter: filters?.propertyId ?? 'all',
        ownerPersonIdFilter: filters?.ownerPersonId ?? 'all',
        categoryIdFilter: filters?.categoryId ?? 'all',
        properties,
        units,
        people,
        propertyOwners,
        contracts,
        receivables,
        payments,
        allocations,
        categories,
        expenses,
        expensePayments,
      });
    },
    [
      allocations,
      categories,
      contracts,
      expensePayments,
      expenses,
      payments,
      people,
      properties,
      propertyOwners,
      receivables,
      selectedMonth,
      selectedYear,
      units,
    ]
  );

  const exportReport = useCallback(
    async (params: {
      format: 'csv' | 'pdf';
      tab: ReportTabKind;
      report: FinancialReportsData;
      propertyId?: string;
      ownerPersonId?: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (!activeTenant) {
        return { ok: false, error: 'No hay espacio activo.' };
      }

      const targetProp =
        params.propertyId && params.propertyId !== 'all' ? params.propertyId : null;
      const guard = validateTenantMutation({
        membership: activeMembership,
        targetTenantId: activeTenant.id,
        moduleId: 'reports',
        action: 'export',
        propertyId: targetProp,
        customRules: tenantPermissions,
      });
      if (!guard.allowed) {
        return { ok: false, error: guard.message };
      }

      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.rpc('export_tenant_report', {
          p_tenant_id: activeTenant.id,
          p_report_kind: `${params.tab}_${params.format}`,
          p_month: params.report.month,
          p_year: params.report.year,
          p_property_id: targetProp,
          p_owner_person_id:
            params.ownerPersonId && params.ownerPersonId !== 'all' ? params.ownerPersonId : null,
        });
        if (error && !error.message.includes('export_tenant_report')) {
          return { ok: false, error: error.message };
        }
      }

      if (params.format === 'csv') {
        downloadReportCsv(params.report, params.tab, activeTenant.name);
      } else {
        downloadReportPdf(params.report, params.tab, activeTenant.name);
      }
      return { ok: true };
    },
    [activeMembership, activeTenant, tenantPermissions]
  );

  const runQaIntegrityChecks = useCallback(async () => {
    if (!activeTenant) {
      setQaReport(null);
      return;
    }

    setRunningQa(true);
    const reconciliationCheck = buildDashboardReportsReconciliationCheck({
      month: selectedMonth,
      year: selectedYear,
      properties,
      units,
      people,
      propertyOwners,
      contracts,
      receivables,
      payments,
      allocations,
      categories,
      expenses,
      expensePayments,
    });

    if (!isSupabaseConfigured || !supabase) {
      const localReport = evaluateTenantInMemoryQaChecks({
        tenantId: activeTenant.id,
        todayLaPaz: getLaPazTodayIso(),
        month: selectedMonth,
        year: selectedYear,
        properties,
        units,
        people,
        propertyOwners,
        contracts,
        receivables,
        payments,
        allocations,
        receipts,
        categories,
        expenses,
        expensePayments,
        cashSessions,
        cashMovements,
      });
      setQaReport(localReport);
      setRunningQa(false);
      return;
    }

    const { data, error } = await supabase.rpc('run_tenant_qa_integrity_checks', {
      p_tenant_id: activeTenant.id,
    });

    if (!error && data && typeof data === 'object') {
      const payload = data as {
        checkedAt?: string;
        checks?: QaIntegrityCheckItem[];
      };
      const combinedChecks = [...(payload.checks ?? []), reconciliationCheck];
      setQaReport({
        checkedAt: payload.checkedAt ?? new Date().toISOString(),
        tenantId: activeTenant.id,
        source: 'supabase_rpc',
        passedCount: combinedChecks.filter((c) => c.passed).length,
        totalChecks: combinedChecks.length,
        checks: combinedChecks,
        errorMessage: null,
      });
      setRunningQa(false);
      return;
    }

    const fallbackLocal = evaluateTenantInMemoryQaChecks({
      tenantId: activeTenant.id,
      todayLaPaz: getLaPazTodayIso(),
      month: selectedMonth,
      year: selectedYear,
      properties,
      units,
      people,
      propertyOwners,
      contracts,
      receivables,
      payments,
      allocations,
      receipts,
      categories,
      expenses,
      expensePayments,
      cashSessions,
      cashMovements,
    });
    setQaReport({
      ...fallbackLocal,
      errorMessage: error?.message?.includes('run_tenant_qa_integrity_checks')
        ? 'Falta ejecutar la migración SQL de Fase 7 (202611200007_phase7_qa_hardening.sql) en Supabase; mostrando verificación sobre datos cargados en sesión.'
        : error?.message ?? 'No se pudo consultar el RPC QA en Supabase.',
    });
    setRunningQa(false);
  }, [
    activeTenant,
    allocations,
    cashMovements,
    cashSessions,
    categories,
    contracts,
    expensePayments,
    expenses,
    payments,
    people,
    properties,
    propertyOwners,
    receipts,
    receivables,
    selectedMonth,
    selectedYear,
    units,
  ]);

  const value = useMemo<Phase6ContextValue>(
    () => ({
      selectedMonth,
      selectedYear,
      setPeriod,
      dashboard,
      computeReports,
      exportReport,
      schemaHealth,
      refreshSchemaHealth,
      qaReport,
      runningQa,
      runQaIntegrityChecks,
    }),
    [
      computeReports,
      dashboard,
      exportReport,
      qaReport,
      refreshSchemaHealth,
      runQaIntegrityChecks,
      runningQa,
      schemaHealth,
      selectedMonth,
      selectedYear,
      setPeriod,
    ]
  );

  return <Phase6Context.Provider value={value}>{children}</Phase6Context.Provider>;
}

export function usePhase6(): Phase6ContextValue {
  const ctx = useContext(Phase6Context);
  if (!ctx) {
    throw new Error('usePhase6 debe usarse dentro de Phase6Provider.');
  }
  return ctx;
}
