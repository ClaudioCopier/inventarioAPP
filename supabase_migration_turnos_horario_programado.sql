-- Horario programado (2026-09-05, pedido explícito del usuario: "los
-- trabajadores están marcando a des-horas sus entradas y salidas, o se
-- olvidan de hacerlo... por ejemplo si un trabajador entra a las 10:00
-- llega a tienda a las 09:58, marca, pero no empieza labores hasta las
-- 10 -- y la app cuenta esos 2 minutos de más"). El admin precarga,
-- semana a semana, la hora de entrada/salida ESPERADA de cada trabajador
-- para cada día -- eso es lo que cuenta para comisión y para las horas
-- contra el contrato semanal, siempre que exista una fila acá. El
-- marcaje real del trabajador (`turnos.hora_entrada`/`hora_salida`) se
-- sigue guardando igual, como registro de presencia/asistencia -- solo
-- deja de ser lo que se usa para calcular plata u horas.
--
-- Un día sin fila acá (turno cargado sin horario programado -- ej. un
-- turno extra o de backfill del libro físico) cae al comportamiento
-- viejo: usa el marcaje real, tal como funcionaba antes de esto.
create table if not exists turnos_horario_programado (
  id bigint generated always as identity primary key,
  worker_id uuid not null references auth.users(id),
  fecha date not null,

  hora_entrada_programada timestamptz not null,
  hora_salida_programada timestamptz not null,

  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_por text,
  actualizado_en timestamptz not null default now(),

  unique (worker_id, fecha)
);

create index if not exists turnos_horario_programado_worker_fecha_idx
  on turnos_horario_programado (worker_id, fecha);

alter table turnos_horario_programado enable row level security;

-- Mismo criterio que comisiones_config (dato de gestión de turnos, no
-- colaborativo como Vencimientos): el trabajador puede LEER su propio
-- horario -- necesita saber a qué hora entra -- pero solo el admin
-- carga/edita/borra.
drop policy if exists "turnos_horario_programado: propio o admin lee" on turnos_horario_programado;
create policy "turnos_horario_programado: propio o admin lee" on turnos_horario_programado
  for select using (worker_id = auth.uid() or is_admin());

drop policy if exists "turnos_horario_programado: solo admin inserta" on turnos_horario_programado;
create policy "turnos_horario_programado: solo admin inserta" on turnos_horario_programado
  for insert with check (is_admin());

drop policy if exists "turnos_horario_programado: solo admin actualiza" on turnos_horario_programado;
create policy "turnos_horario_programado: solo admin actualiza" on turnos_horario_programado
  for update using (is_admin());

drop policy if exists "turnos_horario_programado: solo admin borra" on turnos_horario_programado;
create policy "turnos_horario_programado: solo admin borra" on turnos_horario_programado
  for delete using (is_admin());
