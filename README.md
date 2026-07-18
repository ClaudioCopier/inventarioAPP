# Inventario Punto Verde

App web (funciona en el celular desde el navegador, no requiere instalar nada) para hacer conteos de inventario en tienda. Un administrador sube el Excel y decide qué productos ve cada trabajador; el trabajador registra lo que encuentra y la app calcula automáticamente si falta, sobra o está cuadrado.

Está hecha para funcionar gratis con **Supabase** (base de datos) + **Vercel** (hosting). Con 1-3 trabajadores y 1-2 administradores usando la app, estás muy por debajo de los límites gratuitos de ambos servicios.

## Cómo funciona

- `/admin` — panel de administrador (pide una clave para entrar)
- `/trabajador` — vista del trabajador (sin clave, se comparte el link directo)

El administrador sube el Excel, elige qué columna es la descripción y cuál el inventario del sistema, y define un filtro de texto ("comienza por"). Ese filtro se guarda en la base de datos y el trabajador ve solo esos productos.

El trabajador llena "en tienda", "en vitrina" y "en cajas". La app resta esos tres números al inventario del sistema:

- Resultado = 0 → **Cuadrado** (verde)
- Resultado > 0 → **Faltan X productos** (rojo)
- Resultado < 0 → **Sobran X productos** (amarillo)

Cada campo se guarda solo (no hay botón "Guardar"), apenas el trabajador deja de escribir o cambia de campo.

## Paso 1: Crear el proyecto en Supabase (gratis)

1. Ve a [supabase.com](https://supabase.com) y crea una cuenta / un nuevo proyecto.
2. Cuando el proyecto esté listo, ve a **SQL Editor** (menú lateral) → **New query**.
3. Copia y pega todo el contenido del archivo `supabase_schema.sql` (incluido en este proyecto) y presiona **Run**. Esto crea las tablas `products`, `conteos` y `config`.
4. Ve a **Project Settings → API**. Ahí vas a encontrar:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **anon public key** (una clave larga)

Vas a necesitar esos dos valores en el paso 3.

> Nota de seguridad: para simplificar, la base de datos queda con acceso abierto a través de la clave "anon" (no hay login de usuarios). La única protección es la clave de administrador dentro de la app, que evita que cualquiera suba un Excel nuevo por error. Si en el futuro quieres más seguridad (por ejemplo, login real), se puede agregar Supabase Auth.

## Paso 2: Subir el código a GitHub

Si no tienes el proyecto en GitHub todavía:

```bash
cd inventario-app
git init
git add .
git commit -m "Primera versión"
```

Luego crea un repositorio nuevo en [github.com/new](https://github.com/new) y sigue las instrucciones para subir el código (`git remote add origin ...` y `git push`).

## Paso 3: Desplegar en Vercel (gratis)

1. Ve a [vercel.com](https://vercel.com) y entra con tu cuenta de GitHub.
2. **Add New → Project** y elige el repositorio que acabas de subir.
3. Vercel detecta automáticamente que es un proyecto Vite. No cambies nada en "Build settings".
4. Antes de darle a "Deploy", abre la sección **Environment Variables** y agrega estas tres:

   | Nombre | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | el Project URL de Supabase |
   | `VITE_SUPABASE_ANON_KEY` | el anon public key de Supabase |
   | `VITE_ADMIN_CLAVE` | una clave que tú inventes, ej: `puntoverde2026` |

5. Dale a **Deploy**. En un par de minutos tendrás una URL tipo `https://inventario-punto-verde.vercel.app`.

Con eso ya está: `https://tu-proyecto.vercel.app/admin` es tu panel y `https://tu-proyecto.vercel.app/trabajador` es el link para compartir con los trabajadores (por WhatsApp, por ejemplo).

## Cómo probarlo en tu computador antes de subirlo (opcional)

```bash
cd inventario-app
npm install
cp .env.example .env
# edita .env y pon tus valores reales de Supabase y la clave de admin
npm run dev
```

Se abrirá en `http://localhost:5173`.

## Formato del Excel

No importa el nombre exacto de las columnas: al subir el archivo, la app te deja elegir con menús desplegables cuál columna es la "descripción" y cuál es el "inventario del sistema". Solo necesitas que el Excel tenga, como mínimo, esas dos columnas (puede tener más, se ignoran).

## Uso día a día

1. El administrador exporta el Excel de productos (por ejemplo desde el sistema POS) y lo sube en `/admin`.
2. El administrador escribe el texto del filtro (por ejemplo la marca, como "COCA" o "NESTLE") en "Filtrar descripción que comienza por" y presiona **Publicar filtro**.
3. El trabajador abre `/trabajador` en su celular (puede guardarlo como acceso directo en la pantalla de inicio) y empieza a contar.
4. Para la siguiente ronda o la siguiente marca, el administrador cambia el filtro y publica de nuevo — no hace falta subir el Excel otra vez si los productos no cambiaron.
5. Si vas a repetir un conteo desde cero, usa **Reiniciar conteos de trabajadores** en el panel de admin.

## Estructura del proyecto

```
inventario-app/
├── src/
│   ├── pages/
│   │   ├── AdminPage.jsx     → sube Excel, define el filtro, herramientas
│   │   └── WorkerPage.jsx    → tabla de conteo para el trabajador
│   ├── supabaseClient.js     → conexión a Supabase
│   ├── App.jsx               → rutas (/, /admin, /trabajador)
│   └── styles.css
├── supabase_schema.sql       → script para crear las tablas
├── vercel.json                → configuración para que /admin y /trabajador funcionen
└── .env.example
```
