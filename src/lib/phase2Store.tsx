/**
 * Archivo: src/lib/phase2Store.tsx
 * Responsabilidad: Proveedor de estado y operaciones transaccionales de Fase 2 (Casas,
 *   Unidades/Cuartos, Personas multi-rol y Propietarios) con aislamiento estricto por
 *   tenant_id, validación de doble capa (Capa 1 + Capa 2) y soporte Supabase/Preview.
 * Cumplimiento LuchoRentas.md: RF-010 a RF-014, RF-020, RF-021, RF-044, DEC-10 (100%
 *   copropietarios), DEC-13 (alcance por casa) y §4.2 (estado ocupado derivado).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import {
  filterPropertiesForMembership,
  type OwnerShareInput,
  validateManualUnitStatusChange,
  validateOwnerShares,
  validateRentalModeChange,
} from './phase2Domain';
import { SEED_PEOPLE, SEED_PROPERTIES, SEED_PROPERTY_OWNERS, SEED_UNITS } from './phase2Seed';
import { validateTenantMutation } from './rbac';
import { isSupabaseConfigured, supabase } from './supabase';
import type {
  CurrencyCode,
  Person,
  PersonBusinessRole,
  PersonType,
  Property,
  PropertyOwnerLink,
  PropertyUnit,
  RentalMode,
  UnitStatus,
} from '../types/domain';

interface Phase2StoreData {
  properties: Property[];
  units: PropertyUnit[];
  people: Person[];
  propertyOwners: PropertyOwnerLink[];
}

const STORAGE_KEY = 'luchorentas_phase2_store_v1';

interface ActionResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface Phase2ContextValue {
  properties: Property[];
  units: PropertyUnit[];
  people: Person[];
  propertyOwners: PropertyOwnerLink[];
  isLoading: boolean;
  createProperty: (input: {
    name: string;
    address: string;
    description: string;
    rentalMode: RentalMode;
    referenceRent: number | null;
    currency: CurrencyCode;
  }) => Promise<ActionResult<Property>>;
  updateProperty: (
    propertyId: string,
    input: {
      name: string;
      address: string;
      description: string;
      rentalMode: RentalMode;
    }
  ) => Promise<ActionResult>;
  upsertPropertyUnit: (input: {
    id?: string;
    propertyId: string;
    code: string;
    name: string;
    referenceRent: number | null;
    currency: CurrencyCode;
    notes: string;
  }) => Promise<ActionResult>;
  changeUnitStatus: (
    propertyId: string,
    unitId: string,
    nextStatus: UnitStatus
  ) => Promise<ActionResult>;
  savePropertyOwners: (
    propertyId: string,
    shares: OwnerShareInput[]
  ) => Promise<ActionResult>;
  upsertPerson: (input: {
    id?: string;
    fullName: string;
    personType: PersonType;
    documentId: string;
    phone: string;
    whatsapp: string;
    email: string;
    address: string;
    notes: string;
    roles: PersonBusinessRole[];
  }) => Promise<ActionResult<Person>>;
  togglePersonStatus: (personId: string, isActive: boolean) => Promise<ActionResult>;
  refreshPhase2: () => Promise<void>;
  syncUnitOccupancyStatus: (unitId: string, nextStatus: 'available' | 'occupied') => void;
}

const Phase2Context = createContext<Phase2ContextValue | null>(null);

function loadPreviewPhase2(): Phase2StoreData {
  const fallback: Phase2StoreData = {
    properties: SEED_PROPERTIES,
    units: SEED_UNITS,
    people: SEED_PEOPLE,
    propertyOwners: SEED_PROPERTY_OWNERS,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Phase2StoreData>;
    return {
      properties: parsed.properties ?? fallback.properties,
      units: parsed.units ?? fallback.units,
      people: parsed.people ?? fallback.people,
      propertyOwners: parsed.propertyOwners ?? fallback.propertyOwners,
    };
  } catch {
    return fallback;
  }
}

export function Phase2Provider({ children }: { children: React.ReactNode }) {
  const { activeTenant, activeMembership, tenantPermissions } = useAuth();
  const [store, setStore] = useState<Phase2StoreData>(loadPreviewPhase2);
  const [liveData, setLiveData] = useState<Phase2StoreData>({
    properties: [],
    units: [],
    people: [],
    propertyOwners: [],
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isSupabaseConfigured) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Ignorar si almacenamiento está lleno
    }
  }, [store]);

  const loadSupabasePhase2 = useCallback(async (tenantId: string) => {
    if (!supabase) return;
    setIsLoading(true);
    const [
      { data: propRows },
      { data: unitRows },
      { data: peopleRows },
      { data: roleRows },
      { data: ownerRows },
    ] = await Promise.all([
      supabase.from('properties').select('*').eq('tenant_id', tenantId).order('created_at'),
      supabase.from('property_units').select('*').eq('tenant_id', tenantId).order('code'),
      supabase.from('people').select('*').eq('tenant_id', tenantId).order('full_name'),
      supabase.from('person_roles').select('person_id, role').eq('tenant_id', tenantId),
      supabase.from('property_owners').select('*').eq('tenant_id', tenantId),
    ]);

    const rolesByPerson = new Map<string, PersonBusinessRole[]>();
    for (const rr of (roleRows as Array<{ person_id: string; role: PersonBusinessRole }>) ?? []) {
      const list = rolesByPerson.get(rr.person_id) ?? [];
      list.push(rr.role);
      rolesByPerson.set(rr.person_id, list);
    }

    setLiveData({
      properties: ((propRows as Array<Record<string, unknown>>) ?? []).map((p) => ({
        id: String(p.id),
        tenantId: String(p.tenant_id),
        name: String(p.name),
        address: String(p.address),
        description: String(p.description ?? ''),
        rentalMode: p.rental_mode as RentalMode,
        isActive: Boolean(p.is_active),
        createdAt: String(p.created_at),
        updatedAt: String(p.updated_at),
      })),
      units: ((unitRows as Array<Record<string, unknown>>) ?? []).map((u) => ({
        id: String(u.id),
        tenantId: String(u.tenant_id),
        propertyId: String(u.property_id),
        code: String(u.code),
        name: String(u.name),
        isDefaultHouseUnit: Boolean(u.is_default_house_unit),
        status: u.status as UnitStatus,
        referenceRent: u.reference_rent !== null ? Number(u.reference_rent) : null,
        currency: (u.currency as CurrencyCode) ?? 'BOB',
        notes: String(u.notes ?? ''),
        isActive: Boolean(u.is_active),
        createdAt: String(u.created_at),
        updatedAt: String(u.updated_at),
      })),
      people: ((peopleRows as Array<Record<string, unknown>>) ?? []).map((pe) => ({
        id: String(pe.id),
        tenantId: String(pe.tenant_id),
        fullName: String(pe.full_name),
        personType: pe.person_type as PersonType,
        documentId: String(pe.document_id ?? ''),
        phone: String(pe.phone ?? ''),
        whatsapp: String(pe.whatsapp ?? ''),
        email: String(pe.email ?? ''),
        address: String(pe.address ?? ''),
        notes: String(pe.notes ?? ''),
        roles: rolesByPerson.get(String(pe.id)) ?? [],
        isActive: Boolean(pe.is_active),
        createdAt: String(pe.created_at),
        updatedAt: String(pe.updated_at),
      })),
      propertyOwners: ((ownerRows as Array<Record<string, unknown>>) ?? []).map((o) => ({
        id: String(o.id),
        tenantId: String(o.tenant_id),
        propertyId: String(o.property_id),
        personId: String(o.person_id),
        ownershipPercent: Number(o.ownership_percent),
        effectiveFrom: String(o.effective_from),
        effectiveTo: o.effective_to ? String(o.effective_to) : null,
        notes: String(o.notes ?? ''),
      })),
    });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!activeTenant || !activeMembership) {
      setLiveData({ properties: [], units: [], people: [], propertyOwners: [] });
      return;
    }
    void loadSupabasePhase2(activeTenant.id);
  }, [activeTenant, activeMembership, loadSupabasePhase2]);

  const rawData = isSupabaseConfigured ? liveData : store;

  // Aislamiento estricto por tenant_id y alcance por casa (DEC-13)
  const visibleProperties = useMemo(() => {
    return filterPropertiesForMembership(rawData.properties, activeMembership);
  }, [activeMembership, rawData.properties]);

  const visiblePropertyIds = useMemo(
    () => new Set(visibleProperties.map((p) => p.id)),
    [visibleProperties]
  );

  const visibleUnits = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.units.filter(
      (u) => u.tenantId === activeTenant.id && visiblePropertyIds.has(u.propertyId) && u.isActive
    );
  }, [activeTenant, rawData.units, visiblePropertyIds]);

  const visiblePeople = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.people.filter((p) => p.tenantId === activeTenant.id);
  }, [activeTenant, rawData.people]);

  const visibleOwners = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.propertyOwners.filter(
      (o) => o.tenantId === activeTenant.id && visiblePropertyIds.has(o.propertyId)
    );
  }, [activeTenant, rawData.propertyOwners, visiblePropertyIds]);

  const createProperty: Phase2ContextValue['createProperty'] = async (input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'properties',
      action: 'manage',
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const cleanName = input.name.trim();
    const cleanAddress = input.address.trim();
    if (cleanName.length < 2) return { ok: false, error: 'El nombre de la casa debe tener al menos 2 caracteres.' };
    if (cleanAddress.length < 3) return { ok: false, error: 'Ingresa una dirección válida (mínimo 3 caracteres).' };

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('create_property', {
        p_tenant_id: activeTenant.id,
        p_name: cleanName,
        p_address: cleanAddress,
        p_rental_mode: input.rentalMode,
        p_description: input.description.trim(),
        p_reference_rent: input.referenceRent,
        p_currency: input.currency,
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase2(activeTenant.id);
      return {
        ok: true,
        data: {
          id: String(data.id),
          tenantId: String(data.tenant_id),
          name: String(data.name),
          address: String(data.address),
          description: String(data.description ?? ''),
          rentalMode: data.rental_mode as RentalMode,
          isActive: Boolean(data.is_active),
          createdAt: String(data.created_at),
          updatedAt: String(data.updated_at),
        },
      };
    }

    const nowIso = new Date().toISOString();
    const propId = `prop-${crypto.randomUUID().slice(0, 8)}`;
    const newProp: Property = {
      id: propId,
      tenantId: activeTenant.id,
      name: cleanName,
      address: cleanAddress,
      description: input.description.trim(),
      rentalMode: input.rentalMode,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const newUnits: PropertyUnit[] =
      input.rentalMode === 'full_house'
        ? [
            {
              id: `unit-${crypto.randomUUID().slice(0, 8)}`,
              tenantId: activeTenant.id,
              propertyId: propId,
              code: 'CASA-COMPLETA',
              name: `${cleanName} (Casa completa)`,
              isDefaultHouseUnit: true,
              status: 'available',
              referenceRent: input.referenceRent,
              currency: input.currency,
              notes: '',
              isActive: true,
              createdAt: nowIso,
              updatedAt: nowIso,
            },
          ]
        : [];

    setStore((prev) => ({
      ...prev,
      properties: [...prev.properties, newProp],
      units: [...prev.units, ...newUnits],
    }));

    return { ok: true, data: newProp };
  };

  const updateProperty: Phase2ContextValue['updateProperty'] = async (propertyId, input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'properties',
      action: 'manage',
      propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const target = visibleProperties.find((p) => p.id === propertyId);
    if (!target) return { ok: false, error: 'Casa no encontrada en el espacio activo.' };

    const modeCheck = validateRentalModeChange(target, input.rentalMode, visibleUnits);
    if (!modeCheck.valid) return { ok: false, error: modeCheck.error };

    const cleanName = input.name.trim();
    const cleanAddress = input.address.trim();
    if (cleanName.length < 2 || cleanAddress.length < 3) {
      return { ok: false, error: 'Nombre y dirección válidos son obligatorios.' };
    }

    if (isSupabaseConfigured && supabase) {
      if (target.rentalMode !== input.rentalMode) {
        const { error: modeErr } = await supabase.rpc('update_property_rental_mode', {
          p_tenant_id: activeTenant.id,
          p_property_id: propertyId,
          p_new_mode: input.rentalMode,
        });
        if (modeErr) return { ok: false, error: modeErr.message };
      }
      const { error } = await supabase
        .from('properties')
        .update({ name: cleanName, address: cleanAddress, description: input.description.trim() })
        .eq('id', propertyId)
        .eq('tenant_id', activeTenant.id);
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase2(activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => {
      let nextUnits = prev.units.map((u) => {
        if (u.propertyId !== propertyId || u.tenantId !== activeTenant.id) return u;
        if (input.rentalMode === 'full_house' && !u.isDefaultHouseUnit) {
          return { ...u, isActive: false, updatedAt: nowIso };
        }
        if (input.rentalMode === 'by_rooms' && u.isDefaultHouseUnit) {
          return { ...u, isActive: false, updatedAt: nowIso };
        }
        return u;
      });

      if (input.rentalMode === 'full_house') {
        const existingFull = nextUnits.find(
          (u) => u.propertyId === propertyId && u.isDefaultHouseUnit
        );
        if (existingFull) {
          nextUnits = nextUnits.map((u) =>
            u.id === existingFull.id ? { ...u, isActive: true, name: `${cleanName} (Casa completa)` } : u
          );
        } else {
          nextUnits.push({
            id: `unit-${crypto.randomUUID().slice(0, 8)}`,
            tenantId: activeTenant.id,
            propertyId,
            code: 'CASA-COMPLETA',
            name: `${cleanName} (Casa completa)`,
            isDefaultHouseUnit: true,
            status: 'available',
            referenceRent: null,
            currency: activeTenant.defaultCurrency,
            notes: '',
            isActive: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
      }

      return {
        ...prev,
        properties: prev.properties.map((p) =>
          p.id === propertyId && p.tenantId === activeTenant.id
            ? {
                ...p,
                name: cleanName,
                address: cleanAddress,
                description: input.description.trim(),
                rentalMode: input.rentalMode,
                updatedAt: nowIso,
              }
            : p
        ),
        units: nextUnits,
      };
    });

    return { ok: true };
  };

  const upsertPropertyUnit: Phase2ContextValue['upsertPropertyUnit'] = async (input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'properties',
      action: 'manage',
      propertyId: input.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const prop = visibleProperties.find((p) => p.id === input.propertyId);
    if (!prop) return { ok: false, error: 'Inmueble no encontrado.' };

    if (prop.rentalMode === 'full_house' && !input.id) {
      return {
        ok: false,
        error: 'Una casa en modalidad "Casa completa" solo tiene una única unidad alquilable.',
      };
    }

    const cleanCode = input.code.trim().toUpperCase();
    const cleanName = input.name.trim();
    if (!cleanCode || cleanName.length < 2) {
      return { ok: false, error: 'Código y nombre de la unidad son obligatorios.' };
    }

    const duplicateCode = visibleUnits.some(
      (u) =>
        u.propertyId === input.propertyId &&
        u.code.toUpperCase() === cleanCode &&
        u.id !== input.id
    );
    if (duplicateCode) {
      return { ok: false, error: `Ya existe una unidad con el código "${cleanCode}" en esta casa.` };
    }

    if (isSupabaseConfigured && supabase) {
      if (input.id) {
        const { error } = await supabase
          .from('property_units')
          .update({
            code: cleanCode,
            name: cleanName,
            reference_rent: input.referenceRent,
            currency: input.currency,
            notes: input.notes.trim(),
          })
          .eq('id', input.id)
          .eq('tenant_id', activeTenant.id);
        if (error) return { ok: false, error: error.message };
      } else {
        const { error } = await supabase.from('property_units').insert({
          tenant_id: activeTenant.id,
          property_id: input.propertyId,
          code: cleanCode,
          name: cleanName,
          is_default_house_unit: false,
          status: 'available',
          reference_rent: input.referenceRent,
          currency: input.currency,
          notes: input.notes.trim(),
        });
        if (error) return { ok: false, error: error.message };
      }
      await loadSupabasePhase2(activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => {
      if (input.id) {
        return {
          ...prev,
          units: prev.units.map((u) =>
            u.id === input.id && u.tenantId === activeTenant.id
              ? {
                  ...u,
                  code: cleanCode,
                  name: cleanName,
                  referenceRent: input.referenceRent,
                  currency: input.currency,
                  notes: input.notes.trim(),
                  updatedAt: nowIso,
                }
              : u
          ),
        };
      }
      return {
        ...prev,
        units: [
          ...prev.units,
          {
            id: `unit-${crypto.randomUUID().slice(0, 8)}`,
            tenantId: activeTenant.id,
            propertyId: input.propertyId,
            code: cleanCode,
            name: cleanName,
            isDefaultHouseUnit: false,
            status: 'available',
            referenceRent: input.referenceRent,
            currency: input.currency,
            notes: input.notes.trim(),
            isActive: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ],
      };
    });

    return { ok: true };
  };

  const changeUnitStatus: Phase2ContextValue['changeUnitStatus'] = async (
    propertyId,
    unitId,
    nextStatus
  ) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'properties',
      action: 'manage',
      propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const unit = visibleUnits.find((u) => u.id === unitId && u.propertyId === propertyId);
    if (!unit) return { ok: false, error: 'Unidad no encontrada.' };

    const statusCheck = validateManualUnitStatusChange(unit.status, nextStatus);
    if (!statusCheck.valid) return { ok: false, error: statusCheck.error };

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase
        .from('property_units')
        .update({ status: nextStatus })
        .eq('id', unitId)
        .eq('tenant_id', activeTenant.id);
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase2(activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => ({
      ...prev,
      units: prev.units.map((u) =>
        u.id === unitId && u.tenantId === activeTenant.id
          ? { ...u, status: nextStatus, updatedAt: nowIso }
          : u
      ),
    }));
    return { ok: true };
  };

  const savePropertyOwners: Phase2ContextValue['savePropertyOwners'] = async (
    propertyId,
    shares
  ) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'properties',
      action: 'manage',
      propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const validation = validateOwnerShares(shares, visiblePeople);
    if (!validation.valid) return { ok: false, error: validation.error };

    if (isSupabaseConfigured && supabase) {
      const payload = shares.map((s) => ({
        person_id: s.personId,
        ownership_percent: s.ownershipPercent,
        notes: s.notes ?? '',
      }));
      const { error } = await supabase.rpc('save_property_owners', {
        p_tenant_id: activeTenant.id,
        p_property_id: propertyId,
        p_owners: payload,
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase2(activeTenant.id);
      return { ok: true };
    }

    const todayLaPaz = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    setStore((prev) => {
      // Conservar histórico cerrando effectiveTo en enlaces vigentes previos (DEC-10)
      const closed = prev.propertyOwners.map((link) =>
        link.tenantId === activeTenant.id &&
        link.propertyId === propertyId &&
        link.effectiveTo === null
          ? { ...link, effectiveTo: todayLaPaz }
          : link
      );
      const added: PropertyOwnerLink[] = shares.map((s) => ({
        id: `po-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: activeTenant.id,
        propertyId,
        personId: s.personId,
        ownershipPercent: Number(s.ownershipPercent.toFixed(2)),
        effectiveFrom: todayLaPaz,
        effectiveTo: null,
        notes: s.notes?.trim() ?? '',
      }));
      return {
        ...prev,
        propertyOwners: [...closed, ...added],
      };
    });

    return { ok: true };
  };

  const upsertPerson: Phase2ContextValue['upsertPerson'] = async (input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'people',
      action: 'manage',
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const cleanName = input.fullName.trim();
    if (cleanName.length < 2) {
      return { ok: false, error: 'El nombre o razón social debe tener al menos 2 caracteres.' };
    }
    if (input.roles.length === 0) {
      return { ok: false, error: 'Selecciona al menos un rol para la ficha de persona.' };
    }

    if (isSupabaseConfigured && supabase) {
      let personId = input.id;
      if (personId) {
        const { error } = await supabase
          .from('people')
          .update({
            full_name: cleanName,
            person_type: input.personType,
            document_id: input.documentId.trim(),
            phone: input.phone.trim(),
            whatsapp: input.whatsapp.trim(),
            email: input.email.trim(),
            address: input.address.trim(),
            notes: input.notes.trim(),
          })
          .eq('id', personId)
          .eq('tenant_id', activeTenant.id);
        if (error) return { ok: false, error: error.message };
        await supabase
          .from('person_roles')
          .delete()
          .eq('tenant_id', activeTenant.id)
          .eq('person_id', personId);
      } else {
        const { data, error } = await supabase
          .from('people')
          .insert({
            tenant_id: activeTenant.id,
            full_name: cleanName,
            person_type: input.personType,
            document_id: input.documentId.trim(),
            phone: input.phone.trim(),
            whatsapp: input.whatsapp.trim(),
            email: input.email.trim(),
            address: input.address.trim(),
            notes: input.notes.trim(),
          })
          .select()
          .single();
        if (error || !data) return { ok: false, error: error?.message ?? 'Error al crear persona.' };
        personId = String(data.id);
      }

      const { error: rolesErr } = await supabase.from('person_roles').insert(
        input.roles.map((r) => ({
          tenant_id: activeTenant.id,
          person_id: personId!,
          role: r,
        }))
      );
      if (rolesErr) return { ok: false, error: rolesErr.message };

      await loadSupabasePhase2(activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    if (input.id) {
      let updatedPerson: Person | undefined;
      setStore((prev) => ({
        ...prev,
        people: prev.people.map((p) => {
          if (p.id === input.id && p.tenantId === activeTenant.id) {
            updatedPerson = {
              ...p,
              fullName: cleanName,
              personType: input.personType,
              documentId: input.documentId.trim(),
              phone: input.phone.trim(),
              whatsapp: input.whatsapp.trim(),
              email: input.email.trim(),
              address: input.address.trim(),
              notes: input.notes.trim(),
              roles: [...input.roles],
              updatedAt: nowIso,
            };
            return updatedPerson;
          }
          return p;
        }),
      }));
      return { ok: true, data: updatedPerson };
    }

    const created: Person = {
      id: `per-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      fullName: cleanName,
      personType: input.personType,
      documentId: input.documentId.trim(),
      phone: input.phone.trim(),
      whatsapp: input.whatsapp.trim(),
      email: input.email.trim(),
      address: input.address.trim(),
      notes: input.notes.trim(),
      roles: [...input.roles],
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setStore((prev) => ({
      ...prev,
      people: [...prev.people, created],
    }));
    return { ok: true, data: created };
  };

  const togglePersonStatus: Phase2ContextValue['togglePersonStatus'] = async (
    personId,
    isActive
  ) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'people',
      action: 'manage',
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase
        .from('people')
        .update({ is_active: isActive })
        .eq('id', personId)
        .eq('tenant_id', activeTenant.id);
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase2(activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => ({
      ...prev,
      people: prev.people.map((p) =>
        p.id === personId && p.tenantId === activeTenant.id
          ? { ...p, isActive, updatedAt: nowIso }
          : p
      ),
    }));
    return { ok: true };
  };

  const refreshPhase2 = useCallback(async () => {
    if (isSupabaseConfigured && activeTenant) {
      await loadSupabasePhase2(activeTenant.id);
    }
  }, [activeTenant, loadSupabasePhase2]);

  const syncUnitOccupancyStatus = useCallback(
    (unitId: string, nextStatus: 'available' | 'occupied') => {
      if (isSupabaseConfigured || !activeTenant) return;
      const nowIso = new Date().toISOString();
      setStore((prev) => ({
        ...prev,
        units: prev.units.map((u) =>
          u.id === unitId && u.tenantId === activeTenant.id
            ? { ...u, status: nextStatus, updatedAt: nowIso }
            : u
        ),
      }));
    },
    [activeTenant]
  );

  return (
    <Phase2Context.Provider
      value={{
        properties: visibleProperties,
        units: visibleUnits,
        people: visiblePeople,
        propertyOwners: visibleOwners,
        isLoading,
        createProperty,
        updateProperty,
        upsertPropertyUnit,
        changeUnitStatus,
        savePropertyOwners,
        upsertPerson,
        togglePersonStatus,
        refreshPhase2,
        syncUnitOccupancyStatus,
      }}
    >
      {children}
    </Phase2Context.Provider>
  );
}

export function usePhase2(): Phase2ContextValue {
  const ctx = useContext(Phase2Context);
  if (!ctx) {
    throw new Error('usePhase2 debe usarse dentro de Phase2Provider');
  }
  return ctx;
}
