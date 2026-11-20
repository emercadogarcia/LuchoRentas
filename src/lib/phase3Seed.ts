/**
 * Archivo: src/lib/phase3Seed.ts
 * Responsabilidad: Datos semilla deterministas de Fase 3 (contratos mensuales en
 *   borrador y versiones iniciales) estrictamente aislados por tenant_id para vista previa local.
 * Cumplimiento LuchoRentas.md: Mantiene consistencia con el estado 'available' de SEED_UNITS
 *   y separa estrictamente Inmobiliaria Las Palmas (BOB) y Residencial Tunari (USD).
 */
import type { ReceivableCharge, RentalContract, RentalContractVersion } from '../types/domain';

export const SEED_CONTRACTS: RentalContract[] = [
  {
    id: 'ctr-palmas-1',
    tenantId: 'tenant-las-palmas',
    contractCode: 'CTR-202611-PAL01',
    propertyId: 'prop-palmas-1',
    unitId: 'unit-palmas-101',
    tenantPersonId: 'per-palmas-3',
    status: 'draft',
    billingFrequency: 'monthly',
    startDate: '2026-11-15',
    firstPeriodStartDate: '2026-11-15',
    endDate: null,
    anchorDay: 15,
    monthlyAmount: 1150,
    currency: 'BOB',
    notes: 'Contrato borrador listo para revisión de calendario por aniversario y activación.',
    finalizationReason: '',
    activatedAt: null,
    finalizedAt: null,
    createdAt: '2026-11-14T10:00:00-04:00',
    updatedAt: '2026-11-14T10:00:00-04:00',
  },
  {
    id: 'ctr-tunari-1',
    tenantId: 'tenant-tunari',
    contractCode: 'CTR-202611-TUN01',
    propertyId: 'prop-tunari-1',
    unitId: 'unit-tunari-a',
    tenantPersonId: 'per-tunari-2',
    status: 'draft',
    billingFrequency: 'monthly',
    startDate: '2026-11-30',
    firstPeriodStartDate: '2026-11-30',
    endDate: null,
    anchorDay: 30,
    monthlyAmount: 220,
    currency: 'USD',
    notes: 'Contrato ejecutivo con ancla día 30 (regla DEC-18 confirmada).',
    finalizationReason: '',
    activatedAt: null,
    finalizedAt: null,
    createdAt: '2026-11-18T11:00:00-04:00',
    updatedAt: '2026-11-18T11:00:00-04:00',
  },
];

export const SEED_CONTRACT_VERSIONS: RentalContractVersion[] = [
  {
    id: 'ctrv-palmas-1',
    tenantId: 'tenant-las-palmas',
    contractId: 'ctr-palmas-1',
    versionNumber: 1,
    effectiveFrom: '2026-11-15',
    monthlyAmount: 1150,
    currency: 'BOB',
    notes: 'Condiciones iniciales',
    createdAt: '2026-11-14T10:00:00-04:00',
  },
  {
    id: 'ctrv-tunari-1',
    tenantId: 'tenant-tunari',
    contractId: 'ctr-tunari-1',
    versionNumber: 1,
    effectiveFrom: '2026-11-30',
    monthlyAmount: 220,
    currency: 'USD',
    notes: 'Condiciones iniciales',
    createdAt: '2026-11-18T11:00:00-04:00',
  },
];

export const SEED_RECEIVABLES: ReceivableCharge[] = [];
