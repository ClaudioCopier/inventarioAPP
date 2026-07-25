-- Fase 1 de la migración a Supabase Auth real (ver el plan de la sesión).
-- ADITIVO: no toca ninguna política RLS de supabase_schema.sql -- las 7
-- tablas viejas siguen abiertas hasta la Fase 5. Correr completo en
-- Supabase > SQL Editor > New query > Run.

-- Perfil de cada usuario real de Supabase Auth (trabajador o admin).
-- "perfiles" es tabla NUEVA (no existía nada parecido antes), así que sus
-- políticas se definen ya mismo, sin esperar a la Fase 5 -- no hay ningún
-- comportamiento viejo que preservar acá.
create table if not exists perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text unique,
  rol text not null default 'trabajador' check (rol in ('trabajador','admin')),
  recuperacion_hash text,
  creado_en timestamptz default now()
);

alter table perfiles enable row level security;

-- is_admin() se define ANTES de las políticas de perfiles que la usan
-- (Postgres exige que la función ya exista al crear la policy). También la
-- van a usar las políticas de la Fase 5.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles where id = auth.uid() and rol = 'admin'
  );
$$;

drop policy if exists "perfiles: leer el propio o admin" on perfiles;
create policy "perfiles: leer el propio o admin" on perfiles
  for select using (auth.uid() = id or is_admin());

drop policy if exists "perfiles: actualizar el propio" on perfiles;
create policy "perfiles: actualizar el propio" on perfiles
  for update using (auth.uid() = id);

-- Al crear un usuario real (signUp o Admin API), crea automáticamente su
-- fila en "perfiles" -- toma el nombre de los metadatos del usuario
-- (user_metadata.nombre), que el cliente/script de backfill deben mandar.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, nombre)
  values (new.id, new.raw_user_meta_data->>'nombre')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Identidad real detrás de cada conteo/reporte -- esto es lo que la Fase 5
-- va a usar en las políticas RLS, en vez de confiar en el string de texto
-- (trabajador_nombre/cerrado_por) que hoy manda el cliente sin verificar.
-- Las columnas de texto se quedan tal cual, solo para mostrar en pantalla.
alter table conteo_log add column if not exists worker_id uuid references auth.users(id);
alter table reportes_inventario add column if not exists worker_id uuid references auth.users(id);

create or replace function public.set_worker_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.worker_id is null then
    new.worker_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_worker_id_conteo_log on conteo_log;
create trigger set_worker_id_conteo_log
  before insert on conteo_log
  for each row execute function public.set_worker_id();

drop trigger if exists set_worker_id_reportes_inventario on reportes_inventario;
create trigger set_worker_id_reportes_inventario
  before insert on reportes_inventario
  for each row execute function public.set_worker_id();
