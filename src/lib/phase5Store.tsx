/**
 * Archivo: src/lib/phase5Store.tsx
 * Responsabilidad: Proveedor de estado y operaciones transaccionales de Fase 5
 *   (Categorías, Gastos/CxP con registro/aprobación/pago diferenciados, Pagos a
 *   proveedores, Cajas por usuario y moneda BOB/USD, Movimientos compensatorios,
 *   Arqueos, Cierre de caja y Adjuntos privados con enlaces temporales).
 * Cumplimiento LuchoRentas.md: RF-040 a RF-045, RF-054, RF-055, §4.7, §4.8,
 *   §10.1 (enlaces temporales privados), DEC-01, DEC-07, DEC-08, DEC-09 y DEC-13.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { usePhase2 } from './phase2Store';
import { getLaPazTodayIso, roundCurrency2 } from './phase3Domain';
import {
  DEFAULT_EXPENSE_CATEGORY_NAMES,
  computeCashSessionBalances,
  validateAttachmentFile,
  validateExpenseInput,
  validateExpensePaymentInput,
  validateReconciliationInput,
} from './phase5Domain';
import { validateTenantMutation } from './rbac';
import { isSupabaseConfigured, supabase } from './supabase';
import type {
  CashAccount,
  CashMovement,
  CashMovementDirection,
  CashMovementSource,
  CashReconciliation,
  CashSession,
  CashSessionStatus,
  CurrencyCode,
  ExpenseCategory,
  ExpenseItem,
  ExpensePayment,
  ExpenseScope,
  ExpenseStatus,
  PaymentMethod,
  ReconciliationStatus,
} from '../types/domain';

interface Phase5StoreData {
  categories: ExpenseCategory[];
  expenses: ExpenseItem[];
  expensePayments: ExpensePayment[];
  cashAccounts: CashAccount[];
  cashSessions: CashSession[];
  cashMovements: CashMovement[];
  cashReconciliations: CashReconciliation[];
}

const STORAGE_KEY = 'luchorentas_phase5_store_v1';
const ATTACHMENT_BUCKET = 'luchorentas-attachments';

interface ActionResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface Phase5ContextValue {
  categories: ExpenseCategory[];
  expenses: ExpenseItem[];
  expensePayments: ExpensePayment[];
  cashAccounts: CashAccount[];
  cashSessions: CashSession[];
  cashMovements: CashMovement[];
  cashReconciliations: CashReconciliation[];
  isLoading: boolean;
  createCategory: (name: string) => Promise<ActionResult<ExpenseCategory>>;
  createExpense: (input: {
    scope: ExpenseScope;
    propertyId: string | null;
    unitId: string | null;
    categoryId: string;
    supplierPersonId: string | null;
    concept: string;
    expenseDate: string;
    dueDate: string | null;
    amount: number;
    currency: CurrencyCode;
    notes: string;
    attachmentFile?: File | null;
  }) => Promise<ActionResult<ExpenseItem>>;
  approveExpense: (expenseId: string) => Promise<ActionResult>;
  voidExpense: (expenseId: string, reason: string) => Promise<ActionResult>;
  confirmExpensePayment: (input: {
    expenseId: string;
    cashSessionId: string;
    effectiveAt: string;
    amount: number;
    paymentMethod: PaymentMethod;
    referenceCode: string;
    notes: string;
  }) => Promise<ActionResult<ExpensePayment>>;
  openCashSession: (input: {
    currency: CurrencyCode;
    openingBalance: number;
    notes: string;
  }) => Promise<ActionResult<CashSession>>;
  recordCashAdjustment: (input: {
    cashSessionId: string;
    direction: CashMovementDirection;
    amount: number;
    reason: string;
    linkedMovementId?: string | null;
  }) => Promise<ActionResult<CashMovement>>;
  recordCashReconciliation: (input: {
    cashSessionId: string;
    countedBalance: number;
    differenceReason: string;
    evidenceNote: string;
  }) => Promise<ActionResult<CashReconciliation>>;
  approveCashReconciliation: (reconciliationId: string) => Promise<ActionResult>;
  closeCashSession: (cashSessionId: string) => Promise<ActionResult>;
  getAttachmentSignedUrl: (storagePath: string) => Promise<ActionResult<string>>;
  refreshPhase5: () => Promise<void>;
}

const Phase5Context = createContext<Phase5ContextValue | null>(null);

function loadPreviewPhase5(): Phase5StoreData {
  const fallback: Phase5StoreData = {
    categories: [],
    expenses: [],
    expensePayments: [],
    cashAccounts: [],
    cashSessions: [],
    cashMovements: [],
    cashReconciliations: [],
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Phase5StoreData>;
    return {
      categories: parsed.categories ?? [],
      expenses: parsed.expenses ?? [],
      expensePayments: parsed.expensePayments ?? [],
      cashAccounts: parsed.cashAccounts ?? [],
      cashSessions: parsed.cashSessions ?? [],
      cashMovements: parsed.cashMovements ?? [],
      cashReconciliations: parsed.cashReconciliations ?? [],
    };
  } catch {
    return fallback;
  }
}

export function Phase5Provider({ children }: { children: React.ReactNode }) {
  const { activeTenant, activeMembership, currentUser, tenantPermissions, canView } = useAuth();
  const { properties } = usePhase2();

  const [store, setStore] = useState<Phase5StoreData>(loadPreviewPhase5);
  const [liveData, setLiveData] = useState<Phase5StoreData>({
    categories: [],
    expenses: [],
    expensePayments: [],
    cashAccounts: [],
    cashSessions: [],
    cashMovements: [],
    cashReconciliations: [],
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

  // Asegurar categorías iniciales en vista previa local para el tenant activo
  useEffect(() => {
    if (isSupabaseConfigured || !activeTenant) return;
    setStore((prev) => {
      const hasCats = prev.categories.some((c) => c.tenantId === activeTenant.id);
      if (hasCats) return prev;
      const seeded: ExpenseCategory[] = DEFAULT_EXPENSE_CATEGORY_NAMES.map((name, idx) => ({
        id: `ecat-${activeTenant.id.slice(0, 6)}-${idx + 1}`,
        tenantId: activeTenant.id,
        name,
        isSystemDefault: true,
        isActive: true,
      }));
      return { ...prev, categories: [...prev.categories, ...seeded] };
    });
  }, [activeTenant]);

  const loadSupabasePhase5 = useCallback(
    async (tenantId: string) => {
      if (!supabase) return;
      setIsLoading(true);

      // Si el usuario tiene acceso a gastos, asegurar categorías iniciales del PRD (RF-041)
      if (canView('expenses')) {
        await supabase.rpc('ensure_default_expense_categories', { p_tenant_id: tenantId });
      }

      const [
        { data: catRows },
        { data: expRows },
        { data: epRows },
        { data: caRows },
        { data: csRows },
        { data: cmRows },
        { data: crRows },
      ] = await Promise.all([
        supabase
          .from('expense_categories')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .order('is_system_default', { ascending: false })
          .order('name', { ascending: true }),
        supabase
          .from('expenses')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('expense_date', { ascending: false }),
        supabase
          .from('expense_payments')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('effective_at', { ascending: false }),
        supabase
          .from('cash_accounts')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('owner_name', { ascending: true }),
        supabase
          .from('cash_sessions')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('opened_at', { ascending: false }),
        supabase
          .from('cash_movements')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('effective_at', { ascending: false }),
        supabase
          .from('cash_reconciliations')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('reconciled_at', { ascending: false }),
      ]);

      setLiveData({
        categories: ((catRows as Array<Record<string, unknown>>) ?? []).map((c) => ({
          id: String(c.id),
          tenantId: String(c.tenant_id),
          name: String(c.name),
          isSystemDefault: Boolean(c.is_system_default),
          isActive: Boolean(c.is_active),
        })),
        expenses: ((expRows as Array<Record<string, unknown>>) ?? []).map((e) => ({
          id: String(e.id),
          tenantId: String(e.tenant_id),
          expenseCode: String(e.expense_code),
          scope: e.scope as ExpenseScope,
          propertyId: e.property_id ? String(e.property_id) : null,
          unitId: e.unit_id ? String(e.unit_id) : null,
          categoryId: String(e.category_id),
          supplierPersonId: e.supplier_person_id ? String(e.supplier_person_id) : null,
          concept: String(e.concept),
          expenseDate: String(e.expense_date),
          dueDate: e.due_date ? String(e.due_date) : null,
          amount: Number(e.amount),
          paidAmount: Number(e.paid_amount ?? 0),
          currency: (e.currency as CurrencyCode) ?? 'BOB',
          status: e.status as ExpenseStatus,
          notes: String(e.notes ?? ''),
          evidenceName: String(e.evidence_name ?? ''),
          evidencePath: String(e.evidence_path ?? ''),
          approvedBy: e.approved_by ? String(e.approved_by) : null,
          approvedAt: e.approved_at ? String(e.approved_at) : null,
          voidReason: String(e.void_reason ?? ''),
          createdAt: String(e.created_at),
          updatedAt: String(e.updated_at),
        })),
        expensePayments: ((epRows as Array<Record<string, unknown>>) ?? []).map((ep) => ({
          id: String(ep.id),
          tenantId: String(ep.tenant_id),
          expenseId: String(ep.expense_id),
          cashSessionId: String(ep.cash_session_id),
          effectiveAt: String(ep.effective_at),
          amount: Number(ep.amount),
          currency: (ep.currency as CurrencyCode) ?? 'BOB',
          paymentMethod: (ep.payment_method as PaymentMethod) ?? 'cash',
          referenceCode: String(ep.reference_code ?? ''),
          notes: String(ep.notes ?? ''),
          paidByUserId: ep.paid_by_user_id ? String(ep.paid_by_user_id) : null,
          paidByName: String(ep.paid_by_name ?? 'Operador'),
          createdAt: String(ep.created_at),
        })),
        cashAccounts: ((caRows as Array<Record<string, unknown>>) ?? []).map((ca) => ({
          id: String(ca.id),
          tenantId: String(ca.tenant_id),
          ownerUserId: String(ca.owner_user_id),
          ownerName: String(ca.owner_name),
          currency: (ca.currency as CurrencyCode) ?? 'BOB',
          isActive: Boolean(ca.is_active),
        })),
        cashSessions: ((csRows as Array<Record<string, unknown>>) ?? []).map((cs) => ({
          id: String(cs.id),
          tenantId: String(cs.tenant_id),
          cashAccountId: String(cs.cash_account_id),
          ownerUserId: String(cs.owner_user_id),
          ownerName: String(cs.owner_name),
          currency: (cs.currency as CurrencyCode) ?? 'BOB',
          status: (cs.status as CashSessionStatus) ?? 'open',
          openedAt: String(cs.opened_at),
          openingBalance: Number(cs.opening_balance ?? 0),
          closedAt: cs.closed_at ? String(cs.closed_at) : null,
          closingExpectedBalance:
            cs.closing_expected_balance !== null && cs.closing_expected_balance !== undefined
              ? Number(cs.closing_expected_balance)
              : null,
          closingCountedBalance:
            cs.closing_counted_balance !== null && cs.closing_counted_balance !== undefined
              ? Number(cs.closing_counted_balance)
              : null,
          notes: String(cs.notes ?? ''),
        })),
        cashMovements: ((cmRows as Array<Record<string, unknown>>) ?? []).map((cm) => ({
          id: String(cm.id),
          tenantId: String(cm.tenant_id),
          cashAccountId: String(cm.cash_account_id),
          cashSessionId: String(cm.cash_session_id),
          currency: (cm.currency as CurrencyCode) ?? 'BOB',
          direction: (cm.direction as CashMovementDirection) ?? 'inflow',
          sourceType: (cm.source_type as CashMovementSource) ?? 'manual_adjustment',
          sourceId: cm.source_id ? String(cm.source_id) : null,
          linkedMovementId: cm.linked_movement_id ? String(cm.linked_movement_id) : null,
          effectiveAt: String(cm.effective_at),
          amount: Number(cm.amount),
          notes: String(cm.notes ?? ''),
          createdBy: cm.created_by ? String(cm.created_by) : null,
          createdByName: String(cm.created_by_name ?? 'Operador'),
          createdAt: String(cm.created_at),
        })),
        cashReconciliations: ((crRows as Array<Record<string, unknown>>) ?? []).map((cr) => ({
          id: String(cr.id),
          tenantId: String(cr.tenant_id),
          cashSessionId: String(cr.cash_session_id),
          currency: (cr.currency as CurrencyCode) ?? 'BOB',
          reconciledAt: String(cr.reconciled_at),
          expectedBalance: Number(cr.expected_balance),
          countedBalance: Number(cr.counted_balance),
          differenceAmount: Number(cr.difference_amount),
          differenceReason: String(cr.difference_reason ?? ''),
          evidenceNote: String(cr.evidence_note ?? ''),
          status: (cr.status as ReconciliationStatus) ?? 'balanced',
          recordedBy: cr.recorded_by ? String(cr.recorded_by) : null,
          recordedByName: String(cr.recorded_by_name ?? 'Operador'),
          approvedBy: cr.approved_by ? String(cr.approved_by) : null,
          approvedByName: String(cr.approved_by_name ?? ''),
          approvedAt: cr.approved_at ? String(cr.approved_at) : null,
        })),
      });
      setIsLoading(false);
    },
    [canView]
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!activeTenant || !activeMembership) {
      setLiveData({
        categories: [],
        expenses: [],
        expensePayments: [],
        cashAccounts: [],
        cashSessions: [],
        cashMovements: [],
        cashReconciliations: [],
      });
      return;
    }
    void loadSupabasePhase5(activeTenant.id);
  }, [activeTenant, activeMembership, loadSupabasePhase5]);

  const refreshPhase5 = useCallback(async () => {
    if (!isSupabaseConfigured || !activeTenant) return;
    await loadSupabasePhase5(activeTenant.id);
  }, [activeTenant, loadSupabasePhase5]);

  const rawData = isSupabaseConfigured ? liveData : store;

  const visiblePropertyIds = useMemo(
    () => new Set(properties.map((p) => p.id)),
    [properties]
  );

  const visibleCategories = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.categories.filter((c) => c.tenantId === activeTenant.id && c.isActive);
  }, [activeTenant, rawData.categories]);

  const visibleExpenses = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.expenses.filter(
      (e) =>
        e.tenantId === activeTenant.id &&
        (e.propertyId === null || visiblePropertyIds.has(e.propertyId))
    );
  }, [activeTenant, rawData.expenses, visiblePropertyIds]);

  const visibleExpenseIds = useMemo(
    () => new Set(visibleExpenses.map((e) => e.id)),
    [visibleExpenses]
  );

  const visibleExpensePayments = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.expensePayments.filter(
      (ep) => ep.tenantId === activeTenant.id && visibleExpenseIds.has(ep.expenseId)
    );
  }, [activeTenant, rawData.expensePayments, visibleExpenseIds]);

  const canReconcileCash = Boolean(
    activeMembership &&
      validateTenantMutation({
        membership: activeMembership,
        targetTenantId: activeTenant?.id ?? '',
        moduleId: 'cash',
        action: 'reconcile',
        customRules: tenantPermissions,
      }).allowed
  );

  const visibleCashAccounts = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.cashAccounts.filter(
      (ca) =>
        ca.tenantId === activeTenant.id &&
        (canReconcileCash || ca.ownerUserId === currentUser?.id)
    );
  }, [activeTenant, canReconcileCash, currentUser?.id, rawData.cashAccounts]);

  const visibleCashSessions = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.cashSessions.filter(
      (cs) =>
        cs.tenantId === activeTenant.id &&
        (canReconcileCash || cs.ownerUserId === currentUser?.id)
    );
  }, [activeTenant, canReconcileCash, currentUser?.id, rawData.cashSessions]);

  const visibleSessionIds = useMemo(
    () => new Set(visibleCashSessions.map((cs) => cs.id)),
    [visibleCashSessions]
  );

  const visibleCashMovements = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.cashMovements.filter(
      (cm) => cm.tenantId === activeTenant.id && visibleSessionIds.has(cm.cashSessionId)
    );
  }, [activeTenant, rawData.cashMovements, visibleSessionIds]);

  const visibleCashReconciliations = useMemo(() => {
    if (!activeTenant) return [];
    return rawData.cashReconciliations.filter(
      (cr) => cr.tenantId === activeTenant.id && visibleSessionIds.has(cr.cashSessionId)
    );
  }, [activeTenant, rawData.cashReconciliations, visibleSessionIds]);

  const createCategory: Phase5ContextValue['createCategory'] = async (name) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'expenses',
      action: 'manage',
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const clean = name.trim();
    if (clean.length < 2) {
      return { ok: false, error: 'El nombre de la categoría debe tener al menos 2 caracteres.' };
    }
    if (visibleCategories.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, error: 'Ya existe una categoría con ese nombre en este espacio.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('create_expense_category', {
        p_tenant_id: activeTenant.id,
        p_name: clean,
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase5(activeTenant.id);
      return {
        ok: true,
        data: {
          id: String(data.id),
          tenantId: String(data.tenant_id),
          name: String(data.name),
          isSystemDefault: Boolean(data.is_system_default),
          isActive: Boolean(data.is_active),
        },
      };
    }

    const created: ExpenseCategory = {
      id: `ecat-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      name: clean,
      isSystemDefault: false,
      isActive: true,
    };
    setStore((prev) => ({ ...prev, categories: [...prev.categories, created] }));
    return { ok: true, data: created };
  };

  const createExpense: Phase5ContextValue['createExpense'] = async (input) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'expenses',
      action: 'manage',
      propertyId: input.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const val = validateExpenseInput({
      scope: input.scope,
      propertyId: input.propertyId,
      unitId: input.unitId,
      categoryId: input.categoryId,
      concept: input.concept,
      expenseDate: input.expenseDate,
      dueDate: input.dueDate,
      amount: input.amount,
    });
    if (!val.valid) return { ok: false, error: val.error };

    let evidenceName = '';
    let evidencePath = '';

    if (input.attachmentFile) {
      const fileVal = validateAttachmentFile(input.attachmentFile);
      if (!fileVal.valid) return { ok: false, error: fileVal.error };
      evidenceName = input.attachmentFile.name;

      if (isSupabaseConfigured && supabase) {
        const cleanFileName = input.attachmentFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${activeTenant.id}/expenses/${crypto.randomUUID()}-${cleanFileName}`;
        const { error: uploadErr } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .upload(path, input.attachmentFile, {
            contentType: input.attachmentFile.type,
            upsert: false,
          });
        if (uploadErr) {
          return {
            ok: false,
            error: `No se pudo subir el comprobante privado: ${uploadErr.message}`,
          };
        }
        evidencePath = path;
      } else {
        evidencePath = `local-preview://${evidenceName}`;
      }
    }

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('create_expense', {
        p_tenant_id: activeTenant.id,
        p_scope: input.scope,
        p_property_id: input.scope === 'tenant_general' ? null : input.propertyId,
        p_unit_id: input.scope === 'unit' ? input.unitId : null,
        p_category_id: input.categoryId,
        p_supplier_person_id: input.supplierPersonId || null,
        p_concept: input.concept.trim(),
        p_expense_date: input.expenseDate,
        p_due_date: input.dueDate || null,
        p_amount: roundCurrency2(input.amount),
        p_currency: input.currency,
        p_notes: input.notes.trim(),
        p_evidence_name: evidenceName,
        p_evidence_path: evidencePath,
      });
      if (error) return { ok: false, error: error.message };

      if (evidencePath && input.attachmentFile) {
        await supabase.from('attachments').insert({
          tenant_id: activeTenant.id,
          entity_type: 'expenses',
          entity_id: data.id,
          file_name: evidenceName,
          mime_type: input.attachmentFile.type,
          byte_size: input.attachmentFile.size,
          storage_path: evidencePath,
          uploaded_by: currentUser?.id ?? null,
        });
      }

      await loadSupabasePhase5(activeTenant.id);
      return {
        ok: true,
        data: {
          id: String(data.id),
          tenantId: String(data.tenant_id),
          expenseCode: String(data.expense_code),
          scope: data.scope as ExpenseScope,
          propertyId: data.property_id ? String(data.property_id) : null,
          unitId: data.unit_id ? String(data.unit_id) : null,
          categoryId: String(data.category_id),
          supplierPersonId: data.supplier_person_id ? String(data.supplier_person_id) : null,
          concept: String(data.concept),
          expenseDate: String(data.expense_date),
          dueDate: data.due_date ? String(data.due_date) : null,
          amount: Number(data.amount),
          paidAmount: Number(data.paid_amount ?? 0),
          currency: data.currency as CurrencyCode,
          status: data.status as ExpenseStatus,
          notes: String(data.notes ?? ''),
          evidenceName: String(data.evidence_name ?? ''),
          evidencePath: String(data.evidence_path ?? ''),
          approvedBy: data.approved_by ? String(data.approved_by) : null,
          approvedAt: data.approved_at ? String(data.approved_at) : null,
          voidReason: String(data.void_reason ?? ''),
          createdAt: String(data.created_at),
          updatedAt: String(data.updated_at),
        },
      };
    }

    const nowIso = new Date().toISOString();
    const id = `exp-${crypto.randomUUID().slice(0, 8)}`;
    const code = `GAS-${(input.expenseDate || getLaPazTodayIso()).slice(0, 7).replace('-', '')}-${id.slice(-4).toUpperCase()}`;

    const created: ExpenseItem = {
      id,
      tenantId: activeTenant.id,
      expenseCode: code,
      scope: input.scope,
      propertyId: input.scope === 'tenant_general' ? null : input.propertyId,
      unitId: input.scope === 'unit' ? input.unitId : null,
      categoryId: input.categoryId,
      supplierPersonId: input.supplierPersonId || null,
      concept: input.concept.trim(),
      expenseDate: input.expenseDate,
      dueDate: input.dueDate || null,
      amount: roundCurrency2(input.amount),
      paidAmount: 0,
      currency: input.currency,
      status: 'pending_approval',
      notes: input.notes.trim(),
      evidenceName,
      evidencePath,
      approvedBy: null,
      approvedAt: null,
      voidReason: '',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setStore((prev) => ({ ...prev, expenses: [created, ...prev.expenses] }));
    return { ok: true, data: created };
  };

  const approveExpense: Phase5ContextValue['approveExpense'] = async (expenseId) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const exp = visibleExpenses.find((e) => e.id === expenseId);
    if (!exp) return { ok: false, error: 'Gasto no encontrado.' };

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'expenses',
      action: 'manage',
      propertyId: exp.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    if (exp.status !== 'pending_approval') {
      return { ok: false, error: 'Solo pueden aprobarse gastos pendientes de aprobación.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('approve_expense', {
        p_tenant_id: activeTenant.id,
        p_expense_id: expenseId,
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase5(activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => ({
      ...prev,
      expenses: prev.expenses.map((e) =>
        e.id === expenseId && e.tenantId === activeTenant.id
          ? {
              ...e,
              status: 'approved',
              approvedBy: currentUser?.id ?? null,
              approvedAt: nowIso,
              updatedAt: nowIso,
            }
          : e
      ),
    }));
    return { ok: true };
  };

  const voidExpense: Phase5ContextValue['voidExpense'] = async (expenseId, reason) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const exp = visibleExpenses.find((e) => e.id === expenseId);
    if (!exp) return { ok: false, error: 'Gasto no encontrado.' };

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'expenses',
      action: 'manage',
      propertyId: exp.propertyId,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    if (exp.paidAmount > 0) {
      return { ok: false, error: 'No se puede anular un gasto con pagos confirmados.' };
    }
    if (reason.trim().length < 3) {
      return { ok: false, error: 'Debes indicar un motivo de anulación.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('void_expense', {
        p_tenant_id: activeTenant.id,
        p_expense_id: expenseId,
        p_reason: reason.trim(),
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase5(activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => ({
      ...prev,
      expenses: prev.expenses.map((e) =>
        e.id === expenseId && e.tenantId === activeTenant.id
          ? { ...e, status: 'voided', voidReason: reason.trim(), updatedAt: nowIso }
          : e
      ),
    }));
    return { ok: true };
  };

  const openCashSession: Phase5ContextValue['openCashSession'] = async (input) => {
    if (!activeTenant || !currentUser) return { ok: false, error: 'Sin sesión activa.' };
    const canViewCash = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'cash',
      action: 'view',
      customRules: tenantPermissions,
    }).allowed;
    const canRecCash = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'cash',
      action: 'reconcile',
      customRules: tenantPermissions,
    }).allowed;

    if (!canViewCash && !canRecCash) {
      return { ok: false, error: 'Tu rol no tiene permiso para operar cajas en este espacio.' };
    }

    if (!Number.isFinite(input.openingBalance) || input.openingBalance < 0) {
      return { ok: false, error: 'El saldo inicial de caja no puede ser negativo.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('open_cash_session', {
        p_tenant_id: activeTenant.id,
        p_currency: input.currency,
        p_opening_balance: roundCurrency2(input.openingBalance),
        p_notes: input.notes.trim(),
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase5(activeTenant.id);
      return {
        ok: true,
        data: {
          id: String(data.id),
          tenantId: String(data.tenant_id),
          cashAccountId: String(data.cash_account_id),
          ownerUserId: String(data.owner_user_id),
          ownerName: String(data.owner_name),
          currency: data.currency as CurrencyCode,
          status: data.status as CashSessionStatus,
          openedAt: String(data.opened_at),
          openingBalance: Number(data.opening_balance),
          closedAt: null,
          closingExpectedBalance: null,
          closingCountedBalance: null,
          notes: String(data.notes ?? ''),
        },
      };
    }

    const alreadyOpen = visibleCashSessions.some(
      (s) =>
        s.ownerUserId === currentUser.id &&
        s.currency === input.currency &&
        s.status === 'open'
    );
    if (alreadyOpen) {
      return {
        ok: false,
        error: `Ya tienes una caja abierta en ${input.currency}. Ciérrala antes de abrir otra.`,
      };
    }

    const nowIso = new Date().toISOString();
    let account = visibleCashAccounts.find(
      (a) => a.ownerUserId === currentUser.id && a.currency === input.currency
    );
    const createdAcc: CashAccount | null = account
      ? null
      : {
          id: `cacc-${crypto.randomUUID().slice(0, 8)}`,
          tenantId: activeTenant.id,
          ownerUserId: currentUser.id,
          ownerName: currentUser.fullName,
          currency: input.currency,
          isActive: true,
        };
    if (createdAcc) account = createdAcc;

    const newSession: CashSession = {
      id: `cses-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      cashAccountId: account!.id,
      ownerUserId: currentUser.id,
      ownerName: currentUser.fullName,
      currency: input.currency,
      status: 'open',
      openedAt: nowIso,
      openingBalance: roundCurrency2(input.openingBalance),
      closedAt: null,
      closingExpectedBalance: null,
      closingCountedBalance: null,
      notes: input.notes.trim(),
    };

    setStore((prev) => ({
      ...prev,
      cashAccounts: createdAcc ? [...prev.cashAccounts, createdAcc] : prev.cashAccounts,
      cashSessions: [newSession, ...prev.cashSessions],
    }));

    return { ok: true, data: newSession };
  };

  const confirmExpensePayment: Phase5ContextValue['confirmExpensePayment'] = async (input) => {
    if (!activeTenant || !currentUser) return { ok: false, error: 'Sin sesión activa.' };
    const expense = visibleExpenses.find((e) => e.id === input.expenseId);
    const session = visibleCashSessions.find((s) => s.id === input.cashSessionId);

    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'expenses',
      action: 'manage',
      propertyId: expense?.propertyId ?? null,
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const validation = validateExpensePaymentInput({
      expense,
      cashSession: session,
      amount: input.amount,
      effectiveAt: input.effectiveAt,
    });
    if (!validation.valid) return { ok: false, error: validation.error };

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('confirm_expense_payment', {
        p_tenant_id: activeTenant.id,
        p_expense_id: expense!.id,
        p_cash_session_id: session!.id,
        p_effective_at: new Date(input.effectiveAt).toISOString(),
        p_amount: roundCurrency2(input.amount),
        p_payment_method: input.paymentMethod,
        p_reference_code: input.referenceCode.trim(),
        p_notes: input.notes.trim(),
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase5(activeTenant.id);
      return {
        ok: true,
        data: {
          id: String(data.id),
          tenantId: String(data.tenant_id),
          expenseId: String(data.expense_id),
          cashSessionId: String(data.cash_session_id),
          effectiveAt: String(data.effective_at),
          amount: Number(data.amount),
          currency: data.currency as CurrencyCode,
          paymentMethod: data.payment_method as PaymentMethod,
          referenceCode: String(data.reference_code ?? ''),
          notes: String(data.notes ?? ''),
          paidByUserId: data.paid_by_user_id ? String(data.paid_by_user_id) : null,
          paidByName: String(data.paid_by_name ?? 'Operador'),
          createdAt: String(data.created_at),
        },
      };
    }

    const nowIso = new Date().toISOString();
    const effIso = new Date(input.effectiveAt).toISOString();
    const cleanAmt = roundCurrency2(input.amount);
    const epId = `ep-${crypto.randomUUID().slice(0, 8)}`;

    const newPayment: ExpensePayment = {
      id: epId,
      tenantId: activeTenant.id,
      expenseId: expense!.id,
      cashSessionId: session!.id,
      effectiveAt: effIso,
      amount: cleanAmt,
      currency: expense!.currency,
      paymentMethod: input.paymentMethod,
      referenceCode: input.referenceCode.trim(),
      notes: input.notes.trim(),
      paidByUserId: currentUser.id,
      paidByName: currentUser.fullName,
      createdAt: nowIso,
    };

    const newMovement: CashMovement = {
      id: `cm-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      cashAccountId: session!.cashAccountId,
      cashSessionId: session!.id,
      currency: expense!.currency,
      direction: 'outflow',
      sourceType: 'expense_payment',
      sourceId: epId,
      linkedMovementId: null,
      effectiveAt: effIso,
      amount: cleanAmt,
      notes: `Pago de gasto ${expense!.expenseCode}: ${expense!.concept}`,
      createdBy: currentUser.id,
      createdByName: currentUser.fullName,
      createdAt: nowIso,
    };

    const nextPaid = roundCurrency2(expense!.paidAmount + cleanAmt);
    const nextStatus: ExpenseStatus = nextPaid >= expense!.amount ? 'paid' : 'partially_paid';

    setStore((prev) => ({
      ...prev,
      expensePayments: [newPayment, ...prev.expensePayments],
      cashMovements: [newMovement, ...prev.cashMovements],
      expenses: prev.expenses.map((e) =>
        e.id === expense!.id && e.tenantId === activeTenant.id
          ? { ...e, paidAmount: nextPaid, status: nextStatus, updatedAt: nowIso }
          : e
      ),
    }));

    return { ok: true, data: newPayment };
  };

  const recordCashAdjustment: Phase5ContextValue['recordCashAdjustment'] = async (input) => {
    if (!activeTenant || !currentUser) return { ok: false, error: 'Sin sesión activa.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'cash',
      action: 'reconcile',
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const session = visibleCashSessions.find((s) => s.id === input.cashSessionId);
    if (!session || session.status !== 'open') {
      return {
        ok: false,
        error: 'Los movimientos compensatorios deben registrarse en una caja abierta vigente (§4.8).',
      };
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return { ok: false, error: 'El monto debe ser mayor a 0.' };
    }
    if (input.reason.trim().length < 3) {
      return { ok: false, error: 'Debes explicar el motivo del movimiento compensatorio.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('record_cash_adjustment', {
        p_tenant_id: activeTenant.id,
        p_cash_session_id: session.id,
        p_direction: input.direction,
        p_amount: roundCurrency2(input.amount),
        p_reason: input.reason.trim(),
        p_linked_movement_id: input.linkedMovementId || null,
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase5(activeTenant.id);
      return {
        ok: true,
        data: {
          id: String(data.id),
          tenantId: String(data.tenant_id),
          cashAccountId: String(data.cash_account_id),
          cashSessionId: String(data.cash_session_id),
          currency: data.currency as CurrencyCode,
          direction: data.direction as CashMovementDirection,
          sourceType: 'manual_adjustment',
          sourceId: null,
          linkedMovementId: data.linked_movement_id ? String(data.linked_movement_id) : null,
          effectiveAt: String(data.effective_at),
          amount: Number(data.amount),
          notes: String(data.notes ?? ''),
          createdBy: data.created_by ? String(data.created_by) : null,
          createdByName: String(data.created_by_name ?? 'Operador'),
          createdAt: String(data.created_at),
        },
      };
    }

    const nowIso = new Date().toISOString();
    const mov: CashMovement = {
      id: `cm-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      cashAccountId: session.cashAccountId,
      cashSessionId: session.id,
      currency: session.currency,
      direction: input.direction,
      sourceType: 'manual_adjustment',
      sourceId: null,
      linkedMovementId: input.linkedMovementId || null,
      effectiveAt: nowIso,
      amount: roundCurrency2(input.amount),
      notes: input.reason.trim(),
      createdBy: currentUser.id,
      createdByName: currentUser.fullName,
      createdAt: nowIso,
    };
    setStore((prev) => ({ ...prev, cashMovements: [mov, ...prev.cashMovements] }));
    return { ok: true, data: mov };
  };

  const recordCashReconciliation: Phase5ContextValue['recordCashReconciliation'] = async (
    input
  ) => {
    if (!activeTenant || !currentUser) return { ok: false, error: 'Sin sesión activa.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'cash',
      action: 'reconcile',
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const session = visibleCashSessions.find((s) => s.id === input.cashSessionId);
    const balances = session
      ? computeCashSessionBalances(session, visibleCashMovements)
      : { expectedBalance: 0 };

    const val = validateReconciliationInput({
      session,
      expectedBalance: balances.expectedBalance,
      countedBalance: input.countedBalance,
      differenceReason: input.differenceReason,
    });
    if (!val.valid) return { ok: false, error: val.error };

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('record_cash_reconciliation', {
        p_tenant_id: activeTenant.id,
        p_cash_session_id: session!.id,
        p_counted_balance: roundCurrency2(input.countedBalance),
        p_difference_reason: input.differenceReason.trim(),
        p_evidence_note: input.evidenceNote.trim(),
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase5(activeTenant.id);
      return {
        ok: true,
        data: {
          id: String(data.id),
          tenantId: String(data.tenant_id),
          cashSessionId: String(data.cash_session_id),
          currency: data.currency as CurrencyCode,
          reconciledAt: String(data.reconciled_at),
          expectedBalance: Number(data.expected_balance),
          countedBalance: Number(data.counted_balance),
          differenceAmount: Number(data.difference_amount),
          differenceReason: String(data.difference_reason ?? ''),
          evidenceNote: String(data.evidence_note ?? ''),
          status: data.status as ReconciliationStatus,
          recordedBy: data.recorded_by ? String(data.recorded_by) : null,
          recordedByName: String(data.recorded_by_name ?? 'Operador'),
          approvedBy: data.approved_by ? String(data.approved_by) : null,
          approvedByName: String(data.approved_by_name ?? ''),
          approvedAt: data.approved_at ? String(data.approved_at) : null,
        },
      };
    }

    const nowIso = new Date().toISOString();
    const rec: CashReconciliation = {
      id: `crec-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: activeTenant.id,
      cashSessionId: session!.id,
      currency: session!.currency,
      reconciledAt: nowIso,
      expectedBalance: balances.expectedBalance,
      countedBalance: roundCurrency2(input.countedBalance),
      differenceAmount: val.differenceAmount,
      differenceReason: input.differenceReason.trim(),
      evidenceNote: input.evidenceNote.trim(),
      status: val.requiresApproval ? 'pending_approval' : 'balanced',
      recordedBy: currentUser.id,
      recordedByName: currentUser.fullName,
      approvedBy: null,
      approvedByName: '',
      approvedAt: null,
    };
    setStore((prev) => ({
      ...prev,
      cashReconciliations: [rec, ...prev.cashReconciliations],
    }));
    return { ok: true, data: rec };
  };

  const approveCashReconciliation: Phase5ContextValue['approveCashReconciliation'] = async (
    reconciliationId
  ) => {
    if (!activeTenant || !currentUser) return { ok: false, error: 'Sin sesión activa.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'cash',
      action: 'reconcile',
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const rec = visibleCashReconciliations.find((r) => r.id === reconciliationId);
    if (!rec || rec.status !== 'pending_approval') {
      return { ok: false, error: 'El arqueo no tiene una diferencia pendiente de aprobación.' };
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('approve_cash_reconciliation', {
        p_tenant_id: activeTenant.id,
        p_reconciliation_id: reconciliationId,
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase5(activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => ({
      ...prev,
      cashReconciliations: prev.cashReconciliations.map((r) =>
        r.id === reconciliationId && r.tenantId === activeTenant.id
          ? {
              ...r,
              status: 'approved',
              approvedBy: currentUser.id,
              approvedByName: currentUser.fullName,
              approvedAt: nowIso,
            }
          : r
      ),
    }));
    return { ok: true };
  };

  const closeCashSession: Phase5ContextValue['closeCashSession'] = async (cashSessionId) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    const authCheck = validateTenantMutation({
      membership: activeMembership,
      targetTenantId: activeTenant.id,
      moduleId: 'cash',
      action: 'reconcile',
      customRules: tenantPermissions,
    });
    if (!authCheck.allowed) return { ok: false, error: authCheck.message };

    const session = visibleCashSessions.find((s) => s.id === cashSessionId);
    if (!session || session.status !== 'open') {
      return { ok: false, error: 'La sesión de caja no está abierta.' };
    }

    const lastRec = visibleCashReconciliations
      .filter((r) => r.cashSessionId === cashSessionId)
      .sort((a, b) => b.reconciledAt.localeCompare(a.reconciledAt))[0];

    if (!lastRec) {
      return { ok: false, error: 'Debes realizar un arqueo antes de cerrar la caja (§4.8).' };
    }
    if (lastRec.status === 'pending_approval') {
      return {
        ok: false,
        error: 'La diferencia del último arqueo debe ser aprobada antes de cerrar la caja.',
      };
    }

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.rpc('close_cash_session', {
        p_tenant_id: activeTenant.id,
        p_cash_session_id: cashSessionId,
      });
      if (error) return { ok: false, error: error.message };
      await loadSupabasePhase5(activeTenant.id);
      return { ok: true };
    }

    const nowIso = new Date().toISOString();
    setStore((prev) => ({
      ...prev,
      cashSessions: prev.cashSessions.map((s) =>
        s.id === cashSessionId && s.tenantId === activeTenant.id
          ? {
              ...s,
              status: 'closed',
              closedAt: nowIso,
              closingExpectedBalance: lastRec.expectedBalance,
              closingCountedBalance: lastRec.countedBalance,
            }
          : s
      ),
    }));
    return { ok: true };
  };

  const getAttachmentSignedUrl: Phase5ContextValue['getAttachmentSignedUrl'] = async (
    storagePath
  ) => {
    if (!activeTenant) return { ok: false, error: 'Sin espacio activo.' };
    if (!storagePath) return { ok: false, error: 'Sin comprobante adjunto.' };
    if (!isSupabaseConfigured || !supabase || storagePath.startsWith('local-preview://')) {
      return {
        ok: false,
        error: 'Comprobante registrado en vista previa local (sin enlace Storage remoto).',
      };
    }
    const { data, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(storagePath, 60);
    if (error || !data?.signedUrl) {
      return {
        ok: false,
        error: error?.message ?? 'No se pudo generar el enlace temporal privado.',
      };
    }
    return { ok: true, data: data.signedUrl };
  };

  return (
    <Phase5Context.Provider
      value={{
        categories: visibleCategories,
        expenses: visibleExpenses,
        expensePayments: visibleExpensePayments,
        cashAccounts: visibleCashAccounts,
        cashSessions: visibleCashSessions,
        cashMovements: visibleCashMovements,
        cashReconciliations: visibleCashReconciliations,
        isLoading,
        createCategory,
        createExpense,
        approveExpense,
        voidExpense,
        confirmExpensePayment,
        openCashSession,
        recordCashAdjustment,
        recordCashReconciliation,
        approveCashReconciliation,
        closeCashSession,
        getAttachmentSignedUrl,
        refreshPhase5,
      }}
    >
      {children}
    </Phase5Context.Provider>
  );
}

export function usePhase5(): Phase5ContextValue {
  const ctx = useContext(Phase5Context);
  if (!ctx) {
    throw new Error('usePhase5 debe usarse dentro de Phase5Provider');
  }
  return ctx;
}
