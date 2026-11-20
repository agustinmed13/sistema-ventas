# AGENTS.md — Sistema de Gestión Comercial

Instrucciones para cualquier agente de IA que trabaje en este repositorio.
**Leer este archivo completo antes de escribir código.**

Repositorio: `github.com/agustinmed13/sistema-ventas`

---

## 1. Qué es este proyecto

Segundo parcial de Programación IV (TUP26, UTN FRT, Ing. Alejandro Di Battista).

Sistema web de gestión comercial: ventas, catálogo de productos, control de stock
y cuentas corrientes de clientes.

- **Grupo de 3 personas**, cada una trabajando con su propio agente de IA.
- **Fecha de defensa: jueves 26 de noviembre de 2026.**
- La defensa es **individual**: cada integrante responde preguntas sobre
  *cualquier* parte del sistema, muestra en el código dónde está lo que se le
  pregunta, y hace un cambio pequeño pedido en el momento.
- **El grupo se coordina solo por texto.** No hay llamadas ni reuniones
  presenciales. Esto condiciona todo lo demás (ver sección 3).

### Qué significa eso para el agente

El objetivo no es código que funcione: es código que un estudiante de nivel
básico-intermedio pueda **leer, explicar y modificar bajo presión**, incluso si no
lo escribió.

- Preferir siempre la solución **simple y explícita** sobre la elegante.
- No usar patrones, abstracciones ni librerías que no sean necesarias.
- Si hay dos formas de hacer algo, elegir la que sea más fácil de explicar.
- Código repetido y claro es mejor que código abstracto y corto.
- Comentar en español las partes no obvias, sobre todo las reglas de negocio.
- **Menos código es mejor.** Cada línea de más es una línea que otra persona
  tiene que entender leyendo, sin poder preguntar en el momento.

---

## 2. Stack — fijo, no cambiar

| Capa | Herramienta |
|---|---|
| Framework | Next.js 16 (App Router) |
| Lenguaje | **JavaScript** (no TypeScript) |
| API | Route Handlers en `app/api/...` — **API REST, no Server Actions** |
| Base de datos | SQLite local en desarrollo, Turso en producción |
| ORM | Drizzle |
| Estilos | Tailwind CSS — ya instalado por el generador, no reinstalar |
| Publicación | Vercel |

**No usar NextAuth ni ninguna librería de autenticación.** La sesión se
implementa a mano (tabla `sesiones` + cookie `HttpOnly`) porque el grupo tiene
que poder explicar línea por línea dónde se verifica la sesión.

**No usar Server Actions para las operaciones de negocio.** El profesor pregunta
textualmente "¿dónde se expone la API REST para agregar un producto?". Tiene que
haber rutas REST reales.

El proyecto se creó con `create-next-app` 16.4.6. Si algo de la documentación de
Next.js 15 no coincide, mandan la versión 16 y el código que ya está en el repo.

---

## 3. Cómo trabaja este grupo (solo texto)

No hay llamadas. Todo el entendimiento se transfiere por escrito. Tres reglas
obligatorias:

### 3.1 Cada parte compartida se documenta

Quien escribe la base de datos, el login o las ventas deja además un archivo
corto en `docs/` explicándolo: qué hace, dónde está, y por qué se hizo así.
Pensado para alguien que lo lee sin poder preguntar nada.

- `docs/base-de-datos.md`
- `docs/autenticacion.md`
- `docs/ventas.md`
- `docs/defensa.md` ← el mapa de preguntas (ver 3.3)

Cortos. Con ejemplos concretos. Si un diagrama lo explica mejor que tres
párrafos, va el diagrama.

### 3.2 Pull requests con pregunta obligatoria

Nadie mergea su propio código. Antes de aprobar, quien revisa escribe **una
pregunta** sobre lo que leyó, y quien lo escribió la responde en el PR.

Queda por escrito y obliga a leer. Es el reemplazo directo de la revisión cara a
cara.

### 3.3 El mapa de defensa

`docs/defensa.md` lista las preguntas del README del profesor y, al lado de cada
una, **el archivo y la línea donde está la respuesta**. Lo completa quien escribió
cada parte, a medida que la escribe — no al final.

---

## 4. Estructura de carpetas

```
app/
  login/                 Pantalla de acceso
  (app)/                 Pantallas con menú lateral
    ventas/
    productos/
    clientes/
  api/
    sesion/
    usuarios/
    productos/
    movimientos-stock/
    clientes/
    ventas/
db/
  schema.js              Definición de las tablas (Drizzle)
  index.js               Conexión a la base
  seed.js                Datos de prueba y primer administrador
lib/
  auth.js                Sesión, hash de contraseñas, permisos
  formato.js             Importes y fechas
  errores.js             Construcción de respuestas de error
components/              Componentes compartidos
docs/                    Explicaciones para el grupo (ver sección 3)
```

---

## 5. Convenciones de la API

**La referencia es `parcial/api-rest-sistema-ventas.md` del repositorio del
profesor.** Ante cualquier duda, ese documento manda. Rutas acordadas:

```
POST   /api/sesion                          iniciar sesión
GET    /api/sesion                          usuario actual
DELETE /api/sesion                          cerrar sesión

GET    /api/usuarios?q=            (admin)
POST   /api/usuarios               (admin)
GET    /api/usuarios/:id           (admin)
PATCH  /api/usuarios/:id           (admin)

GET    /api/productos?q=
POST   /api/productos
GET    /api/productos/:id
PATCH  /api/productos/:id

GET    /api/movimientos-stock?productoId=
POST   /api/movimientos-stock

GET    /api/clientes?q=
POST   /api/clientes
GET    /api/clientes/:id
PATCH  /api/clientes/:id

GET    /api/ventas
POST   /api/ventas
GET    /api/ventas/:id

GET    /api/clientes/:id/cuenta-corriente
POST   /api/clientes/:id/pagos
```

### Formato de respuestas

Listados:

```json
{ "datos": [ ... ] }
```

Errores:

```json
{
  "error": {
    "codigo": "STOCK_INSUFICIENTE",
    "mensaje": "No hay stock suficiente para Café molido 250 g.",
    "detalles": { "productoId": 1, "disponible": 3, "solicitado": 5 }
  }
}
```

### Códigos HTTP

| Código | Cuándo |
|---|---|
| `400` | JSON inválido o solicitud mal formada |
| `401` | Sin sesión válida o credenciales incorrectas |
| `403` | Sin permiso para la operación |
| `404` | El recurso no existe |
| `409` | Conflicto: código duplicado, stock insuficiente, pago mayor al saldo |
| `422` | Datos bien formados que violan una regla de validación |
| `500` | Error inesperado — nunca exponer detalles internos |

Respuesta exitosa sin contenido: `204`, sin cuerpo.

---

## 6. Convenciones de datos

- **Los importes se guardan en centavos enteros.** `650000` = $ 6.500,00. Los
  campos terminan en `Centavos` (`precioCentavos`, `totalCentavos`,
  `importeCentavos`). Nunca decimales: en JavaScript `0.1 + 0.2` no da `0.3`, y
  esos errores se acumulan en los totales.
- La interfaz muestra pesos; convierte a centavos antes de llamar la API.
- Las cantidades son **enteros positivos**. El stock puede ser cero, nunca
  negativo.
- Fechas en **ISO 8601 con zona** (`2026-11-26T14:30:00Z`).
- La búsqueda `q` no distingue mayúsculas ni acentos. `q` vacío devuelve todo.
- El código de producto es único sin distinguir mayúsculas.
- Nombres en **español**, `camelCase` en JavaScript, `snake_case` en las columnas
  de la base.

### Lo que el servidor asigna, no el cliente

El cliente **nunca** envía: `id`, `usuarioId`, número de comprobante, fecha de
ventas y movimientos, stock actualizado, ni totales calculados. Todo eso lo
determina el servidor. Si el cliente manda un campo de solo lectura o
desconocido: `422`.

---

## 7. Tablas

Nombres acordados. **Los campos se definen en conjunto — ningún agente los define
por su cuenta.**

| Tabla | Qué guarda |
|---|---|
| `usuarios` | nombre, acceso, hash de contraseña, perfil, activo |
| `sesiones` | token, usuarioId, expiración |
| `productos` | código, nombre, precioCentavos, stock, activo |
| `clientes` | nombre o razón social, documento, contacto |
| `ventas` | número, fecha, clienteId, totalCentavos, formaPago, usuarioId |
| `venta_detalles` | ventaId, productoId, descripción, cantidad, precio, subtotal |
| `movimientos_stock` | productoId, tipo, cantidad, motivo, origen, fecha |
| `pagos` | clienteId, fecha, importeCentavos, observación |

### Dos reglas de modelado que se van a preguntar en la defensa

- **`venta_detalles` guarda copia de la descripción y el precio**, no solo el
  `productoId`. Si mañana cambia el precio o el nombre del producto, el
  comprobante viejo tiene que seguir mostrando los datos del momento de la venta.
- **El saldo del cliente se calcula** (ventas en cuenta corriente − pagos), no se
  guarda en una columna. El stock del producto sí se guarda, y se actualiza
  dentro de la misma transacción que el movimiento.

---

## 8. Archivos compartidos — no tocar sin avisar al grupo

```
db/schema.js
db/index.js
db/seed.js
lib/auth.js
lib/formato.js
lib/errores.js
app/(app)/layout.js
components/
package.json
```

Si un cambio necesita tocar uno de estos, el agente lo plantea y la persona lo
coordina por WhatsApp antes de hacerlo. Es la causa más común de que tres
personas se pisen el trabajo.

---

## 9. Plan y reparto

| Día | Qué | Quién |
|---|---|---|
| Vie 20 | Proyecto, repo, Turso, deploy vacío en Vercel | Agustín |
| Sáb 21 | Base de datos + datos de prueba + `docs/base-de-datos.md` | Agustín |
| Dom 22 | Login, sesión, permisos, layout + `docs/autenticacion.md` | Agustín |
| Lun 23 | Módulos repartidos (ver abajo) | Cada una |
| Mar 24 | Ventas + `docs/ventas.md` | A definir |
| Mié 25 | README, datos en producción, `docs/defensa.md`, cambios cruzados | Las tres |
| Jue 26 | **Defensa** | — |

**Módulos del lunes:**

| Módulo | Contenido |
|---|---|
| **A** | Productos: listado, búsqueda, alta, edición, activar/desactivar |
| **B** | Clientes: listado, búsqueda, alta, edición + cuenta corriente y pagos |
| **C** | Layout, menú lateral, componentes compartidos, formato de importes y fechas |

**El miércoles cada integrante hace un cambio pequeño en un módulo que NO
escribió** y manda captura de que funciona, más una explicación escrita de qué
tocó y por qué. Es exactamente lo que el profesor pide en la defensa.

---

## 10. Reglas de negocio que no se negocian

Estas son las que el profesor pregunta y evalúa:

1. **La venta es atómica.** Al confirmar: se registra el comprobante, se descuenta
   el stock y, si es cuenta corriente, se genera la deuda. Las tres cosas en una
   transacción: o pasan todas o no pasa ninguna.
2. **El stock nunca queda negativo.** Se verifica en el servidor, dentro de la
   transacción, no solo en la interfaz.
3. **Cuenta corriente solo para clientes registrados.** Un consumidor final no
   puede comprar a crédito.
4. **No se admite un pago mayor al saldo adeudado.**
5. **Un producto inactivo** no se puede agregar a ventas nuevas, pero sigue
   apareciendo en los comprobantes anteriores.
6. **Los permisos se verifican en el servidor.** Ocultar un botón no es seguridad:
   un operador que llame directamente a `/api/usuarios` debe recibir `403`.
7. **Las contraseñas nunca se guardan en texto plano**, y las respuestas de la API
   nunca incluyen la contraseña ni su hash.
8. **No se piden ni se guardan números de tarjeta.** El pago con tarjeta se
   registra de forma simulada.
9. **Sin anulación, edición ni devolución** de ventas y pagos confirmados. Están
   fuera del alcance del parcial.

---

## 11. Alcance recortado — qué NO se implementa

El grupo tiene 6 días y se coordina solo por texto. Un sistema más chico que las
tres puedan defender vale más que uno completo que solo una entiende. El
enunciado pide declarar lo pendiente en el README, así que **lo recortado se
documenta, no se esconde**.

**Recortado a propósito:**

- **Pantalla de administración de usuarios.** El administrador y un operador se
  crean por `seed`, documentado en el README. Las rutas `/api/usuarios` con
  verificación de permisos **sí se implementan**: son la prueba de que los
  permisos se controlan en el servidor, y eso se pregunta en la defensa.
- **Formulario de entrada y salida manual de stock.** El historial de movimientos
  sí existe — lo generan las ventas y el stock inicial del seed.

**Fuera del alcance según el enunciado:**

- Impuestos, descuentos, devoluciones, anulaciones
- Pagos combinados, cuotas, intereses, imputación de un pago a una factura
- Múltiples empresas, depósitos o monedas
- Integración con ARCA o comprobantes fiscales
- Límite de crédito por cliente
- Paginación de listados

**Opcionales — solo si todo lo obligatorio ya funciona:** panel de indicadores,
gráficos, filtros de ventas, impresión del comprobante, roles configurables.

> Si el profesor pregunta por el límite de crédito o por la anulación de
> facturas, la respuesta correcta es que están fuera del alcance definido en el
> enunciado. No implementarlos.

---

## 12. Secretos

Las credenciales de Turso y el secreto de sesión van en `.env.local`, que está en
`.gitignore` y **nunca se commitea**. En producción se cargan como variables de
entorno en Vercel. El primer administrador se crea con el script de seed, con su
contraseña configurada fuera del repositorio.

---

## 13. Registro de errores de la IA

Cuando un agente se equivoque y haya que corregirlo, anotarlo en `NOTAS-IA.md`:
fecha, qué hizo mal, cómo se corrigió.

El profesor pregunta textualmente: *"muestren algo que el agente hizo mal y cómo
lo corrigieron"*. Si no se anota sobre la marcha, el jueves no se va a acordar
nadie.
