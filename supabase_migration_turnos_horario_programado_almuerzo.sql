-- Colación programada (2026-09-05, pedido explícito del usuario: "en el
-- día que se escoge agendar tiene que salir entrada almuerzo salida...
-- además de los atajos que ya hemos creado" -- mismo flujo de carga de
-- FormularioTurno/FormularioTurnoNuevo, con "0000" saltando directo a
-- Salida). Puramente aditivo sobre una tabla recién creada (sin filas
-- todavía) -- ambas columnas nullable, un horario sin colación cargada
-- sigue siendo válido (entrada->salida sin descuento).
alter table turnos_horario_programado
  add column if not exists hora_almuerzo_inicio_programada timestamptz,
  add column if not exists hora_almuerzo_fin_programada timestamptz;
