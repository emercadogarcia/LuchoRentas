/**
 * Archivo: src/lib/phase7QaDomain.ts
 * Responsabilidad: Motor puro de verificación QA de invariantes financieras,
 *   estructurales, multi-tenant y conciliación Dashboard ↔ Reportes (Fase 7).
 * Cumplimiento LuchoRentas.md: §10.1, §10.2, §18.2 (17 pruebas obligatorias) y §18.3.
 */
import { roundCurrency2 } from './phase3Domain';
import { computeExecutiveDashboard, computeFinancialReports } from './phase6Domain';
import type {
  CashMovement,
  CashSession,
  ExpenseCategory,
  ExpenseItem,
  ExpensePayment,
  PaymentAllocation,
  Person,
  Property,
  PropertyOwnerLink,
  PropertyUnit,
  QaIntegrityCheckItem,
  QaIntegrityReport,
  ReceivableCharge,
  RentalContract,
  RentPayment,
  RentReceipt,
} from '../types/domain';

/**
 * Verifica coincidencia matemática exacta entre los KPIs del Dashboard Ejecutivo
 * (Modelo A) y los totales del Reporte Consolidado (Modelo D) en BOB y USD (§18.2 #15).
 */
export function buildDashboardReportsReconciliationCheck(params: {
  month: number;
  year: number;
  properties: Property[];
  units: PropertyUnit[];
  people: Person[];
  propertyOwners: PropertyOwnerLink[];
  contracts: RentalContract[];
  receivables: ReceivableCharge[];
  payments: RentPayment[];
  allocations: PaymentAllocation[];
  categories: ExpenseCategory[];
  expenses: ExpenseItem[];
  expensePayments: ExpensePayment[];
}): QaIntegrityCheckItem {
  const dash = computeExecutiveDashboard(params);
  const report = computeFinancialReports(params);

  const diffs: string[] = [];
  if (roundCurrency2(dash.collectionsByCurrency.BOB) !== roundCurrency2(report.collectedTotals.BOB)) {
    diffs.push(`Cobros BOB (Dash ${dash.collectionsByCurrency.BOB} vs Rep ${report.collectedTotals.BOB})`);
  }
  if (roundCurrency2(dash.collectionsByCurrency.USD) !== roundCurrency2(report.collectedTotals.USD)) {
    diffs.push(`Cobros USD (Dash ${dash.collectionsByCurrency.USD} vs Rep ${report.collectedTotals.USD})`);
  }
  if (
    roundCurrency2(dash.receivablesByCurrency.BOB.total) !==
    roundCurrency2(report.receivablesClosingTotals.BOB)
  ) {
    diffs.push(
      `CxC BOB (Dash ${dash.receivablesByCurrency.BOB.total} vs Rep ${report.receivablesClosingTotals.BOB})`
    );
  }
  if (
    roundCurrency2(dash.receivablesByCurrency.USD.total) !==
    roundCurrency2(report.receivablesClosingTotals.USD)
  ) {
    diffs.push(
      `CxC USD (Dash ${dash.receivablesByCurrency.USD.total} vs Rep ${report.receivablesClosingTotals.USD})`
    );
  }
  if (
    roundCurrency2(dash.payablesByCurrency.BOB.total) !==
    roundCurrency2(report.payablesClosingTotals.BOB)
  ) {
    diffs.push(
      `CxP BOB (Dash ${dash.payablesByCurrency.BOB.total} vs Rep ${report.payablesClosingTotals.BOB})`
    );
  }
  if (
    roundCurrency2(dash.payablesByCurrency.USD.total) !==
    roundCurrency2(report.payablesClosingTotals.USD)
  ) {
    diffs.push(
      `CxP USD (Dash ${dash.payablesByCurrency.USD.total} vs Rep ${report.payablesClosingTotals.USD})`
    );
  }

  return {
    id: 'qa-dashboard-reports-parity',
    label: 'Conciliación exacta Dashboard ↔ Reportes en BOB y USD (§18.2)',
    passed: diffs.length === 0,
    detail:
      diffs.length === 0
        ? `Periodo ${String(params.month).padStart(2, '0')}/${params.year}: Cobros, CxC y CxP coinciden al centavo en BOB y USD.`
        : `Diferencias detectadas: ${diffs.join(' · ')}`,
  };
}

/**
 * Ejecuta las 7 comprobaciones estructurales/financieras sobre colecciones del tenant activo
 * cuando la aplicación corre en modo local o como doble validación en cliente.
 */
export function evaluateTenantInMemoryQaChecks(params: {
  tenantId: string;
  todayLaPaz: string;
  month: number;
  year: number;
  properties: Property[];
  units: PropertyUnit[];
  people: Person[];
  propertyOwners: PropertyOwnerLink[];
  contracts: RentalContract[];
  receivables: ReceivableCharge[];
  payments: RentPayment[];
  allocations: PaymentAllocation[];
  receipts: RentReceipt[];
  categories: ExpenseCategory[];
  expenses: ExpenseItem[];
  expensePayments: ExpensePayment[];
  cashSessions: CashSession[];
  cashMovements: CashMovement[];
}): QaIntegrityReport {
  const {
    tenantId,
    todayLaPaz,
    properties,
    propertyOwners,
    contracts,
    receivables,
    payments,
    receipts,
    expenses,
    expensePayments,
    cashSessions,
    cashMovements,
  } = params;

  const checks: QaIntegrityCheckItem[] = [];

  // 1. Copropietarios vigentes suman 100%
  const activeProps = properties.filter((p) => p.tenantId === tenantId && p.isActive);
  let badOwnerProps = 0;
  for (const prop of activeProps) {
    const activeLinks = propertyOwners.filter(
      (l) =>
        l.tenantId === tenantId &&
        l.propertyId === prop.id &&
        l.effectiveFrom <= todayLaPaz &&
        (l.effectiveTo === null || l.effectiveTo >= todayLaPaz)
    );
    if (activeLinks.length > 0) {
      const pctSum = roundCurrency2(
        activeLinks.reduce((acc, item) => acc + item.ownershipPercent, 0)
      );
      if (pctSum !== 100) badOwnerProps += 1;
    }
  }
  checks.push({
    id: 'qa-owners-100',
    label: 'Copropietarios vigentes por casa suman 100.00% (DEC-10)',
    passed: badOwnerProps === 0,
    detail:
      badOwnerProps === 0
        ? 'Todas las casas con propietarios vigentes suman exactamente 100%.'
        : `${badOwnerProps} inmueble(s) presentan suma distinta de 100%.`,
  });

  // 2. Sin doble ocupación activa
  const activeByUnit = new Map<string, number>();
  for (const c of contracts) {
    if (c.tenantId === tenantId && c.status === 'active') {
      activeByUnit.set(c.unitId, (activeByUnit.get(c.unitId) ?? 0) + 1);
    }
  }
  const doubleOccupied = Array.from(activeByUnit.values()).filter((n) => n > 1).length;
  checks.push({
    id: 'qa-no-double-occupancy',
    label: 'Sin doble ocupación simultánea por unidad (RF-014)',
    passed: doubleOccupied === 0,
    detail:
      doubleOccupied === 0
        ? 'Cada cuarto o casa completa tiene como máximo 1 contrato activo.'
        : `${doubleOccupied} unidad(es) tienen más de 1 contrato activo.`,
  });

  // 3. Cobros con recibo 1:1
  const receiptByPayId = new Set(receipts.map((r) => r.paymentId));
  const missingReceipts = payments.filter(
    (py) => py.tenantId === tenantId && py.entryKind === 'collection' && !receiptByPayId.has(py.id)
  ).length;
  checks.push({
    id: 'qa-receipts-1to1',
    label: 'Cada cobro emitido posee su recibo correlativo 1:1 (RF-035)',
    passed: missingReceipts === 0,
    detail:
      missingReceipts === 0
        ? 'Integridad 1:1 confirmada entre cobros y recibos correlativos.'
        : `${missingReceipts} cobro(s) sin recibo asociado.`,
  });

  // 4. Límites de CxC
  const badReceivables = receivables.filter(
    (ch) =>
      ch.tenantId === tenantId &&
      (ch.amount <= 0 ||
        ch.paidAmount < 0 ||
        ch.adjustedAmount < 0 ||
        roundCurrency2(ch.paidAmount + ch.adjustedAmount) > roundCurrency2(ch.amount))
  ).length;
  checks.push({
    id: 'qa-receivables-bounds',
    label: 'Saldos de CxC dentro de límites válidos (§10.2)',
    passed: badReceivables === 0,
    detail:
      badReceivables === 0
        ? 'Todas las obligaciones cumplen paid + adjusted <= amount y >= 0.'
        : `${badReceivables} obligación(es) con saldos inconsistentes.`,
  });

  // 5. Máximo 1 caja abierta por usuario y moneda
  const openSessionsMap = new Map<string, number>();
  for (const cs of cashSessions) {
    if (cs.tenantId === tenantId && cs.status === 'open') {
      const k = `${cs.ownerUserId}:${cs.currency}`;
      openSessionsMap.set(k, (openSessionsMap.get(k) ?? 0) + 1);
    }
  }
  const dupOpenCash = Array.from(openSessionsMap.values()).filter((n) => n > 1).length;
  checks.push({
    id: 'qa-cash-one-open',
    label: 'Máximo 1 caja abierta por usuario y moneda (DEC-07)',
    passed: dupOpenCash === 0,
    detail:
      dupOpenCash === 0
        ? 'Aislamiento correcto por usuario y divisa BOB/USD.'
        : `${dupOpenCash} par(es) usuario/moneda con múltiples cajas abiertas.`,
  });

  // 6. Moneda consistente en movimientos de caja
  const sessionCurrencyMap = new Map(cashSessions.map((cs) => [cs.id, cs.currency]));
  const mismatchedMovements = cashMovements.filter((cm) => {
    if (cm.tenantId !== tenantId) return false;
    const sc = sessionCurrencyMap.get(cm.cashSessionId);
    return !sc || sc !== cm.currency;
  }).length;
  checks.push({
    id: 'qa-cash-currency-match',
    label: 'Consistencia estricta BOB/USD entre movimientos y sesiones (DEC-01)',
    passed: mismatchedMovements === 0,
    detail:
      mismatchedMovements === 0
        ? 'Ningún movimiento mezcla moneda respecto a su sesión de caja.'
        : `${mismatchedMovements} movimiento(s) con moneda distinta a su caja.`,
  });

  // 7. Egresos solo sobre gastos aprobados/pagados
  const epMap = new Map(expensePayments.map((ep) => [ep.id, ep]));
  const exMap = new Map(expenses.map((ex) => [ex.id, ex]));
  const badExpenseOutflows = cashMovements.filter((cm) => {
    if (cm.tenantId !== tenantId || cm.sourceType !== 'expense_payment') return false;
    const ep = cm.sourceId ? epMap.get(cm.sourceId) : undefined;
    const ex = ep ? exMap.get(ep.expenseId) : undefined;
    return !ex || !['approved', 'partially_paid', 'paid'].includes(ex.status);
  }).length;
  checks.push({
    id: 'qa-expenses-approved-outflow',
    label: 'Egresos en caja respaldados únicamente por gastos aprobados/pagados (DEC-09)',
    passed: badExpenseOutflows === 0,
    detail:
      badExpenseOutflows === 0
        ? 'Todos los egresos provienen de pagos confirmados sobre gastos autorizados.'
        : `${badExpenseOutflows} egreso(s) sin gasto aprobado válido.`,
  });

  // 8. Conciliación Dashboard <-> Reportes
  checks.push(buildDashboardReportsReconciliationCheck(params));

  const passedCount = checks.filter((c) => c.passed).length;
  return {
    checkedAt: new Date().toISOString(),
    tenantId,
    source: 'local',
    passedCount,
    totalChecks: checks.length,
    checks,
  };
}
