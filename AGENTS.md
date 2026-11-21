# AGENTS.md — Sistema de Gestión Comercial

Instrucciones para cualquier agente de IA que trabaje en este repositorio.
**Leer este archivo completo antes de escribir código.**

Repositorio: `github.com/agustinmed13/sistema-ventas`

---

## 0. La consigna oficial

La consigna es **`requerimientos.md`**, en la raíz del repositorio de la
cátedra: `github.com/AlejandroDiBattista/tup26-p4`. Está fechada el 29 de
octubre de 2026 y reúne el enunciado, las pautas de arquitectura, la API REST y
los entregables.

> **Atención:** existe otro archivo, `parcial/segundo-parcial.md`, que describe
> un alcance más chico. **No es la consigna.** Ante cualquier diferencia manda
> `requerimientos.md`.

Cada requerimiento tiene un código (`RF-V1`, `RF-P3`, etc.) para citarlo en el
README y en la corrección. Usalos.

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
- Código repetido y claro es mejor que abstracto y corto.
- Comentar en español las partes no obvias, sobre todo las reglas de negocio.

---

## 2. Stack — obligatorio, no cambiar

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
| Hosting | Vercel | Obligatorio |

**Autenticación:** sesión propia con tabla `sesiones` + cookie `HttpOnly`. Ya
está implementada. La consigna la acepta explícitamente como alternativa a
Auth.js. **No instalar NextAuth.**

**No usar Server Actions para las operaciones de negocio.** Todo pasa por la
API REST: la consigna lo exige y en la defensa preguntan por las rutas.

---

## 3. Reglas de trabajo

1. **No instalar dependencias** sin que la persona lo apruebe explícitamente.
2. **No tocar archivos fuera del módulo asignado** (ver sección 8).
3. **No refactorizar de más.** Si se pide arreglar un formulario, arreglar ese
   formulario.
4. **Trabajar por etapas.** Entregar una pieza funcionando, explicarla, y
   recién después seguir.
5. **Explicar siempre:** qué archivo se tocó, qué hace cada bloque importante,
   por qué se eligió esa forma.
6. **No asumir que algo funciona.** Dar el comando exacto y esperar que la
   persona reporte el resultado.
7. **Anotar los errores propios** en `NOTAS-IA.md` (fecha, qué salió mal, cómo
   se corrigió). El profesor lo pregunta en la defensa.

---

## 4. Estructura

```
app/
  login/                 Única página pública
  (app)/
    layout.tsx           Panel lateral + barra superior + protección
    page.tsx             Tablero de inicio
    ventas/
    productos/
    clientes/
    usuarios/
    perfil/
  api/
    sesion/
    usuarios/
    categorias/
    productos/
    movimientos-stock/
    clientes/
    facturas/
db/
  schema.ts              Las tablas
  index.ts               Conexión (único lugar)
  seed.ts                Datos de prueba
lib/
  auth.ts                Sesión, contraseñas, permisos
  errores.ts             Respuestas de error
  formato.ts             Importes y fechas
components/              Componentes compartidos
docs/                    Explicaciones para el grupo
```

---

## 5. Modelo de datos

Según la sección 7 de la consigna. Todas las tablas llevan `id` y fecha de
creación. Los importes van en **centavos enteros**.

| Tabla | Guarda |
|---|---|
| `usuarios` | email (único), nombre, hash de contraseña, rol, activo |
| `sesiones` | token, usuario, vencimiento |
| `categorias` | nombre (único), activa |
| `productos` | código (único), descripción, precio, existencia, stock mínimo, activo, categoría |
| `movimientos_stock` | tipo, cantidad con signo, existencia resultante, motivo, fecha, producto, usuario, factura opcional |
| `clientes` | tipo y número de documento (único), nombre, domicilio, teléfono, email, cuenta corriente habilitada, límite de crédito, activo |
| `facturas` | punto de venta, número, fecha, total, forma de pago, datos de tarjeta, monto recibido, estado, motivo de anulación, cliente opcional, usuario |
| `factura_items` | cantidad, precio unitario, subtotal, descripción (copiada), factura, producto |
| `pagos` | número de recibo, fecha, importe, medio, observación, cliente, usuario |
| `movimientos_cuenta` | tipo (débito/crédito), importe, fecha, descripción, cliente, factura o pago de origen |

**Roles:** `admin` y `vendedor`. El vendedor opera el mostrador pero no toca
configuración, stock ni anulaciones.

---

## 6. Reglas de negocio

Se validan **en el servidor**. La interfaz puede adelantarlas, pero no las
reemplaza.

1. **La existencia nunca es negativa.** Se controla al cargar el ítem y otra
   vez al confirmar.
2. **Todo cambio de stock deja un movimiento**, en la misma transacción que
   actualiza la existencia.
3. **El precio se congela.** La factura guarda el precio del momento.
4. **Numeración correlativa y sin huecos**, formato `0001-00000001`. Se asigna
   al confirmar, no al empezar.
5. **Una factura confirmada no se modifica.** Solo se anula, y la anulación
   revierte stock y saldo.
6. **Consumidor final no compra en cuenta corriente.**
7. **Saldo = débitos − créditos.** Si el cliente tiene límite de crédito, una
   venta a cuenta no puede superarlo.
8. **Un pago no supera la deuda.** No hay saldos a favor.
9. **De la tarjeta solo se guardan tipo, marca y últimos 4 dígitos.**
10. **Importes en centavos enteros**, mostrados como `$ 12.345,50`.
11. **Trazabilidad:** facturas, movimientos y pagos registran usuario y fecha.
12. **Bajas lógicas.** Nunca se borra nada con historial.

---

## 7. Convenciones de la API

Rutas bajo `/api`, con `route.ts`. Cada operación verifica **en el servidor**
la sesión, los permisos y las reglas que correspondan.

**Verificación al empezar cada ruta, explícita:**

```ts
const usuario = await obtenerUsuarioActual();
if (!usuario) return errorNoAutorizado();
if (usuario.rol !== 'admin') return errorProhibido();
```

Nada de wrappers ni middleware. Tiene que poder señalarse el lugar exacto.

**Listados:** `{ datos: [...] }`

**Errores:**

```json
{
  "error": {
    "codigo": "STOCK_INSUFICIENTE",
    "mensaje": "No hay stock suficiente para Café molido 250 g.",
    "detalles": { "productoId": 1, "disponible": 3, "solicitado": 5 }
  }
}
```

| Código | Cuándo |
|---|---|
| `400` | JSON inválido o solicitud mal formada |
| `401` | Sin sesión válida o credenciales incorrectas |
| `403` | Sin permiso para la operación |
| `404` | El recurso no existe |
| `409` | Conflicto: código duplicado, stock insuficiente, pago mayor al saldo |
| `422` | Datos bien formados que violan una validación |
| `500` | Error inesperado — nunca exponer detalles internos |

**El servidor asigna**, el cliente nunca envía: `id`, usuario, número de
comprobante, número de recibo, fechas, existencia actualizada y totales
calculados.

---

## 8. Archivos compartidos — no tocar sin avisar

```
db/schema.ts
db/index.ts
db/seed.ts
lib/auth.ts
lib/errores.ts
lib/formato.ts
app/(app)/layout.tsx
components/
package.json
```

---

## 9. Reparto

| Integrante | Módulos |
|---|---|
| **Agustín** | Base de datos, seed, y **Ventas** (RF-V) |
| **Jazmín** | Interfaz general y layout, **Productos** (RF-P), **Usuarios** (RF-U4, U5) |
| **Majo** | **Clientes y cuenta corriente** (RF-C), **Tablero** (RF-T) |

---

## 10. Prioridades

El guion de la defensa define qué es obligatorio. Son cuatro operaciones que
tienen que funcionar sobre la URL pública:

1. Venta a consumidor final con efectivo
2. Venta a un cliente **nuevo** en cuenta corriente
3. Pago de ese cliente
4. **Anulación** de una factura

verificando stock y saldo después de cada paso.

**Imprescindible:** login y protección · catálogo · alta de clientes · nueva
venta con las tres formas de pago · comprobante · listado · anulación · cuenta
corriente · pagos.

**Si alcanza el tiempo, en este orden:** categorías · ingresos y egresos
manuales de stock · tablero con gráficos · gestión de usuarios · perfil ·
saldos · recibo imprimible · filtros y paginado.

**Lo que no entre se documenta en el README citando su código RF.** Un
requerimiento declarado como pendiente cuesta mucho menos que uno a medias que
se rompe en la demo.

---

## 11. Interfaz

De la sección 8 de la consigna:

- **Diseño propio.** Las pantallas del profesor son referencia de *contenido*,
  no de diseño. Está dicho explícitamente: cada equipo propone su propia
  presentación. **No copiar el mockup.**
- **Consistencia:** mismos colores, tipografía, botones y espaciado en todas
  las pantallas. Módulo activo resaltado en el panel lateral.
- **Adaptable:** usable desde 360 px. El panel lateral se colapsa en menú.
- **Estados completos:** cada listado contempla carga, vacío y error. Cada
  operación confirma su resultado.
- **Validación en ambos lados**, con las mismas reglas.
- **Confirmación** de acciones irreversibles: anular, dar de baja, desactivar.
- **Venta ágil:** la pantalla de nueva venta se opera con teclado.
- **Formatos locales:** `$ 12.345,50`, `dd/mm/aaaa`, hora de Argentina.

---

## 12. Datos de prueba

La consigna pide, como mínimo: **2 usuarios** (uno por rol), **5 categorías**,
**30 productos**, **10 clientes** y **50 facturas repartidas en los últimos 30
días**, para que el tablero muestre información desde el primer arranque.

---

## 13. Secretos

Credenciales de Turso y contraseñas iniciales en `.env.local`, ignorado por
Git. En producción, variables de entorno de Vercel. El primer administrador lo
crea el seed, con su contraseña fuera del repositorio. La entrega incluye un
`.env.example` y los usuarios de prueba por rol.

---

## 14. Registro de errores de la IA

Cuando un agente se equivoque y haya que corregirlo, anotarlo en `NOTAS-IA.md`:
fecha, qué hizo mal, cómo se corrigió.

El profesor pregunta textualmente: *"muestren algo que el agente hizo mal y cómo
lo corrigieron"*.
