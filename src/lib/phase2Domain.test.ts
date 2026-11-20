/**
 * Archivo: src/lib/phase2Domain.test.ts
 * Responsabilidad: Pruebas unitarias deterministas de Fase 2 (reglas de modalidad de casas,
 *   bloqueo de edición manual de estado ocupado, suma exacta 100% de copropietarios y
 *   aislamiento por tenant_id / allowed_property_ids).
 * Cumplimiento LuchoRentas.md: Valida CA-010 a CA-014, CA-020, CA-021 y DEC-10 / DEC-13.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterPropertiesForMembership,
  validateManualUnitStatusChange,
  validateOwnerShares,
  validateRentalModeChange,
} from './phase2Domain';
import type { Person, Property, PropertyUnit, TenantMembership } from '../types/domain';

const people: Person[] = [
  {
    id: 'p-owner-1',
    tenantId: 't-1',
    fullName: 'Rosa Vargas',
    personType: 'individual',
    documentId: '4567890 SC',
    phone: '70011223',
    whatsapp: '70011223',
    email: '',
    address: '',
    notes: '',
    roles: ['property_owner'],
    isActive: true,
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
  },
  {
    id: 'p-owner-2',
    tenantId: 't-1',
    fullName: 'Mario Flores',
    personType: 'individual',
    documentId: '9876543 SC',
    phone: '70099887',
    whatsapp: '',
    email: '',
    address: '',
    notes: '',
    roles: ['property_owner', 'supplier'],
    isActive: true,
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
  },
  {
    id: 'p-renter-only',
    tenantId: 't-1',
    fullName: 'Ana Quispe',
    personType: 'individual',
    documentId: '1231231 LP',
    phone: '71112222',
    whatsapp: '',
    email: '',
    address: '',
    notes: '',
    roles: ['tenant_renter'],
    isActive: true,
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
  },
];

test('copropietarios vigentes deben sumar exactamente 100% (DEC-10)', () => {
  const badSum = validateOwnerShares(
    [
      { personId: 'p-owner-1', ownershipPercent: 60 },
      { personId: 'p-owner-2', ownershipPercent: 30 },
    ],
    people
  );
  assert.equal(badSum.valid, false);

  const okSum = validateOwnerShares(
    [
      { personId: 'p-owner-1', ownershipPercent: 33.33 },
      { personId: 'p-owner-2', ownershipPercent: 66.67 },
    ],
    people
  );
  assert.equal(okSum.valid, true);
});

test('no permite asociar como propietario a persona sin rol property_owner', () => {
  const res = validateOwnerShares([{ personId: 'p-renter-only', ownershipPercent: 100 }], people);
  assert.equal(res.valid, false);
});

test('no permite fijar ni sobrescribir manualmente estado occupied (§4.2)', () => {
  assert.equal(validateManualUnitStatusChange('available', 'occupied').valid, false);
  assert.equal(validateManualUnitStatusChange('occupied', 'available').valid, false);
  assert.equal(validateManualUnitStatusChange('available', 'out_of_service').valid, true);
});

test('bloquea cambio de modalidad cuando existen unidades ocupadas (§4.2)', () => {
  const prop: Property = {
    id: 'prop-1',
    tenantId: 't-1',
    name: 'Casa Norte',
    address: 'Av. Banzer Km 5',
    description: '',
    rentalMode: 'by_rooms',
    isActive: true,
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
  };
  const units: PropertyUnit[] = [
    {
      id: 'u-1',
      tenantId: 't-1',
      propertyId: 'prop-1',
      code: 'C-101',
      name: 'Cuarto 101',
      isDefaultHouseUnit: false,
      status: 'occupied',
      referenceRent: 1000,
      currency: 'BOB',
      notes: '',
      isActive: true,
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-01T10:00:00Z',
    },
  ];
  assert.equal(validateRentalModeChange(prop, 'full_house', units).valid, false);
});

test('filtra casas por tenant_id y alcance allowedPropertyIds (DEC-13)', () => {
  const props: Property[] = [
    {
      id: 'prop-1',
      tenantId: 't-1',
      name: 'Casa 1',
      address: 'Dir 1',
      description: '',
      rentalMode: 'full_house',
      isActive: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'prop-2',
      tenantId: 't-1',
      name: 'Casa 2',
      address: 'Dir 2',
      description: '',
      rentalMode: 'by_rooms',
      isActive: true,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'prop-other',
      tenantId: 't-2',
      name: 'Casa Ajena',
      address: 'Dir 3',
      description: '',
      rentalMode: 'full_house',
      isActive: true,
      createdAt: '',
      updatedAt: '',
    },
  ];
  const restrictedMember: TenantMembership = {
    id: 'm-1',
    tenantId: 't-1',
    userId: 'u-1',
    role: 'collector',
    status: 'active',
    allowedPropertyIds: ['prop-2'],
    createdAt: '',
    updatedAt: '',
  };
  const visible = filterPropertiesForMembership(props, restrictedMember);
  assert.deepEqual(
    visible.map((p) => p.id),
    ['prop-2']
  );
});
