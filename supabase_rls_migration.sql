-- Fase 5 de la migración a Supabase Auth real (ver el plan de la sesión).
-- Reemplaza las 7 políticas "public all X" (using(true) with check(true))
-- por políticas reales basadas en auth.uid()/is_admin().
--
-- IMPORTANTE: si algo se rompe después de correr esto, hay un bloque de
-- ROLLBACK completo al final de este mismo archivo -- se puede pegar y
-- correr en segundos para volver exactamente a como estaba, sin redeploy.

drop policy if exists "public all products" on products;
drop policy if exists "public all conteos" on conteos;
drop policy if exists "public all config" on config;
drop policy if exists "public all sync_requests" on sync_requests;
drop policy if exists "public all trabajadores" on trabajadores;
drop policy if exists "public all conteo_log" on conteo_log;
drop policy if exists "public all reportes_inventario" on reportes_inventario;

-- products: cualquiera logueado ve el catálogo; solo el admin sube/edita/
-- borra (carga de Excel, sincronización con el POS, vaciar productos).
create policy "products: leer si esta logueado" on products
  for select using (auth.uid() is not null);
create policy "products: solo admin inserta" on products
  for insert with check (is_admin());
create policy "products: solo admin actualiza" on products
  for update using (is_admin());
create policy "products: solo admin borra" on products
  for delete using (is_admin());

-- config: cualquiera logueado ve el filtro/ronda actual; solo el admin
-- publica un filtro nuevo.
create policy "config: leer si esta logueado" on config
  for select using (auth.uid() is not null);
create policy "config: solo admin actualiza" on config
  for update using (is_admin());

-- conteos: colaborativo -- cualquier trabajador logueado puede ver y
-- actualizar el conteo de cualquier producto (así funciona hoy, varios
-- trabajadores contando la misma ronda a la vez).
create policy "conteos: logueados leen y escriben" on conteos
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- conteo_log: lectura colaborativa igual que conteos, pero el insert
-- queda atado a la identidad real -- nadie puede insertar un registro
-- como si fuera otro trabajador (worker_id lo llena el trigger de la
-- Fase 1 con auth.uid(), este check solo confirma que no lo pisaron).
create policy "conteo_log: logueados leen" on conteo_log
  for select using (auth.uid() is not null);
create policy "conteo_log: logueados insertan como si mismos" on conteo_log
  for insert with check (worker_id = auth.uid());
create policy "conteo_log: logueados borran" on conteo_log
  for delete using (auth.uid() is not null);

-- reportes_inventario: cualquier trabajador logueado puede finalizar la
-- ronda (decisión explícita: se mantiene igual que hoy, no pasa a
-- admin-only), pero el reporte queda atado a quien realmente lo cerró.
create policy "reportes_inventario: logueados leen" on reportes_inventario
  for select using (auth.uid() is not null);
create policy "reportes_inventario: logueados insertan como si mismos" on reportes_inventario
  for insert with check (worker_id = auth.uid());

-- sync_requests: cualquiera logueado ve el estado de la última
-- sincronización; solo el admin puede pedir una nueva.
create policy "sync_requests: logueados leen" on sync_requests
  for select using (auth.uid() is not null);
create policy "sync_requests: solo admin pide sync" on sync_requests
  for insert with check (is_admin());
create policy "sync_requests: solo admin actualiza" on sync_requests
  for update using (is_admin());

-- trabajadores: tabla vieja, ya no se usa para login (queda como
-- auditoría). RLS habilitada y sin ninguna política = cerrada por
-- completo para anon/authenticated; service_role la sigue viendo igual.

-- ============================================================
-- ROLLBACK -- pegar y correr esto completo si algo se rompe, para volver
-- exactamente a como estaba antes de la Fase 5 (segundos, sin redeploy).
-- ============================================================
--
-- drop policy if exists "products: leer si esta logueado" on products;
-- drop policy if exists "products: solo admin inserta" on products;
-- drop policy if exists "products: solo admin actualiza" on products;
-- drop policy if exists "products: solo admin borra" on products;
-- create policy "public all products" on products for all using (true) with check (true);
--
-- drop policy if exists "config: leer si esta logueado" on config;
-- drop policy if exists "config: solo admin actualiza" on config;
-- create policy "public all config" on config for all using (true) with check (true);
--
-- drop policy if exists "conteos: logueados leen y escriben" on conteos;
-- create policy "public all conteos" on conteos for all using (true) with check (true);
--
-- drop policy if exists "conteo_log: logueados leen" on conteo_log;
-- drop policy if exists "conteo_log: logueados insertan como si mismos" on conteo_log;
-- drop policy if exists "conteo_log: logueados borran" on conteo_log;
-- create policy "public all conteo_log" on conteo_log for all using (true) with check (true);
--
-- drop policy if exists "reportes_inventario: logueados leen" on reportes_inventario;
-- drop policy if exists "reportes_inventario: logueados insertan como si mismos" on reportes_inventario;
-- create policy "public all reportes_inventario" on reportes_inventario for all using (true) with check (true);
--
-- drop policy if exists "sync_requests: logueados leen" on sync_requests;
-- drop policy if exists "sync_requests: solo admin pide sync" on sync_requests;
-- drop policy if exists "sync_requests: solo admin actualiza" on sync_requests;
-- create policy "public all sync_requests" on sync_requests for all using (true) with check (true);
--
-- create policy "public all trabajadores" on trabajadores for all using (true) with check (true);
