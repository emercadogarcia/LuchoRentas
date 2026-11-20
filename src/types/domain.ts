/**
 * Archivo: src/types/domain.ts
 * Responsabilidad: Definición estricta de tipos de dominio TypeScript para la Fase 1
 *   (tenants, perfiles, membresías, roles, permisos, monedas, modelos de pantalla y plan de fases).
 * Cumplimiento LuchoRentas.md: §4.1 (multi-tenant), §5 (roles), §14.2 (DEC-01 BOB/USD,
 *   America/La_Paz, DEC-13 permisos por módulo/acción/casa) y §17.2 (roadmap).
 */

export type CurrencyCode = 'BOB' | 'USD';

export type TenantTimezone = 'America/La_Paz';

export type TenantRole =
  | 'tenant_owner'
  | 'admin'
  | 'collector'
  | 'finance_operator'
  | 'viewer';

export type MembershipStatus = 'active' | 'inactive';

export type AppModuleId =
  | 'dashboard'
  | 'properties'
  | 'people'
  | 'contracts'
  | 'receivables'
  | 'collections'
  | 'expenses'
  | 'cash'
  | 'reports'
  | 'users_permissions';

export type ModuleAction =
  | 'view'
  | 'manage'
  | 'generate'
  | 'create'
  | 'reverse'
  | 'reconcile'
  | 'export';

export type ScreenArchetype = 'Modelo A' | 'Modelo B' | 'Modelo C' | 'Modelo D';

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  timezone: TenantTimezone;
  defaultCurrency: CurrencyCode;
  isActive: boolean;
  createdAt: string;
}

export interface TenantMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: TenantRole;
  status: MembershipStatus;
  allowedPropertyIds: string[] | null;
  createdAt: string;
  updatedAt: string;
  profile?: UserProfile;
}

export interface RolePermissionRule {
  id: string;
  tenantId: string;
  role: Exclude<TenantRole, 'tenant_owner'>;
  moduleId: AppModuleId;
  actionId: ModuleAction;
  allowed: boolean;
}

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ModuleCatalogItem {
  id: AppModuleId;
  label: string;
  archetype: ScreenArchetype;
  phase: 1 | 2 | 3 | 4 | 5 | 6;
  description: string;
  requiredAction: ModuleAction;
}

export interface PhaseRoadmapItem {
  phase: number;
  title: string;
  status: 'active' | 'pending';
  scope: string;
  deliverables: string[];
}

export const ROLE_LABELS: Record<TenantRole, string> = {
  tenant_owner: 'Propietario del tenant',
  admin: 'Administrador',
  collector: 'Cobrador',
  finance_operator: 'Operador financiero',
  viewer: 'Consulta (Solo lectura)',
};

export const ROLE_DESCRIPTIONS: Record<TenantRole, string> = {
  tenant_owner: 'Control total del espacio, casas, usuarios, configuración y finanzas.',
  admin: 'Gestiona casas, contratos, personas, cuentas, cobros y gastos según permisos.',
  collector: 'Consulta cuentas por cobrar y registra cobros con recibo correlativo.',
  finance_operator: 'Registra gastos, pagos a proveedores, caja y arqueos.',
  viewer: 'Accede únicamente a reportes y consultas autorizadas en solo lectura.',
};

// ----------------------------------------------------------------------------
// Fase 2: Casas, Unidades/Cuartos, Personas multi-rol y Propietarios
// ----------------------------------------------------------------------------

export type RentalMode = 'full_house' | 'by_rooms';

export type UnitStatus = 'available' | 'occupied' | 'out_of_service';

export type PersonType = 'individual' | 'company';

export type PersonBusinessRole =
  | 'tenant_renter'
  | 'property_owner'
  | 'supplier'
  | 'contact';

export interface Property {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  description: string;
  rentalMode: RentalMode;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyUnit {
  id: string;
  tenantId: string;
  propertyId: string;
  code: string;
  name: string;
  isDefaultHouseUnit: boolean;
  status: UnitStatus;
  referenceRent: number | null;
  currency: CurrencyCode;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  id: string;
  tenantId: string;
  fullName: string;
  personType: PersonType;
  documentId: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  notes: string;
  roles: PersonBusinessRole[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyOwnerLink {
  id: string;
  tenantId: string;
  propertyId: string;
  personId: string;
  ownershipPercent: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string;
}

export const RENTAL_MODE_LABELS: Record<RentalMode, string> = {
  full_house: 'Casa completa',
  by_rooms: 'Por cuartos',
};

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  available: 'Disponible',
  occupied: 'Ocupada',
  out_of_service: 'Fuera de servicio',
};

export const PERSON_ROLE_LABELS: Record<PersonBusinessRole, string> = {
  tenant_renter: 'Inquilino',
  property_owner: 'Propietario',
  supplier: 'Proveedor',
  contact: 'Contacto / Otro',
};

// ----------------------------------------------------------------------------
// Fase 3: Contratos Mensuales, Versionado de Tarifas y Cuentas por Cobrar (CxC)
// ----------------------------------------------------------------------------

export type ContractStatus = 'draft' | 'active' | 'finalized' | 'cancelled';

export type ReceivableBaseStatus = 'pending' | 'partially_paid' | 'paid' | 'voided';

export type ReceivableEffectiveStatus =
  | 'pending'
  | 'overdue'
  | 'partially_paid'
  | 'paid'
  | 'voided';

export type ChargeGenerationMode = 'automatic_daily' | 'manual_period';

export interface RentalContract {
  id: string;
  tenantId: string;
  contractCode: string;
  propertyId: string;
  unitId: string;
  tenantPersonId: string;
  status: ContractStatus;
  billingFrequency: 'monthly';
  startDate: string;
  firstPeriodStartDate: string;
  endDate: string | null;
  anchorDay: number;
  monthlyAmount: number;
  currency: CurrencyCode;
  notes: string;
  finalizationReason: string;
  activatedAt: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RentalContractVersion {
  id: string;
  tenantId: string;
  contractId: string;
  versionNumber: number;
  effectiveFrom: string;
  monthlyAmount: number;
  currency: CurrencyCode;
  notes: string;
  createdAt: string;
}

export interface ReceivableCharge {
  id: string;
  tenantId: string;
  contractId: string;
  contractVersionId: string | null;
  propertyId: string;
  unitId: string;
  tenantPersonId: string;
  periodIndex: number;
  nominalPeriodStart: string;
  nominalPeriodEnd: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  calendarDaysDivisor: number;
  coveredDays: number;
  isProrated: boolean;
  baseMonthlyAmount: number;
  amount: number;
  paidAmount: number;
  adjustedAmount: number;
  currency: CurrencyCode;
  status: ReceivableBaseStatus;
  generationMode: ChargeGenerationMode;
  voidReason: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContractPeriodPreview {
  periodIndex: number;
  nominalStart: string;
  nominalEnd: string;
  effectiveStart: string;
  effectiveEnd: string;
  dueDate: string;
  calendarDaysDivisor: number;
  coveredDays: number;
  isProrated: boolean;
  baseMonthlyAmount: number;
  currency: CurrencyCode;
  calculatedAmount: number;
  versionId: string | null;
}

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Borrador',
  active: 'Activo',
  finalized: 'Finalizado',
  cancelled: 'Cancelado',
};

export const RECEIVABLE_STATUS_LABELS: Record<ReceivableEffectiveStatus, string> = {
  pending: 'Pendiente',
  overdue: 'Vencida',
  partially_paid: 'Parcialmente pagada',
  paid: 'Pagada',
  voided: 'Anulada',
};

// ----------------------------------------------------------------------------
// Fase 4: Cobros, Aplicaciones, Créditos por Excedente y Recibos Correlativos
// ----------------------------------------------------------------------------

export type PaymentMethod = 'cash' | 'bank_transfer' | 'qr' | 'other';

export type PaymentStatus = 'confirmed' | 'reversed';

export type PaymentEntryKind = 'collection' | 'reversal';

export type AllocationKind = 'payment' | 'credit_application' | 'reversal';

export type ReceiptStatus = 'valid' | 'voided_by_reversal';

export interface RentPayment {
  id: string;
  tenantId: string;
  propertyId: string;
  unitId: string;
  tenantPersonId: string;
  entryKind: PaymentEntryKind;
  status: PaymentStatus;
  effectiveAt: string;
  receivedAmount: number;
  appliedAmount: number;
  creditAmount: number;
  currency: CurrencyCode;
  paymentMethod: PaymentMethod;
  referenceCode: string;
  notes: string;
  collectedByUserId: string | null;
  collectedByName: string;
  reversedPaymentId: string | null;
  reversalReason: string;
  createdAt: string;
}

export interface PaymentAllocation {
  id: string;
  tenantId: string;
  paymentId: string;
  receivableChargeId: string;
  allocationKind: AllocationKind;
  allocatedAmount: number;
  notes: string;
  createdAt: string;
}

export interface TenantCredit {
  id: string;
  tenantId: string;
  tenantPersonId: string;
  sourcePaymentId: string;
  currency: CurrencyCode;
  originalAmount: number;
  remainingAmount: number;
  notes: string;
  createdAt: string;
}

export interface RentReceipt {
  id: string;
  tenantId: string;
  paymentId: string;
  propertyId: string;
  docType: 'rent_receipt';
  sequenceNumber: number;
  receiptNumber: string;
  issuedAt: string;
  tenantName: string;
  tenantPersonName: string;
  propertyName: string;
  unitName: string;
  conceptPeriod: string;
  amount: number;
  currency: CurrencyCode;
  paymentMethod: PaymentMethod;
  collectedByName: string;
  notes: string;
  nonFiscalLegend: string;
  status: ReceiptStatus;
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  bank_transfer: 'Transferencia bancaria',
  qr: 'QR / Billetera móvil',
  other: 'Otro método',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  confirmed: 'Confirmado',
  reversed: 'Revertido',
};

// ----------------------------------------------------------------------------
// Fase 5: Gastos, Cuentas por Pagar, Pagos a Proveedores, Caja y Arqueos
// ----------------------------------------------------------------------------

export type ExpenseScope = 'property' | 'unit' | 'tenant_general';

export type ExpenseStatus =
  | 'pending_approval'
  | 'approved'
  | 'partially_paid'
  | 'paid'
  | 'voided';

export type CashSessionStatus = 'open' | 'closed';

export type CashMovementDirection = 'inflow' | 'outflow';

export type CashMovementSource =
  | 'opening'
  | 'rent_collection'
  | 'collection_reversal'
  | 'expense_payment'
  | 'manual_adjustment';

export type ReconciliationStatus = 'balanced' | 'pending_approval' | 'approved';

export interface ExpenseCategory {
  id: string;
  tenantId: string;
  name: string;
  isSystemDefault: boolean;
  isActive: boolean;
}

export interface ExpenseItem {
  id: string;
  tenantId: string;
  expenseCode: string;
  scope: ExpenseScope;
  propertyId: string | null;
  unitId: string | null;
  categoryId: string;
  supplierPersonId: string | null;
  concept: string;
  expenseDate: string;
  dueDate: string | null;
  amount: number;
  paidAmount: number;
  currency: CurrencyCode;
  status: ExpenseStatus;
  notes: string;
  evidenceName: string;
  evidencePath: string;
  approvedBy: string | null;
  approvedAt: string | null;
  voidReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpensePayment {
  id: string;
  tenantId: string;
  expenseId: string;
  cashSessionId: string;
  effectiveAt: string;
  amount: number;
  currency: CurrencyCode;
  paymentMethod: PaymentMethod;
  referenceCode: string;
  notes: string;
  paidByUserId: string | null;
  paidByName: string;
  createdAt: string;
}

export interface CashAccount {
  id: string;
  tenantId: string;
  ownerUserId: string;
  ownerName: string;
  currency: CurrencyCode;
  isActive: boolean;
}

export interface CashSession {
  id: string;
  tenantId: string;
  cashAccountId: string;
  ownerUserId: string;
  ownerName: string;
  currency: CurrencyCode;
  status: CashSessionStatus;
  openedAt: string;
  openingBalance: number;
  closedAt: string | null;
  closingExpectedBalance: number | null;
  closingCountedBalance: number | null;
  notes: string;
}

export interface CashMovement {
  id: string;
  tenantId: string;
  cashAccountId: string;
  cashSessionId: string;
  currency: CurrencyCode;
  direction: CashMovementDirection;
  sourceType: CashMovementSource;
  sourceId: string | null;
  linkedMovementId: string | null;
  effectiveAt: string;
  amount: number;
  notes: string;
  createdBy: string | null;
  createdByName: string;
  createdAt: string;
}

export interface CashReconciliation {
  id: string;
  tenantId: string;
  cashSessionId: string;
  currency: CurrencyCode;
  reconciledAt: string;
  expectedBalance: number;
  countedBalance: number;
  differenceAmount: number;
  differenceReason: string;
  evidenceNote: string;
  status: ReconciliationStatus;
  recordedBy: string | null;
  recordedByName: string;
  approvedBy: string | null;
  approvedByName: string;
  approvedAt: string | null;
}

export const EXPENSE_SCOPE_LABELS: Record<ExpenseScope, string> = {
  property: 'Casa completa',
  unit: 'Cuarto / Unidad',
  tenant_general: 'General del espacio',
};

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  pending_approval: 'Pendiente de aprobación',
  approved: 'Aprobado por pagar',
  partially_paid: 'Parcialmente pagado',
  paid: 'Pagado',
  voided: 'Anulado',
};

export const CASH_MOVEMENT_SOURCE_LABELS: Record<CashMovementSource, string> = {
  opening: 'Apertura',
  rent_collection: 'Cobro de alquiler',
  collection_reversal: 'Reversión de cobro',
  expense_payment: 'Pago de gasto / proveedor',
  manual_adjustment: 'Movimiento compensatorio / ajuste',
};

export const RECONCILIATION_STATUS_LABELS: Record<ReconciliationStatus, string> = {
  balanced: 'Cuadrado',
  pending_approval: 'Diferencia por aprobar',
  approved: 'Diferencia aprobada',
};

// ----------------------------------------------------------------------------
// Fase 6: Dashboard Ejecutivo (Modelo A) y Reportes Financieros (Modelo D)
// ----------------------------------------------------------------------------

export type ReportTabKind = 'consolidated' | 'by_property' | 'by_owner';

export interface CurrencyMetricPair<T = number> {
  BOB: T;
  USD: T;
}

export interface ReceivableKpiBucket {
  total: number;
  notOverdue: number;
  overdue: number;
}

export interface PayableKpiBucket {
  total: number;
  overdue: number;
  pendingApproval: number;
}

export interface DashboardCollectionDetailItem {
  id: string;
  effectiveAt: string;
  tenantPersonName: string;
  propertyName: string;
  unitName: string;
  paymentMethod: string;
  amount: number;
  currency: CurrencyCode;
}

export interface DashboardReceivableDetailItem {
  id: string;
  propertyId: string;
  propertyName: string;
  unitName: string;
  tenantPersonId: string;
  tenantPersonName: string;
  dueDate: string;
  amount: number;
  balance: number;
  currency: CurrencyCode;
  isOverdue: boolean;
}

export interface DashboardPayableDetailItem {
  id: string;
  expenseCode: string;
  concept: string;
  categoryName: string;
  propertyName: string;
  dueDate: string | null;
  status: ExpenseStatus;
  amount: number;
  balance: number;
  currency: CurrencyCode;
  isOverdue: boolean;
}

export interface DashboardUnitDetailItem {
  unitId: string;
  propertyId: string;
  propertyName: string;
  unitName: string;
  rentalMode: RentalMode;
  stateAtClose: 'occupied' | 'available';
  tenantPersonName: string;
}

export interface DashboardData {
  month: number;
  year: number;
  periodStartIso: string;
  periodEndIso: string;
  effectiveCloseIso: string;
  collectionsByCurrency: CurrencyMetricPair<number>;
  receivablesByCurrency: CurrencyMetricPair<ReceivableKpiBucket>;
  payablesByCurrency: CurrencyMetricPair<PayableKpiBucket>;
  occupancyPercent: number;
  totalEnabledUnits: number;
  occupiedUnitsCount: number;
  availableUnitsCount: number;
  excludedOutOfServiceCount: number;
  delinquentTenantsCount: number;
  recentCollections: DashboardCollectionDetailItem[];
  allPeriodCollections: DashboardCollectionDetailItem[];
  recentExpensePayments: Array<{
    id: string;
    concept: string;
    categoryName: string;
    propertyName: string;
    effectiveAt: string;
    amount: number;
    currency: CurrencyCode;
  }>;
  allPeriodExpensePayments: Array<{
    id: string;
    concept: string;
    categoryName: string;
    propertyName: string;
    effectiveAt: string;
    amount: number;
    currency: CurrencyCode;
  }>;
  receivableDetails: DashboardReceivableDetailItem[];
  payableDetails: DashboardPayableDetailItem[];
  unitDetails: DashboardUnitDetailItem[];
}

export interface PropertyFinancialBreakdown {
  propertyId: string;
  propertyName: string;
  rentalMode: RentalMode;
  enabledUnitsCount: number;
  occupiedUnitsCount: number;
  collected: CurrencyMetricPair<number>;
  receivablePending: CurrencyMetricPair<number>;
  paidExpenses: CurrencyMetricPair<number>;
  payablePending: CurrencyMetricPair<number>;
  operatingResult: CurrencyMetricPair<number>;
}

export interface OwnerPropertyShareDetail {
  propertyId: string;
  propertyName: string;
  ownershipPercent: number;
  collected: CurrencyMetricPair<number>;
  paidExpenses: CurrencyMetricPair<number>;
  operatingResult: CurrencyMetricPair<number>;
}

export interface OwnerFinancialBreakdown {
  personId: string;
  ownerName: string;
  documentId: string;
  properties: OwnerPropertyShareDetail[];
  attributableCollected: CurrencyMetricPair<number>;
  attributablePaidExpenses: CurrencyMetricPair<number>;
  attributableOperatingResult: CurrencyMetricPair<number>;
}

export interface CategoryExpenseBreakdown {
  categoryId: string;
  categoryName: string;
  paidTotals: CurrencyMetricPair<number>;
  pendingTotals: CurrencyMetricPair<number>;
  paymentsCount: number;
}

export interface ReportMovementRow {
  id: string;
  kind: 'inflow' | 'outflow';
  effectiveAt: string;
  concept: string;
  categoryOrMethod: string;
  propertyId: string | null;
  propertyName: string;
  partyName: string;
  amount: number;
  currency: CurrencyCode;
}

export interface FinancialReportsData {
  month: number;
  year: number;
  periodStartIso: string;
  periodEndIso: string;
  collectedTotals: CurrencyMetricPair<number>;
  paidExpensesTotals: CurrencyMetricPair<number>;
  generalTenantExpensesPaid: CurrencyMetricPair<number>;
  operatingResultTotals: CurrencyMetricPair<number>;
  receivablesClosingTotals: CurrencyMetricPair<number>;
  payablesClosingTotals: CurrencyMetricPair<number>;
  byProperty: PropertyFinancialBreakdown[];
  byOwner: OwnerFinancialBreakdown[];
  byCategory: CategoryExpenseBreakdown[];
  movements: ReportMovementRow[];
}

export interface SchemaHealthStatus {
  checked: boolean;
  mode: 'supabase' | 'preview';
  ready: boolean;
  missingTables: string[];
  counts: {
    properties: number;
    units: number;
    people: number;
    activeContracts: number;
    receivables: number;
    payments: number;
    expenses: number;
    cashSessions: number;
  };
  errorMessage: string | null;
  checkedAt: string | null;
}

// ----------------------------------------------------------------------------
// Fase 7: QA, Integridad Financiera, RLS y Preparación de Liberación
// ----------------------------------------------------------------------------

export interface QaIntegrityCheckItem {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface QaIntegrityReport {
  checkedAt: string;
  tenantId: string;
  source: 'supabase_rpc' | 'local';
  passedCount: number;
  totalChecks: number;
  checks: QaIntegrityCheckItem[];
  errorMessage?: string | null;
}
