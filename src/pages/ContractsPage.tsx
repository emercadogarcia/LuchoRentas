/**
 * Archivo: src/pages/ContractsPage.tsx
 * Responsabilidad: Módulo ABM (Modelo B) de Contratos Mensuales de Alquiler:
 *   creación contextual (casa -> unidad -> inquilino), vista previa inmediata del calendario
 *   por aniversario contractual (DEC-03, DEC-18 días 29/30/31 y prorrateo real DEC-05),
 *   activación anti doble ocupación (RF-014), versionado futuro (RF-024) y finalización (RF-025).
 * Cumplimiento LuchoRentas.md: RF-014, RF-022 a RF-025, §4.4, DEC-01, DEC-03, DEC-05, DEC-18
 *   y control de acceso en doble capa.
 */
import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  FileText,
  History,
  Lock,
  Play,
  Plus,
  Search,
  StopCircle,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePhase2 } from '../lib/phase2Store';
import { getLaPazTodayIso, previewContractSchedule } from '../lib/phase3Domain';
import { usePhase3 } from '../lib/phase3Store';
import { formatCurrencyAmount } from '../lib/rbac';
import {
  CONTRACT_STATUS_LABELS,
  RENTAL_MODE_LABELS,
  type ContractStatus,
  type CurrencyCode,
} from '../types/domain';

export function ContractsPage() {
  const { activeTenant, canDo } = useAuth();
  const { properties, units, people } = usePhase2();
  const {
    contracts,
    versions,
    receivables,
    createContract,
    activateContract,
    addContractVersion,
    finalizeContract,
  } = usePhase3();

  const canManage = canDo('contracts', 'manage');
  const todayLaPaz = getLaPazTodayIso();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ContractStatus>('all');
  const [propertyFilter, setPropertyFilter] = useState<string>('all');
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal Nuevo Contrato
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formPropertyId, setFormPropertyId] = useState('');
  const [formUnitId, setFormUnitId] = useState('');
  const [formTenantPersonId, setFormTenantPersonId] = useState('');
  const [formStartDate, setFormStartDate] = useState(todayLaPaz);
  const [formFirstPeriodDate, setFormFirstPeriodDate] = useState(todayLaPaz);
  const [formEndDate, setFormEndDate] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState<CurrencyCode>(
    activeTenant?.defaultCurrency ?? 'BOB'
  );
  const [formNotes, setFormNotes] = useState('');
  const [formActivateNow, setFormActivateNow] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);

  // Modal Nueva Versión de Tarifa (RF-024)
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [verEffectiveFrom, setVerEffectiveFrom] = useState(todayLaPaz);
  const [verAmount, setVerAmount] = useState('');
  const [verCurrency, setVerCurrency] = useState<CurrencyCode>('BOB');
  const [verNotes, setVerNotes] = useState('');
  const [verError, setVerError] = useState<string | null>(null);

  // Modal Finalizar Contrato (RF-025)
  const [isFinalizeOpen, setIsFinalizeOpen] = useState(false);
  const [finDate, setFinDate] = useState(todayLaPaz);
  const [finReason, setFinReason] = useState('');
  const [finError, setFinError] = useState<string | null>(null);

  const eligibleRenters = useMemo(
    () => people.filter((p) => p.isActive && p.roles.includes('tenant_renter')),
    [people]
  );

  const activeProperties = useMemo(
    () => properties.filter((p) => p.isActive),
    [properties]
  );

  const unitsForFormProperty = useMemo(() => {
    const prop = activeProperties.find((p) => p.id === formPropertyId);
    if (!prop) return [];
    return units.filter((u) => {
      if (u.propertyId !== prop.id || !u.isActive) return false;
      if (prop.rentalMode === 'full_house') return u.isDefaultHouseUnit;
      return !u.isDefaultHouseUnit;
    });
  }, [activeProperties, formPropertyId, units]);

  const liveSchedulePreview = useMemo(() => {
    const parsedAmount = Number(formAmount);
    if (!formFirstPeriodDate || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return [];
    }
    return previewContractSchedule({
      firstPeriodStartDate: formFirstPeriodDate,
      endDate: formEndDate.trim() ? formEndDate.trim() : null,
      monthlyAmount: parsedAmount,
      currency: formCurrency,
      maxPeriods: 4,
    });
  }, [formAmount, formCurrency, formEndDate, formFirstPeriodDate]);

  const filteredContracts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return contracts.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (propertyFilter !== 'all' && c.propertyId !== propertyFilter) return false;
      if (!q) return true;
      const prop = properties.find((p) => p.id === c.propertyId);
      const unit = units.find((u) => u.id === c.unitId);
      const person = people.find((pe) => pe.id === c.tenantPersonId);
      return (
        c.contractCode.toLowerCase().includes(q) ||
        (prop?.name.toLowerCase().includes(q) ?? false) ||
        (unit?.name.toLowerCase().includes(q) ?? false) ||
        (unit?.code.toLowerCase().includes(q) ?? false) ||
        (person?.fullName.toLowerCase().includes(q) ?? false)
      );
    });
  }, [contracts, people, properties, propertyFilter, searchTerm, statusFilter, units]);

  const selectedContract = useMemo(() => {
    if (filteredContracts.length === 0) return null;
    return filteredContracts.find((c) => c.id === selectedContractId) ?? filteredContracts[0];
  }, [filteredContracts, selectedContractId]);

  const selectedVersions = useMemo(() => {
    if (!selectedContract) return [];
    return versions
      .filter((v) => v.contractId === selectedContract.id)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }, [selectedContract, versions]);

  const selectedSchedule = useMemo(() => {
    if (!selectedContract) return [];
    return previewContractSchedule({
      firstPeriodStartDate: selectedContract.firstPeriodStartDate,
      endDate: selectedContract.endDate,
      monthlyAmount: selectedContract.monthlyAmount,
      currency: selectedContract.currency,
      versions: selectedVersions,
      contractId: selectedContract.id,
      maxPeriods: 6,
    });
  }, [selectedContract, selectedVersions]);

  const applyPropertySelection = (propId: string) => {
    setFormPropertyId(propId);
    const prop = activeProperties.find((p) => p.id === propId);
    const candidateUnits = units.filter((u) => {
      if (u.propertyId !== propId || !u.isActive) return false;
      if (prop?.rentalMode === 'full_house') return u.isDefaultHouseUnit;
      return !u.isDefaultHouseUnit;
    });
    const preferred = candidateUnits.find((u) => u.status === 'available') ?? candidateUnits[0];
    setFormUnitId(preferred?.id ?? '');
    if (preferred?.referenceRent) {
      setFormAmount(String(preferred.referenceRent));
      setFormCurrency(preferred.currency);
    } else {
      setFormAmount('');
      setFormCurrency(activeTenant?.defaultCurrency ?? 'BOB');
    }
  };

  const openCreateModal = () => {
    const defaultPropId = activeProperties[0]?.id ?? '';
    setCreateError(null);
    setFormStartDate(todayLaPaz);
    setFormFirstPeriodDate(todayLaPaz);
    setFormEndDate('');
    setFormNotes('');
    setFormActivateNow(true);
    setFormTenantPersonId(eligibleRenters[0]?.id ?? '');
    applyPropertySelection(defaultPropId);
    setIsCreateOpen(true);
  };

  const handleUnitChange = (unitId: string) => {
    setFormUnitId(unitId);
    const unit = units.find((u) => u.id === unitId);
    if (unit?.referenceRent) {
      setFormAmount(String(unit.referenceRent));
      setFormCurrency(unit.currency);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const parsedAmount = Number(formAmount);
    const res = await createContract({
      propertyId: formPropertyId,
      unitId: formUnitId,
      tenantPersonId: formTenantPersonId,
      startDate: formStartDate,
      firstPeriodStartDate: formFirstPeriodDate,
      endDate: formEndDate.trim() ? formEndDate.trim() : null,
      monthlyAmount: parsedAmount,
      currency: formCurrency,
      notes: formNotes,
      activateNow: formActivateNow,
    });

    if (!res.ok) {
      setCreateError(res.error ?? 'No se pudo crear el contrato.');
      return;
    }

    if (res.data) {
      setSelectedContractId(res.data.id);
    }
    setIsCreateOpen(false);
    setFeedback({
      type: 'success',
      text: formActivateNow
        ? 'Contrato registrado y activado. La unidad pasó automáticamente a estado Ocupada.'
        : 'Contrato guardado en Borrador para revisión previa.',
    });
  };

  const handleActivateSelected = async () => {
    if (!selectedContract) return;
    const res = await activateContract(selectedContract.id);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo activar el contrato.' });
      return;
    }
    setFeedback({
      type: 'success',
      text: `Contrato ${selectedContract.contractCode} activado. Unidad marcada como Ocupada.`,
    });
  };

  const openVersionModal = () => {
    if (!selectedContract) return;
    setVerEffectiveFrom(todayLaPaz);
    setVerAmount(String(selectedContract.monthlyAmount));
    setVerCurrency(selectedContract.currency);
    setVerNotes('');
    setVerError(null);
    setIsVersionOpen(true);
  };

  const handleAddVersionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContract) return;
    setVerError(null);
    const res = await addContractVersion({
      contractId: selectedContract.id,
      effectiveFrom: verEffectiveFrom,
      monthlyAmount: Number(verAmount),
      currency: verCurrency,
      notes: verNotes,
    });
    if (!res.ok) {
      setVerError(res.error ?? 'No se pudo agregar la nueva versión.');
      return;
    }
    setIsVersionOpen(false);
    setFeedback({
      type: 'success',
      text: 'Nueva versión contractual registrada. Los cargos ya emitidos conservan sus importes originales.',
    });
  };

  const openFinalizeModal = () => {
    if (!selectedContract) return;
    setFinDate(todayLaPaz);
    setFinReason('');
    setFinError(null);
    setIsFinalizeOpen(true);
  };

  const handleFinalizeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContract) return;
    setFinError(null);
    const res = await finalizeContract({
      contractId: selectedContract.id,
      effectiveEndDate: finDate,
      reason: finReason,
    });
    if (!res.ok) {
      setFinError(res.error ?? 'No se pudo finalizar el contrato.');
      return;
    }
    setIsFinalizeOpen(false);
    setFeedback({
      type: 'success',
      text: `Contrato ${selectedContract.contractCode} finalizado. Se conservó el historial de cargos y se liberó la unidad.`,
    });
  };

  return (
    <div className="space-y-6">
      {/* Encabezado Modelo B */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Modelo B · Aniversario contractual, prorrateo real (DEC-05) y regla ancla 29/30/31 (DEC-18)
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Contratos Mensuales
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Espacio activo: <strong className="font-semibold text-slate-900 dark:text-slate-100">{activeTenant?.name}</strong>
            {' · '}
            <span className="font-mono-tabular text-xs">
              {contracts.filter((c) => c.status === 'active').length} activos
            </span>
            {' · '}
            <span className="font-mono-tabular text-xs">{contracts.length} totales</span>
          </p>
        </div>

        {canManage ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Nuevo contrato</span>
          </button>
        ) : (
          <div className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <Lock className="h-3.5 w-3.5" />
            <span>Consulta en solo lectura</span>
          </div>
        )}
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs font-medium ${
            feedback.type === 'error'
              ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Cerrar notificación"
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Búsqueda y filtros */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              aria-label="Buscar contrato por código, inquilino o inmueble"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar código, inquilino, casa o cuarto..."
              className="w-full min-h-10 rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>

          <select
            aria-label="Filtrar contratos por casa"
            value={propertyFilter}
            onChange={(e) => setPropertyFilter(e.target.value)}
            className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="all">Todas las casas</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div
          role="group"
          aria-label="Filtrar por estado de contrato"
          className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900"
        >
          {(['all', 'active', 'draft', 'finalized'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`min-h-8 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {st === 'all' ? 'Todos' : CONTRACT_STATUS_LABELS[st]}
            </button>
          ))}
        </div>
      </div>

      {/* Layout maestro-detalle */}
      {filteredContracts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <FileText className="mx-auto h-7 w-7 text-slate-400" />
          <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            No hay contratos registrados con los filtros actuales
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Crea un contrato asociando casa/unidad, inquilino, tarifa mensual y primer período de cobro.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Crear primer contrato
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          {/* Lista de contratos */}
          <div className="lg:col-span-5 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {filteredContracts.map((ctr) => {
              const prop = properties.find((p) => p.id === ctr.propertyId);
              const unit = units.find((u) => u.id === ctr.unitId);
              const renter = people.find((pe) => pe.id === ctr.tenantPersonId);
              const isSelected = selectedContract?.id === ctr.id;

              return (
                <button
                  key={ctr.id}
                  type="button"
                  onClick={() => setSelectedContractId(ctr.id)}
                  className={`flex w-full flex-col items-start p-4 text-left transition-colors ${
                    isSelected
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/25'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="font-mono-tabular text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {ctr.contractCode}
                    </span>
                    <span
                      className={`text-xs font-semibold whitespace-nowrap shrink-0 ${
                        ctr.status === 'active'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : ctr.status === 'draft'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {CONTRACT_STATUS_LABELS[ctr.status]}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {renter?.fullName ?? 'Inquilino'}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                    {prop?.name ?? 'Casa'} · {unit?.code ?? ''} {unit?.name ?? ''}
                  </div>
                  <div className="mt-2 flex w-full items-center justify-between text-xs font-mono-tabular">
                    <span className="text-slate-500 dark:text-slate-400">
                      Inicio {ctr.startDate}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrencyAmount(ctr.monthlyAmount, ctr.currency)} / mes
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detalle del contrato seleccionado */}
          {selectedContract && (
            <div className="lg:col-span-7 space-y-6">
              <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between dark:border-slate-800">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono-tabular font-semibold text-slate-700 dark:text-slate-300">
                        {selectedContract.contractCode}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-semibold ${
                          selectedContract.status === 'active'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : selectedContract.status === 'draft'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {CONTRACT_STATUS_LABELS[selectedContract.status]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        Ancla día {selectedContract.anchorDay} (DEC-18)
                      </span>
                    </div>
                    <h2 className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-slate-50">
                      {people.find((p) => p.id === selectedContract.tenantPersonId)?.fullName ?? 'Inquilino'}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                      {properties.find((p) => p.id === selectedContract.propertyId)?.name} —{' '}
                      {units.find((u) => u.id === selectedContract.unitId)?.name}
                    </p>
                  </div>

                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {selectedContract.status === 'draft' && (
                        <button
                          type="button"
                          onClick={handleActivateSelected}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 whitespace-nowrap shrink-0"
                        >
                          <Play className="h-3.5 w-3.5" />
                          <span>Activar contrato</span>
                        </button>
                      )}
                      {(selectedContract.status === 'draft' || selectedContract.status === 'active') && (
                        <button
                          type="button"
                          onClick={openVersionModal}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          <History className="h-3.5 w-3.5" />
                          <span>Nueva tarifa (RF-024)</span>
                        </button>
                      )}
                      {selectedContract.status === 'active' && (
                        <button
                          type="button"
                          onClick={openFinalizeModal}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40 whitespace-nowrap shrink-0"
                        >
                          <StopCircle className="h-3.5 w-3.5" />
                          <span>Finalizar contrato</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Tarifa actual</div>
                    <div className="mt-0.5 font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrencyAmount(selectedContract.monthlyAmount, selectedContract.currency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Inicio contractual</div>
                    <div className="mt-0.5 font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                      {selectedContract.startDate}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">1er período cobro</div>
                    <div className="mt-0.5 font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                      {selectedContract.firstPeriodStartDate}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Fin / Vigencia</div>
                    <div className="mt-0.5 font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                      {selectedContract.endDate ?? 'Indefinido'}
                    </div>
                  </div>
                </div>

                {selectedContract.notes && (
                  <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                    {selectedContract.notes}
                  </p>
                )}
                {selectedContract.finalizationReason && (
                  <p className="mt-2 text-xs text-red-700 dark:text-red-400">
                    Motivo de finalización: {selectedContract.finalizationReason}
                  </p>
                )}
              </section>

              {/* Calendario proyectado */}
              <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Calendario de Períodos Mensuales (Aniversario + DEC-18)
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Vencimiento al inicio de cada período (DEC-04). Prorrateo automático por días reales al cierre.
                    </p>
                  </div>
                  <Calendar className="h-4 w-4 text-slate-400" />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">#</th>
                        <th className="px-4 py-2.5 font-medium">Período</th>
                        <th className="px-4 py-2.5 font-medium">Días / Divisor</th>
                        <th className="px-4 py-2.5 font-medium">Vencimiento</th>
                        <th className="px-4 py-2.5 font-medium text-right">Importe</th>
                        <th className="px-4 py-2.5 font-medium text-right">CxC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {selectedSchedule.map((per) => {
                        const emitted = receivables.find(
                          (r) =>
                            r.contractId === selectedContract.id &&
                            r.periodStart === per.effectiveStart
                        );
                        return (
                          <tr key={per.periodIndex}>
                            <td className="px-4 py-2.5 font-mono-tabular text-slate-500 dark:text-slate-400">
                              P{per.periodIndex + 1}
                            </td>
                            <td className="px-4 py-2.5 font-mono-tabular text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {per.effectiveStart} → {per.effectiveEnd}
                            </td>
                            <td className="px-4 py-2.5 font-mono-tabular text-slate-600 dark:text-slate-300">
                              {per.coveredDays}/{per.calendarDaysDivisor} días
                              {per.isProrated ? ' (Prorrateado)' : ''}
                            </td>
                            <td className="px-4 py-2.5 font-mono-tabular text-slate-600 dark:text-slate-300">
                              {per.dueDate}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono-tabular font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {formatCurrencyAmount(per.calculatedAmount, per.currency)}
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                              {emitted ? (
                                <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Emitida
                                </span>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-500">Pendiente</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Historial de versiones (RF-024) */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Historial de Condiciones y Tarifas (RF-024)
                </h3>
                <div className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
                  {selectedVersions.map((ver) => (
                    <div
                      key={ver.id}
                      className="flex flex-col gap-1 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                          Versión {ver.versionNumber}
                        </span>
                        <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
                        <span className="font-mono-tabular text-slate-600 dark:text-slate-400">
                          Vigente desde {ver.effectiveFrom}
                        </span>
                        {ver.notes && (
                          <span className="ml-2 text-slate-500 dark:text-slate-400">
                            — {ver.notes}
                          </span>
                        )}
                      </div>
                      <span className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrencyAmount(ver.monthlyAmount, ver.currency)} / mes
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* Modal Nuevo Contrato con vista previa en vivo */}
      {isCreateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-contract-title"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="my-8 w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="create-contract-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Nuevo contrato mensual de alquiler
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Previsualiza los períodos por aniversario (incluyendo regla DEC-18 para días 29/30/31) antes de confirmar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                aria-label="Cerrar modal de nuevo contrato"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ctr-property" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Casa / Inmueble
                  </label>
                  <select
                    id="ctr-property"
                    value={formPropertyId}
                    onChange={(e) => applyPropertySelection(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {activeProperties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({RENTAL_MODE_LABELS[p.rentalMode]})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="ctr-unit" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Unidad / Cuarto
                  </label>
                  <select
                    id="ctr-unit"
                    value={formUnitId}
                    onChange={(e) => handleUnitChange(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {unitsForFormProperty.length === 0 ? (
                      <option value="">Sin unidades habilitadas</option>
                    ) : (
                      unitsForFormProperty.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code} — {u.name} ({u.status === 'available' ? 'Disponible' : u.status === 'occupied' ? 'Ocupada' : 'Fuera de servicio'})
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="ctr-renter" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Inquilino responsable
                </label>
                <select
                  id="ctr-renter"
                  value={formTenantPersonId}
                  onChange={(e) => setFormTenantPersonId(e.target.value)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {eligibleRenters.length === 0 ? (
                    <option value="">No hay personas con rol Inquilino registradas</option>
                  ) : (
                    eligibleRenters.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.fullName} {r.documentId ? `(${r.documentId})` : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="ctr-start" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Fecha inicio contrato
                  </label>
                  <input
                    id="ctr-start"
                    type="date"
                    value={formStartDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormStartDate(val);
                      if (!formFirstPeriodDate || formFirstPeriodDate < val) {
                        setFormFirstPeriodDate(val);
                      }
                    }}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="ctr-first-period" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Inicio 1er período cobro
                  </label>
                  <input
                    id="ctr-first-period"
                    type="date"
                    value={formFirstPeriodDate}
                    onChange={(e) => setFormFirstPeriodDate(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="ctr-end" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Fecha fin (opcional)
                  </label>
                  <input
                    id="ctr-end"
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label htmlFor="ctr-amount" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Importe mensual de alquiler
                  </label>
                  <input
                    id="ctr-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="1200.00"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="ctr-currency" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Moneda
                  </label>
                  <select
                    id="ctr-currency"
                    value={formCurrency}
                    onChange={(e) => setFormCurrency(e.target.value as CurrencyCode)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="BOB">BOB (Bs)</option>
                    <option value="USD">USD ($us)</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="ctr-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Observaciones
                </label>
                <input
                  id="ctr-notes"
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Incluye agua, medidor de luz aparte..."
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {/* Previsualización inmediata del calendario (CA-023) */}
              {liveSchedulePreview.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Vista previa del calendario de períodos (Aniversario + DEC-18)
                  </div>
                  <div className="mt-2 space-y-1 text-[11px] font-mono-tabular">
                    {liveSchedulePreview.map((p) => (
                      <div key={p.periodIndex} className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                        <span>
                          P{p.periodIndex + 1}: {p.effectiveStart} → {p.effectiveEnd} ({p.coveredDays}/{p.calendarDaysDivisor} días{p.isProrated ? ', prorrateado' : ''})
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {formatCurrencyAmount(p.calculatedAmount, p.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={formActivateNow}
                  onChange={(e) => setFormActivateNow(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                />
                <span>Activar contrato inmediatamente (marca la unidad como Ocupada)</span>
              </label>

              {createError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Guardar contrato
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Nueva Versión de Tarifa (RF-024) */}
      {isVersionOpen && selectedContract && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="version-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="version-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Modificar condiciones futuras ({selectedContract.contractCode})
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Los cargos ya emitidos conservan sus importes originales (CA-024).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsVersionOpen(false)}
                aria-label="Cerrar modal de nueva tarifa"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddVersionSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="ver-date" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Fecha de vigencia
                </label>
                <input
                  id="ver-date"
                  type="date"
                  value={verEffectiveFrom}
                  onChange={(e) => setVerEffectiveFrom(e.target.value)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label htmlFor="ver-amount" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Nuevo importe mensual
                  </label>
                  <input
                    id="ver-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={verAmount}
                    onChange={(e) => setVerAmount(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="ver-currency" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Moneda
                  </label>
                  <select
                    id="ver-currency"
                    value={verCurrency}
                    onChange={(e) => setVerCurrency(e.target.value as CurrencyCode)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="BOB">BOB</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="ver-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Motivo / Observación
                </label>
                <input
                  id="ver-notes"
                  type="text"
                  value={verNotes}
                  onChange={(e) => setVerNotes(e.target.value)}
                  placeholder="Ej. Reajuste acordado por renovación"
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {verError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {verError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsVersionOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Guardar versión
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Finalizar Contrato (RF-025) */}
      {isFinalizeOpen && selectedContract && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="finalize-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="finalize-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Finalizar contrato {selectedContract.contractCode}
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  No borra cargos previos y libera la ocupación de la unidad (CA-025).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsFinalizeOpen(false)}
                aria-label="Cerrar modal de finalización"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleFinalizeSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="fin-date" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Fecha efectiva de finalización
                </label>
                <input
                  id="fin-date"
                  type="date"
                  value={finDate}
                  onChange={(e) => setFinDate(e.target.value)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="fin-reason" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Motivo de finalización
                </label>
                <textarea
                  id="fin-reason"
                  rows={2}
                  value={finReason}
                  onChange={(e) => setFinReason(e.target.value)}
                  placeholder="Entrega voluntaria de llaves al cierre del mes..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {finError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {finError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsFinalizeOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500"
                >
                  Confirmar finalización
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
