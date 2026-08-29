-- Horas de contrato semanal por trabajador (2026-08-29, pedido explícito
-- del usuario: "Krishna tiene contrato de 30 horas no 42 y Claudio 20
-- horas no 42"). Hasta ahora el calendario de Turnos usaba un único
-- techo fijo (42h, la jornada máxima legal general, Ley 21.561) para
-- resaltar la semana en naranja -- pero cada trabajador puede tener un
-- contrato de menos horas, y ESE es el número relevante para saber si
-- está trabajando de más respecto a lo pactado con él/ella en particular.
alter table perfiles add column if not exists horas_contrato_semanal numeric not null default 42;

-- Admin necesita poder actualizar la fila de OTRO trabajador para
-- configurar esto (hasta ahora "perfiles: actualizar el propio" solo
-- dejaba actualizar la propia fila -- ni siquiera el admin podía tocar la
-- de otro). Se reemplaza esa policy por una que además permite is_admin().
drop policy if exists "perfiles: actualizar el propio" on perfiles;
create policy "perfiles: actualizar el propio o admin" on perfiles
  for update using (auth.uid() = id or is_admin()) with check (auth.uid() = id or is_admin());
