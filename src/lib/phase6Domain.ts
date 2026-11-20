/**
 * Archivo: src/lib/phase6Domain.ts
 * Responsabilidad: Motor puro de cálculo para Fase 6 (Dashboard Ejecutivo Modelo A
 *   con filtro Mes/Año y Reportes Financieros Modelo D por período, casa y
 *   propietario informativo), manteniendo separación absoluta BOB/USD y métricas
 *   conciliadas con los movimientos confirmados.
 * Cumplimiento LuchoRentas.md: RF-050 a RF-058 (CA-050 a CA-058), §4.9, §9.2–§9.5,
 *   §15 (KPIs), DEC-01, DEC-09, DEC-10, DEC-11, DEC-13, DEC-14 y DEC-15.
 */
import { daysInMonth, formatIsoDateParts, getLaPazTodayIso, roundCurrency2 } from './phase3Domain';
import type {
  CategoryExpenseBreakdown,
  CurrencyCode,
  DashboardData,
  ExpenseCategory,
  ExpenseItem,
  ExpensePayment,
  FinancialReportsData,
  OwnerFinancialBreakdown,
  PaymentAllocation,
  Person,
  Property,
  PropertyOwnerLink,
  PropertyUnit,
  ReceivableCharge,
  RentalContract,
  RentPayment,
  ReportMovementRow,
  ReportTabKind,
} from '../types/domain';
import { PAYMENT_METHOD_LABELS } from '../types/domain';

export const BOLIVIA_MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

export function getLaPazDateFromTimestamp(isoTimestamp: string): string {
  const dt = new Date(isoTimestamp);
  if (Number.isNaN(dt.getTime())) {
    return isoTimestamp.slice(0, 10);
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt);
}

export function getMonthBoundsLaPaz(
  year: number,
  month: number,
  todayLaPaz = getLaPazTodayIso()
): {
  periodStartIso: string;
  periodEndIso: string;
  effectiveCloseIso: string;
} {
  const lastDay = daysInMonth(year, month);
  const periodStartIso = formatIsoDateParts(year, month, 1);
  const periodEndIso = formatIsoDateParts(year, month, lastDay);
  const effectiveCloseIso = periodEndIso < todayLaPaz ? periodEndIso : todayLaPaz;
  return { periodStartIso, periodEndIso, effectiveCloseIso };
}

function isUnitEnabledForProperty(property: Property, unit: PropertyUnit): boolean {
  if (!property.isActive || !unit.isActive) return false;
  if (property.rentalMode === 'full_house') return unit.isDefaultHouseUnit;
  return !unit.isDefaultHouseUnit;
}

function computeChargePendingAsOf(
  charge: ReceivableCharge,
  paymentsById: Map<string, RentPayment>,
  allocations: PaymentAllocation[],
  closeEndIso: string
): number {
  if (charge.status === 'voided') return 0;

  let appliedUpToClose = 0;
  let hasAllocationsTracked = false;

  for (const alloc of allocations) {
    if (alloc.receivableChargeId !== charge.id) continue;
    hasAllocationsTracked = true;
    const linkedPay = paymentsById.get(alloc.paymentId);
    const allocDate = linkedPay
      ? getLaPazDateFromTimestamp(linkedPay.effectiveAt)
      : getLaPazDateFromTimestamp(alloc.createdAt);
    if (allocDate <= closeEndIso) {
      appliedUpToClose = roundCurrency2(appliedUpToClose + alloc.allocatedAmount);
    }
  }

  // Respaldo si en una carga inicial existen pagos sin detalle de allocation cargado
  const effectivePaid = hasAllocationsTracked
    ? Math.max(0, appliedUpToClose)
    : charge.paidAmount;

  return Math.max(0, roundCurrency2(charge.amount - charge.adjustedAmount - effectivePaid));
}

function computeExpensePendingAsOf(
  expense: ExpenseItem,
  expensePayments: ExpensePayment[],
  closeEndIso: string
): number {
  if (expense.status === 'voided') return 0;
  let paidUpToClose = 0;
  for (const ep of expensePayments) {
    if (ep.expenseId !== expense.id) continue;
    if (getLaPazDateFromTimestamp(ep.effectiveAt) <= closeEndIso) {
      paidUpToClose = roundCurrency2(paidUpToClose + ep.amount);
    }
  }
  return Math.max(0, roundCurrency2(expense.amount - paidUpToClose));
}

/**
 * Calcula todos los bloques del Dashboard Ejecutivo Modelo A (§9.2–§9.5 / RF-050 a RF-053).
 */
export function computeExecutiveDashboard(params: {
  month: number;
  year: number;
  todayLaPaz?: string;
  properties: Property[];
  units: PropertyUnit[];
  people: Person[];
  contracts: RentalContract[];
  receivables: ReceivableCharge[];
  payments: RentPayment[];
  allocations: PaymentAllocation[];
  categories: ExpenseCategory[];
  expenses: ExpenseItem[];
  expensePayments: ExpensePayment[];
}): DashboardData {
  const {
    month,
    year,
    todayLaPaz = getLaPazTodayIso(),
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
  } = params;

  const { periodStartIso, periodEndIso, effectiveCloseIso } = getMonthBoundsLaPaz(
    year,
    month,
    todayLaPaz
  );

  const propMap = new Map(properties.map((p) => [p.id, p]));
  const unitMap = new Map(units.map((u) => [u.id, u]));
  const personMap = new Map(people.map((pe) => [pe.id, pe]));
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const paymentsById = new Map(payments.map((py) => [py.id, py]));
  const expenseMap = new Map(expenses.map((ex) => [ex.id, ex]));

  // 1. Cobros confirmados por fecha efectiva dentro del mes/año (§9.3)
  const collectionsByCurrency = { BOB: 0, USD: 0 };
  const periodCollections: DashboardData['allPeriodCollections'] = [];

  for (const py of payments) {
    if (py.entryKind !== 'collection' || py.status !== 'confirmed') continue;
    const effDate = getLaPazDateFromTimestamp(py.effectiveAt);
    if (effDate < periodStartIso || effDate > periodEndIso) continue;

    collectionsByCurrency[py.currency] = roundCurrency2(
      collectionsByCurrency[py.currency] + py.receivedAmount
    );

    periodCollections.push({
      id: py.id,
      effectiveAt: py.effectiveAt,
      tenantPersonName: personMap.get(py.tenantPersonId)?.fullName ?? 'Inquilino',
      propertyName: propMap.get(py.propertyId)?.name ?? 'Casa',
      unitName: unitMap.get(py.unitId)?.name ?? 'Unidad',
      paymentMethod: PAYMENT_METHOD_LABELS[py.paymentMethod] ?? py.paymentMethod,
      amount: py.receivedAmount,
      currency: py.currency,
    });
  }

  periodCollections.sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));

  // 2. Cuentas por cobrar del período y morosidad única al cierre (§9.3, §9.4)
  const receivablesByCurrency: DashboardData['receivablesByCurrency'] = {
    BOB: { total: 0, notOverdue: 0, overdue: 0 },
    USD: { total: 0, notOverdue: 0, overdue: 0 },
  };
  const receivableDetails: DashboardData['receivableDetails'] = [];
  const delinquentTenantIds = new Set<string>();

  for (const ch of receivables) {
    if (ch.status === 'voided') continue;
    if (ch.dueDate < periodStartIso || ch.dueDate > periodEndIso) continue;

    const pending = computeChargePendingAsOf(ch, paymentsById, allocations, periodEndIso);
    if (pending <= 0) continue;

    const isOverdue = ch.dueDate < effectiveCloseIso;
    const bucket = receivablesByCurrency[ch.currency];
    bucket.total = roundCurrency2(bucket.total + pending);
    if (isOverdue) {
      bucket.overdue = roundCurrency2(bucket.overdue + pending);
      delinquentTenantIds.add(ch.tenantPersonId);
    } else {
      bucket.notOverdue = roundCurrency2(bucket.notOverdue + pending);
    }

    receivableDetails.push({
      id: ch.id,
      propertyId: ch.propertyId,
      propertyName: propMap.get(ch.propertyId)?.name ?? 'Casa',
      unitName: unitMap.get(ch.unitId)?.name ?? 'Unidad',
      tenantPersonId: ch.tenantPersonId,
      tenantPersonName: personMap.get(ch.tenantPersonId)?.fullName ?? 'Inquilino',
      dueDate: ch.dueDate,
      amount: ch.amount,
      balance: pending,
      currency: ch.currency,
      isOverdue,
    });
  }

  // 3. Cuentas por pagar al cierre del período y pagos de gastos del período (§9.3, §9.5, DEC-09)
  const payablesByCurrency: DashboardData['payablesByCurrency'] = {
    BOB: { total: 0, overdue: 0, pendingApproval: 0 },
    USD: { total: 0, overdue: 0, pendingApproval: 0 },
  };
  const payableDetails: DashboardData['payableDetails'] = [];

  for (const ex of expenses) {
    if (ex.status === 'voided') continue;
    if (ex.expenseDate > periodEndIso) continue;

    const pending = computeExpensePendingAsOf(ex, expensePayments, periodEndIso);
    if (pending <= 0) continue;

    const isOverdue = Boolean(ex.dueDate && ex.dueDate < effectiveCloseIso);
    const bucket = payablesByCurrency[ex.currency];
    bucket.total = roundCurrency2(bucket.total + pending);
    if (isOverdue) {
      bucket.overdue = roundCurrency2(bucket.overdue + pending);
    }
    if (ex.status === 'pending_approval') {
      bucket.pendingApproval = roundCurrency2(bucket.pendingApproval + pending);
    }

    payableDetails.push({
      id: ex.id,
      expenseCode: ex.expenseCode,
      concept: ex.concept,
      categoryName: catMap.get(ex.categoryId)?.name ?? 'Categoría',
      propertyName: ex.propertyId ? propMap.get(ex.propertyId)?.name ?? 'Casa' : 'General del espacio',
      dueDate: ex.dueDate,
      status: ex.status,
      amount: ex.amount,
      balance: pending,
      currency: ex.currency,
      isOverdue,
    });
  }

  const allPeriodExpensePayments: DashboardData['allPeriodExpensePayments'] = [];
  for (const ep of expensePayments) {
    const effDate = getLaPazDateFromTimestamp(ep.effectiveAt);
    if (effDate < periodStartIso || effDate > periodEndIso) continue;
    const ex = expenseMap.get(ep.expenseId);
    allPeriodExpensePayments.push({
      id: ep.id,
      concept: ex?.concept ?? 'Pago a proveedor',
      categoryName: ex ? catMap.get(ex.categoryId)?.name ?? 'Otros' : 'Otros',
      propertyName: ex?.propertyId ? propMap.get(ex.propertyId)?.name ?? 'Casa' : 'General',
      effectiveAt: ep.effectiveAt,
      amount: ep.amount,
      currency: ep.currency,
    });
  }
  allPeriodExpensePayments.sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));

  // 4. Ocupación al último día del mes seleccionado (CA-052: excluye out_of_service)
  let totalEnabledUnits = 0;
  let occupiedUnitsCount = 0;
  let availableUnitsCount = 0;
  let excludedOutOfServiceCount = 0;
  const unitDetails: DashboardData['unitDetails'] = [];

  for (const unit of units) {
    const prop = propMap.get(unit.propertyId);
    if (!prop || !isUnitEnabledForProperty(prop, unit)) continue;

    if (unit.status === 'out_of_service') {
      excludedOutOfServiceCount += 1;
      continue;
    }

    totalEnabledUnits += 1;

    const occupyingContract = contracts.find(
      (c) =>
        c.unitId === unit.id &&
        (c.status === 'active' || c.status === 'finalized') &&
        c.startDate <= periodEndIso &&
        (c.endDate === null || c.endDate >= periodEndIso)
    );

    if (occupyingContract) {
      occupiedUnitsCount += 1;
      unitDetails.push({
        unitId: unit.id,
        propertyId: prop.id,
        propertyName: prop.name,
        unitName: unit.name,
        rentalMode: prop.rentalMode,
        stateAtClose: 'occupied',
        tenantPersonName: personMap.get(occupyingContract.tenantPersonId)?.fullName ?? 'Inquilino',
      });
    } else {
      availableUnitsCount += 1;
      unitDetails.push({
        unitId: unit.id,
        propertyId: prop.id,
        propertyName: prop.name,
        unitName: unit.name,
        rentalMode: prop.rentalMode,
        stateAtClose: 'available',
        tenantPersonName: 'Sin contrato vigente',
      });
    }
  }

  const occupancyPercent =
    totalEnabledUnits > 0 ? Math.round((occupiedUnitsCount / totalEnabledUnits) * 1000) / 10 : 0;

  return {
    month,
    year,
    periodStartIso,
    periodEndIso,
    effectiveCloseIso,
    collectionsByCurrency,
    receivablesByCurrency,
    payablesByCurrency,
    occupancyPercent,
    totalEnabledUnits,
    occupiedUnitsCount,
    availableUnitsCount,
    excludedOutOfServiceCount,
    delinquentTenantsCount: delinquentTenantIds.size,
    recentCollections: periodCollections.slice(0, 5),
    allPeriodCollections: periodCollections,
    recentExpensePayments: allPeriodExpensePayments.slice(0, 5),
    allPeriodExpensePayments,
    receivableDetails,
    payableDetails,
    unitDetails,
  };
}

/**
 * Calcula Reportes Financieros Modelo D: Consolidado, por Casa y por Propietario (RF-054 a RF-058).
 */
export function computeFinancialReports(params: {
  month: number;
  year: number;
  propertyIdFilter?: string;
  ownerPersonIdFilter?: string;
  categoryIdFilter?: string;
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
}): FinancialReportsData {
  const {
    month,
    year,
    propertyIdFilter = 'all',
    ownerPersonIdFilter = 'all',
    categoryIdFilter = 'all',
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
  } = params;

  const { periodStartIso, periodEndIso } = getMonthBoundsLaPaz(year, month);
  const propMap = new Map(properties.map((p) => [p.id, p]));
  const personMap = new Map(people.map((pe) => [pe.id, pe]));
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const paymentsById = new Map(payments.map((py) => [py.id, py]));
  const expenseMap = new Map(expenses.map((ex) => [ex.id, ex]));

  const filteredProps = properties.filter(
    (p) => p.isActive && (propertyIdFilter === 'all' || p.id === propertyIdFilter)
  );

  // Acumuladores globales
  const collectedTotals = { BOB: 0, USD: 0 };
  const paidExpensesTotals = { BOB: 0, USD: 0 };
  const generalTenantExpensesPaid = { BOB: 0, USD: 0 };
  const receivablesClosingTotals = { BOB: 0, USD: 0 };
  const payablesClosingTotals = { BOB: 0, USD: 0 };

  // Desglose por Casa (CA-056)
  const propRowsMap = new Map(
    filteredProps.map((p) => {
      const enabledUnits = units.filter(
        (u) => u.propertyId === p.id && isUnitEnabledForProperty(p, u) && u.status !== 'out_of_service'
      );
      const occupiedUnits = enabledUnits.filter((u) =>
        contracts.some(
          (c) =>
            c.unitId === u.id &&
            (c.status === 'active' || c.status === 'finalized') &&
            c.startDate <= periodEndIso &&
            (c.endDate === null || c.endDate >= periodEndIso)
        )
      );
      return [
        p.id,
        {
          propertyId: p.id,
          propertyName: p.name,
          rentalMode: p.rentalMode,
          enabledUnitsCount: enabledUnits.length,
          occupiedUnitsCount: occupiedUnits.length,
          collected: { BOB: 0, USD: 0 },
          receivablePending: { BOB: 0, USD: 0 },
          paidExpenses: { BOB: 0, USD: 0 },
          payablePending: { BOB: 0, USD: 0 },
          operatingResult: { BOB: 0, USD: 0 },
        },
      ];
    })
  );

  const movements: ReportMovementRow[] = [];

  for (const py of payments) {
    if (py.entryKind !== 'collection' || py.status !== 'confirmed') continue;
    if (propertyIdFilter !== 'all' && py.propertyId !== propertyIdFilter) continue;
    const effDate = getLaPazDateFromTimestamp(py.effectiveAt);
    if (effDate < periodStartIso || effDate > periodEndIso) continue;

    collectedTotals[py.currency] = roundCurrency2(collectedTotals[py.currency] + py.receivedAmount);
    const propRow = propRowsMap.get(py.propertyId);
    if (propRow) {
      propRow.collected[py.currency] = roundCurrency2(
        propRow.collected[py.currency] + py.receivedAmount
      );
    }

    movements.push({
      id: py.id,
      kind: 'inflow',
      effectiveAt: py.effectiveAt,
      concept: 'Cobro de alquiler',
      categoryOrMethod: PAYMENT_METHOD_LABELS[py.paymentMethod] ?? py.paymentMethod,
      propertyId: py.propertyId,
      propertyName: propMap.get(py.propertyId)?.name ?? 'Casa',
      partyName: personMap.get(py.tenantPersonId)?.fullName ?? 'Inquilino',
      amount: py.receivedAmount,
      currency: py.currency,
    });
  }

  // Categorías y pagos de gastos confirmados (DEC-09: solo pagos confirmados son egreso real)
  const categoryBreakdownMap = new Map<string, CategoryExpenseBreakdown>();
  const ensureCatRow = (catId: string): CategoryExpenseBreakdown => {
    const existing = categoryBreakdownMap.get(catId);
    if (existing) return existing;
    const created: CategoryExpenseBreakdown = {
      categoryId: catId,
      categoryName: catMap.get(catId)?.name ?? 'Otros',
      paidTotals: { BOB: 0, USD: 0 },
      pendingTotals: { BOB: 0, USD: 0 },
      paymentsCount: 0,
    };
    categoryBreakdownMap.set(catId, created);
    return created;
  };

  for (const ep of expensePayments) {
    const effDate = getLaPazDateFromTimestamp(ep.effectiveAt);
    if (effDate < periodStartIso || effDate > periodEndIso) continue;

    const ex = expenseMap.get(ep.expenseId);
    if (!ex) continue;
    if (propertyIdFilter !== 'all' && ex.propertyId !== propertyIdFilter) continue;
    if (categoryIdFilter !== 'all' && ex.categoryId !== categoryIdFilter) continue;

    paidExpensesTotals[ep.currency] = roundCurrency2(paidExpensesTotals[ep.currency] + ep.amount);
    if (ex.propertyId) {
      const propRow = propRowsMap.get(ex.propertyId);
      if (propRow) {
        propRow.paidExpenses[ep.currency] = roundCurrency2(
          propRow.paidExpenses[ep.currency] + ep.amount
        );
      }
    } else {
      generalTenantExpensesPaid[ep.currency] = roundCurrency2(
        generalTenantExpensesPaid[ep.currency] + ep.amount
      );
    }

    const catRow = ensureCatRow(ex.categoryId);
    catRow.paidTotals[ep.currency] = roundCurrency2(catRow.paidTotals[ep.currency] + ep.amount);
    catRow.paymentsCount += 1;

    movements.push({
      id: ep.id,
      kind: 'outflow',
      effectiveAt: ep.effectiveAt,
      concept: ex.concept,
      categoryOrMethod: catMap.get(ex.categoryId)?.name ?? 'Otros',
      propertyId: ex.propertyId,
      propertyName: ex.propertyId ? propMap.get(ex.propertyId)?.name ?? 'Casa' : 'General del espacio',
      partyName: ex.supplierPersonId
        ? personMap.get(ex.supplierPersonId)?.fullName ?? 'Proveedor'
        : 'Sin proveedor',
      amount: ep.amount,
      currency: ep.currency,
    });
  }

  for (const ch of receivables) {
    if (ch.status === 'voided') continue;
    if (propertyIdFilter !== 'all' && ch.propertyId !== propertyIdFilter) continue;
    if (ch.dueDate < periodStartIso || ch.dueDate > periodEndIso) continue;
    const pending = computeChargePendingAsOf(ch, paymentsById, allocations, periodEndIso);
    if (pending <= 0) continue;

    receivablesClosingTotals[ch.currency] = roundCurrency2(
      receivablesClosingTotals[ch.currency] + pending
    );
    const propRow = propRowsMap.get(ch.propertyId);
    if (propRow) {
      propRow.receivablePending[ch.currency] = roundCurrency2(
        propRow.receivablePending[ch.currency] + pending
      );
    }
  }

  for (const ex of expenses) {
    if (ex.status === 'voided') continue;
    if (propertyIdFilter !== 'all' && ex.propertyId !== propertyIdFilter) continue;
    if (categoryIdFilter !== 'all' && ex.categoryId !== categoryIdFilter) continue;
    if (ex.expenseDate > periodEndIso) continue;

    const pending = computeExpensePendingAsOf(ex, expensePayments, periodEndIso);
    if (pending <= 0) continue;

    payablesClosingTotals[ex.currency] = roundCurrency2(payablesClosingTotals[ex.currency] + pending);
    if (ex.propertyId) {
      const propRow = propRowsMap.get(ex.propertyId);
      if (propRow) {
        propRow.payablePending[ex.currency] = roundCurrency2(
          propRow.payablePending[ex.currency] + pending
        );
      }
    }
    const catRow = ensureCatRow(ex.categoryId);
    catRow.pendingTotals[ex.currency] = roundCurrency2(catRow.pendingTotals[ex.currency] + pending);
  }

  const byProperty = Array.from(propRowsMap.values())
    .map((row) => ({
      ...row,
      operatingResult: {
        BOB: roundCurrency2(row.collected.BOB - row.paidExpenses.BOB),
        USD: roundCurrency2(row.collected.USD - row.paidExpenses.USD),
      },
    }))
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName));

  // Desglose informativo por Propietario (CA-057 / DEC-10 / DEC-11)
  // Solo atribuye casas con relación de propiedad vigente en el mes. Nunca calcula comisiones.
  const ownerMap = new Map<string, OwnerFinancialBreakdown>();

  for (const link of propertyOwners) {
    if (propertyIdFilter !== 'all' && link.propertyId !== propertyIdFilter) continue;
    if (ownerPersonIdFilter !== 'all' && link.personId !== ownerPersonIdFilter) continue;
    if (link.effectiveFrom > periodEndIso) continue;
    if (link.effectiveTo && link.effectiveTo < periodStartIso) continue;

    const propRow = byProperty.find((pr) => pr.propertyId === link.propertyId);
    if (!propRow) continue;
    const ownerPerson = personMap.get(link.personId);
    if (!ownerPerson) continue;

    const factor = link.ownershipPercent / 100;
    const shareCollectedBob = roundCurrency2(propRow.collected.BOB * factor);
    const shareCollectedUsd = roundCurrency2(propRow.collected.USD * factor);
    const shareExpBob = roundCurrency2(propRow.paidExpenses.BOB * factor);
    const shareExpUsd = roundCurrency2(propRow.paidExpenses.USD * factor);
    const shareNetBob = roundCurrency2(shareCollectedBob - shareExpBob);
    const shareNetUsd = roundCurrency2(shareCollectedUsd - shareExpUsd);

    let ownerAgg = ownerMap.get(link.personId);
    if (!ownerAgg) {
      ownerAgg = {
        personId: link.personId,
        ownerName: ownerPerson.fullName,
        documentId: ownerPerson.documentId,
        properties: [],
        attributableCollected: { BOB: 0, USD: 0 },
        attributablePaidExpenses: { BOB: 0, USD: 0 },
        attributableOperatingResult: { BOB: 0, USD: 0 },
      };
      ownerMap.set(link.personId, ownerAgg);
    }

    ownerAgg.properties.push({
      propertyId: propRow.propertyId,
      propertyName: propRow.propertyName,
      ownershipPercent: link.ownershipPercent,
      collected: { BOB: shareCollectedBob, USD: shareCollectedUsd },
      paidExpenses: { BOB: shareExpBob, USD: shareExpUsd },
      operatingResult: { BOB: shareNetBob, USD: shareNetUsd },
    });

    ownerAgg.attributableCollected.BOB = roundCurrency2(
      ownerAgg.attributableCollected.BOB + shareCollectedBob
    );
    ownerAgg.attributableCollected.USD = roundCurrency2(
      ownerAgg.attributableCollected.USD + shareCollectedUsd
    );
    ownerAgg.attributablePaidExpenses.BOB = roundCurrency2(
      ownerAgg.attributablePaidExpenses.BOB + shareExpBob
    );
    ownerAgg.attributablePaidExpenses.USD = roundCurrency2(
      ownerAgg.attributablePaidExpenses.USD + shareExpUsd
    );
    ownerAgg.attributableOperatingResult.BOB = roundCurrency2(
      ownerAgg.attributableCollected.BOB - ownerAgg.attributablePaidExpenses.BOB
    );
    ownerAgg.attributableOperatingResult.USD = roundCurrency2(
      ownerAgg.attributableCollected.USD - ownerAgg.attributablePaidExpenses.USD
    );
  }

  movements.sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));

  return {
    month,
    year,
    periodStartIso,
    periodEndIso,
    collectedTotals,
    paidExpensesTotals,
    generalTenantExpensesPaid,
    operatingResultTotals: {
      BOB: roundCurrency2(collectedTotals.BOB - paidExpensesTotals.BOB),
      USD: roundCurrency2(collectedTotals.USD - paidExpensesTotals.USD),
    },
    receivablesClosingTotals,
    payablesClosingTotals,
    byProperty,
    byOwner: Array.from(ownerMap.values()).sort((a, b) =>
      a.ownerName.localeCompare(b.ownerName)
    ),
    byCategory: Array.from(categoryBreakdownMap.values()).sort((a, b) =>
      a.categoryName.localeCompare(b.categoryName)
    ),
    movements,
  };
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Construye contenido CSV UTF-8 con separación explícita BOB/USD (RF-058 / CA-058).
 */
export function buildReportCsv(
  report: FinancialReportsData,
  tab: ReportTabKind,
  tenantName: string
): string {
  const periodLabel = `${BOLIVIA_MONTH_LABELS[report.month - 1]} ${report.year}`;
  const lines: string[] = [];

  lines.push(`LuchoRentas,${escapeCsvCell(tenantName)},${escapeCsvCell(periodLabel)}`);

  if (tab === 'consolidated') {
    lines.push('Seccion,Tipo,FechaHora,Casa,Categoria_Metodo,Contraparte,Moneda,Monto');
    for (const m of report.movements) {
      lines.push(
        [
          'Movimiento',
          m.kind === 'inflow' ? 'Entrada' : 'Salida',
          m.effectiveAt,
          m.propertyName,
          m.categoryOrMethod,
          m.partyName,
          m.currency,
          m.amount.toFixed(2),
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
    lines.push(
      ['Resumen', 'Cobros', report.periodEndIso, 'Todas', '-', '-', 'BOB', report.collectedTotals.BOB.toFixed(2)].join(',')
    );
    lines.push(
      ['Resumen', 'EgresosPagados', report.periodEndIso, 'Todas', '-', '-', 'BOB', report.paidExpensesTotals.BOB.toFixed(2)].join(',')
    );
    lines.push(
      ['Resumen', 'ResultadoOperativo', report.periodEndIso, 'Todas', '-', '-', 'BOB', report.operatingResultTotals.BOB.toFixed(2)].join(',')
    );
    lines.push(
      ['Resumen', 'Cobros', report.periodEndIso, 'Todas', '-', '-', 'USD', report.collectedTotals.USD.toFixed(2)].join(',')
    );
    lines.push(
      ['Resumen', 'EgresosPagados', report.periodEndIso, 'Todas', '-', '-', 'USD', report.paidExpensesTotals.USD.toFixed(2)].join(',')
    );
    lines.push(
      ['Resumen', 'ResultadoOperativo', report.periodEndIso, 'Todas', '-', '-', 'USD', report.operatingResultTotals.USD.toFixed(2)].join(',')
    );
  } else if (tab === 'by_property') {
    lines.push(
      'Casa,Modalidad,UnidadesHabilitadas,UnidadesOcupadas,Cobros_BOB,GastosPagados_BOB,Resultado_BOB,SaldoCxC_BOB,Cobros_USD,GastosPagados_USD,Resultado_USD,SaldoCxC_USD'
    );
    for (const p of report.byProperty) {
      lines.push(
        [
          p.propertyName,
          p.rentalMode === 'full_house' ? 'Casa completa' : 'Por cuartos',
          p.enabledUnitsCount,
          p.occupiedUnitsCount,
          p.collected.BOB.toFixed(2),
          p.paidExpenses.BOB.toFixed(2),
          p.operatingResult.BOB.toFixed(2),
          p.receivablePending.BOB.toFixed(2),
          p.collected.USD.toFixed(2),
          p.paidExpenses.USD.toFixed(2),
          p.operatingResult.USD.toFixed(2),
          p.receivablePending.USD.toFixed(2),
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  } else {
    lines.push(
      'Propietario,Casa,ParticipacionPct,CobrosAtribuibles_BOB,GastosAtribuibles_BOB,ResultadoInformativo_BOB,CobrosAtribuibles_USD,GastosAtribuibles_USD,ResultadoInformativo_USD'
    );
    for (const ow of report.byOwner) {
      for (const sh of ow.properties) {
        lines.push(
          [
            ow.ownerName,
            sh.propertyName,
            sh.ownershipPercent.toFixed(2),
            sh.collected.BOB.toFixed(2),
            sh.paidExpenses.BOB.toFixed(2),
            sh.operatingResult.BOB.toFixed(2),
            sh.collected.USD.toFixed(2),
            sh.paidExpenses.USD.toFixed(2),
            sh.operatingResult.USD.toFixed(2),
          ]
            .map(escapeCsvCell)
            .join(',')
        );
      }
    }
  }

  return `\uFEFF${lines.join('\n')}`;
}
