/**
 * Archivo: src/App.tsx
 * Responsabilidad: Raíz de la aplicación LuchoRentas que integra ThemeProvider,
 *   AuthProvider y el enrutamiento condicional entre AuthPage y AppShell.
 * Cumplimiento LuchoRentas.md: CA-001 (bloqueo de vistas privadas sin sesión activa)
 *   y persistencia del tema Oscuro por defecto.
 */
import { AppShell } from './components/AppShell';
import { AuthProvider, useAuth } from './lib/auth';
import { Phase2Provider } from './lib/phase2Store';
import { Phase3Provider } from './lib/phase3Store';
import { Phase4Provider } from './lib/phase4Store';
import { Phase5Provider } from './lib/phase5Store';
import { Phase6Provider } from './lib/phase6Store';
import { ThemeProvider } from './lib/theme';
import { AuthPage } from './pages/AuthPage';

function RootRouter() {
  const { currentUser, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-400">
        Verificando sesión y permisos del espacio...
      </div>
    );
  }

  return currentUser ? <AppShell /> : <AuthPage />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Phase2Provider>
          <Phase3Provider>
            <Phase4Provider>
              <Phase5Provider>
                <Phase6Provider>
                  <RootRouter />
                </Phase6Provider>
              </Phase5Provider>
            </Phase4Provider>
          </Phase3Provider>
        </Phase2Provider>
      </AuthProvider>
    </ThemeProvider>
  );
}
