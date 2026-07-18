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
