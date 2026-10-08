/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  // Solo desarrollo: 'true' usa propiedades de ejemplo (ver src/lib/site-data.tsx).
  readonly VITE_USE_FIXTURES?: string
  // Clave PÚBLICA del widget de Cloudflare Turnstile (la secreta vive solo en Supabase).
  readonly VITE_TURNSTILE_SITE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
