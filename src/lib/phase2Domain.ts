/**
 * Archivo: src/lib/phase2Domain.ts
 * Responsabilidad: Reglas puras de negocio para Fase 2: validación de modalidad de casa,
 *   transición de estado de unidades/cuartos (impidiendo contradecir ocupación),
 *   validación de suma 100% de participaciones de copropietarios y filtrado tenant-safe.
 * Cumplimiento LuchoRentas.md: §4.2 (casas completas vs cuartos, estado ocupado derivado),
 *   §4.3 (personas con múltiples roles), §4.9 / DEC-10 (suma 100% vigente), DEC-13 (alcance).
 */
import type {
  Person,
  Property,
  PropertyOwnerLink,
  PropertyUnit,
  RentalMode,
  TenantMembership,
  UnitStatus,
} from '../types/domain';

export interface OwnerShareInput {
  personId: string;
  ownershipPercent: number;
  notes?: string;
}

/**
 * Valida que las participaciones vigentes de copropietarios sumen exactamente 100.00%
 * cuando existen uno o más propietarios asignados a una casa (DEC-10).
 */
export function validateOwnerShares(
  shares: OwnerShareInput[],
  peopleInTenant: Person[]
): { valid: true } | { valid: false; error: string } {
  if (shares.length === 0) {
    return { valid: true };
  }

  const seenPersons = new Set<string>();
  let totalCents = 0;

  for (const item of shares) {
    if (seenPersons.has(item.personId)) {
      return {
        valid: false,
        error: 'No puedes asignar dos veces a la misma persona como copropietario vigente.',
      };
    }
    seenPersons.add(item.personId);

    const person = peopleInTenant.find((p) => p.id === item.personId && p.isActive);
    if (!person) {
      return {
        valid: false,
        error: 'El propietario seleccionado no existe o está inactivo en este espacio.',
      };
    }
    if (!person.roles.includes('property_owner')) {
      return {
        valid: false,
        error: `${person.fullName} no tiene el rol de Propietario asignado en su ficha.`,
      };
    }

    if (!Number.isFinite(item.ownershipPercent) || item.ownershipPercent <= 0 || item.ownershipPercent > 100) {
      return {
        valid: false,
        error: 'Cada participación debe ser mayor a 0% y menor o igual a 100%.',
      };
    }

    totalCents += Math.round(item.ownershipPercent * 100);
  }

  if (totalCents !== 10000) {
    const actualPct = (totalCents / 100).toFixed(2);
    return {
      valid: false,
      error: `La suma de participaciones vigentes debe ser exactamente 100.00% (actual: ${actualPct}%).`,
    };
  }

  return { valid: true };
}

/**
 * Valida si una casa puede cambiar su modalidad de alquiler (full_house <-> by_rooms).
 * Impide el cambio si alguna unidad figura ocupada (§4.2).
 */
export function validateRentalModeChange(
  property: Property,
  nextMode: RentalMode,
  unitsOfProperty: PropertyUnit[]
): { valid: true } | { valid: false; error: string } {
  if (property.rentalMode === nextMode) {
    return { valid: true };
  }

  const hasOccupied = unitsOfProperty.some(
    (u) => u.propertyId === property.id && u.isActive && u.status === 'occupied'
  );
  if (hasOccupied) {
    return {
      valid: false,
      error:
        'No se puede cambiar la modalidad de alquiler mientras existan unidades ocupadas o contratos vigentes.',
    };
  }

  return { valid: true };
}

/**
 * Valida transición manual de estado de una unidad.
 * §4.2: El estado "occupied" se deriva de contratos activos y no puede forzarse ni
 * contradecirse manualmente.
 */
export function validateManualUnitStatusChange(
  currentStatus: UnitStatus,
  nextStatus: UnitStatus
): { valid: true } | { valid: false; error: string } {
  if (nextStatus === 'occupied' && currentStatus !== 'occupied') {
    return {
      valid: false,
      error:
        'El estado "Ocupada" se deriva automáticamente de contratos activos y no puede marcarse manualmente.',
    };
  }

  if (currentStatus === 'occupied' && nextStatus !== 'occupied') {
    return {
      valid: false,
      error:
        'Esta unidad está ocupada por un contrato vigente. Finaliza el contrato antes de cambiar su estado.',
    };
  }

  return { valid: true };
}

/**
 * Filtra casas visibles para la membresía activa según aislamiento por tenant_id
 * y alcance opcional por casa (DEC-13).
 */
export function filterPropertiesForMembership(
  properties: Property[],
  membership: TenantMembership | null | undefined
): Property[] {
  if (!membership || membership.status !== 'active') return [];
  return properties.filter((prop) => {
    if (prop.tenantId !== membership.tenantId) return false;
    if (membership.role === 'tenant_owner') return true;
    if (membership.allowedPropertyIds === null) return true;
    return membership.allowedPropertyIds.includes(prop.id);
  });
}

/**
 * Resume conteo operativo de unidades de una casa excluyendo inactivas.
 */
export function summarizePropertyUnits(units: PropertyUnit[]) {
  const active = units.filter((u) => u.isActive);
  const occupied = active.filter((u) => u.status === 'occupied').length;
  const available = active.filter((u) => u.status === 'available').length;
  const outOfService = active.filter((u) => u.status === 'out_of_service').length;
  return {
    totalActive: active.length,
    occupied,
    available,
    outOfService,
  };
}

/**
 * Devuelve las participaciones vigentes (effectiveTo === null) de una casa.
 */
export function getActivePropertyOwners(
  links: PropertyOwnerLink[],
  tenantId: string,
  propertyId: string
): PropertyOwnerLink[] {
  return links.filter(
    (l) => l.tenantId === tenantId && l.propertyId === propertyId && l.effectiveTo === null
  );
}
