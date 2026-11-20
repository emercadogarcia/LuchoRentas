/**
 * Archivo: src/lib/supabase.ts
 * Responsabilidad: Inicialización del cliente oficial de Supabase usando variables
 *   públicas VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
 * Cumplimiento LuchoRentas.md: §11 (Arquitectura React + Vite + Supabase Auth/PostgreSQL).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('http') &&
    !supabaseUrl.includes('tu-proyecto.supabase.co')
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
