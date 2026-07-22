-- Ejecuta este script completo en Supabase: Panel > SQL Editor > New query > Run

create table if not exists products (
  id bigint generated always as identity primary key,
  descripcion text not null,
  inventario_sistema numeric not null default 0,
  creado_en timestamptz default now()
);

create table if not exists conteos (
  id bigint generated always as identity primary key,
  product_id bigint references products(id) on delete cascade unique,
  en_tienda numeric not null default 0,
  en_vitrina numeric not null default 0,
  en_cajas numeric not null default 0,
  actualizado_en timestamptz default now()
);

create table if not exists config (
  id int primary key default 1,
  filtro_prefijo text default '',
  ronda text default '',
  actualizado_en timestamptz default now()
);

insert into config (id, filtro_prefijo, ronda)
values (1, '', 'Ronda inicial')
on conflict (id) do nothing;

-- Habilitamos acceso público de lectura/escritura con la clave "anon".
-- Esto es intencional: es una herramienta interna sin login de usuarios,
-- protegida solo por la clave de administrador dentro de la app (no es
-- seguridad real a nivel de base de datos). Si más adelante quieres
-- restringirlo más, puedes reemplazar estas políticas por unas más finas.

alter table products enable row level security;
alter table conteos enable row level security;
alter table config enable row level security;

drop policy if exists "public all products" on products;
create policy "public all products" on products
  for all using (true) with check (true);

drop policy if exists "public all conteos" on conteos;
create policy "public all conteos" on conteos
  for all using (true) with check (true);

drop policy if exists "public all config" on config;
create policy "public all config" on config
  for all using (true) with check (true);

-- Activa la sincronización en vivo: cuando un trabajador guarda un conteo,
-- los demás lo ven al instante sin esperar el refresco automático.
alter publication supabase_realtime add table conteos;

-- Sincronización de inventario directo desde el POS (AbarrotesPDV), en vez
-- de subir un Excel a mano. "codigo" identifica cada producto de forma
-- estable entre sincronizaciones, para actualizar sin perder los conteos
-- de los trabajadores que ya estén en progreso.
alter table products add column if not exists codigo text;
alter table products drop constraint if exists products_codigo_key;
alter table products add constraint products_codigo_key unique (codigo);

create table if not exists sync_requests (
  id bigint generated always as identity primary key,
  status text not null default 'pending', -- pending | running | done | error
  solicitado_en timestamptz default now(),
  completado_en timestamptz,
  productos_actualizados int,
  mensaje text
);

alter table sync_requests enable row level security;

drop policy if exists "public all sync_requests" on sync_requests;
create policy "public all sync_requests" on sync_requests
  for all using (true) with check (true);

alter publication supabase_realtime add table sync_requests;

-- Login básico de trabajadores (nombre + clave), para saber quién contó
-- qué y quién cerró cada ronda de inventario.
create table if not exists trabajadores (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  clave_hash text not null,
  recuperacion_hash text,
  creado_en timestamptz default now()
);

-- Registro de cada guardado de conteo, con el trabajador que lo hizo.
-- Se usa para armar el reporte final ("qué trabajadores actualizaron cada
-- producto") y la lista de participantes de la ronda.
create table if not exists conteo_log (
  id bigint generated always as identity primary key,
  product_id bigint references products(id) on delete cascade,
  trabajador_nombre text not null,
  en_tienda numeric,
  en_vitrina numeric,
  en_cajas numeric,
  actualizado_en timestamptz default now()
);

-- Reportes generados al presionar "Finalizar inventario": una foto fija
-- de cómo quedó todo, para que el admin la pueda ver después aunque los
-- conteos ya se hayan limpiado para la siguiente ronda.
create table if not exists reportes_inventario (
  id bigint generated always as identity primary key,
  ronda text,
  cerrado_por text not null,
  cerrado_en timestamptz default now(),
  participantes jsonb not null default '[]',
  resumen jsonb not null default '[]'
);

alter table trabajadores enable row level security;
alter table conteo_log enable row level security;
alter table reportes_inventario enable row level security;

drop policy if exists "public all trabajadores" on trabajadores;
create policy "public all trabajadores" on trabajadores
  for all using (true) with check (true);

drop policy if exists "public all conteo_log" on conteo_log;
create policy "public all conteo_log" on conteo_log
  for all using (true) with check (true);

drop policy if exists "public all reportes_inventario" on reportes_inventario;
create policy "public all reportes_inventario" on reportes_inventario
  for all using (true) with check (true);

-- Para que al presionar "Finalizar inventario" todos los trabajadores
-- conectados se enteren al instante y se cierre su sesión.
alter publication supabase_realtime add table reportes_inventario;

-- Recuperación de clave para trabajadores (no hay email en el sistema, así
-- que se usa una "palabra de recuperación" definida al crear la cuenta).
alter table trabajadores add column if not exists recuperacion_hash text;

-- Columnas extra del catálogo del POS (precios, mínimo, departamento) --
-- no se usan para el conteo en sí, se guardan de paso porque agente-servidor
-- ya las lee al sincronizar, para que "Exportar inventario a Excel" en el
-- panel admin pueda traer el mismo detalle completo que el Excel del POS.
alter table products add column if not exists precio_costo numeric;
alter table products add column if not exists precio_venta numeric;
alter table products add column if not exists precio_mayoreo numeric;
alter table products add column if not exists inv_minimo numeric;
alter table products add column if not exists departamento text;
