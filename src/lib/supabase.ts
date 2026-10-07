import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
// Solo la clave pública (publishable/anon). La service_role nunca va en el
// frontend: todo lo que viaja al navegador es visible para cualquiera.
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY. Revisa .env.local (ver .env.example).',
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey)
