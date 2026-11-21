# AGENTS.md — Sistema de Gestión Comercial

Instrucciones para cualquier agente de IA que trabaje en este repositorio.
**Leer este archivo completo antes de escribir código.**

Repositorio: `github.com/agustinmed13/sistema-ventas`

---

## 0. La consigna oficial

La consigna es **`requerimientos.md`**, en la raíz del repositorio de la
cátedra: `github.com/AlejandroDiBattista/tup26-p4`. Reúne el enunciado
(secciones 1 a 9), las pautas arquitectónicas (sección 10), la especificación
de la API REST (sección 11) y los entregables (sección 12).

> **Atención:** existen otros dos archivos que describen un alcance distinto:
> `parcial/segundo-parcial.md` y `parcial/api-rest-sistema-ventas.md`.
> **Ninguno de los dos es la consigna.** Ante cualquier diferencia manda
> `requerimientos.md`.

Cada requerimiento tiene un código (`RF-V1`, `RF-P3`) para citarlo en el README
y en la corrección. Usalos.

- **Entrega:** lunes 23 de noviembre de 2026
- **Defensa:** jueves 26 de noviembre de 2026
- **Grupo de 3**, cada integrante con su propio agente de IA

---

## 1. Qué significa esto para el agente

La defensa es **individual** y sobre **todo el sistema**. Cada integrante
responde preguntas sobre cualquier parte del código, muestra dónde está lo que
se le pregunta, y hace **un cambio pequeño pedido en el momento**.

El objetivo no es código que funcione: es código que un estudiante de nivel
básico-intermedio pueda **leer, explicar y modificar bajo presión**, incluso si
no lo escribió.

- Preferir siempre la solución **simple y explícita** sobre la elegante.
- No usar patrones, abstracciones ni librerías que no sean necesarias.
- Si hay dos formas de hacer algo, elegir la más fácil de explicar.
- Comentar en español las partes no obvias, **citando el requerimiento o la
  regla que implementan** (por ejemplo `// RF-V6` o `// regla 2`). La consigna
  lo pide explícitamente en la sección 10.2.

---

## 2. Stack — obligatorio

| Capa | Tecnología | Carácter |
|---|---|---|
| Lenguaje | **TypeScript** | Obligatorio |
| Framework | Next.js 16, App Router | Obligatorio |
| API | REST con Route Handlers (`route.ts`) | Obligatorio |
| Estilos | Tailwind CSS | Obligatorio |
| Componentes | **shadcn/ui** | Obligatorio |
| Gráficos | **Chart.js** con `react-chartjs-2` | Obligatorio |
| Base de datos | Turso (libSQL) | Obligatorio |
| Acceso a datos | Drizzle ORM + migraciones de `drizzle-kit` | Obligatorio |
| Validación | Zod, compartido entre cliente y servidor | Sugerido |
| Hosting | Vercel | Obligatorio |

**Autenticación:** sesión propia con tabla `sesiones` + cookie `HttpOnly`,
`SameSite=Lax`. Ya está implementada. La consigna la acepta como alternativa a
Auth.js. **No instalar NextAuth.**

---

## 3. Arquitectura en capas — lo que más se evalúa

La sección 10 de la consigna define una arquitectura, y la **sección 10.8 es
una lista de control que el profesor verifica en la defensa**. El principio es
uno solo:

> **Cada regla de negocio vive en un único lugar: la capa de servicios.**

| Capa | Qué hace | Qué NO hace |
|---|---|---|
| `db/` | Esquema, migraciones, conexión | No contiene reglas de negocio |
| `lib/servicios/` | Valida la entrada, verifica el rol, aplica las reglas, abre las transacciones | No conoce HTTP ni cookies |
| `app/api/` | Exige sesión, lee parámetros y cuerpo, llama a un servicio, traduce el resultado | No repite validaciones ni reglas |
| `app/(app)/` | Muestra datos, adelanta validaciones | No reemplaza ningún control del servidor |

### Reglas de la capa de servicios

- **Un módulo por parte del dominio:** `autenticacion`, `usuarios`,
  `categorias`, `productos`, `stock`, `clientes`, `pagos`, `facturas`,
  `tablero`.
- Cada función recibe el **usuario autenticado** y los **datos sin validar**, y
  sigue siempre el mismo orden: valida, verifica el permiso, aplica las reglas,
  devuelve el resultado.
- Toda operación que toca más de una tabla va en **una transacción**.
- **La existencia de un producto solo cambia en `moverStock()`**, que actualiza
  con condición (`WHERE existencia >= ?`) y graba el movimiento en la misma
  transacción. Ventas, anulaciones, ingresos y egresos la llaman; nadie más
  toca la existencia.
- El saldo del cliente sale **siempre** de `movimientos_cuenta`.
- El **seed** crea facturas y pagos **usando los mismos servicios**, para que
  los datos de prueba cumplan todas las reglas (sección 10.7).

### La lista de control de la defensa (sección 10.8)

1. Ninguna ruta contiene reglas de negocio: solo llama a un servicio.
2. Un vendedor que llama directo a una ruta de admin recibe `403`.
3. Una operación compuesta que falla no deja datos parciales.
4. Dos ventas simultáneas de la última unidad terminan con una sola factura.
5. La existencia de cada producto coincide con la suma de sus movimientos, y el
   saldo de cada cliente con sus débitos menos sus créditos.
6. El mismo esquema de Zod valida en el formulario y en el servidor.
7. Cada integrante ubica dónde vive una regla y puede modificarla en un solo
   lugar.

---

## 4. Reglas de trabajo

1. **No instalar dependencias** sin aprobación explícita.
2. **No tocar archivos fuera del módulo asignado** (ver sección 9).
3. **No refactorizar de más.**
4. **Trabajar por etapas.** Entregar una pieza, explicarla, y recién seguir.
5. **Explicar siempre:** qué archivo se tocó, qué hace cada bloque, por qué.
6. **No asumir que algo funciona.** Dar el comando exacto y esperar el reporte.
7. **Anotar los errores propios** en `NOTAS-IA.md`.

---

## 5. Convenciones de la API (sección 11.1)

- JSON, nombres de campo en **camelCase**.
- Toda ruta exige sesión salvo `POST /api/auth/login`; sin ella, `401`.
- Rutas marcadas *admin* responden `403` al vendedor.
- **Importes siempre enteros en centavos.** La API nunca devuelve decimales.
- **Fechas** en ISO 8601 UTC (`2026-10-29T18:24:00Z`). Los filtros por día
  (`desde`, `hasta`) usan `AAAA-MM-DD` y se interpretan en hora de Argentina.
- **Bajas lógicas:** no hay `DELETE` para registros con historial. Se usa
  `PATCH` con `"activo": false`.
- **Precios desde el servidor.** Al facturar, el cliente manda productos y
  cantidades; precios, subtotales y total los calcula el servidor.

### Listados — con paginación

```json
{ "data": [], "page": 1, "pageSize": 20, "total": 137 }
```

`page` desde 1, `pageSize` por defecto 20 y máximo 100.

### Errores

```json
{
  "error": {
    "code": "VALIDACION",
    "message": "Hay campos con errores.",
    "details": [{ "campo": "codigo", "mensaje": "Es obligatorio." }]
  }
}
```

`details` es **un arreglo** y es opcional.

### Códigos de error (sección 11.8)

| HTTP | `code` |
|---|---|
| 400 | `JSON_INVALIDO` |
| 401 | `NO_AUTENTICADO` · `CREDENCIALES_INVALIDAS` |
| 403 | `SIN_PERMISO` |
| 404 | `NO_ENCONTRADO` |
| 409 | `CODIGO_DUPLICADO` · `DOCUMENTO_DUPLICADO` · `EMAIL_DUPLICADO` · `NOMBRE_DUPLICADO` · `CATEGORIA_EN_USO` · `STOCK_INSUFICIENTE` · `FACTURA_ANULADA` |
| 422 | `VALIDACION` · `PRODUCTO_INACTIVO` · `CUENTA_CORRIENTE_NO_HABILITADA` · `LIMITE_CREDITO_EXCEDIDO` · `MONTO_INSUFICIENTE` · `PAGO_SUPERA_DEUDA` · `SALDO_PENDIENTE` · `CONTRASENA_ACTUAL_INCORRECTA` · `OPERACION_SOBRE_SI_MISMO` |
| 500 | `ERROR_INTERNO` |

**Criterio:** `409` cuando el pedido choca con el **estado actual** de los
datos; `422` cuando está bien formado pero **rompe una regla de negocio**.

---

## 6. Estructura de carpetas (sección 11.9)

```
app/
  login/
  (app)/
    layout.tsx         Panel lateral + barra superior + protección
    page.tsx           Tablero
    ventas/  productos/  clientes/  usuarios/  perfil/
  api/
    auth/      login/  logout/  me/  password/
    usuarios/  route.ts  [id]/route.ts  [id]/reset-password/
    categorias/ route.ts  [id]/route.ts
    productos/ route.ts  [id]/route.ts  [id]/movimientos/
    movimientos-stock/route.ts
    clientes/  route.ts  [id]/route.ts  [id]/cuenta/  [id]/pagos/
    pagos/[id]/route.ts
    facturas/  route.ts  proximo-numero/  [id]/route.ts  [id]/anulacion/
    tablero/route.ts
db/        schema.ts  index.ts  seed.ts
lib/
  servicios/   un módulo por dominio
  errores.ts   ApiError y respuestas
  formato.ts   importes, fechas, documento, numeración
  auth.ts      sesión y contraseñas
components/
docs/
```

Son **31 rutas**. Los segmentos fijos (`proximo-numero`) tienen prioridad sobre
`[id]`.

---

## 7. Modelo de datos (sección 7)

| Tabla | Guarda |
|---|---|
| `usuarios` | email (único), nombre, hash, rol, activo |
| `sesiones` | token, usuario, vencimiento |
| `categorias` | nombre (único), activa |
| `productos` | código (único), descripción, precio, existencia, stock mínimo, activo, categoría |
| `movimientos_stock` | tipo, cantidad **con signo**, existencia resultante, motivo, fecha, producto, usuario, factura opcional |
| `clientes` | tipo y número de documento (único), nombre, domicilio, teléfono, email, cuenta corriente habilitada, límite de crédito, activo |
| `facturas` | punto de venta, número, fecha, total, forma de pago, datos de tarjeta, monto recibido, estado, motivo de anulación, cliente opcional, usuario |
| `factura_items` | cantidad, precio unitario, subtotal, descripción copiada |
| `pagos` | número de recibo, fecha, importe, medio, observación, cliente, usuario |
| `movimientos_cuenta` | tipo (débito/crédito), importe, fecha, descripción, cliente, factura o pago de origen |

**Roles:** `admin` y `vendedor`.

---

## 8. Reglas de negocio (sección 6)

Se validan **en el servicio**. La interfaz puede adelantarlas, no reemplazarlas.

1. **La existencia nunca es negativa.** Se controla al cargar el ítem y otra vez
   al confirmar.
2. **Todo cambio de stock deja un movimiento**, en la misma transacción.
3. **El precio se congela.** La factura guarda el precio del momento.
4. **Numeración correlativa y sin huecos**, formato `0001-00000001`. Se asigna
   al confirmar. Los recibos tienen numeración propia.
5. **Una factura confirmada no se modifica.** Solo se anula, y la anulación
   revierte stock y saldo.
6. **Consumidor final no compra en cuenta corriente.**
7. **Saldo = débitos − créditos.** Con límite de crédito, una venta a cuenta no
   puede superarlo.
8. **Un pago no supera la deuda.**
9. **De la tarjeta solo se guardan tipo, marca y últimos 4 dígitos.**
10. **Importes en centavos enteros**, mostrados como `$ 12.345,50`.
11. **Trazabilidad:** facturas, movimientos y pagos registran usuario y fecha.
12. **Bajas lógicas.** Nunca se borra nada con historial.

---

## 9. Reparto

| Integrante | Módulos | Archivos |
|---|---|---|
| **Agustín** | Base de datos, seed, **Ventas** (RF-V) | `db/`, `lib/servicios/facturas.ts`, `app/api/facturas/`, `app/(app)/ventas/` |
| **Jazmín** | Interfaz general, **Productos** (RF-P), **Usuarios** (RF-U) | `app/(app)/layout.tsx`, `components/`, `lib/formato.ts`, `lib/servicios/productos.ts`, `app/api/productos/`, `app/api/categorias/` |
| **Majo** | **Clientes** (RF-C), **Tablero** (RF-T) | `lib/servicios/clientes.ts`, `app/api/clientes/`, `app/api/tablero/`, `app/(app)/clientes/` |

**Compartidos — avisar antes de tocar:** `db/schema.ts`, `db/index.ts`,
`db/seed.ts`, `lib/auth.ts`, `lib/errores.ts`, `lib/formato.ts`,
`app/(app)/layout.tsx`, `components/`, `package.json`.

---

## 10. Prioridades

El guion de la defensa (sección 12) define lo obligatorio. Son cuatro
operaciones que tienen que funcionar **sobre la URL pública**:

1. Venta a consumidor final con efectivo
2. Venta a un cliente **nuevo** en cuenta corriente
3. Pago de ese cliente
4. **Anulación** de una factura

verificando stock y saldo después de cada paso.

**Imprescindible:** login y protección · capa de servicios · catálogo · alta de
clientes · nueva venta con las tres formas de pago · comprobante · listado ·
anulación · cuenta corriente · pagos.

**Si alcanza el tiempo:** paginación · categorías · ingresos y egresos manuales
de stock · tablero con gráficos · gestión de usuarios · perfil · saldos ·
recibo imprimible · Zod compartido.

**Lo que no entre se documenta en el README citando su código RF.**

---

## 11. Interfaz (sección 8)

- **Diseño propio.** Las pantallas del profesor son referencia de *contenido*,
  no de diseño. **No copiar el mockup.**
- **Consistencia:** mismos colores, tipografía, botones y espaciado. Módulo
  activo resaltado.
- **Adaptable:** usable desde 360 px. El panel lateral se colapsa en menú.
- **Estados completos:** carga, vacío y error en cada listado. Cada operación
  confirma su resultado.
- **Validación en ambos lados**, con las mismas reglas.
- **Confirmación** de acciones irreversibles: anular, dar de baja, desactivar.
- **Venta ágil:** la pantalla de nueva venta se opera con teclado.
- **Formatos locales:** `$ 12.345,50`, `dd/mm/aaaa`, hora de Argentina. Todos en
  `lib/formato.ts`; los componentes no formatean por su cuenta.
- Las páginas de lectura son **Server Components**; los componentes
  interactivos, Client Components chicos.

---

## 12. Datos de prueba (sección 8)

Mínimo: **2 usuarios** (uno por rol), **5 categorías**, **30 productos**,
**10 clientes** y **50 facturas repartidas en los últimos 30 días**.

El seed los crea **usando los servicios**, no escribiendo directo en las tablas.

---

## 13. Secretos

Credenciales de Turso y contraseñas iniciales en `.env.local`, ignorado por Git.
En producción, variables de entorno de Vercel. La entrega incluye un
**`.env.example`** con los nombres pero sin los valores, y los usuarios de
prueba por rol.

---

## 14. Registro de errores de la IA

Cuando un agente se equivoque y haya que corregirlo, anotarlo en `NOTAS-IA.md`:
fecha, qué hizo mal, cómo se corrigió.

El profesor pregunta textualmente: *"muestren algo que el agente hizo mal y cómo
lo corrigieron"*.
