-- Inventario en vivo durante una ronda de conteo (2026-08-01).
--
-- Hasta ahora, `products.inventario_sistema` solo se actualizaba a pedido
-- (al publicar el filtro o apretar "Actualizar inventario"). Las
-- trabajadoras contaban contra un número congelado desde el arranque de la
-- ronda, y si se vendía algo mientras contaban, tenían que ir a revisar a
-- mano en la PC porque el número no se movía solo.
--
-- Esta columna le avisa a agente-servidor cuándo hay una ronda activa, para
-- que sincronice existencia en vivo (cada ~30s, solo lo que cambió, leyendo
-- nada más que debug.nfo -- liviano a propósito) SOLO mientras corresponde,
-- no todo el tiempo que el agente esté abierto. La prende
-- "Publicar filtro para trabajadores" y la apaga "Finalizar inventario"
-- (ver AdminPage.jsx / WorkerPage.jsx).
--
-- Correr una sola vez en Supabase → SQL Editor.

alter table config add column if not exists activo boolean default false;

update config set activo = false where id = 1;
