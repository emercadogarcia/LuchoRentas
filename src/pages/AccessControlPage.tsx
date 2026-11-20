/**
 * Archivo: src/pages/AccessControlPage.tsx
 * Responsabilidad: Módulo ABM (Modelo B) de Usuarios, Membresías y Permisos del tenant activo,
 *   junto con la matriz de permisos por rol (DEC-13) y la bitácora de auditoría RLS.
 * Cumplimiento LuchoRentas.md: RF-004 (CA-004 invitar/activar/desactivar usuarios y asignar
 *   permisos con doble validación backend + frontend) y §10.5 (auditoría por tenant_id).
 */
import React, { useMemo, useState } from 'react';
import { Ban, CheckCircle2, Lock, Plus, Search, ShieldAlert, UserCheck, X } from 'lucide-react';
import { isPermissionDefaultAllowed, useAuth } from '../lib/auth';
import { MODULE_CATALOG, formatBoliviaDateTime } from '../lib/rbac';
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type AppModuleId,
  type MembershipStatus,
  type ModuleAction,
  type TenantMembership,
  type TenantRole,
} from '../types/domain';

const EDITABLE_ROLES: Exclude<TenantRole, 'tenant_owner'>[] = [
  'admin',
  'collector',
  'finance_operator',
  'viewer',
];

const MATRIX_ROWS: Array<{ moduleId: AppModuleId; actionId: ModuleAction; label: string }> = [
  { moduleId: 'dashboard', actionId: 'view', label: 'Dashboard · Ver panel' },
  { moduleId: 'properties', actionId: 'view', label: 'Casas y Cuartos · Ver' },
  { moduleId: 'properties', actionId: 'manage', label: 'Casas y Cuartos · Crear/Editar' },
  { moduleId: 'people', actionId: 'view', label: 'Personas · Ver' },
  { moduleId: 'people', actionId: 'manage', label: 'Personas · Crear/Editar' },
  { moduleId: 'contracts', actionId: 'view', label: 'Contratos · Ver' },
  { moduleId: 'contracts', actionId: 'manage', label: 'Contratos · Gestionar' },
  { moduleId: 'receivables', actionId: 'view', label: 'CxC · Ver saldos y mora' },
  { moduleId: 'receivables', actionId: 'generate', label: 'CxC · Generar obligaciones' },
  { moduleId: 'collections', actionId: 'view', label: 'Cobros y Recibos · Ver' },
  { moduleId: 'collections', actionId: 'create', label: 'Cobros · Registrar cobro' },
  { moduleId: 'collections', actionId: 'reverse', label: 'Cobros · Revertir cobro' },
  { moduleId: 'expenses', actionId: 'view', label: 'Gastos y CxP · Ver' },
  { moduleId: 'expenses', actionId: 'manage', label: 'Gastos y CxP · Registrar/Pagar' },
  { moduleId: 'cash', actionId: 'view', label: 'Caja · Ver movimientos' },
  { moduleId: 'cash', actionId: 'reconcile', label: 'Caja · Arqueo y Cierre' },
  { moduleId: 'reports', actionId: 'view', label: 'Reportes · Ver' },
  { moduleId: 'reports', actionId: 'export', label: 'Reportes · Exportar' },
  { moduleId: 'users_permissions', actionId: 'view', label: 'Usuarios · Ver membresías' },
  { moduleId: 'users_permissions', actionId: 'manage', label: 'Usuarios · Dar de alta/Administrar' },
];

export function AccessControlPage() {
  const {
    isSupabaseLive,
    activeTenant,
    activeMembership,
    tenantMemberships,
    tenantPermissions,
    tenantAuditLogs,
    canDo,
    addOrUpdateMember,
    toggleMembershipStatus,
    updateRolePermission,
  } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MembershipStatus>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TenantMembership | null>(null);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<TenantRole>('collector');
  const [modalError, setModalError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<TenantMembership | null>(null);

  const canManageUsers = canDo('users_permissions', 'manage');
  const isOwner = activeMembership?.role === 'tenant_owner';
  const assignableRoles: TenantRole[] = isOwner
    ? ['tenant_owner', ...EDITABLE_ROLES]
    : EDITABLE_ROLES;

  const filteredMembers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return tenantMemberships.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (!q) return true;
      const name = m.profile?.fullName.toLowerCase() ?? '';
      const email = m.profile?.email.toLowerCase() ?? '';
      const roleLabel = ROLE_LABELS[m.role].toLowerCase();
      return name.includes(q) || email.includes(q) || roleLabel.includes(q);
    });
  }, [searchTerm, statusFilter, tenantMemberships]);

  const openCreateModal = () => {
    setEditingMember(null);
    setMemberName('');
    setMemberEmail('');
    setMemberRole('collector');
    setModalError(null);
    setFeedback(null);
    setIsModalOpen(true);
  };

  const openEditModal = (member: TenantMembership) => {
    if (member.role === 'tenant_owner') return;
    setEditingMember(member);
    setMemberName(member.profile?.fullName ?? '');
    setMemberEmail(member.profile?.email ?? '');
    setMemberRole(member.role);
    setModalError(null);
    setFeedback(null);
    setIsModalOpen(true);
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    const res = await addOrUpdateMember({
      fullName: memberName,
      email: memberEmail,
      role: memberRole,
    });
    if (!res.ok) {
      setModalError(res.error ?? 'Error al guardar colaborador.');
      return;
    }
    setIsModalOpen(false);
    setFeedback({
      type: 'success',
      text: editingMember
        ? `Rol actualizado para ${memberEmail}.`
        : `Colaborador ${memberEmail} asignado al espacio ${activeTenant?.name}.`,
    });
  };

  const handleConfirmStatusToggle = async () => {
    if (!confirmToggle) return;
    const nextStatus: MembershipStatus = confirmToggle.status === 'active' ? 'inactive' : 'active';
    const res = await toggleMembershipStatus(confirmToggle.id, nextStatus);
    setConfirmToggle(null);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'Operación rechazada.' });
      return;
    }
    setFeedback({
      type: 'success',
      text:
        nextStatus === 'inactive'
          ? 'Acceso revocado. Se conserva el historial de operaciones del usuario.'
          : 'Membresía reactivada correctamente.',
    });
  };

  const handlePermissionSwitch = async (
    role: Exclude<TenantRole, 'tenant_owner'>,
    moduleId: AppModuleId,
    actionId: ModuleAction,
    nextAllowed: boolean
  ) => {
    const res = await updateRolePermission(role, moduleId, actionId, nextAllowed);
    if (!res.ok) {
      setFeedback({ type: 'error', text: res.error ?? 'No se pudo actualizar el permiso.' });
      return;
    }
    setFeedback({
      type: 'success',
      text: `Permiso ${moduleId}:${actionId} actualizado para ${ROLE_LABELS[role]}.`,
    });
  };

  return (
    <div className="space-y-8">
      {/* Encabezado Modelo B */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Modelo B · ABM de Seguridad Multi-Tenant
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Usuarios, Membresías y Permisos
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Espacio activo: <strong className="font-semibold text-slate-900 dark:text-slate-100">{activeTenant?.name}</strong>
            {' · '}
            <span className="font-mono-tabular text-xs">{tenantMemberships.length} miembros</span>
          </p>
        </div>

        {canManageUsers ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Nuevo colaborador</span>
          </button>
        ) : (
          <div className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <Lock className="h-3.5 w-3.5" />
            <span>Solo lectura para tu rol ({activeMembership ? ROLE_LABELS[activeMembership.role] : '—'})</span>
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
            aria-label="Cerrar mensaje"
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Barra de búsqueda y filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            aria-label="Buscar usuarios por nombre, correo o rol"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nombre, correo o rol..."
            className="w-full min-h-10 rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div
          role="group"
          aria-label="Filtrar por estado de membresía"
          className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900"
        >
          {(['all', 'active', 'inactive'] as const).map((st) => (
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
              {st === 'all' ? 'Todos' : st === 'active' ? 'Activos' : 'Inactivos'}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla responsive de membresías */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <th className="px-4 py-3">Usuario</th>
              <th className="px-4 py-3">Rol asignado</th>
              <th className="px-4 py-3">Alcance inmuebles</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Alta (La Paz)</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  No se encontraron miembros que coincidan con el filtro aplicado.
                </td>
              </tr>
            ) : (
              filteredMembers.map((member) => {
                const isActive = member.status === 'active';
                const isRowOwner = member.role === 'tenant_owner';

                return (
                  <tr
                    key={member.id}
                    className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {member.profile?.fullName ?? 'Usuario'}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {member.profile?.email ?? member.userId}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-800 dark:text-slate-200">
                      {ROLE_LABELS[member.role]}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                      {member.allowedPropertyIds === null
                        ? 'Todas las casas del tenant'
                        : `${member.allowedPropertyIds.length} casas asignadas`}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                          isActive
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {isActive ? (
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>{isActive ? 'Activo' : 'Inactivo'}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-xs text-slate-600 dark:text-slate-400">
                      {formatBoliviaDateTime(member.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManageUsers && !isRowOwner ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(member)}
                            aria-label={`Editar rol de ${member.profile?.fullName ?? member.userId}`}
                            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            Editar rol
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmToggle(member)}
                            aria-label={
                              isActive
                                ? `Desactivar acceso de ${member.profile?.fullName ?? member.userId}`
                                : `Reactivar acceso de ${member.profile?.fullName ?? member.userId}`
                            }
                            className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                              isActive
                                ? 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40'
                                : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/60 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                            }`}
                          >
                            {isActive ? 'Desactivar' : 'Reactivar'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          {isRowOwner ? 'Propietario protegido' : 'Sin permiso'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Matriz de permisos por rol (Capa 1 + Capa 2) */}
      <section className="space-y-4 border-t border-slate-200 pt-6 dark:border-slate-800">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
              Matriz de Permisos por Rol (DEC-13)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              El Propietario del tenant conserva acceso total. Solo el propietario puede modificar permisos por rol.
            </p>
          </div>
          {!isOwner && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Solo lectura: requiere rol Propietario del tenant</span>
            </span>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400">
                <th className="px-4 py-3 font-semibold">Módulo y acción</th>
                <th className="px-4 py-3 text-center font-semibold">Propietario</th>
                {EDITABLE_ROLES.map((role) => (
                  <th key={role} className="px-4 py-3 text-center font-semibold">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {MATRIX_ROWS.map((row) => (
                <tr key={`${row.moduleId}:${row.actionId}`}>
                  <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                    {row.label}
                  </td>
                  <td className="px-4 py-2.5 text-center text-emerald-700 dark:text-emerald-400">
                    Total
                  </td>
                  {EDITABLE_ROLES.map((role) => {
                    const allowed = isPermissionDefaultAllowed(
                      role,
                      row.moduleId,
                      row.actionId,
                      tenantPermissions
                    );
                    return (
                      <td key={role} className="px-4 py-2.5 text-center">
                        <button
                          type="button"
                          disabled={!isOwner}
                          onClick={() =>
                            handlePermissionSwitch(role, row.moduleId, row.actionId, !allowed)
                          }
                          aria-label={`${ROLE_LABELS[role]} - ${row.label}: ${allowed ? 'Permitido' : 'Denegado'}`}
                          className={`inline-flex min-h-8 min-w-16 items-center justify-center rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                            allowed
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                          } ${!isOwner ? 'cursor-not-allowed opacity-70' : 'hover:opacity-85'}`}
                        >
                          {allowed ? 'Sí' : 'No'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Bitácora de auditoría aislada al tenant activo */}
      <section className="space-y-3 border-t border-slate-200 pt-6 dark:border-slate-800">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
            Auditoría del Espacio Activo
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Registros inmutables filtrados estrictamente por tenant_id ({activeTenant?.id}).
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400">
                <th className="px-4 py-2.5 font-semibold">Fecha/Hora (La Paz)</th>
                <th className="px-4 py-2.5 font-semibold">Actor</th>
                <th className="px-4 py-2.5 font-semibold">Evento</th>
                <th className="px-4 py-2.5 font-semibold">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {tenantAuditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-2.5 font-mono-tabular text-slate-600 dark:text-slate-400">
                    {formatBoliviaDateTime(log.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                    {log.actorName}
                  </td>
                  <td className="px-4 py-2.5 font-mono-tabular text-slate-700 dark:text-slate-300">
                    {log.action}
                  </td>
                  <td className="px-4 py-2.5 font-mono-tabular text-slate-600 dark:text-slate-400">
                    {JSON.stringify(log.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal Alta/Edición de colaborador */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="member-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2
                  id="member-modal-title"
                  className="text-base font-semibold text-slate-900 dark:text-slate-100"
                >
                  {editingMember ? 'Editar rol de colaborador' : 'Agregar colaborador al espacio'}
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  El acceso aplica únicamente a {activeTenant?.name}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Cerrar modal de colaborador"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMember} className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="member-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  {isSupabaseLive ? 'Nombre completo (opcional si ya tiene cuenta)' : 'Nombre completo'}
                </label>
                <input
                  id="member-name"
                  type="text"
                  disabled={Boolean(editingMember)}
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder="Ej. Carla Suárez"
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="member-email"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Correo electrónico
                </label>
                <input
                  id="member-email"
                  type="email"
                  disabled={Boolean(editingMember)}
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  placeholder="colaborador@luchorentas.bo"
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="member-role"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Rol en el tenant
                </label>
                <select
                  id="member-role"
                  value={memberRole}
                  onChange={(e) => setMemberRole(e.target.value as TenantRole)}
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {ROLE_DESCRIPTIONS[memberRole]}
                </p>
              </div>

              {modalError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
                >
                  {modalError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  <span>Guardar</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmación Segura de Baja / Reactivación */}
      {confirmToggle && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-status-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <h2
              id="confirm-status-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {confirmToggle.status === 'active'
                ? 'Confirmar revocación de acceso'
                : 'Confirmar reactivación de acceso'}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {confirmToggle.status === 'active'
                ? `Al desactivar a ${confirmToggle.profile?.fullName}, perderá acceso inmediato al espacio ${activeTenant?.name}, pero se conservará todo su historial de cobros, gastos y auditoría.`
                : `Se restituirá el acceso de ${confirmToggle.profile?.fullName} al espacio ${activeTenant?.name} con el rol ${ROLE_LABELS[confirmToggle.role]}.`}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmToggle(null)}
                className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmStatusToggle}
                className={`min-h-10 rounded-lg px-4 py-2 text-xs font-semibold text-white ${
                  confirmToggle.status === 'active'
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {confirmToggle.status === 'active' ? 'Desactivar acceso' : 'Reactivar acceso'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
