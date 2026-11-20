/**
 * Archivo: src/pages/PropertiesPage.tsx
 * Responsabilidad: Módulo ABM (Modelo B) de Casas y Cuartos: alta/edición de casas,
 *   configuración de modalidad (Casa completa vs Por cuartos), gestión de unidades/cuartos
 *   con protección de estado Ocupada y gestión de copropietarios (suma exacta 100%).
 * Cumplimiento LuchoRentas.md: RF-010 a RF-014, RF-021, §4.2 (modalidad y unidades),
 *   §4.9 / DEC-10 (copropietarios 100% e historial) y control de acceso en doble capa.
 */
import React, { useMemo, useState } from 'react';
import {
  Ban,
  Building,
  CheckCircle2,
  DoorOpen,
  Edit3,
  Lock,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  getActivePropertyOwners,
  summarizePropertyUnits,
  type OwnerShareInput,
} from '../lib/phase2Domain';
import { usePhase2 } from '../lib/phase2Store';
import { formatCurrencyAmount } from '../lib/rbac';
import {
  RENTAL_MODE_LABELS,
  UNIT_STATUS_LABELS,
  type CurrencyCode,
  type Property,
  type PropertyUnit,
  type RentalMode,
  type UnitStatus,
} from '../types/domain';

export function PropertiesPage() {
  const { activeTenant, canDo } = useAuth();
  const {
    properties,
    units,
    people,
    propertyOwners,
    createProperty,
    updateProperty,
    upsertPropertyUnit,
    changeUnitStatus,
    savePropertyOwners,
  } = usePhase2();

  const canManage = canDo('properties', 'manage');

  const [searchTerm, setSearchTerm] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | RentalMode>('all');
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal Casa
  const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [propName, setPropName] = useState('');
  const [propAddress, setPropAddress] = useState('');
  const [propDesc, setPropDesc] = useState('');
  const [propMode, setPropMode] = useState<RentalMode>('by_rooms');
  const [propRefRent, setPropRefRent] = useState('');
  const [propCurrency, setPropCurrency] = useState<CurrencyCode>(
    activeTenant?.defaultCurrency ?? 'BOB'
  );
  const [propModalError, setPropModalError] = useState<string | null>(null);

  // Modal Cuarto / Unidad
  const [isUnitModalOpen, setIsUnitModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<PropertyUnit | null>(null);
  const [unitCode, setUnitCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [unitRent, setUnitRent] = useState('');
  const [unitCurrency, setUnitCurrency] = useState<CurrencyCode>(
    activeTenant?.defaultCurrency ?? 'BOB'
  );
  const [unitNotes, setUnitNotes] = useState('');
  const [unitModalError, setUnitModalError] = useState<string | null>(null);

  // Modal Propietarios (DEC-10 suma 100%)
  const [isOwnersModalOpen, setIsOwnersModalOpen] = useState(false);
  const [ownerDrafts, setOwnerDrafts] = useState<OwnerShareInput[]>([]);
  const [ownersModalError, setOwnersModalError] = useState<string | null>(null);

  const filteredProperties = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return properties.filter((p) => {
      if (modeFilter !== 'all' && p.rentalMode !== modeFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    });
  }, [modeFilter, properties, searchTerm]);

  const activeProperty = useMemo(() => {
    if (filteredProperties.length === 0) return null;
    return (
      filteredProperties.find((p) => p.id === selectedPropertyId) ?? filteredProperties[0]
    );
  }, [filteredProperties, selectedPropertyId]);

  const activePropertyUnits = useMemo(() => {
    if (!activeProperty) return [];
    return units.filter((u) => u.propertyId === activeProperty.id);
  }, [activeProperty, units]);

  const activeOwnersForSelected = useMemo(() => {
    if (!activeProperty || !activeTenant) return [];
    return getActivePropertyOwners(propertyOwners, activeTenant.id, activeProperty.id);
  }, [activeProperty, activeTenant, propertyOwners]);

  const historicalOwnersForSelected = useMemo(() => {
    if (!activeProperty || !activeTenant) return [];
    return propertyOwners.filter(
      (o) => o.tenantId === activeTenant.id && o.propertyId === activeProperty.id && o.effectiveTo !== null
    );
  }, [activeProperty, activeTenant, propertyOwners]);

  const ownerEligiblePeople = useMemo(
    () => people.filter((p) => p.isActive && p.roles.includes('property_owner')),
    [people]
  );

  const openCreatePropertyModal = () => {
    setEditingProperty(null);
    setPropName('');
    setPropAddress('');
    setPropDesc('');
    setPropMode('by_rooms');
    setPropRefRent('');
    setPropCurrency(activeTenant?.defaultCurrency ?? 'BOB');
    setPropModalError(null);
    setIsPropertyModalOpen(true);
  };

  const openEditPropertyModal = (prop: Property) => {
    setEditingProperty(prop);
    setPropName(prop.name);
    setPropAddress(prop.address);
    setPropDesc(prop.description);
    setPropMode(prop.rentalMode);
    setPropRefRent('');
    setPropCurrency(activeTenant?.defaultCurrency ?? 'BOB');
    setPropModalError(null);
    setIsPropertyModalOpen(true);
  };

  const handleSaveProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    setPropModalError(null);

    if (editingProperty) {
      const res = await updateProperty(editingProperty.id, {
        name: propName,
        address: propAddress,
        description: propDesc,
        rentalMode: propMode,
      });
      if (!res.ok) {
        setPropModalError(res.error ?? 'Error al actualizar la casa.');
        return;
      }
      setIsPropertyModalOpen(false);
      setFeedback({ type: 'success', text: `Casa "${propName}" actualizada.` });
      return;
    }

    const parsedRent = propRefRent.trim() === '' ? null : Number(propRefRent);
    if (parsedRent !== null && (Number.isNaN(parsedRent) || parsedRent < 0)) {
      setPropModalError('Ingresa una tarifa referencial válida (mayor o igual a 0).');
      return;
    }

    const res = await createProperty({
      name: propName,
      address: propAddress,
      description: propDesc,
      rentalMode: propMode,
      referenceRent: parsedRent,
      currency: propCurrency,
    });

    if (!res.ok) {
      setPropModalError(res.error ?? 'Error al crear la casa.');
      return;
    }

    if (res.data) {
      setSelectedPropertyId(res.data.id);
    }
    setIsPropertyModalOpen(false);
    setFeedback({ type: 'success', text: `Casa "${propName}" registrada en ${activeTenant?.name}.` });
  };

  const openCreateUnitModal = () => {
    if (!activeProperty) return;
    setEditingUnit(null);
    setUnitCode('');
    setUnitName('');
    setUnitRent('');
    setUnitCurrency(activeTenant?.defaultCurrency ?? 'BOB');
    setUnitNotes('');
    setUnitModalError(null);
    setIsUnitModalOpen(true);
  };

  const openEditUnitModal = (unit: PropertyUnit) => {
    setEditingUnit(unit);
    setUnitCode(unit.code);
    setUnitName(unit.name);
    setUnitRent(unit.referenceRent !== null ? String(unit.referenceRent) : '');
    setUnitCurrency(unit.currency);
    setUnitNotes(unit.notes);
    setUnitModalError(null);
    setIsUnitModalOpen(true);
  };

  const handleSaveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProperty) return;
    setUnitModalError(null);

    const parsedRent = unitRent.trim() === '' ? null : Number(unitRent);
    if (parsedRent !== null && (Number.isNaN(parsedRent) || parsedRent < 0)) {
      setUnitModalError('La tarifa de referencia debe ser un número válido.');
      return;
    }

    const res = await upsertPropertyUnit({
      id: editingUnit?.id,
      propertyId: activeProperty.id,
      code: unitCode,
      name: unitName,
      referenceRent: parsedRent,
      currency: unitCurrency,
      notes: unitNotes,
    });

    if (!res.ok) {
      setUnitModalError(res.error ?? 'No se pudo guardar la unidad.');
      return;
    }

    setIsUnitModalOpen(false);
    setFeedback({
      type: 'success',
      text: editingUnit ? `Unidad "${unitName}" actualizada.` : `Cuarto "${unitName}" agregado.`,
    });
  };

  const handleUnitStatusToggle = async (unit: PropertyUnit, nextStatus: UnitStatus) => {
    if (!activeProperty) return;
    const res = await changeUnitStatus(activeProperty.id, unit.id, nextStatus);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo cambiar el estado.' });
      return;
    }
    setFeedback({
      type: 'success',
      text: `Estado de "${unit.name}" cambiado a ${UNIT_STATUS_LABELS[nextStatus]}.`,
    });
  };

  const openOwnersModal = () => {
    if (!activeProperty) return;
    setOwnersModalError(null);
    setOwnerDrafts(
      activeOwnersForSelected.map((o) => ({
        personId: o.personId,
        ownershipPercent: o.ownershipPercent,
        notes: o.notes,
      }))
    );
    setIsOwnersModalOpen(true);
  };

  const handleAddOwnerRow = () => {
    if (ownerEligiblePeople.length === 0) {
      setOwnersModalError(
        'No hay personas con rol "Propietario" registradas en este espacio. Crea primero la ficha en Personas y Roles.'
      );
      return;
    }
    const unused = ownerEligiblePeople.find(
      (p) => !ownerDrafts.some((d) => d.personId === p.id)
    );
    const chosen = unused ?? ownerEligiblePeople[0];
    const remaining = Math.max(
      0,
      Number((100 - ownerDrafts.reduce((acc, s) => acc + s.ownershipPercent, 0)).toFixed(2))
    );
    setOwnerDrafts((prev) => [
      ...prev,
      { personId: chosen.id, ownershipPercent: remaining || 100, notes: '' },
    ]);
  };

  const handleSaveOwners = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProperty) return;
    setOwnersModalError(null);
    const res = await savePropertyOwners(activeProperty.id, ownerDrafts);
    if (!res.ok) {
      setOwnersModalError(res.error ?? 'Error al guardar propietarios.');
      return;
    }
    setIsOwnersModalOpen(false);
    setFeedback({
      type: 'success',
      text: `Propietarios de "${activeProperty.name}" actualizados con historial preservado.`,
    });
  };

  const totalDraftPercent = ownerDrafts.reduce(
    (sum, item) => sum + (Number.isFinite(item.ownershipPercent) ? item.ownershipPercent : 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Encabezado Modelo B */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Modelo B · Inmuebles y Unidades Alquilables
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Casas y Cuartos
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Espacio activo: <strong className="font-semibold text-slate-900 dark:text-slate-100">{activeTenant?.name}</strong>
            {' · '}
            <span className="font-mono-tabular text-xs">{properties.length} casas</span>
            {' · '}
            <span className="font-mono-tabular text-xs">{units.length} unidades</span>
          </p>
        </div>

        {canManage ? (
          <button
            type="button"
            onClick={openCreatePropertyModal}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Nueva casa</span>
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

      {/* Búsqueda y filtro por modalidad */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            aria-label="Buscar casa por nombre o dirección"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar casa por nombre o dirección..."
            className="w-full min-h-10 rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div
          role="group"
          aria-label="Filtrar por modalidad de alquiler"
          className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900"
        >
          {(['all', 'full_house', 'by_rooms'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModeFilter(m)}
              className={`min-h-8 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                modeFilter === m
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {m === 'all' ? 'Todas' : RENTAL_MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Layout maestro-detalle: Casas a la izquierda, Unidades + Propietarios a la derecha */}
      {filteredProperties.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <Building className="mx-auto h-7 w-7 text-slate-400" />
          <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            No hay casas registradas con los filtros actuales
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Registra una casa en modalidad completa o por cuartos para comenzar a gestionar sus unidades.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={openCreatePropertyModal}
              className="mt-4 min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Registrar primera casa
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          {/* Lista de casas */}
          <div className="lg:col-span-5 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {filteredProperties.map((prop) => {
              const propUnits = units.filter((u) => u.propertyId === prop.id);
              const stats = summarizePropertyUnits(propUnits);
              const isSelected = activeProperty?.id === prop.id;
              const activeOwners = activeTenant
                ? getActivePropertyOwners(propertyOwners, activeTenant.id, prop.id)
                : [];

              return (
                <button
                  key={prop.id}
                  type="button"
                  onClick={() => setSelectedPropertyId(prop.id)}
                  className={`flex w-full flex-col items-start p-4 text-left transition-colors ${
                    isSelected
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/25'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {prop.name}
                    </span>
                    <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0">
                      {RENTAL_MODE_LABELS[prop.rentalMode]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{prop.address}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                    <span>{stats.available} disp.</span>
                    <span aria-hidden="true">·</span>
                    <span>{stats.occupied} ocup.</span>
                    <span aria-hidden="true">·</span>
                    <span>{stats.outOfService} fuera serv.</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {activeOwners.length === 0
                        ? 'Propia del administrador'
                        : `${activeOwners.length} propietario(s)`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detalle de casa seleccionada: Unidades y Propietarios */}
          {activeProperty && (
            <div className="lg:col-span-7 space-y-6">
              {/* Cabecera del inmueble seleccionado */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                      <span>{RENTAL_MODE_LABELS[activeProperty.rentalMode]}</span>
                    </div>
                    <h2 className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-slate-50">
                      {activeProperty.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                      {activeProperty.address}
                    </p>
                    {activeProperty.description && (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {activeProperty.description}
                      </p>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditPropertyModal(activeProperty)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>Editar casa</span>
                      </button>
                      <button
                        type="button"
                        onClick={openOwnersModal}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Users className="h-3.5 w-3.5" />
                        <span>Propietarios</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Propietarios vigentes */}
                <div className="mt-4">
                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Propietarios vigentes (DEC-10)
                  </h3>
                  {activeOwnersForSelected.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Sin propietarios externos asignados (casa propia del administrador).
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {activeOwnersForSelected.map((link) => {
                        const person = people.find((p) => p.id === link.personId);
                        return (
                          <div
                            key={link.id}
                            className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300"
                          >
                            <span>{person?.fullName ?? 'Propietario'}</span>
                            <span className="font-mono-tabular font-semibold">
                              {link.ownershipPercent.toFixed(2)}% · desde {link.effectiveFrom}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {historicalOwnersForSelected.length > 0 && (
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                      Historial registrado: {historicalOwnersForSelected.length} vigencia(s) cerrada(s).
                    </p>
                  )}
                </div>
              </section>

              {/* Unidades / Cuartos de la casa */}
              <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Unidades Alquilables
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {activeProperty.rentalMode === 'full_house'
                        ? 'Modalidad Casa completa: unidad lógica única.'
                        : 'Modalidad Por cuartos: cada cuarto tiene estado y tarifa independiente.'}
                    </p>
                  </div>
                  {canManage && activeProperty.rentalMode === 'by_rooms' && (
                    <button
                      type="button"
                      onClick={openCreateUnitModal}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Nuevo cuarto</span>
                    </button>
                  )}
                </div>

                {activePropertyUnits.length === 0 ? (
                  <div className="p-8 text-center">
                    <DoorOpen className="mx-auto h-6 w-6 text-slate-400" />
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Aún no hay cuartos creados en esta casa.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {activePropertyUnits.map((unit) => {
                      const isOccupied = unit.status === 'occupied';
                      const isAvailable = unit.status === 'available';

                      return (
                        <div
                          key={unit.id}
                          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono-tabular text-xs font-semibold text-slate-500 dark:text-slate-400">
                                {unit.code}
                              </span>
                              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {unit.name}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                              <span
                                className={`inline-flex items-center gap-1 font-medium ${
                                  isAvailable
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : isOccupied
                                      ? 'text-sky-700 dark:text-sky-400'
                                      : 'text-amber-700 dark:text-amber-400'
                                }`}
                              >
                                {isAvailable ? (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                ) : isOccupied ? (
                                  <Lock className="h-3.5 w-3.5" />
                                ) : (
                                  <Ban className="h-3.5 w-3.5" />
                                )}
                                <span>{UNIT_STATUS_LABELS[unit.status]}</span>
                              </span>
                              <span aria-hidden="true" className="text-slate-400">·</span>
                              <span className="font-mono-tabular text-slate-700 dark:text-slate-300">
                                {unit.referenceRent !== null
                                  ? formatCurrencyAmount(unit.referenceRent, unit.currency)
                                  : 'Sin tarifa ref.'}
                              </span>
                              {unit.notes && (
                                <>
                                  <span aria-hidden="true" className="text-slate-400">·</span>
                                  <span className="text-slate-500 dark:text-slate-400">{unit.notes}</span>
                                </>
                              )}
                            </div>
                          </div>

                          {canManage && (
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => openEditUnitModal(unit)}
                                aria-label={`Editar unidad ${unit.name}`}
                                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                Editar
                              </button>
                              {!isOccupied && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUnitStatusToggle(
                                      unit,
                                      isAvailable ? 'out_of_service' : 'available'
                                    )
                                  }
                                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  {isAvailable ? 'Fuera de servicio' : 'Habilitar'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}

      {/* Modal Alta / Edición de Casa */}
      {isPropertyModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="property-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <h2
                id="property-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                {editingProperty ? 'Editar casa' : 'Registrar nueva casa'}
              </h2>
              <button
                type="button"
                onClick={() => setIsPropertyModalOpen(false)}
                aria-label="Cerrar modal de casa"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProperty} className="mt-5 space-y-4">
              <div>
                <label htmlFor="prop-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Nombre de la casa
                </label>
                <input
                  id="prop-name"
                  type="text"
                  value={propName}
                  onChange={(e) => setPropName(e.target.value)}
                  placeholder="Ej. Casa Equipetrol Norte"
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="prop-address" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Dirección
                </label>
                <input
                  id="prop-address"
                  type="text"
                  value={propAddress}
                  onChange={(e) => setPropAddress(e.target.value)}
                  placeholder="Ej. Av. San Martín #310"
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="prop-mode" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Modalidad de alquiler
                </label>
                <select
                  id="prop-mode"
                  value={propMode}
                  onChange={(e) => setPropMode(e.target.value as RentalMode)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="by_rooms">Por cuartos (unidades independientes)</option>
                  <option value="full_house">Casa completa (unidad lógica única)</option>
                </select>
              </div>

              {!editingProperty && propMode === 'full_house' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="prop-rent" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Tarifa ref. opcional
                    </label>
                    <input
                      id="prop-rent"
                      type="number"
                      step="0.01"
                      value={propRefRent}
                      onChange={(e) => setPropRefRent(e.target.value)}
                      placeholder="4500.00"
                      className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="prop-currency" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Moneda
                    </label>
                    <select
                      id="prop-currency"
                      value={propCurrency}
                      onChange={(e) => setPropCurrency(e.target.value as CurrencyCode)}
                      className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="BOB">BOB (Bs)</option>
                      <option value="USD">USD ($us)</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="prop-desc" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Descripción / Observaciones
                </label>
                <textarea
                  id="prop-desc"
                  rows={2}
                  value={propDesc}
                  onChange={(e) => setPropDesc(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {propModalError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {propModalError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPropertyModalOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Guardar casa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Alta / Edición de Cuarto */}
      {isUnitModalOpen && activeProperty && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unit-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <h2 id="unit-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingUnit ? 'Editar unidad' : `Nuevo cuarto en ${activeProperty.name}`}
              </h2>
              <button
                type="button"
                onClick={() => setIsUnitModalOpen(false)}
                aria-label="Cerrar modal de unidad"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUnit} className="mt-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="unit-code" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Código
                  </label>
                  <input
                    id="unit-code"
                    type="text"
                    disabled={Boolean(editingUnit?.isDefaultHouseUnit)}
                    value={unitCode}
                    onChange={(e) => setUnitCode(e.target.value)}
                    placeholder="C-104"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono-tabular text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="unit-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Nombre / Identificador
                  </label>
                  <input
                    id="unit-name"
                    type="text"
                    value={unitName}
                    onChange={(e) => setUnitName(e.target.value)}
                    placeholder="Cuarto 104"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="unit-rent" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Tarifa referencia
                  </label>
                  <input
                    id="unit-rent"
                    type="number"
                    step="0.01"
                    value={unitRent}
                    onChange={(e) => setUnitRent(e.target.value)}
                    placeholder="1100.00"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="unit-currency" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Moneda
                  </label>
                  <select
                    id="unit-currency"
                    value={unitCurrency}
                    onChange={(e) => setUnitCurrency(e.target.value as CurrencyCode)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="BOB">BOB (Bs)</option>
                    <option value="USD">USD ($us)</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="unit-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Observaciones
                </label>
                <input
                  id="unit-notes"
                  type="text"
                  value={unitNotes}
                  onChange={(e) => setUnitNotes(e.target.value)}
                  placeholder="Baño privado, medidor independiente..."
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {unitModalError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {unitModalError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsUnitModalOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Guardar unidad
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Propietarios de la Casa (DEC-10: suma exacta 100%) */}
      {isOwnersModalOpen && activeProperty && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="owners-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="owners-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Propietarios de {activeProperty.name}
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  Si asignas propietarios externos, sus participaciones vigentes deben sumar 100.00%.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOwnersModalOpen(false)}
                aria-label="Cerrar modal de propietarios"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveOwners} className="mt-5 space-y-4">
              {ownerDrafts.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                  Casa propia del administrador (0 propietarios externos). Agrega propietarios si administras este inmueble para terceros.
                </p>
              ) : (
                <div className="space-y-3">
                  {ownerDrafts.map((row, index) => (
                    <div key={`${row.personId}-${index}`} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-7">
                        <select
                          aria-label={`Propietario ${index + 1}`}
                          value={row.personId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setOwnerDrafts((prev) =>
                              prev.map((d, i) => (i === index ? { ...d, personId: val } : d))
                            );
                          }}
                          className="w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        >
                          {ownerEligiblePeople.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.fullName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-3">
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          max="100"
                          aria-label={`Porcentaje propietario ${index + 1}`}
                          value={row.ownershipPercent}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setOwnerDrafts((prev) =>
                              prev.map((d, i) =>
                                i === index ? { ...d, ownershipPercent: val } : d
                              )
                            );
                          }}
                          className="w-full min-h-10 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>
                      <div className="col-span-2 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setOwnerDrafts((prev) => prev.filter((_, i) => i !== index))
                          }
                          aria-label={`Quitar propietario ${index + 1}`}
                          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-300 text-red-600 hover:bg-red-50 dark:border-slate-700 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleAddOwnerRow}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Agregar propietario</span>
                </button>
                <span
                  className={`font-mono-tabular text-xs font-semibold ${
                    ownerDrafts.length === 0 || Math.round(totalDraftPercent * 100) === 10000
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  Total vigente: {totalDraftPercent.toFixed(2)}%
                </span>
              </div>

              {ownersModalError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {ownersModalError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsOwnersModalOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Guardar propietarios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
