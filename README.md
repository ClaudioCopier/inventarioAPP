# PuntoVerdeAPP

App web (funciona en el celular desde el navegador, no requiere instalar
nada) con 4 sub-apps para la operación diaria de la tienda: **Inventario**
(conteos de stock), **Reportes** (dashboard de ventas, solo admin),
**Vencimientos** (fecha de vencimiento por lote, alertas) y **Turnos**
(marcar turno + comisión por venta durante esas horas). Un solo login
de Supabase Auth para las cuatro — ver `../SISTEMA.md` y `../SEGURIDAD.md`
en la raíz de `APP INVENTARIOS/` para el panorama completo del sistema
(incluye `agente-servidor`, el proceso aparte que lee el POS de la tienda
y publica todo acá).

Corre gratis con **Supabase** (base de datos + Auth) y **Vercel**
(hosting). Con el volumen de esta tienda estás muy por debajo de los
límites gratuitos de ambos.

## Cómo funciona

Sin sesión, la portada (`/`) deja elegir "Soy administrador" o "Soy
trabajador" — ambos casos terminan en una cuenta real de Supabase Auth
(`signInWithPassword`, no una clave comparada en el navegador). Con sesión
activa, la portada muestra botones a las 4 sub-apps (Reportes y el panel
admin de Turnos solo si el rol es admin) y "Salir".

- **Inventario** (`/trabajador`, `/admin`) — el admin publica un filtro de
  productos (por marca, por ejemplo) y arranca una ronda; el trabajador
  cuenta "en tienda"/"en vitrina"/"en cajas" y la app calcula si falta,
  sobra o está cuadrado contra el inventario del sistema (sincronizado
  desde el POS por `agente-servidor`, o cargado a mano por Excel).
- **Reportes** (`/reportes/`) — dashboard de ventas, admin-only incluso
  con sesión válida (RLS exige `is_admin()`, no solo estar logueado).
- **Vencimientos** (`/vencimientos`, `/vencimientos/lista`,
  `/vencimientos/historial`) — cada entrada de mercadería se trackea como
  un lote propio; alguien le pone fecha de vencimiento (o marca que no
  aplica) y el sistema avisa cuando se acerca. Detalle completo en
  `../VENCIMIENTOS.md`.
- **Turnos** (`/turnos`, `/turnos/admin`, `/turnos/historial`) — el
  trabajador se auto-marca (Entrada/Almuerzo/Salida, no reemplaza el
  libro físico) y el admin puede ver/editar/corregir cualquier turno y
  definir el % de comisión; un motor en `agente-servidor` calcula cuánto
  vendió la tienda durante esas horas exactas. Detalle completo en
  `../TURNOS.md`.

## Paso 1: Crear el proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) y crea una cuenta / un nuevo proyecto.
2. **SQL Editor** → correr, en orden: `supabase_schema.sql`,
   `supabase_schema_auth.sql`, `supabase_migration_vencimientos.sql` y el
   resto de los `supabase_migration_vencimientos_*.sql` (uno por
   incremento — ver `../SERVIDOR-PDV/SERVIDOR.md`, sección "Fase S", para
   el orden y el porqué de cada uno), `supabase_migration_turnos.sql` y
   `../SERVIDOR-PDV/supabase_migration_turnos_solicitudes.sql` (ver
   sección "Fase T" del mismo documento).
3. **Project Settings → API**: copiar **Project URL** y **anon public
   key** (los vas a necesitar en el Paso 3) y la clave **service_role**
   (server-only, para los endpoints de recuperación de clave).

**Seguridad real, no "abierta":** las tablas tienen RLS de verdad (no la
clave `anon` abierta) — trabajador y admin son cuentas reales de Supabase
Auth, con roles (`perfiles.rol`) que deciden qué puede leer/escribir cada
uno. Detalle completo en `../SEGURIDAD.md` — incluye por qué se eligió
este camino y no uno más simple.

## Paso 2: Subir el código a GitHub

```bash
cd inventario-app
git init
git add .
git commit -m "Primera versión"
```

Luego crear un repositorio en [github.com/new](https://github.com/new) y
seguir las instrucciones para subir el código.

## Paso 3: Desplegar en Vercel

1. [vercel.com](https://vercel.com) → entrar con la cuenta de GitHub.
2. **Add New → Project**, elegir el repositorio.
3. Vercel detecta el build multi-página de Vite (`vite.config.js` define
   dos entradas: `index.html` e `reportes/index.html`) — no cambiar nada
   en "Build settings".
4. **Environment Variables**, antes de desplegar:

   | Nombre | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | el Project URL de Supabase |
   | `VITE_SUPABASE_ANON_KEY` | el anon public key de Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | la clave `service_role` — server-only, nunca con prefijo `VITE_` |

5. **Deploy**. La primera cuenta de admin se crea corriendo
   `crear-clave-inicial` (ver `api/crear-clave-inicial.js`) o directo en
   Supabase Auth — el email de admin está fijado en
   `src/lib/constantes.js` (`ADMIN_EMAIL`).

## Cómo probarlo local

```bash
cd inventario-app
npm install
cp .env.example .env
# editar .env con los valores reales de Supabase
npm run dev
```

Se abre en `http://localhost:5173`.

## Formato del Excel (carga manual de inventario)

No importa el nombre exacto de las columnas: al subir el archivo, la app
deja elegir con menús desplegables cuál columna es la "descripción" y cuál
el "inventario del sistema". Solo hace falta que el Excel tenga, como
mínimo, esas dos columnas.

## Estructura del proyecto

```
inventario-app/
├── src/
│   ├── App.jsx                        → portal + rutas de las 4 sub-apps
│   ├── supabaseClient.js              → sesión con storage distinto para trabajador/admin
│   ├── pages/
│   │   ├── AdminPage.jsx              → Inventario: sube Excel/POS, filtro, herramientas
│   │   ├── WorkerPage.jsx             → Inventario: conteo del trabajador, badge de vencimiento
│   │   ├── HistorialReportesPage.jsx  → Inventario: historial de rondas cerradas
│   │   ├── WorkerHistorialPage.jsx    → Inventario: historial del trabajador
│   │   ├── vencimientos/
│   │   │   ├── CargarPage.jsx         → Vencimientos: buscar, cargar fecha, juntar/separar
│   │   │   ├── ListaPage.jsx          → Vencimientos: lista, pestañas, búsqueda, selección múltiple
│   │   │   └── HistorialPage.jsx      → Vencimientos: auditoría (quién hizo qué)
│   │   └── turnos/
│   │       ├── MarcarPage.jsx         → Turnos: marcar el propio turno, calcular la propia comisión
│   │       ├── AdminPage.jsx          → Turnos: ver/editar/crear turnos, % de comisión, calcular
│   │       └── HistorialPage.jsx      → Turnos: auditoría (quién marcó/corrigió qué)
│   ├── reportes/                      → Reportes: copia del sitio, gate cambiado a Supabase Auth
│   ├── components/                    → GateTrabajador, ReporteCard, CampoFecha, CampoHora
│   └── lib/                           → useSesionTrabajador, vencimientosReglas, exportadores Excel
├── reportes/index.html                → segunda entrada del build multi-página
├── supabase_schema*.sql               → esquema de Inventario/Auth
├── supabase_migration_vencimientos*.sql → esquema de Vencimientos (un archivo por incremento)
├── supabase_migration_turnos.sql      → esquema de Turnos (turnos, turnos_log, comisiones_config)
├── vite.config.js                     → build multi-página (index + reportes)
├── vercel.json                        → rewrites para que las 4 sub-apps funcionen
└── .env.example
```
