-- Comisión de Turnos, separada a su propia tabla admin-only (2026-08-29,
-- pedido explícito del usuario: "el trabajador jamás podrá ver sus
-- comisiones... eso lo maneja solo el admin, el trabajador solo podrá ver
-- sus días asistidos").
--
-- Por qué hace falta esto y no alcanza con ocultarlo en la UI: RLS en
-- Postgres es por FILA, no por columna. Las columnas bruto/neto/costo/
-- ganancia/comision_* vivían en "turnos", donde la policy de SELECT es
-- "worker_id = auth.uid() or is_admin()" -- un trabajador logueado puede
-- pedir su propia fila completa por la API REST (con su propio token,
-- sin pasar por el frontend) y esas columnas venían incluidas, aunque
-- ninguna pantalla las mostrara. La única forma real de que "jamás" sea
-- cierto es que ese dato viva en una tabla que el trabajador no tiene
-- ningún permiso de leer, ni siquiera para su propia fila.
create table if not exists turnos_comision (
  turno_id bigint primary key references turnos(id) on delete cascade,
  bruto numeric,
  neto numeric,
  costo numeric,
  ganancia numeric,
  comision_porcentaje numeric,
  comision_monto numeric,
  calculado_en timestamptz
);

alter table turnos_comision enable row level security;

drop policy if exists "turnos_comision: solo admin lee" on turnos_comision;
create policy "turnos_comision: solo admin lee" on turnos_comision
  for select using (is_admin());

-- Sin policy de insert/update/delete para el cliente -- solo
-- agente-servidor (service_role, bypasea RLS) escribe acá. Ni siquiera
-- admin escribe directo: siempre pasa por el cálculo real
-- (turnos_solicitudes), nunca a mano.

-- Migra cualquier dato ya calculado antes de este cambio (turnos que ya
-- tenían bruto/comisión guardados directo en la fila).
insert into turnos_comision (turno_id, bruto, neto, costo, ganancia, comision_porcentaje, comision_monto, calculado_en)
select id, bruto, neto, costo, ganancia, comision_porcentaje, comision_monto, calculado_en
from turnos
where calculado_en is not null
on conflict (turno_id) do nothing;

-- Retira las columnas viejas de "turnos" -- eran justamente el problema
-- (RLS de "turnos" es "propio o admin", así que un trabajador podía leer
-- su propia fila completa, comisión incluida).
alter table turnos drop column if exists bruto;
alter table turnos drop column if exists neto;
alter table turnos drop column if exists costo;
alter table turnos drop column if exists ganancia;
alter table turnos drop column if exists comision_porcentaje;
alter table turnos drop column if exists comision_monto;
alter table turnos drop column if exists calculado_en;
