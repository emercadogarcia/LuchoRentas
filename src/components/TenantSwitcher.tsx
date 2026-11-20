/**
 * Archivo: src/components/TenantSwitcher.tsx
 * Responsabilidad: Selector del tenant activo (espacio de trabajo multi-tenant) y
 *   modal transaccional para crear un nuevo tenant (create_tenant).
 * Cumplimiento LuchoRentas.md: RF-002 (crear tenant y quedar como propietario) y
 *   RF-005 (cambiar tenant activo sin mezclar datos, moneda BOB/USD, America/La_Paz).
 */
import React, { useState } from 'react';
import { Building2, Plus, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { CurrencyCode } from '../types/domain';

export function TenantSwitcher() {
  const { myTenants, activeTenant, switchTenant, createTenant } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tenantName, setTenantName] = useState('');
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>('BOB');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    const res = await createTenant(tenantName, defaultCurrency);
    setIsSubmitting(false);

    if (!res.ok) {
      setFormError(res.error ?? 'No se pudo crear el espacio de trabajo.');
      return;
    }

    setTenantName('');
    setDefaultCurrency('BOB');
    setIsModalOpen(false);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="relative flex items-center">
          <Building2
            aria-hidden="true"
            className="pointer-events-none absolute left-3 h-4 w-4 text-slate-500 dark:text-slate-400"
          />
          <select
            aria-label="Seleccionar espacio de trabajo activo"
            value={activeTenant?.id ?? ''}
            onChange={(e) => switchTenant(e.target.value)}
            className="min-h-10 max-w-[170px] truncate rounded-lg border border-slate-300 bg-white pl-9 pr-7 py-2 text-xs font-medium text-slate-900 transition-colors hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 sm:max-w-none sm:pr-8 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600"
          >
            {myTenants.length === 0 && <option value="">Sin espacio asignado</option>}
            {myTenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name} ({tenant.defaultCurrency})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setIsModalOpen(true);
          }}
          aria-label="Crear nuevo espacio de trabajo"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Nuevo espacio</span>
        </button>
      </div>

      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-tenant-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h2
                  id="create-tenant-title"
                  className="text-base font-semibold text-slate-900 dark:text-slate-100"
                >
                  Crear nuevo espacio (Tenant)
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  Quedarás registrado como Propietario principal con aislamiento total de datos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Cerrar modal de nuevo espacio"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="new-tenant-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Nombre del negocio o administración
                </label>
                <input
                  id="new-tenant-name"
                  type="text"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  placeholder="Ej. Condominio Los Tajibos"
                  className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="new-tenant-currency"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Moneda predeterminada
                  </label>
                  <select
                    id="new-tenant-currency"
                    value={defaultCurrency}
                    onChange={(e) => setDefaultCurrency(e.target.value as CurrencyCode)}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="BOB">BOB — Bolivianos (Bs)</option>
                    <option value="USD">USD — Dólares ($us)</option>
                  </select>
                </div>

                <div>
                  <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Zona horaria fija
                  </span>
                  <div className="mt-1.5 flex min-h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-mono-tabular text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    America/La_Paz
                  </div>
                </div>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
                >
                  {formError}
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
                  disabled={isSubmitting}
                  className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isSubmitting ? 'Creando...' : 'Crear espacio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
