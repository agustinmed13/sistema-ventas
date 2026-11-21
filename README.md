# Mostrador — Sistema de gestión comercial

Segundo parcial de Programación IV — TUP, UTN Facultad Regional Tucumán.

## 1. Descripción

Mostrador es un sistema web de gestión comercial para un comercio minorista:
permite facturar ventas en el mostrador (contado, tarjeta o cuenta corriente),
controla la existencia de cada producto con un historial de movimientos y lleva
la cuenta corriente de los clientes. Está construido con Next.js y una API REST
propia, con una capa de servicios donde viven todas las reglas de negocio, y
guarda los datos en una base Turso.

## 2. Integrantes

> **TODO:** completar nombre y legajo de cada integrante.

| Nombre | Legajo |
|---|---|
| TODO | TODO |
| TODO | TODO |
| TODO | TODO |

## 3. URL pública

https://sistema-ventas-dusky.vercel.app

## 4. Usuarios de prueba

Los crea el script de datos iniciales (`npm run db:seed`).

| Email | Rol | Contraseña |
|---|---|---|
| `admin@mostrador.com` | admin | **TODO** |
| `vendedor@mostrador.com` | vendedor | **TODO** |

El **admin** puede todo. El **vendedor** opera el mostrador pero no puede, por
ejemplo, anular facturas: si lo intenta, el servidor responde `403`.

## 5. Tecnologías

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Next.js (App Router) | 16.4.6 |
| Interfaz | React | 19.3.0 |
| Lenguaje | TypeScript | 6 |
| Estilos | Tailwind CSS | 4.3.3 |
| Componentes | shadcn/ui (con Radix UI e íconos Lucide) | 4 |
| Acceso a datos | Drizzle ORM / drizzle-kit | 0.45 / 0.31 |
| Base de datos | Turso (libSQL), cliente `@libsql/client` | 0.18 |
| Contraseñas | bcryptjs | 3 |
| Hosting | Vercel | — |

La sesión está implementada a mano (tabla `sesiones` + cookie `HttpOnly`,
`SameSite=Lax`), sin librerías de autenticación.

## 6. Cómo instalarlo y ejecutarlo

### Requisitos

- **Node.js 20 o superior** (el proyecto se desarrolló con Node 24) y npm.
- **Una base de datos en [Turso](https://turso.tech)** (hay plan gratuito). Ver
  la sección 7 para obtener la URL y el token.

### Pasos

**1. Clonar el repositorio**

```bash
git clone https://github.com/agustinmed13/sistema-ventas.git
cd sistema-ventas
```

**2. Instalar las dependencias**

```bash
npm install
```

Descarga en `node_modules/` todas las librerías listadas en `package.json`.

**3. Crear el archivo `.env.local`**

Copiar el modelo y completar los valores (ver sección 7):

```bash
cp .env.example .env.local
```

**4. Crear las tablas**

```bash
npm run db:migrate
```

Ejecuta las migraciones de la carpeta `drizzle/` contra la base de Turso: crea
las 10 tablas del sistema. Solo hace falta la primera vez (o cuando se agregue
una migración nueva).

**5. Cargar los datos de prueba**

```bash
npm run db:seed
```

Ejecuta `db/seed.ts`. **Borra todos los datos** y vuelve a cargar: 2 usuarios,
5 categorías, 30 productos con su stock inicial, 10 clientes y 50 facturas
repartidas en los últimos 30 días. Tarda entre uno y tres minutos.

Las facturas y el stock inicial no se escriben directo en las tablas: se crean
con los mismos servicios que usa la aplicación (`crearFactura()` y
`moverStock()`), así los datos de prueba cumplen todas las reglas. Al terminar,
el script verifica e informa que:

- la existencia de cada producto coincide con la suma de sus movimientos,
- el saldo de cada cliente coincide con sus débitos menos créditos y no supera
  su límite de crédito,
- la numeración de facturas es correlativa y sin huecos.

Si alguna verificación falla, lo muestra y termina con error.

**6. Levantar la aplicación**

```bash
npm run dev
```

Inicia el servidor de desarrollo. Abrir http://localhost:3000 e ingresar con
alguno de los usuarios de prueba.

### Otros comandos

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila la aplicación para producción (lo hace Vercel al publicar) |
| `npm run start` | Sirve la versión compilada |
| `npm run lint` | Revisa el código con ESLint |
| `npm run db:generate` | Genera una migración nueva después de cambiar `db/schema.ts` |

## 7. Variables de entorno

Van en el archivo `.env.local`, en la raíz del proyecto. El archivo
`.env.example` tiene los nombres sin los valores.

| Variable | Qué es | De dónde se saca |
|---|---|---|
| `TURSO_DATABASE_URL` | Dirección de la base de datos (empieza con `libsql://`) | Panel de Turso, o `turso db show <nombre-de-la-base> --url` |
| `TURSO_AUTH_TOKEN` | Token de acceso a esa base | Panel de Turso, o `turso db tokens create <nombre-de-la-base>` |
| `ADMIN_PASSWORD` | Contraseña que el seed le asigna a `admin@mostrador.com` | La elige quien instala |
| `VENDEDOR_PASSWORD` | Contraseña que el seed le asigna a `vendedor@mostrador.com` | La elige quien instala |

- **`.env.local` nunca se commitea**: está en `.gitignore`. Las credenciales y
  las contraseñas quedan fuera del repositorio.
- **En producción** las variables `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` se
  cargan en Vercel (*Settings → Environment Variables*). `ADMIN_PASSWORD` y
  `VENDEDOR_PASSWORD` solo las usa el seed, que se corre desde una máquina
  local.
- Las contraseñas nunca se guardan en texto plano: el seed guarda su hash con
  bcrypt.

## 8. Arquitectura

El código está organizado en capas (consigna, sección 10). **Regla central:
cada regla de negocio vive en un único lugar, la capa de servicios.**

| Carpeta | Capa | Qué hace |
|---|---|---|
| `db/` | Datos | Esquema de las tablas (`schema.ts`), conexión a Turso (`index.ts`), migraciones (`drizzle/`) y datos de prueba (`seed.ts`). Sin reglas de negocio. |
| `lib/servicios/` | Servicios | Validan la entrada, verifican el rol, aplican las reglas y abren las transacciones. No saben nada de HTTP. Un archivo por parte del dominio. |
| `app/api/` | API REST | Adaptadores finos: exigen la sesión, leen el pedido, llaman a un servicio y traducen el resultado a una respuesta HTTP. No contienen reglas. |
| `app/(app)/` | Interfaz | Pantallas. Las de lectura son Server Components que llaman a los servicios; las interactivas llaman a la API. Pueden adelantar validaciones, pero nunca reemplazan las del servidor. |

Otros archivos de `lib/`:

- `lib/auth.ts`: sesión y contraseñas. `obtenerUsuarioActual()` es el lugar
  donde se verifica la sesión en cada pedido.
- `lib/errores.ts`: la clase `ApiError` que lanzan los servicios y la función
  que la convierte en respuesta con el formato
  `{ "error": { "code", "message", "details" } }`.
- `lib/formato.ts`: importes (`$ 12.345,50`), fechas en hora de Argentina,
  número de factura (`0001-00000001`) y documentos.

Decisiones importantes:

- **`moverStock()` (`lib/servicios/stock.ts`) es el único lugar del sistema
  donde cambia la existencia de un producto.** Las salidas se descuentan con un
  `UPDATE` condicional (`WHERE existencia >= cantidad`), así la existencia nunca
  queda negativa aunque dos ventas compitan por la última unidad, y cada cambio
  graba su movimiento en la misma transacción.
- **Toda operación que toca más de una tabla va en una transacción** (por
  ejemplo, emitir o anular una factura): o se guarda todo o no se guarda nada.
- **Los importes se guardan en centavos enteros**, nunca con decimales.
- **El saldo de un cliente no se guarda**: se calcula siempre desde
  `movimientos_cuenta` (débitos menos créditos).
- **Bajas lógicas**: una factura anulada no se borra; queda visible con su
  estado, motivo, fecha y quién la anuló.

## 9. Funcionalidades implementadas

Códigos según `requerimientos.md` de la cátedra.

### Usuarios y acceso

- **RF-U1 — Sesión.** Inicio de sesión con email y contraseña, y cierre de
  sesión (`/login`, `POST /api/auth/login`, `POST /api/auth/logout`). Si el
  email no existe, la contraseña es incorrecta o el usuario está inactivo, la
  respuesta es la misma (`401`), para no revelar qué cuentas existen.
- **RF-U2 — Protección.** Las pantallas del sistema redirigen a `/login` sin
  sesión válida, y todas las rutas de la API implementadas, salvo el login,
  responden `401` sin sesión. `GET /api/auth/me` devuelve el usuario actual.
- **RF-U3 — Primer administrador.** Lo crea el script de datos iniciales, con
  la contraseña tomada de `ADMIN_PASSWORD`.

### Ventas

- **RF-V1 — Nueva venta.** Pantalla `/ventas/nueva` con las tres zonas
  (comprador, ítems y pago); el total se recalcula en cada cambio. Operable con
  teclado.
- **RF-V3 — Ítems.** Búsqueda de productos por código o descripción; cantidad
  editable, subtotal y botón para quitar. Agregar un producto que ya está suma
  la cantidad al renglón existente.
- **RF-V4 — Control de existencia.** La pantalla muestra la existencia y no deja
  cargar más; el servidor lo vuelve a controlar al confirmar.
- **RF-V5 — Forma de pago.** Contado (monto recibido y vuelto), tarjeta (tipo,
  marca y últimos 4 dígitos; el número completo no se pide ni se guarda) y
  cuenta corriente (solo para clientes habilitados y dentro de su límite).
  *La cuenta corriente necesita elegir un cliente, que depende de RF-V2 (ver
  pendientes).*
- **RF-V6 — Confirmación.** `POST /api/facturas`: en una sola transacción el
  servidor calcula los precios y el total, verifica stock y límite de crédito,
  asigna el número correlativo, descuenta la existencia y, si es cuenta
  corriente, registra el débito.
- **RF-V7 — Comprobante.** `/ventas/[id]`: número, fecha y hora, vendedor,
  comprador, detalle, total y datos de la forma de pago. Preparado para
  imprimir (las acciones no salen en papel). *Falta mostrar los datos del
  comercio (ver pendientes).*
- **RF-V8 — Listado de facturas.** `/ventas`: filtros por rango de fechas,
  forma de pago, estado y número, con paginado; los filtros viven en la URL, así
  el listado se puede recargar y compartir. La API (`GET /api/facturas`) admite
  además filtrar por cliente (`clienteId`) y por vendedor (`usuarioId`).
- **RF-V9 — Anulación.** Solo el administrador, con motivo obligatorio y
  confirmación. Devuelve el stock y, si era cuenta corriente, registra un
  crédito. La factura queda visible como *Anulada*. Un vendedor que llame
  directamente a `POST /api/facturas/{id}/anulacion` recibe `403`.

### Productos

- **RF-P1 — Catálogo (solo API).** `GET /api/productos`: búsqueda por código o
  descripción sin distinguir mayúsculas ni tildes, filtro por categoría y por
  estado, marca de productos bajo el stock mínimo y paginado.

### Datos de prueba

- 2 usuarios (uno por rol), 5 categorías, 30 productos, 10 clientes y 50
  facturas en los últimos 30 días, creados con los servicios y verificados
  (ver paso 5 de la instalación).

## 10. Pendientes

> **⚠️ TODO — COMPLETAR ANTES DE ENTREGAR.** Esta sección refleja el estado del
> repositorio al momento de escribirla. Hay módulos en desarrollo: revisar cada
> punto contra el código final y borrar lo que se haya terminado.

### Ventas

- **RF-V2 — Comprador.** La pantalla de venta ya tiene el buscador de clientes
  y el formulario modal de alta, pero dependen de `GET /api/clientes` y
  `POST /api/clientes`, que todavía no existen. Hasta entonces, toda venta es a
  consumidor final.
- **RF-V7 — Comprobante:** falta mostrar los datos del comercio.
- **RF-V8 — Listado:** en la pantalla faltan los filtros por cliente y por
  vendedor (la API ya los admite por parámetro).

### Productos y existencias

- **RF-P1 — Catálogo:** falta la pantalla del catálogo (la API existe).
- **RF-P2 — Alta y edición de productos.** (Hoy el stock inicial se carga como
  ingreso solo desde el seed.)
- **RF-P3 — Baja lógica de productos.** (Las ventas ya rechazan productos
  inactivos, pero no hay forma de desactivarlos.)
- **RF-P4 — Ingreso de stock** y **RF-P5 — Egreso de stock.** (`moverStock()`
  ya admite ingresos y egresos; faltan la ruta y la pantalla.)
- **RF-P6 — Movimientos de stock.** (Se registran en cada operación; falta
  consultarlos.)
- **RF-P7 — Categorías.**

### Clientes y cuenta corriente

- **RF-C1 — Listado**, **RF-C2 — Alta y edición**, **RF-C3 — Ficha**,
  **RF-C4 — Cuenta corriente**, **RF-C5 — Registrar pago**, **RF-C6 — Saldos**
  y **RF-C7 — Baja**. (Los pagos de los datos de prueba hoy se cargan
  directamente desde el seed; cuando exista el servicio de pagos, el seed tiene
  que usarlo.)

### Usuarios

- **RF-U4 — Gestión de usuarios** y **RF-U5 — Contraseñas** (restablecer y
  cambiar).

### Inicio

- **RF-T1 — Indicadores**, **RF-T2 — Gráficos** (Chart.js, todavía no
  instalado) y **RF-T3 — Más vendidos.** La pantalla de inicio es por ahora un
  título.

### Transversales

- **Paginación:** implementada en las API de facturas y productos y en el
  listado de facturas; falta en los listados que todavía no existen.
- **Validación con Zod compartida** entre formularios y servidor (sugerida por
  la consigna, punto 6 de la lista de la sección 10.8): no implementada; hoy la
  validación está escrita a mano en cada servicio.
- **Rutas de la API (sección 11.2 y 11.9):** hay 8 de las 31. Faltan:
  - `PUT /api/auth/password`
  - `GET` y `POST /api/usuarios`, `PATCH /api/usuarios/{id}`,
    `POST /api/usuarios/{id}/reset-password`
  - `GET` y `POST /api/categorias`, `PATCH /api/categorias/{id}`
  - `GET /api/productos/{id}`, `POST /api/productos`,
    `PATCH /api/productos/{id}`, `GET` y `POST /api/productos/{id}/movimientos`,
    `GET /api/movimientos-stock`
  - `GET` y `POST /api/clientes`, `GET` y `PATCH /api/clientes/{id}`,
    `GET /api/clientes/{id}/cuenta`, `POST /api/clientes/{id}/pagos`,
    `GET /api/pagos/{id}`
  - `GET /api/facturas/proximo-numero`
  - `GET /api/tablero`
