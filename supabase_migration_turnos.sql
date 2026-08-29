-- Turnos y comisiones (2026-08-29) -- puramente aditivo. Pedido del
-- usuario: pagar comisión en base a cuánto vendió la TIENDA (no el
-- trabajador como cajero) durante las horas de su turno. El libro de
-- asistencia físico sigue siendo el registro legal (Resolución Exenta
-- N°38, DT -- el usuario decidió explícitamente no tramitar la
-- certificación para que un sistema electrónico lo reemplace); esto es
-- una herramienta interna de gestión/nómina en paralelo, nunca presentada
-- como el registro oficial. Correr en Supabase -> SQL Editor, o vía la
-- Management API (agente-servidor/lib/supabaseSql.js).

-- Registro no-legal de turno, por trabajador y día. A diferencia de
-- lotes_vencimiento (colaborativo), esto es dato de sueldo -- cada
-- trabajador ve/marca SOLO el suyo, admin ve/corrige cualquiera.
create table if not exists turnos (
  id bigint generated always as identity primary key,

  worker_id uuid not null references auth.users(id),
  worker_nombre text not null, -- denormalizado, mismo patrón que lotes_vencimiento_log

  fecha date not null, -- día calendario del turno; nunca cruza medianoche (tienda cierra bien antes)

  hora_entrada timestamptz,
  hora_almuerzo_inicio timestamptz,
  hora_almuerzo_fin timestamptz,
  hora_salida timestamptz,

  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),

  -- Trazabilidad de origen/corrección (además del rastro inmutable en turnos_log)
  marcado_por text not null default 'trabajador' check (marcado_por in ('trabajador', 'admin')),
  corregido boolean not null default false, -- true si un admin lo tocó después de que el trabajador lo marcara

  -- Resultado del cálculo de ventas -- SOLO lo escribe agente-servidor
  -- (service_role, ver turnos_solicitudes en SERVIDOR-PDV/). Snapshot al
  -- momento de calcular, no un JOIN en vivo contra comisiones_config --
  -- así un cambio de % después no reescribe en silencio un turno ya
  -- liquidado.
  bruto numeric,
  neto numeric,
  costo numeric,
  ganancia numeric,
  comision_porcentaje numeric,
  comision_monto numeric,
  calculado_en timestamptz,

  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);

create index if not exists turnos_worker_fecha_idx on turnos (worker_id, fecha);
create index if not exists turnos_fecha_idx on turnos (fecha);
create index if not exists turnos_estado_idx on turnos (estado);

-- Auditoría inmutable de marcado/corrección -- mismo espíritu que
-- lotes_vencimiento_log.
create table if not exists turnos_log (
  id bigint generated always as identity primary key,
  turno_id bigint references turnos(id) on delete cascade,
  worker_id uuid references auth.users(id),
  worker_nombre text,
  -- marcado_entrada | marcado_almuerzo_inicio | marcado_almuerzo_fin |
  -- marcado_salida | creado_admin | corregido_admin |
  -- cerrado_forzado_admin | calculo_ventas
  accion text not null,
  detalle jsonb,
  creado_en timestamptz not null default now()
);

create index if not exists turnos_log_turno_idx on turnos_log (turno_id);

-- % de comisión por trabajador, HISTORIZADO -- append-only, nunca se
-- actualiza una fila existente. Se eligió historial en vez de una columna
-- en "perfiles" a propósito: si se pisara el % en una columna, un cambio
-- de comisión reescribiría en silencio el criterio con el que se
-- calcularon turnos YA liquidados (que además quedan con su propio
-- snapshot en turnos.comision_porcentaje). Corregir un % es agregar una
-- fila nueva, nunca editar el pasado -- mismo criterio que ya usa este
-- proyecto en todos lados (ver lotes_vencimiento_log).
create table if not exists comisiones_config (
  id bigint generated always as identity primary key,
  worker_id uuid not null references auth.users(id),
  porcentaje numeric not null check (porcentaje >= 0 and porcentaje <= 100),
  vigente_desde timestamptz not null default now(),
  creado_por text,
  creado_en timestamptz not null default now()
);

create index if not exists comisiones_config_worker_idx on comisiones_config (worker_id, vigente_desde desc);

alter table turnos enable row level security;
alter table turnos_log enable row level security;
alter table comisiones_config enable row level security;

-- turnos: cada trabajador ve y marca SOLO su propio turno (dato de sueldo,
-- no colaborativo). Admin ve y edita cualquiera (correcciones, backfill
-- desde el libro físico). Sin política de DELETE -- nunca se borra desde
-- la app.
drop policy if exists "turnos: propio o admin leen" on turnos;
create policy "turnos: propio o admin leen" on turnos
  for select using (worker_id = auth.uid() or is_admin());
drop policy if exists "turnos: propio o admin insertan" on turnos;
create policy "turnos: propio o admin insertan" on turnos
  for insert with check (worker_id = auth.uid() or is_admin());
drop policy if exists "turnos: propio o admin actualizan" on turnos;
create policy "turnos: propio o admin actualizan" on turnos
  for update using (worker_id = auth.uid() or is_admin()) with check (worker_id = auth.uid() or is_admin());

-- turnos_log: lectura del propio rastro (transparencia -- "quién me
-- corrigió el turno y cuándo") o admin ve todo. Insert como uno mismo o
-- admin (o el service_role del agente, que salta RLS).
drop policy if exists "turnos_log: propio o admin leen" on turnos_log;
create policy "turnos_log: propio o admin leen" on turnos_log
  for select using (worker_id = auth.uid() or is_admin());
drop policy if exists "turnos_log: propio o admin insertan" on turnos_log;
create policy "turnos_log: propio o admin insertan" on turnos_log
  for insert with check (worker_id = auth.uid() or is_admin());

-- comisiones_config: un trabajador puede ver SU PROPIO % (transparencia
-- razonable), nunca el de otro (dato sensible entre compañeros). Solo
-- admin define comisiones -- pedido explícito del usuario. Sin
-- UPDATE/DELETE a propósito -- ver el comentario de la tabla, append-only.
drop policy if exists "comisiones_config: propio o admin leen" on comisiones_config;
create policy "comisiones_config: propio o admin leen" on comisiones_config
  for select using (worker_id = auth.uid() or is_admin());
drop policy if exists "comisiones_config: solo admin escribe" on comisiones_config;
create policy "comisiones_config: solo admin escribe" on comisiones_config
  for insert with check (is_admin());

-- Nota deliberada: NO se agrega ninguna de estas 3 tablas a
-- supabase_realtime (mismo criterio que lotes_vencimiento/
-- lotes_vencimiento_log -- no es tan urgente, se evita el canal nuevo
-- hasta que haga falta de verdad; el panel admin se refresca al entrar/al
-- guardar). turnos_solicitudes SÍ lo necesita -- ver
-- SERVIDOR-PDV/supabase_migration_turnos_solicitudes.sql.
