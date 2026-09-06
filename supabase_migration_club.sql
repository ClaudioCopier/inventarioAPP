-- Club de fidelización (2026-09-06) -- pedido explícito del usuario: un
-- club de socios por RUT que registre cuánto compra cada persona, sin
-- modificar el POS. Ver la investigación de factibilidad en
-- SERVIDOR-PDV/SERVIDOR.md (sección "Fase U" o similar) y el brainstorm
-- de modelos de fidelización -- el cajero escribe el RUT del cliente en
-- el campo "Notas" del ticket (`ventatickets.notas`, confirmado vacío en
-- operación normal, funciona con tarjeta y efectivo); `agente-servidor`
-- lee ese campo y, si el RUT coincide con un socio ya registrado, suma
-- esa compra a su historial.
--
-- Puramente aditivo -- no toca products/conteos/reportes/vencimientos/turnos.

-- El registro real de cada socio. RUT normalizado SIN puntos, CON guión
-- (ej. "18756847-1") -- ver lib/rut.js (agente-servidor y frontend,
-- misma función replicada a mano, mismo criterio que
-- vencimientosReglas.js) para el algoritmo de validación/normalización.
create table if not exists club_socios (
  id bigint generated always as identity primary key,
  rut text not null unique,
  nombre text not null,
  telefono text,
  email text,
  fecha_nacimiento date,

  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);

create index if not exists club_socios_rut_idx on club_socios (rut);

-- Una fila por ticket ya vinculado a un socio -- nunca se recalcula el
-- total "a mano": el gasto total de un socio es SUM(bruto) de sus filas
-- acá, igual criterio que vencimientos_resumen_publico (derivado, se
-- reconstruye solo, nunca se edita directo).
create table if not exists club_compras (
  id bigint generated always as identity primary key,
  socio_id bigint not null references club_socios(id) on delete cascade,
  ticket_id bigint not null unique, -- id real de ventatickets en Firebird -- nunca se reprocesa dos veces
  fecha date not null,
  bruto numeric not null default 0, -- ventatickets.total (con IVA)
  neto numeric not null default 0, -- bruto / 1.19, mismo criterio que Turnos (ver Fase T, bug real de IVA)
  articulos int,
  notas_original text, -- lo que el cajero tipeó tal cual, para auditar si algo calzó mal
  creado_en timestamptz not null default now()
);

create index if not exists club_compras_socio_idx on club_compras (socio_id);

-- Un ticket trae en "Notas" algo que PARECE un RUT válido (pasa el dígito
-- verificador) pero no coincide con ningún socio registrado -- típico:
-- typo del cajero, o alguien que compró antes de anotarse al club. Se
-- guarda para revisar a mano en vez de perderse en silencio (pedido
-- explícito del usuario).
create table if not exists club_compras_sin_socio (
  id bigint generated always as identity primary key,
  ticket_id bigint not null unique,
  fecha date not null,
  rut_detectado text not null,
  notas_original text,
  bruto numeric,

  revisado boolean not null default false,
  revisado_por text,
  revisado_en timestamptz,

  creado_en timestamptz not null default now()
);

create index if not exists club_compras_sin_socio_pendientes_idx on club_compras_sin_socio (revisado);

-- Cursor del motor -- mismo patrón exacto que vencimientos_watermark:
-- "hasta qué id de ventatickets ya procesé", nunca se reprocesa desde el
-- principio. Arranca en el MAX(id) actual la primera corrida (no hay
-- Notas históricas reales que valga la pena escanear).
create table if not exists club_watermark (
  id smallint primary key default 1 check (id = 1),
  ultimo_ticket_id_procesado bigint,
  actualizado_en timestamptz not null default now()
);

-- "Actualizar" desde la app -- mismo patrón exacto que
-- vencimientos_solicitudes: abierta a cualquier trabajador logueado (el
-- club es colaborativo, no admin-only).
create table if not exists club_solicitudes (
  id bigint generated always as identity primary key,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  solicitado_por text,
  solicitado_en timestamptz not null default now(),
  completado_en timestamptz,
  mensaje text,
  resultado jsonb
);

alter table club_socios enable row level security;
alter table club_compras enable row level security;
alter table club_compras_sin_socio enable row level security;
alter table club_watermark enable row level security;
alter table club_solicitudes enable row level security;

-- club_socios / club_compras: colaborativo -- cualquier trabajador o admin
-- logueado lee y escribe, mismo criterio que lotes_vencimiento (pedido
-- explícito del usuario: registrar un socio no depende de que el admin
-- esté presente).
drop policy if exists "club_socios: logueados leen y escriben" on club_socios;
create policy "club_socios: logueados leen y escriben" on club_socios
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "club_compras: logueados leen y escriben" on club_compras;
create policy "club_compras: logueados leen y escriben" on club_compras
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "club_compras_sin_socio: logueados leen y escriben" on club_compras_sin_socio;
create policy "club_compras_sin_socio: logueados leen y escriben" on club_compras_sin_socio
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "club_solicitudes: logueados leen y escriben" on club_solicitudes;
create policy "club_solicitudes: logueados leen y escriben" on club_solicitudes
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- club_watermark: sin ninguna policy a propósito -- ni admin ni trabajador
-- necesitan tocarlo nunca, solo el service_role del agente (bypassa RLS).

-- CRÍTICO -- mismo gotcha real ya documentado dos veces (Vencimientos,
-- Turnos): sin esto, Realtime nunca dispara el INSERT y "Actualizar" se
-- queda en 'pending' para siempre sin ningún error visible.
alter publication supabase_realtime add table club_solicitudes;
