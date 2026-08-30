-- estado pasa a ser una columna GENERADA a partir de hora_salida
-- (2026-08-30) -- bug real de producción: el trabajador corrigió su
-- hora_salida desde "Corregir una hora" (MarcarPage.jsx) y el turno se
-- quedó "abierto" para siempre, porque ese formulario nunca calculaba
-- `estado` en el UPDATE (a diferencia de los formularios del admin, que
-- sí lo hacían). Tres lugares distintos del código JS tenían que
-- "acordarse" de la misma regla (estado = 'cerrado' si hay hora_salida,
-- si no 'abierto') y uno se olvidó -- la causa de fondo no es un typo
-- puntual, es que la regla vivía duplicada en varios lugares en vez de
-- en un solo sitio. Se saca la columna de en medio: ahora Postgres la
-- calcula solo, ningún INSERT/UPDATE puede pisarla ni olvidarse de
-- ponerla -- estructuralmente no puede volver a pasar este bug.
alter table turnos drop column estado;
alter table turnos add column estado text
  generated always as (case when hora_salida is not null then 'cerrado' else 'abierto' end) stored;

-- Se recrea el índice que ya existía sobre esta columna (se pierde al
-- hacer drop column).
create index if not exists turnos_estado_idx on turnos (estado);
