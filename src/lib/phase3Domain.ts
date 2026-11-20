/**
 * Archivo: src/lib/phase3Domain.ts
 * Responsabilidad: Motor puro de cálculo contractual mensual (aniversario DEC-03,
 *   regla de días 29/30/31 DEC-18 confirmada, prorrateo por días reales DEC-05),
 *   detección de doble ocupación (RF-014), resolución de versiones de tarifa (RF-024)
 *   y derivación de saldos y morosidad informativa de CxC (DEC-04, DEC-01).
 * Cumplimiento LuchoRentas.md: §4.4, §4.5, RF-014, RF-022 a RF-025, RF-030 a RF-032,
 *   DEC-01, DEC-03, DEC-04, DEC-05, DEC-06 y DEC-18 confirmada.
 */
import type {
  ContractPeriodPreview,
  CurrencyCode,
  Property,
  PropertyUnit,
  ReceivableCharge,
  ReceivableEffectiveStatus,
  RentalContract,
  RentalContractVersion,
} from '../types/domain';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseIsoDateParts(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: m, day: d };
}

export function formatIsoDateParts(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDaysIso(iso: string, deltaDays: number): string {
  const { year, month, day } = parseIsoDateParts(iso);
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return formatIsoDateParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function diffDaysInclusive(startIso: string, endIso: string): number {
  const s = parseIsoDateParts(startIso);
  const e = parseIsoDateParts(endIso);
  const msStart = Date.UTC(s.year, s.month - 1, s.day);
  const msEnd = Date.UTC(e.year, e.month - 1, e.day);
  if (msEnd < msStart) return 0;
  return Math.floor((msEnd - msStart) / 86_400_000) + 1;
}

export function getLaPazTodayIso(referenceDate = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(referenceDate);
}

/**
 * DEC-18 (confirmada): Conserva el día ancla original (ej. 29, 30, 31),
 * usa el último día disponible en meses cortos y recupera el ancla original al mes siguiente.
 */
export function clampAnchorDate(
  baseYear: number,
  baseMonth: number,
  monthOffset: number,
  anchorDay: number
): string {
  const totalMonths = baseYear * 12 + (baseMonth - 1) + monthOffset;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const maxDay = daysInMonth(year, month);
  return formatIsoDateParts(year, month, Math.min(anchorDay, maxDay));
}

export function roundCurrency2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Resuelve la versión de tarifa aplicable al inicio nominal del período (RF-024 / CA-024).
 */
export function resolveContractVersionForDate(
  versions: RentalContractVersion[],
  contractId: string,
  nominalPeriodStart: string,
  fallbackAmount: number,
  fallbackCurrency: CurrencyCode
): { versionId: string | null; monthlyAmount: number; currency: CurrencyCode } {
  const applicable = versions
    .filter((v) => v.contractId === contractId && v.effectiveFrom <= nominalPeriodStart)
    .sort((a, b) => {
      if (b.effectiveFrom !== a.effectiveFrom) {
        return b.effectiveFrom.localeCompare(a.effectiveFrom);
      }
      return b.versionNumber - a.versionNumber;
    });

  if (applicable.length > 0) {
    return {
      versionId: applicable[0].id,
      monthlyAmount: applicable[0].monthlyAmount,
      currency: applicable[0].currency,
    };
  }

  return {
    versionId: null,
    monthlyAmount: fallbackAmount,
    currency: fallbackCurrency,
  };
}

/**
 * Calcula un período contractual mensual por aniversario con prorrateo por días reales (DEC-03, DEC-05, DEC-18).
 */
export function computeContractPeriod(params: {
  firstPeriodStartDate: string;
  anchorDay: number;
  periodIndex: number;
  contractEndDate: string | null;
  monthlyAmount: number;
  currency: CurrencyCode;
  versionId?: string | null;
}): ContractPeriodPreview | null {
  const {
    firstPeriodStartDate,
    anchorDay,
    periodIndex,
    contractEndDate,
    monthlyAmount,
    currency,
    versionId = null,
  } = params;

  if (periodIndex < 0 || !firstPeriodStartDate) return null;

  const { year, month } = parseIsoDateParts(firstPeriodStartDate);
  const nominalStart = clampAnchorDate(year, month, periodIndex, anchorDay);
  const nextNominalStart = clampAnchorDate(year, month, periodIndex + 1, anchorDay);
  const nominalEnd = addDaysIso(nextNominalStart, -1);

  const effectiveStart = nominalStart;
  const effectiveEnd =
    contractEndDate && contractEndDate < nominalEnd ? contractEndDate : nominalEnd;

  const calendarDaysDivisor = diffDaysInclusive(nominalStart, nominalEnd);
  const coveredDays = diffDaysInclusive(effectiveStart, effectiveEnd);

  if (coveredDays <= 0) {
    return null;
  }

  const isProrated = coveredDays < calendarDaysDivisor;
  const calculatedAmount = isProrated
    ? roundCurrency2((monthlyAmount / calendarDaysDivisor) * coveredDays)
    : roundCurrency2(monthlyAmount);

  return {
    periodIndex,
    nominalStart,
    nominalEnd,
    effectiveStart,
    effectiveEnd,
    // DEC-04: La obligación vence al inicio del período
    dueDate: effectiveStart,
    calendarDaysDivisor,
    coveredDays,
    isProrated,
    baseMonthlyAmount: monthlyAmount,
    currency,
    calculatedAmount,
    versionId,
  };
}

/**
 * Previsualiza los próximos períodos mensuales de un contrato antes de confirmar (CA-023).
 */
export function previewContractSchedule(params: {
  firstPeriodStartDate: string;
  endDate: string | null;
  monthlyAmount: number;
  currency: CurrencyCode;
  versions?: RentalContractVersion[];
  contractId?: string;
  maxPeriods?: number;
}): ContractPeriodPreview[] {
  const {
    firstPeriodStartDate,
    endDate,
    monthlyAmount,
    currency,
    versions = [],
    contractId = '',
    maxPeriods = 6,
  } = params;

  if (!firstPeriodStartDate || monthlyAmount <= 0) return [];
  const { day: anchorDay } = parseIsoDateParts(firstPeriodStartDate);
  const result: ContractPeriodPreview[] = [];

  for (let i = 0; i < maxPeriods; i += 1) {
    const { year, month } = parseIsoDateParts(firstPeriodStartDate);
    const nomStart = clampAnchorDate(year, month, i, anchorDay);
    const resolved = contractId
      ? resolveContractVersionForDate(versions, contractId, nomStart, monthlyAmount, currency)
      : { versionId: null, monthlyAmount, currency };

    const period = computeContractPeriod({
      firstPeriodStartDate,
      anchorDay,
      periodIndex: i,
      contractEndDate: endDate,
      monthlyAmount: resolved.monthlyAmount,
      currency: resolved.currency,
      versionId: resolved.versionId,
    });

    if (!period) break;
    result.push(period);
  }

  return result;
}

/**
 * Encuentra el índice de período que cubre una fecha dada (para el corte automático diario sin retroactividad, DEC-06).
 */
export function findPeriodIndexCoveringDate(
  firstPeriodStartDate: string,
  anchorDay: number,
  targetDate: string,
  contractEndDate: string | null
): number | null {
  if (targetDate < firstPeriodStartDate) return null;
  if (contractEndDate && targetDate > contractEndDate) return null;

  const first = parseIsoDateParts(firstPeriodStartDate);
  const target = parseIsoDateParts(targetDate);
  const approxOffset = (target.year - first.year) * 12 + (target.month - first.month);

  for (let idx = Math.max(0, approxOffset - 1); idx <= approxOffset + 1; idx += 1) {
    const period = computeContractPeriod({
      firstPeriodStartDate,
      anchorDay,
      periodIndex: idx,
      contractEndDate,
      monthlyAmount: 1,
      currency: 'BOB',
    });
    if (period && targetDate >= period.effectiveStart && targetDate <= period.effectiveEnd) {
      return idx;
    }
  }
  return null;
}

/**
 * Verifica compatibilidad e impide doble ocupación en una casa o cuarto (RF-014, §4.2).
 */
export function validateContractOccupancy(params: {
  candidate: {
    id?: string;
    tenantId: string;
    propertyId: string;
    unitId: string;
    startDate: string;
    endDate: string | null;
  };
  property: Property | undefined;
  unit: PropertyUnit | undefined;
  existingContracts: RentalContract[];
}): { valid: true } | { valid: false; error: string } {
  const { candidate, property, unit, existingContracts } = params;

  if (!property || property.tenantId !== candidate.tenantId || !property.isActive) {
    return { valid: false, error: 'Casa no encontrada o inactiva en el tenant activo.' };
  }
  if (!unit || unit.propertyId !== property.id || unit.tenantId !== candidate.tenantId || !unit.isActive) {
    return { valid: false, error: 'Unidad no válida para la casa seleccionada.' };
  }
  if (unit.status === 'out_of_service') {
    return {
      valid: false,
      error: 'La unidad está fuera de servicio. Habilítala antes de activar el contrato.',
    };
  }
  if (property.rentalMode === 'full_house' && !unit.isDefaultHouseUnit) {
    return {
      valid: false,
      error: 'Una casa en modalidad Casa completa solo admite contratos sobre su unidad única.',
    };
  }
  if (property.rentalMode === 'by_rooms' && unit.isDefaultHouseUnit) {
    return {
      valid: false,
      error: 'Una casa Por cuartos requiere elegir un cuarto independiente.',
    };
  }

  const candEnd = candidate.endDate ?? '9999-12-31';

  const conflict = existingContracts.find((c) => {
    if (c.tenantId !== candidate.tenantId) return false;
    if (c.id === candidate.id) return false;
    if (c.status !== 'active') return false;

    const sameScope =
      c.unitId === candidate.unitId ||
      (property.rentalMode === 'full_house' && c.propertyId === candidate.propertyId);

    if (!sameScope) return false;

    const existingEnd = c.endDate ?? '9999-12-31';
    return c.startDate <= candEnd && existingEnd >= candidate.startDate;
  });

  if (conflict) {
    return {
      valid: false,
      error: `Doble ocupación bloqueada: el contrato ${conflict.contractCode} ya ocupa esa unidad en el intervalo indicado.`,
    };
  }

  return { valid: true };
}

/**
 * Calcula saldo derivado, estado efectivo y días de mora informativa (DEC-04, CA-032).
 * El saldo nunca se edita manualmente; surge de amount - paidAmount - adjustedAmount.
 */
export function deriveReceivableState(
  charge: ReceivableCharge,
  todayLaPazIso: string
): {
  balance: number;
  effectiveStatus: ReceivableEffectiveStatus;
  daysOverdue: number;
} {
  if (charge.status === 'voided') {
    return {
      balance: 0,
      effectiveStatus: 'voided',
      daysOverdue: 0,
    };
  }

  const balance = roundCurrency2(
    Math.max(0, charge.amount - charge.paidAmount - charge.adjustedAmount)
  );

  if (balance <= 0) {
    return {
      balance: 0,
      effectiveStatus: 'paid',
      daysOverdue: 0,
    };
  }

  const isOverdue = todayLaPazIso > charge.dueDate;
  const daysOverdue = isOverdue ? Math.max(1, diffDaysInclusive(charge.dueDate, todayLaPazIso) - 1) : 0;

  if (charge.paidAmount > 0) {
    return {
      balance,
      effectiveStatus: 'partially_paid',
      daysOverdue,
    };
  }

  return {
    balance,
    effectiveStatus: isOverdue ? 'overdue' : 'pending',
    daysOverdue,
  };
}

/**
 * Resume totales de CxC estrictamente separados por moneda BOB y USD (DEC-01).
 */
export function summarizeReceivablesByCurrency(
  charges: ReceivableCharge[],
  todayLaPazIso: string
): Record<
  CurrencyCode,
  {
    totalIssued: number;
    pendingNotOverdue: number;
    overdueBalance: number;
    totalPendingBalance: number;
    overdueChargesCount: number;
  }
> & { uniqueDelinquentTenantsCount: number } {
  const emptyBucket = () => ({
    totalIssued: 0,
    pendingNotOverdue: 0,
    overdueBalance: 0,
    totalPendingBalance: 0,
    overdueChargesCount: 0,
  });

  const summary = {
    BOB: emptyBucket(),
    USD: emptyBucket(),
    uniqueDelinquentTenantsCount: 0,
  };

  const delinquentTenants = new Set<string>();

  for (const ch of charges) {
    const derived = deriveReceivableState(ch, todayLaPazIso);
    if (derived.effectiveStatus === 'voided') continue;

    const bucket = summary[ch.currency];
    bucket.totalIssued = roundCurrency2(bucket.totalIssued + ch.amount);

    if (derived.balance > 0) {
      bucket.totalPendingBalance = roundCurrency2(bucket.totalPendingBalance + derived.balance);
      if (derived.daysOverdue > 0) {
        bucket.overdueBalance = roundCurrency2(bucket.overdueBalance + derived.balance);
        bucket.overdueChargesCount += 1;
        delinquentTenants.add(ch.tenantPersonId);
      } else {
        bucket.pendingNotOverdue = roundCurrency2(bucket.pendingNotOverdue + derived.balance);
      }
    }
  }

  summary.uniqueDelinquentTenantsCount = delinquentTenants.size;
  return summary;
}
