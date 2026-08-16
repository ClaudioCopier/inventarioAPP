// Email sintético fijo de la cuenta de administrador (Supabase Auth, misma
// tabla que los trabajadores). Antes duplicado en varios archivos --
// centralizado acá (2026-08-16) porque supabaseClient.js también lo
// necesita para decidir cómo guardar la sesión (ver ese archivo).
export const ADMIN_EMAIL = 'admin@inventario.local'
