/**
 * Archivo: src/components/AppShell.tsx
 * Responsabilidad: Marco principal responsive de la aplicación (barra lateral con control
 *   de acceso Capa 2, barra superior con selector de tenant y tema Claro/Oscuro, y área
 *   de contenido principal con manejo explícito de acceso denegado).
 * Cumplimiento LuchoRentas.md: §9.1 (navegación lateral compacta y responsive),
 *   §5.1 (ocultar/bloquear rutas no autorizadas en frontend) y RF-005 (cambio de tenant).
 */
import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  ClipboardList,
  CreditCard,
  FileText,
  Home,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Receipt,
  RefreshCw,
  Shield,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { MODULE_CATALOG } from '../lib/rbac';
import { AccessControlPage } from '../pages/AccessControlPage';
import { CashPage } from '../pages/CashPage';
import { CollectionsPage } from '../pages/CollectionsPage';
import { ContractsPage } from '../pages/ContractsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ExpensesPage } from '../pages/ExpensesPage';
import { PeoplePage } from '../pages/PeoplePage';
import { Phase1OverviewPage } from '../pages/Phase1OverviewPage';
import { PropertiesPage } from '../pages/PropertiesPage';
import { ReceivablesPage } from '../pages/ReceivablesPage';
import { ReportsPage } from '../pages/ReportsPage';
import { ROLE_LABELS, type AppModuleId } from '../types/domain';
import { TenantSwitcher } from './TenantSwitcher';
import { ThemeToggle } from './ThemeToggle';

type ActiveRoute = 'overview' | AppModuleId;

const MODULE_ICONS: Record<AppModuleId, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  properties: Home,
  people: Users,
  contracts: FileText,
  receivables: ClipboardList,
  collections: Receipt,
  expenses: CreditCard,
  cash: Wallet,
  reports: FileText,
  users_permissions: Shield,
};

export function AppShell() {
  const {
    currentUser,
    myTenants,
    activeTenant,
    activeMembership,
    signOut,
    canView,
    createTenant,
    refreshMemberships,
  } = useAuth();
  const [activeRoute, setActiveRoute] = useState<ActiveRoute>(() =>
    canView('dashboard') ? 'dashboard' : 'overview'
  );
  const userSelectedRouteRef = useRef(false);
  const [pendingChargeForCollection, setPendingChargeForCollection] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [firstTenantName, setFirstTenantName] = useState('');
  const [firstTenantCurrency, setFirstTenantCurrency] = useState<'BOB' | 'USD'>('BOB');
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [creatingFirst, setCreatingFirst] = useState(false);
  const [refreshingTenants, setRefreshingTenants] = useState(false);

  useEffect(() => {
    if (!activeMembership) return;
    if (!userSelectedRouteRef.current) {
      if (canView('dashboard')) {
        setActiveRoute('dashboard');
      } else if (canView('properties')) {
        setActiveRoute('properties');
      }
      return;
    }
    if (activeRoute !== 'overview' && !canView(activeRoute)) {
      setActiveRoute(canView('dashboard') ? 'dashboard' : 'overview');
    }
  }, [activeMembership, activeTenant?.id, activeRoute, canView]);

  const visibleModules = MODULE_CATALOG.filter((m) => canView(m.id));
  const selectedModuleMeta =
    activeRoute === 'overview' ? null : MODULE_CATALOG.find((m) => m.id === activeRoute) ?? null;

  const isRouteDenied =
    activeRoute !== 'overview' && !canView(activeRoute);

  const navigateTo = (route: ActiveRoute) => {
    userSelectedRouteRef.current = true;
    setActiveRoute(route);
    setMobileMenuOpen(false);
  };

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col justify-between">
      <div className="space-y-6">
        <div className="flex items-center justify-between px-3 pt-1">
          <div className="flex items-center gap-2.5">
            <Building2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50">
              LuchoRentas
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Cerrar menú lateral"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav aria-label="Navegación principal" className="space-y-1">
          <button
            type="button"
            onClick={() => navigateTo('overview')}
            className={`flex w-full min-h-10 items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors ${
              activeRoute === 'overview'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Shield className="h-4 w-4 shrink-0" />
              <span>Estado y Seguridad</span>
            </span>
            <span className="text-[10px] opacity-80">Sistema</span>
          </button>

          <div className="pt-3 pb-1 px-3 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Módulos autorizados para tu rol
          </div>

          {visibleModules.map((mod) => {
            const Icon = MODULE_ICONS[mod.id];
            const isSelected = activeRoute === mod.id;
            const isReady = mod.phase <= 6;
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => navigateTo(mod.id)}
                className={`flex w-full min-h-10 items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                  isSelected
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{mod.label}</span>
                </span>
                <span
                  className={`text-[10px] font-mono-tabular shrink-0 ${
                    isSelected
                      ? 'text-white/90'
                      : isReady
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {isReady ? 'Activo' : `F${mod.phase}`}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Pie de barra lateral con perfil y cierre de sesión */}
      <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
        <div className="px-3">
          <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
            {currentUser?.fullName}
          </div>
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {activeMembership ? ROLE_LABELS[activeMembership.role] : 'Sin rol'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-3 flex w-full min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <LogOut className="h-4 w-4" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex">
      {/* Sidebar escritorio */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-4 lg:block dark:border-slate-800 dark:bg-slate-900">
        {renderSidebarContent()}
      </aside>

      {/* Drawer móvil */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Contenido principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 py-3 backdrop-blur-xs sm:gap-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex items-center gap-3 min-w-0 shrink-0 sm:shrink">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menú de navegación"
              className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 lg:hidden dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="hidden truncate text-xs text-slate-500 sm:block dark:text-slate-400">
              <span>LuchoRentas</span>
              <span className="mx-1.5" aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {activeRoute === 'overview'
                  ? 'Estado y Seguridad'
                  : selectedModuleMeta?.label ?? 'Módulo'}
              </span>
            </div>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2 shrink-0">
            <TenantSwitcher />
            <ThemeToggle compact />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {myTenants.length === 0 ? (
            <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Configuración inicial · Bolivia (America/La_Paz)
              </p>
              <h1 className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-slate-50">
                Crea tu primer espacio de trabajo
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Aún no tienes un espacio (tenant) asignado para{' '}
                <strong className="font-semibold text-slate-900 dark:text-slate-100">
                  {currentUser?.email}
                </strong>
                . Si ya te otorgaron acceso en Supabase, verifica espacios asignados o crea un nuevo
                espacio donde quedarás como Propietario del tenant con acceso total.
              </p>
              <div className="mt-3">
                <button
                  type="button"
                  disabled={refreshingTenants}
                  onClick={async () => {
                    setRefreshingTenants(true);
                    await refreshMemberships();
                    setRefreshingTenants(false);
                  }}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshingTenants ? 'animate-spin' : ''}`} />
                  <span>{refreshingTenants ? 'Verificando...' : 'Verificar espacios asignados'}</span>
                </button>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setOnboardingError(null);
                  setCreatingFirst(true);
                  const res = await createTenant(firstTenantName, firstTenantCurrency);
                  setCreatingFirst(false);
                  if (!res.ok) {
                    setOnboardingError(res.error ?? 'No se pudo crear el espacio.');
                  }
                }}
                className="mt-5 space-y-4"
              >
                <div>
                  <label
                    htmlFor="first-tenant-name"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Nombre de tu administración o negocio
                  </label>
                  <input
                    id="first-tenant-name"
                    type="text"
                    value={firstTenantName}
                    onChange={(e) => setFirstTenantName(e.target.value)}
                    placeholder="Ej. Administración Central"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="first-tenant-currency"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Moneda predeterminada
                  </label>
                  <select
                    id="first-tenant-currency"
                    value={firstTenantCurrency}
                    onChange={(e) => setFirstTenantCurrency(e.target.value as 'BOB' | 'USD')}
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="BOB">BOB — Bolivianos (Bs)</option>
                    <option value="USD">USD — Dólares ($us)</option>
                  </select>
                </div>
                {onboardingError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
                  >
                    {onboardingError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={creatingFirst}
                  className="w-full min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {creatingFirst ? 'Creando espacio...' : 'Crear espacio y comenzar'}
                </button>
              </form>
            </div>
          ) : isRouteDenied ? (
            <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-center dark:border-red-900/60 dark:bg-red-950/30">
              <Lock className="mx-auto h-6 w-6 text-red-700 dark:text-red-400" />
              <h1 className="mt-3 font-display text-lg font-semibold text-red-900 dark:text-red-200">
                Acceso denegado (Capa 2 Frontend + Capa 1 RLS)
              </h1>
              <p className="mt-1 text-xs text-red-800 dark:text-red-300">
                Tu rol actual no tiene permiso para consultar este módulo en el espacio activo.
              </p>
              <button
                type="button"
                onClick={() => setActiveRoute('overview')}
                className="mt-4 min-h-10 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
              >
                Volver al inicio autorizado
              </button>
            </div>
          ) : activeRoute === 'overview' ? (
            <Phase1OverviewPage
              onNavigate={(route) => navigateTo(route)}
            />
          ) : activeRoute === 'dashboard' ? (
            <DashboardPage
              onNavigate={(route) => navigateTo(route)}
            />
          ) : activeRoute === 'users_permissions' ? (
            <AccessControlPage />
          ) : activeRoute === 'properties' ? (
            <PropertiesPage />
          ) : activeRoute === 'people' ? (
            <PeoplePage />
          ) : activeRoute === 'contracts' ? (
            <ContractsPage />
          ) : activeRoute === 'receivables' ? (
            <ReceivablesPage
              onCollectCharge={(chargeId) => {
                setPendingChargeForCollection(chargeId);
                navigateTo('collections');
              }}
            />
          ) : activeRoute === 'collections' ? (
            <CollectionsPage
              initialChargeId={pendingChargeForCollection}
              onConsumeInitialCharge={() => setPendingChargeForCollection(null)}
            />
          ) : activeRoute === 'expenses' ? (
            <ExpensesPage />
          ) : activeRoute === 'cash' ? (
            <CashPage />
          ) : activeRoute === 'reports' ? (
            <ReportsPage />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {selectedModuleMeta?.archetype} · Fase {selectedModuleMeta?.phase}
              </p>
              <h1 className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-slate-50">
                {selectedModuleMeta?.label}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
                {selectedModuleMeta?.description}
              </p>
              <button
                type="button"
                onClick={() => navigateTo('overview')}
                className="mt-5 min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Volver al Estado del Sistema
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
