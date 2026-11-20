/**
 * Archivo: src/pages/PeoplePage.tsx
 * Responsabilidad: Módulo ABM (Modelo B) de Personas y Roles (Inquilinos, Propietarios,
 *   Proveedores y Contactos) con ficha única multi-rol, consulta de casas por propietario
 *   y desactivación segura preservando historial.
 * Cumplimiento LuchoRentas.md: RF-020 (CA-020 una persona puede tener varios roles),
 *   RF-021 (CA-021 consultar casas de cada propietario), RF-044 (proveedores aislados)
 *   y §4.1 (propietario externo no obtiene acceso al sistema automáticamente).
 */
import React, { useMemo, useState } from 'react';
import { Ban, CheckCircle2, Lock, Plus, Search, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePhase2 } from '../lib/phase2Store';
import {
  PERSON_ROLE_LABELS,
  type Person,
  type PersonBusinessRole,
  type PersonType,
} from '../types/domain';

const ALL_BUSINESS_ROLES: PersonBusinessRole[] = [
  'tenant_renter',
  'property_owner',
  'supplier',
  'contact',
];

export function PeoplePage() {
  const { activeTenant, canDo } = useAuth();
  const { people, properties, propertyOwners, upsertPerson, togglePersonStatus } = usePhase2();

  const canManage = canDo('people', 'manage');

  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | PersonBusinessRole>('all');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal Alta / Edición
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [fullName, setFullName] = useState('');
  const [personType, setPersonType] = useState<PersonType>('individual');
  const [documentId, setDocumentId] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [roles, setRoles] = useState<PersonBusinessRole[]>(['tenant_renter']);
  const [modalError, setModalError] = useState<string | null>(null);

  const filteredPeople = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return people.filter((p) => {
      if (roleFilter !== 'all' && !p.roles.includes(roleFilter)) return false;
      if (!q) return true;
      return (
        p.fullName.toLowerCase().includes(q) ||
        p.documentId.toLowerCase().includes(q) ||
        p.phone.toLowerCase().includes(q) ||
        p.whatsapp.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q)
      );
    });
  }, [people, roleFilter, searchTerm]);

  const openCreateModal = () => {
    setEditingPerson(null);
    setFullName('');
    setPersonType('individual');
    setDocumentId('');
    setPhone('');
    setWhatsapp('');
    setEmail('');
    setAddress('');
    setNotes('');
    setRoles(['tenant_renter']);
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (person: Person) => {
    setEditingPerson(person);
    setFullName(person.fullName);
    setPersonType(person.personType);
    setDocumentId(person.documentId);
    setPhone(person.phone);
    setWhatsapp(person.whatsapp);
    setEmail(person.email);
    setAddress(person.address);
    setNotes(person.notes);
    setRoles([...person.roles]);
    setModalError(null);
    setIsModalOpen(true);
  };

  const toggleRoleSelection = (role: PersonBusinessRole) => {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    const res = await upsertPerson({
      id: editingPerson?.id,
      fullName,
      personType,
      documentId,
      phone,
      whatsapp,
      email,
      address,
      notes,
      roles,
    });

    if (!res.ok) {
      setModalError(res.error ?? 'Error al guardar ficha de persona.');
      return;
    }

    setIsModalOpen(false);
    setFeedback({
      type: 'success',
      text: editingPerson
        ? `Ficha de "${fullName}" actualizada.`
        : `"${fullName}" registrada en ${activeTenant?.name}.`,
    });
  };

  const handleStatusToggle = async (person: Person) => {
    const res = await togglePersonStatus(person.id, !person.isActive);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo cambiar el estado.' });
      return;
    }
    setFeedback({
      type: 'success',
      text: person.isActive
        ? `"${person.fullName}" desactivada preservando su historial.`
        : `"${person.fullName}" reactivada.`,
    });
  };

  const getOwnedPropertiesLabel = (personId: string): string => {
    const activeLinks = propertyOwners.filter(
      (l) => l.personId === personId && l.effectiveTo === null
    );
    if (activeLinks.length === 0) return '—';
    return activeLinks
      .map((l) => {
        const prop = properties.find((p) => p.id === l.propertyId);
        return `${prop?.name ?? 'Casa'} (${l.ownershipPercent}%)`;
      })
      .join(' · ');
  };

  return (
    <div className="space-y-6">
      {/* Encabezado Modelo B */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Modelo B · Ficha Única Multi-Rol
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Personas y Roles
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Inquilinos, propietarios de inmuebles y proveedores de{' '}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">{activeTenant?.name}</strong>
            {' · '}
            <span className="font-mono-tabular text-xs">{people.length} fichas</span>
          </p>
        </div>

        {canManage ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Nueva persona</span>
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

      {/* Búsqueda y filtro por rol de negocio */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            aria-label="Buscar persona por nombre, documento o teléfono"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nombre, CI/NIT, teléfono o correo..."
            className="w-full min-h-10 rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div
          role="group"
          aria-label="Filtrar por rol de persona"
          className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900"
        >
          <button
            type="button"
            onClick={() => setRoleFilter('all')}
            className={`min-h-8 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              roleFilter === 'all'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            Todos
          </button>
          {ALL_BUSINESS_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              className={`min-h-8 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                roleFilter === r
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {PERSON_ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla responsive de personas */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[740px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <th className="px-4 py-3">Nombre / Razón social</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3">CI / NIT</th>
              <th className="px-4 py-3">Contacto</th>
              <th className="px-4 py-3">Casas (Propietario)</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredPeople.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  No existen personas registradas que coincidan con la búsqueda.
                </td>
              </tr>
            ) : (
              filteredPeople.map((person) => (
                <tr key={person.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {person.fullName}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {person.personType === 'company' ? 'Empresa / Jurídica' : 'Persona natural'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-slate-800 dark:text-slate-200">
                    {person.roles.map((r) => PERSON_ROLE_LABELS[r]).join(' · ')}
                  </td>
                  <td className="px-4 py-3 font-mono-tabular text-xs text-slate-600 dark:text-slate-400">
                    {person.documentId || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                    <div className="font-mono-tabular">{person.whatsapp || person.phone || '—'}</div>
                    {person.email && <div className="text-[11px]">{person.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                    {getOwnedPropertiesLabel(person.id)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${
                        person.isActive
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {person.isActive ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Ban className="h-3.5 w-3.5" />
                      )}
                      <span>{person.isActive ? 'Activo' : 'Inactivo'}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canManage ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(person)}
                          aria-label={`Editar ficha de ${person.fullName}`}
                          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusToggle(person)}
                          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {person.isActive ? 'Desactivar' : 'Reactivar'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500">Solo lectura</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Alta / Edición de Persona */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="person-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2 id="person-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {editingPerson ? 'Editar ficha de persona' : 'Nueva ficha de persona'}
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  Una misma persona puede desempeñar varios roles sin duplicar fichas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Cerrar modal de persona"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label htmlFor="person-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Nombre o razón social
                  </label>
                  <input
                    id="person-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ej. Luis Rojas Pérez"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="person-type" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Tipo
                  </label>
                  <select
                    id="person-type"
                    value={personType}
                    onChange={(e) => setPersonType(e.target.value as PersonType)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="individual">Natural</option>
                    <option value="company">Empresa</option>
                  </select>
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Roles de negocio (selecciona uno o varios)
                </span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {ALL_BUSINESS_ROLES.map((role) => (
                    <label
                      key={role}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/50"
                    >
                      <input
                        type="checkbox"
                        checked={roles.includes(role)}
                        onChange={() => toggleRoleSelection(role)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>{PERSON_ROLE_LABELS[role]}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="person-doc" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    CI / NIT (opcional)
                  </label>
                  <input
                    id="person-doc"
                    type="text"
                    value={documentId}
                    onChange={(e) => setDocumentId(e.target.value)}
                    placeholder="4589120 SC"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="person-whatsapp" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    WhatsApp / Teléfono
                  </label>
                  <input
                    id="person-whatsapp"
                    type="text"
                    value={whatsapp}
                    onChange={(e) => {
                      setWhatsapp(e.target.value);
                      if (!phone) setPhone(e.target.value);
                    }}
                    placeholder="+59170011223"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono-tabular text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="person-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Correo electrónico
                  </label>
                  <input
                    id="person-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contacto@correo.bo"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="person-address" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Dirección
                  </label>
                  <input
                    id="person-address"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="person-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Observaciones
                </label>
                <textarea
                  id="person-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {modalError && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {modalError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Guardar ficha
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
