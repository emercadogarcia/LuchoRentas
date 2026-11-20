/**
 * Archivo: src/pages/AuthPage.tsx
 * Responsabilidad: Pantalla de autenticación (Inicio de sesión y Registro de usuario)
 *   con validación estricta de campos, selector de tema claro/oscuro y cuentas de
 *   demostración por rol cuando Supabase no está configurado en entorno local.
 * Cumplimiento LuchoRentas.md: RF-001 (CA-001 usuario no autenticado no accede a datos
 *   privados), RF-002 (registro con creación automática de tenant inicial).
 */
import React, { useState } from 'react';
import { Building2, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';
import { useAuth } from '../lib/auth';
import { DEMO_ACCOUNT_PRESETS } from '../lib/seedData';

export function AuthPage() {
  const { signIn, signUp, isSupabaseLive } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setSubmitting(true);

    const res =
      mode === 'login'
        ? await signIn(email, password)
        : await signUp(fullName, email, password);

    setSubmitting(false);
    if (!res.ok) {
      setErrorMsg(res.error ?? 'Error al autenticar.');
    } else if (res.error) {
      setInfoMsg(res.error);
    }
  };

  const applyPreset = (presetEmail: string, presetPassword: string) => {
    setMode('login');
    setEmail(presetEmail);
    setPassword(presetPassword);
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col">
      <header className="flex items-center justify-between gap-8 border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <Building2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <span className="font-display text-lg font-bold tracking-tight">LuchoRentas</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-10 sm:px-6">
        <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
          {/* Columna izquierda: Propuesta operativa Fase 1 */}
          <section className="lg:col-span-6 space-y-6 py-2">
            <div>
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Bolivia · America/La_Paz · BOB / USD
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl text-balance">
                Control simple y seguro de rentas de casas y cuartos
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Espacios privados multi-tenant con aislamiento estricto por PostgreSQL RLS,
                permisos granulares por rol y trazabilidad financiera sin mezclar monedas.
              </p>
            </div>

            <div className="space-y-4 border-t border-slate-200 pt-5 dark:border-slate-800">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Aislamiento Multi-Tenant (RLS)
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Cada administrador opera sobre su propio tenant_id; ningún espacio puede leer ni
                    modificar registros ajenos.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Control de Acceso en Doble Capa
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Validación en backend/RLS y bloqueo explícito en interfaz para Propietario,
                    Administrador, Cobrador, Operador financiero y Consulta.
                  </p>
                </div>
              </div>
            </div>

            {!isSupabaseLive && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2.5 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Cuentas de prueba por rol (Vista previa local)
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Clic para cargar credenciales
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {DEMO_ACCOUNT_PRESETS.map((preset) => (
                    <button
                      key={preset.userId}
                      type="button"
                      onClick={() => applyPreset(preset.email, preset.password)}
                      className="flex flex-col items-start rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:border-emerald-500/60 hover:bg-emerald-50/40 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-emerald-500/50 dark:hover:bg-slate-800/70"
                    >
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {preset.label}
                      </span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        {preset.roleSummary}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Columna derecha: Formulario de acceso */}
          <section className="lg:col-span-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
              <div
                role="tablist"
                aria-label="Modo de autenticación"
                className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-950"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  onClick={() => {
                    setMode('login');
                    setErrorMsg(null);
                  }}
                  className={`min-h-10 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                    mode === 'login'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Iniciar sesión
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'register'}
                  onClick={() => {
                    setMode('register');
                    setErrorMsg(null);
                  }}
                  className={`min-h-10 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                    mode === 'register'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Crear cuenta
                </button>
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
                {mode === 'register' && (
                  <div>
                    <label
                      htmlFor="auth-fullname"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Nombre completo
                    </label>
                    <input
                      id="auth-fullname"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ej. Edgar Mercado"
                      className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="auth-email"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Correo electrónico
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="usuario@luchorentas.bo"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="auth-password"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Contraseña
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1.5 w-full min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>

                {errorMsg && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
                  >
                    {errorMsg}
                  </div>
                )}

                {infoMsg && (
                  <div
                    role="status"
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    {infoMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:opacity-50"
                >
                  <KeyRound className="h-4 w-4" />
                  <span>
                    {submitting
                      ? 'Procesando...'
                      : mode === 'login'
                        ? 'Ingresar al espacio'
                        : 'Crear cuenta y espacio'}
                  </span>
                </button>
              </form>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
