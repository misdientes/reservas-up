# Sesión 1 — Base del proyecto

## Antes de empezar (requisitos, ~20 min)

- [ ] Cuenta en **GitHub**
- [ ] Cuenta en **Supabase** → crear el proyecto `reservas-up`, región **São Paulo** (la más cercana a Chile). Guarda la contraseña de la base en un lugar seguro.
- [ ] Cuenta en **Cloudflare**
- [ ] **Node.js** (versión LTS) y **Git** instalados
- [ ] **Supabase CLI** instalado
- [ ] Una carpeta vacía `reservas-up` con `CLAUDE.md` copiado dentro
- [ ] El dominio es opcional en esta sesión: usaremos la dirección `*.pages.dev` de Cloudflare

## Prompt para pegar en Claude Code

> Lee CLAUDE.md completo. Esta es la **Sesión 1: Base del proyecto**.
>
> Objetivo: dejar el esqueleto del proyecto funcionando de punta a punta: local → GitHub → Cloudflare Pages → Supabase.
>
> Tareas:
> 1. Inicializa un proyecto React + Vite + TypeScript con Tailwind CSS y React Router, con la estructura de carpetas de CLAUDE.md.
> 2. Crea las rutas vacías: `/` (inicio), `/propiedades/:slug` (detalle), `/admin` (panel). Agrega una plantilla base con encabezado y pie de página simples.
> 3. Crea `src/lib/i18n` con los textos de la interfaz centralizados (solo español por ahora).
> 4. Inicializa Supabase CLI en el proyecto y enlázalo con mi proyecto remoto `reservas-up`. Crea la **primera migración** con una tabla `app_settings` (clave, valor) con Row Level Security activado y una política de lectura pública solo para claves marcadas como públicas. Inserta la fila `site_name = "Reservas UP"`.
> 5. Configura el cliente de Supabase en el frontend usando variables de entorno (`.env.local`, que **no** se sube a GitHub; crea `.env.example` con los nombres de las variables sin valores).
> 6. Haz que la página de inicio lea y muestre `site_name` desde la base de datos.
> 7. Crea `BITACORA.md` y `README.md` con instrucciones para correr el proyecto en local.
> 8. Inicializa git, haz el primer commit y guíame paso a paso para crear el repositorio en GitHub y conectarlo a Cloudflare Pages (incluidas las variables de entorno en Cloudflare).
>
> Restricciones: no instales librerías fuera del stack de CLAUDE.md sin preguntarme. No uses la llave service role en el frontend.
>
> Al terminar, verifica el criterio de aceptación y agrega una línea a BITACORA.md.

## Criterio de aceptación

- [ ] `npm run dev` funciona en local y la página de inicio muestra **"Reservas UP"** leído desde Supabase
- [ ] El sitio está publicado en `https://<tu-proyecto>.pages.dev` y muestra lo mismo
- [ ] Las 3 rutas cargan sin errores
- [ ] `.env.local` **no** aparece en GitHub
- [ ] Existe la migración en `supabase/migrations` y la tabla tiene RLS activado
- [ ] BITACORA.md tiene su primera línea

## Al terminar

Vuelve a este chat con: ✅ o ❌ por cada criterio, y cualquier error que haya aparecido. Con eso preparo la **Sesión 2 (modelo de datos)**, que es la más crítica: ahí se construye la protección anti-doble-reserva.
