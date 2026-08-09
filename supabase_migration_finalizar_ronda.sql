-- Bug real encontrado en producción (2026-08-09): "config: solo admin
-- actualiza" (ver supabase_rls_migration.sql) bloquea en silencio el UPDATE
-- que WorkerPage.jsx::finalizarInventario() hace sobre `config` cuando lo
-- aprieta un trabajador normal (no admin) -- que es el caso de uso
-- principal: los trabajadores terminan sus propios inventarios, los
-- administradores revisan después. Postgres RLS no tira error al bloquear
-- filas por policy, simplemente no las actualiza -- por eso pasaba
-- desapercibido: el reporte final se guardaba bien (reportes_inventario no
-- tiene esta restricción) y los conteos se borraban bien (conteos es
-- colaborativo), pero config.activo se quedaba en `true` y `ronda`/
-- `filtro_prefijo` nunca se limpiaban -- quedaba pareciendo que la ronda
-- seguía "medio activa" para el próximo que abriera el panel admin.
--
-- Arreglo: una función con SECURITY DEFINER (mismo patrón que is_admin(),
-- ver supabase_schema_auth.sql) que hace ESA acción puntual y nada más --
-- cualquier usuario logueado puede llamarla, pero solo puede apagar la
-- ronda actual y limpiar su nombre/filtro, no puede publicar una ronda
-- nueva ni tocar cualquier otra cosa de `config` (eso sigue siendo
-- exclusivo de is_admin() vía la policy de UPDATE normal).
create or replace function public.finalizar_ronda()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update config set activo = false, ronda = '', filtro_prefijo = '' where id = 1;
end;
$$;

grant execute on function public.finalizar_ronda() to authenticated;
