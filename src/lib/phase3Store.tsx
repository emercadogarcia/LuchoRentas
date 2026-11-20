/**
 * Archivo: src/lib/phase3Store.tsx
 * Responsabilidad: Proveedor de estado y operaciones transaccionales de Fase 3
 *   (Contratos Mensuales, Versiones de Tarifa y Cuentas por Cobrar idempotentes)
 *   con aislamiento estricto por tenant_id, sincronización de ocupación con Fase 2
 *   y soporte transparente para Supabase y vista previa local.
 * Cumplimiento LuchoRentas.md: RF-014, RF-022 a RF-025, RF-030 a RF-032, DEC-03,
 *   DEC-04, DEC-05, DEC-06, DEC-13 y DEC-18 confirmada.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { usePhase2 } from './phase2Store';
import {
  computeContractPeriod,
  findPeriodIndexCoveringDate,
  getLaPazTodayIso,
  parseIsoDateParts,
  resolveContractVersionForDate,
  validateContractOccupancy,
} from './phase3Domain';
import { SEED_CONTRACTS, SEED_CONTRACT_VERSIONS, SEED_RECEIVABLES } from './phase3Seed';
import { validateTenantMutation } from './rbac';
import { isSupabaseConfigured, supabase } from './supabase';
import type {
  ChargeGenerationMode,
  ContractStatus,
  CurrencyCode,
  ReceivableBaseStatus,
  ReceivableCharge,
  RentalContract,
  RentalContractVersion,
} from '../types/domain';

interface Phase3StoreData {
  contracts: RentalContract[];
  versions: RentalContractVersion[];
  receivables: ReceivableCharge[];
}

const STORAGE_KEY = 'luchorentas_phase3_store_v1';

interface ActionResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface Phase3ContextValue {
  contracts: RentalContract[];
  versions: RentalContractVersion[];
  receivables: ReceivableCharge[];
  isLoading: boolean;
  createContract: (input: {
    propertyId: string;
    unitId: string;
    tenantPersonId: string;
    startDate: string;
    firstPeriodStartDate: string;
    endDate: string | null;
    monthlyAmount: number;
    currency: CurrencyCode;
    notes: string;
    activateNow: boolean;
  }) => Promise<ActionResult<RentalContract>>;
  activateContract: (contractId: string) => Promise<ActionResult>;
  addContractVersion: (input: {
    contractId: string;
    effectiveFrom: string;
    monthlyAmount: number;
    currency: CurrencyCode;
    notes: string;
  }) => Promise<ActionResult>;
  finalizeContract: (input: {
    contractId: string;
    effectiveEndDate: string;
    reason: string;
  }) => Promise<ActionResult>;
  generateReceivables: (input: {
    mode: ChargeGenerationMode;
    contractId?: string;
    periodIndex?: number;
    referenceDate?: string;
    regularizationReason?: string;
  }) => Promise<ActionResult<{ generatedCount: number; charges: ReceivableCharge[] }>>;
  voidReceivable: (chargeId: string, reason: string) => Promise<ActionResult>;
  refreshPhase3: () => Promise<void>;
  syncReceivablePaidAmount: (
    chargeId: string,
    nextPaidAmount: number,
    nextStatus: ReceivableBaseStatus
  ) => void;
}

const Phase3Context = createContext<Phase3ContextValue | null>(null);

function loadPreviewPhase3(): Phase3StoreData {
  const fallback: Phase3StoreData = {
    contracts: SEED_CONTRACTS,
    versions: SEED_CONTRACT_VERSIONS,
    receivables: SEED_RECEIVABLES,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Phase3StoreData>;
    return {
      contracts: parsed.contracts ?? fallback.contracts,
      versions: parsed.versions ?? fallback.versions,
      receivables: parsed.receivables ?? fallback.receivables,
    };
  } catch {
    return fallback;
  }
}

export function Phase3Provider({ children }: { children: React.ReactNode }) {
  const { activeTenant, activeMembership, tenantPermissions } = useAuth();
  const { properties, units, people, refreshPhase2, syncUnitOccupancyStatus } = usePhase2();

  const [store, setStore] = useState<Phase3StoreData>(loadPreviewPhase3);
  const [liveData, setLiveData] = useState<Phase3StoreData>({
    contracts: [],
    versions: [],
    receivables: [],
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

  const loadSupabasePhase3 = useCallback(async (tenantId: string) => {
    if (!supabase) return;
    setIsLoading(true);
    const [{ data: ctrRows }, { data: verRows }, { data: recRows }] = await Promise.all([
      supabase
        .from('rental_contracts')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
      supabase
        .from('rental_contract_versions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('version_number', { ascending: true }),
      supabase
        .from('receivable_charges')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('due_date', { ascending: false }),
    ]);

    setLiveData({
      contracts: ((ctrRows as Array<Record<string, unknown>>) ?? []).map((c) => ({
        id: String(c.id),
        tenantId: String(c.tenant_id),
        contractCode: String(c.contract_code),
        propertyId: String(c.property_id),
        unitId: String(c.unit_id),
        tenantPersonId: String(c.tenant_person_id),
        status: c.status as ContractStatus,
        billingFrequency: 'monthly',
        startDate: String(c.start_date),
        firstPeriodStartDate: String(c.first_period_start_date),
        endDate: c.end_date ? String(c.end_date) : null,
        anchorDay: Number(c.anchor_day),
        monthlyAmount: Number(c.monthly_amount),
        currency: (c.currency as CurrencyCode) ?? 'BOB',
        notes: String(c.notes ?? ''),
        finalizationReason: String(c.finalization_reason ?? ''),
        activatedAt: c.activated_at ? String(c.activated_at) : null,
        finalizedAt: c.finalized_at ? String(c.finalized_at) : null,
        createdAt: String(c.created_at),
        updatedAt: String(c.updated_at),
      })),
      versions: ((verRows as Array<Record<string, unknown>>) ?? []).map((v) => ({
        id: String(v.id),
        tenantId: String(v.tenant_id),
        contractId: String(v.contract_id),
        versionNumber: Number(v.version_number),
        effectiveFrom: String(v.effective_from),
        monthlyAmount: Number(v.monthly_amount),
        currency: (v.currency as CurrencyCode) ?? 'BOB',
        notes: String(v.notes ?? ''),
        createdAt: String(v.created_at),
      })),
      receivables: ((recRows as Array<Record<string, unknown>>) ?? []).map((r) => ({
        id: String(r.id),
        tenantId: String(r.tenant_id),
        contractId: String(r.contract_id),
        contractVersionId: r.contract_version_id ? String(r.contract_version_id) : null,
        propertyId: String(r.property_id),
        unitId: String(r.unit_id),
        tenantPersonId: String(r.tenant_person_id),
        periodIndex: Number(r.period_index),
        nominalPeriodStart: String(r.nominal_period_start),
        nominalPeriodEnd: String(r.nominal_period_end),
        periodStart: String(r.period_start),
        periodEnd: String(r.period_end),
        issueDate: String(r.issue_date),
        dueDate: String(r.due_date),
        calendarDaysDivisor: Number(r.calendar_days_divisor),
        coveredDays: Number(r.covered_days),
        isProrated: Boolean(r.is_prorated),
        baseMonthlyAmount: Number(r.base_monthly_amount),
        amount: Number(r.amount),
        paidAmount: Number(r.paid_amount ?? 0),
        adjustedAmount: Number(r.adjusted_amount ?? 0),
        currency: (r.currency as CurrencyCode) ?? 'BOB',
        status: r.status as ReceivableBaseStatus,
        generationMode: r.generation_mode as ChargeGenerationMode,
        voidReason: String(r.void_reason ?? ''),
        notes: String(r.notes ?? ''),
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      })),
    });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!activeTenant || !activeMembership) {
      setLiveData({ contracts: [], versions: [], receivables: [] });
      return;
    }
    void loadSupabasePhase3(activeTenant.id);
  }, [activeTenant, activeMembership, loadSupabasePhase3]);

  const rawData = isSupabaseConfigured ? liveData : store;

  const visiblePropertyIds = useMemo(
    () => new Set(properties.map((p) => p.id)),
    [properties]
  );

  const visibleContracts = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.contracts.filter(
      (c) => c.tenantId === activeTenant.id && visiblePropertyIds.has(c.propertyId)
    );
  }, [activeTenant, rawData.contracts, visiblePropertyIds]);

  const visibleContractIds = useMemo(
    () => new Set(visibleContracts.map((c) => c.id)),
    [visibleContracts]
  );

  const visibleVersions = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.versions.filter(
      (v) => v.tenantId === activeTenant.id && visibleContractIds.has(v.contractId)
    );
  }, [activeTenant, rawData.versions, visibleContractIds]);

  const visibleReceivables = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.receivables.filter(
      (r) => r.tenantId === activeTenant.id && visiblePropertyIds.has(r.propertyId)
    );
  }, [activeTenant, rawData.receivables, visiblePropertyIds]);

  const createContract: Phase3ContextValue['createContract'] = async (input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'contracts',
      action: 'manage',
      propertyId: input.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    if (!input.startDate || !input.firstPeriodStartDate) {
      return { ok: false, error: 'Las fechas de inicio y primer período son obligatorias.' };
    }
    if (input.firstPeriodStartDate < input.startDate) {
      return {
        ok: false,
        error: 'El inicio del primer período de cobro no puede ser anterior al inicio del contrato.',
      };
    }
    if (input.endDate && input.endDate < input.startDate) {
      return {
        ok: false,
        error: 'La fecha de finalización no puede ser anterior al inicio del contrato.',
      };
    }
    if (!Number.isFinite(input.monthlyAmount) || input.monthlyAmount <= 0) {
      return { ok: false, error: 'El monto mensual debe ser mayor a 0.' };
    }

    const renter = people.find(
      (p) => p.id === input.tenantPersonId && p.isActive && p.roles.includes('tenant_renter')
    );
    if (!renter) {
      return { ok: false, error: 'Selecciona un inquilino activo válido.' };
    }

    const property = properties.find((p) => p.id === input.propertyId);
    const unit = units.find((u) => u.id === input.unitId && u.propertyId === input.propertyId);
    const occupancyCheck = validateContractOccupancy({
      candidate: {
        tenantId: activeTenant.id,
        propertyId: input.propertyId,
        unitId: input.unitId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      property,
      unit,
      existingContracts: visibleContracts,
    });
    if (!occupancyCheck.valid) return { ok: false, error: occupancyCheck.error };

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('create_rental_contract', {
        p_tenant_id: activeTenant.id,
        p_property_id: input.propertyId,
        p_unit_id: input.unitId,
        p_tenant_person_id: input.tenantPersonId,
        p_start_date: input.startDate,
        p_first_period_start_date: input.firstPeriodStartDate,
        p_end_date: input.endDate,
        p_monthly_amount: input.monthlyAmount,
        p_currency: input.currency,
        p_notes: input.notes.trim(),
        p_activate_now: input.activateNow,
      });
      if (error) return { ok: false, error: error.message };
      await Promise.all([loadSupabasePhase3(activeTenant.id), refreshPhase2()]);
      return {
        ok: true,
        data: {
          id: String(data.id),
          tenantId: String(data.tenant_id),
          contractCode: String(data.contract_code),
          propertyId: String(data.property_id),
          unitId: String(data.unit_id),
          tenantPersonId: String(data.tenant_person_id),
          status: data.status as ContractStatus,
          billingFrequency: 'monthly',
          startDate: String(data.start_date),
          firstPeriodStartDate: String(data.first_period_start_date),
          endDate: data.end_date ? String(data.end_date) : null,
          anchorDay: Number(data.anchor_day),
          monthlyAmount: Number(data.monthly_amount),
          currency: data.currency as CurrencyCode,
          notes: String(data.notes ?? ''),
          finalizationReason: String(data.finalization_reason ?? ''),
          activatedAt: data.activated_at ? String(data.activated_at) : null,
          finalizedAt: data.finalized_at ? String(data.finalized_at) : null,
          createdAt: String(data.created_at),
          updatedAt: String(data.updated_at),
        },
      };
    }

    const nowIso = new Date().toISOString();
    const { day: anchorDay } = parseIsoDateParts(input.firstPeriodStartDate);
    const ctrId = `ctr-${crypto.randomUUID().slice(0, 8)}`;
    const code = `CTR-${input.startDate.slice(0, 7).replace('-', '')}-${ctrId.slice(-4).toUpperCase()}`;

    const created: RentalContract = {
      id: ctrId,
      tenantId: activeTenant.id,
      contractCode: code,
      propertyId: input.propertyId,
      unitId: input.unitId,
      tenantPersonId: input.tenantPersonId,
      status: input.activateNow ? 'active' : 'draft',
      billingFrequency: 'monthly',
      startDate: input.startDate,
      firstPeriodStartDate: input.firstPeriodStartDate,
      endDate: input.endDate,
      anchorDay,
      monthlyAmount: Number(input.monthlyAmount.toFixed(2)),
      currency: input.currency,
      notes: input.notes.trim(),
      finalizationReason: '',
      activatedAt: input.activateNow ? nowIso : null,
      finalizedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const v1: RentalContractVersion = {
      id: `ctrv-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      contractId: ctrId,
      versionNumber: 1,
      effectiveFrom: input.firstPeriodStartDate,
      monthlyAmount: created.monthlyAmount,
      currency: input.currency,
      notes: 'Condiciones iniciales',
      createdAt: nowIso,
    };

    setStore((prev) => ({
      ...prev,
      contracts: [created, ...prev.contracts],
      versions: [...prev.versions, v1],
    }));

    if (input.activateNow) {
      syncUnitOccupancyStatus(input.unitId, 'occupied');
    }

    return { ok: true, data: created };
  };

  const activateContract: Phase3ContextValue['activateContract'] = async (contractId) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const target = visibleContracts.find((c) => c.id === contractId);
    if (!target) return { ok: false, error: 'Contrato no encontrado.' };

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'contracts',
      action: 'manage',
      propertyId: target.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    if (target.status !== 'draft') {
      return { ok: false, error: 'Solo se pueden activar contratos en estado Borrador.' };
    }

    const property = properties.find((p) => p.id === target.propertyId);
    const unit = units.find((u) => u.id === target.unitId);
    const check = validateContractOccupancy({
      candidate: target,
      property,
      unit,
      existingContracts: visibleContracts,
    });
    if (!check.valid) return { ok: false, error: check.error };

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('activate_rental_contract', {
        p_tenant_id: activeTenant.id,
        p_contract_id: contractId,
      });
      if (error) return { ok: false, error: error.message };
      await Promise.all([loadSupabasePhase3(activeTenant.id), refreshPhase2()]);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => ({
      ...prev,
      contracts: prev.contracts.map((c) =>
        c.id === contractId && c.tenantId === activeTenant.id
          ? { ...c, status: 'active', activatedAt: nowIso, updatedAt: nowIso }
          : c
      ),
    }));
    syncUnitOccupancyStatus(target.unitId, 'occupied');
    return { ok: true };
  };

  const addContractVersion: Phase3ContextValue['addContractVersion'] = async (input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const target = visibleContracts.find((c) => c.id === input.contractId);
    if (!target) return { ok: false, error: 'Contrato no encontrado.' };

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'contracts',
      action: 'manage',
      propertyId: target.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    if (!Number.isFinite(input.monthlyAmount) || input.monthlyAmount <= 0) {
      return { ok: false, error: 'El nuevo importe mensual debe ser mayor a 0.' };
    }
    if (!input.effectiveFrom) {
      return { ok: false, error: 'Indica la fecha de vigencia de las nuevas condiciones.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('add_contract_version', {
        p_tenant_id: activeTenant.id,
        p_contract_id: input.contractId,
        p_effective_from: input.effectiveFrom,
        p_monthly_amount: input.monthlyAmount,
        p_currency: input.currency,
        p_notes: input.notes.trim(),
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase3(activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    const todayLaPaz = getLaPazTodayIso();
    const existingVers = visibleVersions.filter((v) => v.contractId === input.contractId);
    const nextNum = existingVers.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;

    const newVersion: RentalContractVersion = {
      id: `ctrv-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      contractId: input.contractId,
      versionNumber: nextNum,
      effectiveFrom: input.effectiveFrom,
      monthlyAmount: Number(input.monthlyAmount.toFixed(2)),
      currency: input.currency,
      notes: input.notes.trim() || 'Actualización de tarifa',
      createdAt: nowIso,
    };

    setStore((prev) => ({
      ...prev,
      versions: [...prev.versions, newVersion],
      contracts:
        input.effectiveFrom <= todayLaPaz
          ? prev.contracts.map((c) =>
              c.id === input.contractId && c.tenantId === activeTenant.id
                ? {
                    ...c,
                    monthlyAmount: newVersion.monthlyAmount,
                    currency: input.currency,
                    updatedAt: nowIso,
                  }
                : c
            )
          : prev.contracts,
    }));
    return { ok: true };
  };

  const finalizeContract: Phase3ContextValue['finalizeContract'] = async (input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const target = visibleContracts.find((c) => c.id === input.contractId);
    if (!target) return { ok: false, error: 'Contrato no encontrado.' };

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'contracts',
      action: 'manage',
      propertyId: target.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    if (target.status !== 'active') {
      return { ok: false, error: 'Solo se pueden finalizar contratos activos.' };
    }
    if (input.reason.trim().length < 3) {
      return { ok: false, error: 'Ingresa el motivo de finalización del contrato.' };
    }
    if (input.effectiveEndDate < target.startDate) {
      return {
        ok: false,
        error: 'La fecha efectiva de finalización no puede ser anterior al inicio del contrato.',
      };
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('finalize_rental_contract', {
        p_tenant_id: activeTenant.id,
        p_contract_id: input.contractId,
        p_effective_end_date: input.effectiveEndDate,
        p_reason: input.reason.trim(),
      });
      if (error) return { ok: false, error: error.message };
      await Promise.all([loadSupabasePhase3(activeTenant.id), refreshPhase2()]);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    const otherActiveOnUnit = visibleContracts.some(
      (c) => c.id !== target.id && c.unitId === target.unitId && c.status === 'active'
    );

    setStore((prev) => ({
      ...prev,
      contracts: prev.contracts.map((c) =>
        c.id === input.contractId && c.tenantId === activeTenant.id
          ? {
              ...c,
              status: 'finalized',
              endDate: input.effectiveEndDate,
              finalizationReason: input.reason.trim(),
              finalizedAt: nowIso,
              updatedAt: nowIso,
            }
          : c
      ),
    }));

    if (!otherActiveOnUnit) {
      syncUnitOccupancyStatus(target.unitId, 'available');
    }
    return { ok: true };
  };

  const generateReceivables: Phase3ContextValue['generateReceivables'] = async (input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const targetContract = input.contractId
      ? visibleContracts.find((c) => c.id === input.contractId)
      : undefined;

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'receivables',
      action: 'generate',
      propertyId: targetContract?.propertyId ?? null,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const refDate = input.referenceDate ?? getLaPazTodayIso();

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('generate_rent_charges', {
        p_tenant_id: activeTenant.id,
        p_mode: input.mode,
        p_contract_id: input.contractId ?? null,
        p_period_index: input.periodIndex ?? null,
        p_reference_date: refDate,
        p_regularization_reason: input.regularizationReason?.trim() ?? '',
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase3(activeTenant.id);
      const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
      return {
        ok: true,
        data: { generatedCount: rows.length, charges: [] },
      };
    }

    const nowIso = new Date().toISOString();
    const generated: ReceivableCharge[] = [];

    if (input.mode === 'manual_period') {
      if (!targetContract || input.periodIndex === undefined || input.periodIndex < 0) {
        return { ok: false, error: 'Selecciona un contrato y período válido.' };
      }
      if (targetContract.status === 'draft' || targetContract.status === 'cancelled') {
        return {
          ok: false,
          error: 'Solo contratos activos o finalizados pueden emitir cuentas por cobrar.',
        };
      }

      const periodPreview = computeContractPeriod({
        firstPeriodStartDate: targetContract.firstPeriodStartDate,
        anchorDay: targetContract.anchorDay,
        periodIndex: input.periodIndex,
        contractEndDate: targetContract.endDate,
        monthlyAmount: targetContract.monthlyAmount,
        currency: targetContract.currency,
      });

      if (!periodPreview) {
        return {
          ok: false,
          error: 'El período seleccionado está fuera de la fecha de finalización del contrato.',
        };
      }

      const alreadyExists = visibleReceivables.some(
        (r) =>
          r.contractId === targetContract.id && r.periodStart === periodPreview.effectiveStart
      );
      if (alreadyExists) {
        return {
          ok: false,
          error: `Ya existe una cuenta por cobrar generada para el período ${periodPreview.effectiveStart} — ${periodPreview.effectiveEnd}.`,
        };
      }

      if (
        periodPreview.effectiveEnd < refDate &&
        (input.regularizationReason ?? '').trim().length < 3
      ) {
        return {
          ok: false,
          error: 'Para regularizar manualmente un período pasado debes indicar el motivo.',
        };
      }

      const resolvedVer = resolveContractVersionForDate(
        visibleVersions,
        targetContract.id,
        periodPreview.nominalStart,
        targetContract.monthlyAmount,
        targetContract.currency
      );
      const finalPeriod = computeContractPeriod({
        firstPeriodStartDate: targetContract.firstPeriodStartDate,
        anchorDay: targetContract.anchorDay,
        periodIndex: input.periodIndex,
        contractEndDate: targetContract.endDate,
        monthlyAmount: resolvedVer.monthlyAmount,
        currency: resolvedVer.currency,
        versionId: resolvedVer.versionId,
      })!;

      const charge: ReceivableCharge = {
        id: `cxc-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: activeTenant.id,
        contractId: targetContract.id,
        contractVersionId: resolvedVer.versionId,
        propertyId: targetContract.propertyId,
        unitId: targetContract.unitId,
        tenantPersonId: targetContract.tenantPersonId,
        periodIndex: input.periodIndex,
        nominalPeriodStart: finalPeriod.nominalStart,
        nominalPeriodEnd: finalPeriod.nominalEnd,
        periodStart: finalPeriod.effectiveStart,
        periodEnd: finalPeriod.effectiveEnd,
        issueDate: refDate,
        dueDate: finalPeriod.dueDate,
        calendarDaysDivisor: finalPeriod.calendarDaysDivisor,
        coveredDays: finalPeriod.coveredDays,
        isProrated: finalPeriod.isProrated,
        baseMonthlyAmount: finalPeriod.baseMonthlyAmount,
        amount: finalPeriod.calculatedAmount,
        paidAmount: 0,
        adjustedAmount: 0,
        currency: finalPeriod.currency,
        status: 'pending',
        generationMode: 'manual_period',
        voidReason: '',
        notes:
          input.regularizationReason?.trim() || 'Generación manual controlada',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      generated.push(charge);
    } else {
      // Corte diario automático: solo genera el período vigente que cubre refDate (DEC-06)
      const candidates = visibleContracts.filter(
        (c) =>
          c.status === 'active' &&
          (!input.contractId || c.id === input.contractId)
      );

      for (const ctr of candidates) {
        const idx = findPeriodIndexCoveringDate(
          ctr.firstPeriodStartDate,
          ctr.anchorDay,
          refDate,
          ctr.endDate
        );
        if (idx === null) continue;

        const basePeriod = computeContractPeriod({
          firstPeriodStartDate: ctr.firstPeriodStartDate,
          anchorDay: ctr.anchorDay,
          periodIndex: idx,
          contractEndDate: ctr.endDate,
          monthlyAmount: ctr.monthlyAmount,
          currency: ctr.currency,
        });
        if (!basePeriod) continue;

        const duplicate =
          visibleReceivables.some(
            (r) => r.contractId === ctr.id && r.periodStart === basePeriod.effectiveStart
          ) ||
          generated.some(
            (r) => r.contractId === ctr.id && r.periodStart === basePeriod.effectiveStart
          );
        if (duplicate) continue;

        const resolvedVer = resolveContractVersionForDate(
          visibleVersions,
          ctr.id,
          basePeriod.nominalStart,
          ctr.monthlyAmount,
          ctr.currency
        );
        const finalPeriod = computeContractPeriod({
          firstPeriodStartDate: ctr.firstPeriodStartDate,
          anchorDay: ctr.anchorDay,
          periodIndex: idx,
          contractEndDate: ctr.endDate,
          monthlyAmount: resolvedVer.monthlyAmount,
          currency: resolvedVer.currency,
          versionId: resolvedVer.versionId,
        })!;

        generated.push({
          id: `cxc-${crypto.randomUUID().slice(0, 8)}`,
          tenantId: activeTenant.id,
          contractId: ctr.id,
          contractVersionId: resolvedVer.versionId,
          propertyId: ctr.propertyId,
          unitId: ctr.unitId,
          tenantPersonId: ctr.tenantPersonId,
          periodIndex: idx,
          nominalPeriodStart: finalPeriod.nominalStart,
          nominalPeriodEnd: finalPeriod.nominalEnd,
          periodStart: finalPeriod.effectiveStart,
          periodEnd: finalPeriod.effectiveEnd,
          issueDate: refDate,
          dueDate: finalPeriod.dueDate,
          calendarDaysDivisor: finalPeriod.calendarDaysDivisor,
          coveredDays: finalPeriod.coveredDays,
          isProrated: finalPeriod.isProrated,
          baseMonthlyAmount: finalPeriod.baseMonthlyAmount,
          amount: finalPeriod.calculatedAmount,
          paidAmount: 0,
          adjustedAmount: 0,
          currency: finalPeriod.currency,
          status: 'pending',
          generationMode: 'automatic_daily',
          voidReason: '',
          notes: 'Corte diario automático',
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    }

    if (generated.length > 0) {
      setStore((prev) => ({
        ...prev,
        receivables: [...generated, ...prev.receivables],
      }));
    }

    return {
      ok: true,
      data: { generatedCount: generated.length, charges: generated },
    };
  };

  const voidReceivable: Phase3ContextValue['voidReceivable'] = async (chargeId, reason) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const charge = visibleReceivables.find((r) => r.id === chargeId);
    if (!charge) return { ok: false, error: 'Cuenta por cobrar no encontrada.' };

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'receivables',
      action: 'generate',
      propertyId: charge.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    if (reason.trim().length < 3) {
      return { ok: false, error: 'Debes indicar un motivo válido para anular la obligación.' };
    }
    if (charge.status === 'voided') {
      return { ok: false, error: 'Esta obligación ya se encuentra anulada.' };
    }
    if (charge.paidAmount > 0) {
      return {
        ok: false,
        error: 'No se puede anular una obligación que ya tiene cobros aplicados.',
      };
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('void_receivable_charge', {
        p_tenant_id: activeTenant.id,
        p_charge_id: chargeId,
        p_reason: reason.trim(),
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase3(activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => ({
      ...prev,
      receivables: prev.receivables.map((r) =>
        r.id === chargeId && r.tenantId === activeTenant.id
          ? {
              ...r,
              status: 'voided',
              adjustedAmount: r.amount,
              voidReason: reason.trim(),
              updatedAt: nowIso,
            }
          : r
      ),
    }));
    return { ok: true };
  };

  const refreshPhase3 = useCallback(async () => {
    if (!isSupabaseConfigured || !activeTenant) return;
    await loadSupabasePhase3(activeTenant.id);
  }, [activeTenant, loadSupabasePhase3]);

  const syncReceivablePaidAmount = useCallback(
    (chargeId: string, nextPaidAmount: number, nextStatus: ReceivableBaseStatus) => {
      if (isSupabaseConfigured || !activeTenant) return;
      const nowIso = new Date().toISOString();
      setStore((prev) => ({
        ...prev,
        receivables: prev.receivables.map((r) =>
          r.id === chargeId && r.tenantId === activeTenant.id
            ? {
                ...r,
                paidAmount: Number(nextPaidAmount.toFixed(2)),
                status: nextStatus,
                updatedAt: nowIso,
              }
            : r
        ),
      }));
    },
    [activeTenant]
  );

  return (
    <Phase3Context.Provider
      value={{
        contracts: visibleContracts,
        versions: visibleVersions,
        receivables: visibleReceivables,
        isLoading,
        createContract,
        activateContract,
        addContractVersion,
        finalizeContract,
        generateReceivables,
        voidReceivable,
        refreshPhase3,
        syncReceivablePaidAmount,
      }}
    >
      {children}
    </Phase3Context.Provider>
  );
}

export function usePhase3(): Phase3ContextValue {
  const ctx = useContext(Phase3Context);
  if (!ctx) {
    throw new Error('usePhase3 debe usarse dentro de Phase3Provider');
  }
  return ctx;
}
