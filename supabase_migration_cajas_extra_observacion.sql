-- Fase (2026-08-10) -- 3 pedidos del usuario para WorkerPage:
-- 1) Productos guardados en más de 1 caja: casillas extra por producto.
-- 2) Observaciones por producto (descuadres), visibles en el reporte final.
-- Correr en Supabase -> SQL Editor.

alter table conteos add column if not exists cajas_extra jsonb not null default '[]'::jsonb;
alter table conteos add column if not exists observacion text not null default '';

-- conteo_log es solo auditoría ("quién tocó qué"), pero se guardan también
-- estos dos campos para no perder el detalle si hace falta revisar después.
alter table conteo_log add column if not exists cajas_extra jsonb;
alter table conteo_log add column if not exists observacion text;

-- Bug real encontrado de paso (2026-08-10): reportes_inventario nunca tuvo
-- una política de DELETE en la migración RLS de la Fase 5
-- (supabase_rls_migration.sql) -- el botón "Eliminar" de ReporteCard.jsx
-- (agregado antes de esa migración) quedó rompiéndose en silencio para
-- TODOS, admin incluido: sin política, el DELETE no borra ninguna fila pero
-- tampoco tira error, así que la app mostraba "eliminado" sin haber borrado
-- nada de verdad. Arreglado: solo admin borra, igual que products.
drop policy if exists "reportes_inventario: solo admin borra" on reportes_inventario;
create policy "reportes_inventario: solo admin borra" on reportes_inventario
  for delete using (is_admin());
