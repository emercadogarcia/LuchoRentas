/**
 * Archivo: src/components/ThemeToggle.tsx
 * Responsabilidad: Botón accesible para alternar entre Modo Oscuro (por defecto) y
 *   Modo Claro con persistencia automática en localStorage.
 * Cumplimiento LuchoRentas.md: Requerimiento UX/UI de selector Claro/Oscuro accesible
 *   en toda la interfaz, manteniendo alto contraste en ambos temas.
 */
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
    >
      {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-700" />}
      {!compact && <span>{isDark ? 'Modo claro' : 'Modo oscuro'}</span>}
    </button>
  );
}
