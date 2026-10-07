// ¿Usar datos de ejemplo? Solo en desarrollo con VITE_USE_FIXTURES=true, o en
// el build local "npm run build:fixtures" (modo 'fixtures', para Lighthouse).
// En el build de producción (modo 'production', DEV=false) esta constante es
// false en tiempo de compilación y todo el código de ejemplo se elimina.
export const USE_FIXTURES =
  import.meta.env.MODE === 'fixtures' || (import.meta.env.DEV && import.meta.env.VITE_USE_FIXTURES === 'true')
