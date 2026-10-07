# Reservas UP

Sitio de reservas directas con pago inmediato (Inmobiliaria UP). Contexto completo del proyecto en [CLAUDE.md](CLAUDE.md).

Stack: React + Vite + TypeScript + Tailwind CSS + React Router · Supabase · Cloudflare Pages.

## Requisitos

- Node.js 24 LTS (incluye npm)
- Git
- Supabase CLI: ya viene como dependencia de desarrollo; se usa con `npx supabase ...`

## Correr en local

1. Instala las dependencias:
   ```
   npm install
   ```
2. Copia `.env.example` como `.env.local` y completa los valores (Supabase → Project Settings → API Keys):
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
   Usa solo la clave **publishable/anon**. `.env.local` no se sube a GitHub.
3. Levanta el servidor de desarrollo:
   ```
   npm run dev
   ```
   Abre http://localhost:5173

Otros comandos: `npm run build` (compila a `dist/`), `npm run preview` (sirve el build), `npm run lint`.

## Base de datos (Supabase)

El esquema se maneja **solo** con migraciones en `supabase/migrations`. Nunca cambies el esquema a mano en el dashboard.

```
npx supabase login                          # una vez por equipo
npx supabase link --project-ref <ref>       # una vez por clon (pide la contraseña de la base)
npx supabase migration new <nombre>         # crea una migración vacía
npx supabase db push --dry-run              # muestra qué se aplicará
npx supabase db push                        # aplica las migraciones pendientes
npx supabase migration list                 # estado local vs remoto
```

Cada tabla nueva lleva RLS, `GRANT` explícitos y políticas (ver CLAUDE.md §3).

## Despliegue

Cloudflare Pages se despliega automáticamente con cada push a `main`.

- Build command: `npm run build` · Output: `dist`
- Variables de entorno: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `NODE_VERSION=24`
- No hay `404.html`, así que Pages trata el sitio como SPA y sirve `index.html` en todas las rutas (no usar `_redirects` con `/* /index.html 200`: Cloudflare lo rechaza como bucle).

## Estructura

```
src/components   UI reutilizable (Layout)
src/pages        rutas públicas
src/admin        panel
src/lib          cliente Supabase, i18n (textos)
src/types        tipos TypeScript
supabase/        configuración y migraciones
```
