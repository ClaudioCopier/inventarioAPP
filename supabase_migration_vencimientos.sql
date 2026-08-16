-- Vencimientos (2026-08-15) -- puramente aditivo, ver el esquema aprobado
-- (diagrama "Arquitectura de Vencimientos"). Cero ALTER sobre products,
-- conteos, conteo_log o reportes_inventario. Correr en Supabase -> SQL
-- Editor, o vía la Management API (agente-servidor/lib/supabaseSql.js).

-- Por lote, no por producto -- un mismo código puede tener varios lotes
-- activos a la vez (llegó stock nuevo antes de agotar el viejo).
create table if not exists lotes_vencimiento (
  id bigint generated always as identity primary key,
  codigo text not null,
  descripcion text not null,
  numero_lote int not null,

  cantidad_inicial numeric not null default 0,
  cantidad_restante numeric not null default 0,
  estado text not null default 'activo' check (estado in ('activo', 'agotado')),

  -- modo NULL = "pendiente", nadie decidió todavía qué hacer con este lote.
  modo text check (modo in ('completo', 'solo_vencimiento', 'omitido')),

  -- modo = 'completo'
  fecha_elaboracion date,
  fecha_vencimiento date,

  -- modo = 'solo_vencimiento' (mismo fecha_vencimiento de arriba + esto)
  aviso_previo_valor numeric,
  aviso_previo_unidad text check (aviso_previo_unidad in ('dias', 'semanas', 'meses')),

  -- modo = 'omitido' -- trazabilidad de quién decidió que no importa,
  -- vale solo para ESTE lote (el próximo lote del mismo código vuelve a
  -- preguntar desde cero).
  omitido_por text,
  omitido_en timestamptz,

  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);

create index if not exists lotes_vencimiento_codigo_idx on lotes_vencimiento (codigo);
create index if not exists lotes_vencimiento_estado_idx on lotes_vencimiento (estado);

-- Auditoría inmutable -- igual espíritu que reportes_inventario: nunca se
-- borra sola. worker_id nulo = acción automática del motor de
-- reconciliación (no de una persona).
create table if not exists lotes_vencimiento_log (
  id bigint generated always as identity primary key,
  lote_id bigint references lotes_vencimiento(id) on delete cascade,
  codigo text not null,
  worker_id uuid references auth.users(id),
  worker_nombre text,
  accion text not null, -- creado_reconciliacion | cargado | actualizado | omitido | consumido_venta
  detalle jsonb,
  creado_en timestamptz not null default now()
);

create index if not exists lotes_vencimiento_log_lote_idx on lotes_vencimiento_log (lote_id);

-- Resumen derivado, SOLO lo que está en alerta ahora mismo -- lo escribe
-- agente-servidor (service_role) en cada reconciliación, lo lee reportes-web
-- directo. reportes-web nunca pasa por Supabase Auth (login propio por
-- clave), así que auth.uid() ahí siempre es nulo -- por eso NO puede leer
-- lotes_vencimiento (RLS de abajo lo bloquearía) y en cambio lee esta tabla
-- pública derivada, mismo criterio que ya usan reportes_ventas_*.
create table if not exists vencimientos_resumen_publico (
  codigo text primary key,
  descripcion text not null,
  fecha_vencimiento date,
  dias_restantes int,
  fraccion_transcurrida numeric,
  cantidad numeric,
  actualizado_en timestamptz not null default now()
);

alter table lotes_vencimiento enable row level security;
alter table lotes_vencimiento_log enable row level security;
alter table vencimientos_resumen_publico enable row level security;

-- lotes_vencimiento: mismo criterio que "conteos" -- cualquier trabajador o
-- admin logueado ve y edita cualquier lote (colaborativo). Sin política de
-- DELETE a propósito (dato de auditoría/negocio, no se borra desde la app).
drop policy if exists "lotes_vencimiento: logueados leen y escriben" on lotes_vencimiento;
create policy "lotes_vencimiento: logueados leen y escriben" on lotes_vencimiento
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- lotes_vencimiento_log: lectura colaborativa, insert solo como uno mismo
-- (o el service_role del motor, que salta RLS). Sin UPDATE/DELETE -- rastro
-- inmutable.
drop policy if exists "lotes_vencimiento_log: logueados leen" on lotes_vencimiento_log;
create policy "lotes_vencimiento_log: logueados leen" on lotes_vencimiento_log
  for select using (auth.uid() is not null);
drop policy if exists "lotes_vencimiento_log: logueados insertan como si mismos" on lotes_vencimiento_log;
create policy "lotes_vencimiento_log: logueados insertan como si mismos" on lotes_vencimiento_log
  for insert with check (worker_id = auth.uid() or worker_id is null);

-- vencimientos_resumen_publico: lectura pública (mismo criterio que las
-- tablas de reportes-web -- la protección real es el login de esa app, no
-- la base). Solo el service_role del agente escribe acá.
drop policy if exists "vencimientos_resumen_publico: lectura publica" on vencimientos_resumen_publico;
create policy "vencimientos_resumen_publico: lectura publica" on vencimientos_resumen_publico
  for select using (true);

-- Nota deliberada: NO se agrega ninguna de estas 3 tablas a
-- supabase_realtime todavía (decisión explícita del esquema aprobado --
-- vencimientos no es tan urgente como el conteo en vivo, se evita el canal
-- nuevo hasta que haga falta de verdad). Si en el futuro se necesita,
-- acordarse: alter publication supabase_realtime add table lotes_vencimiento;
