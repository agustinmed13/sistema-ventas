# Módulo de Ventas (RF-V)

Guía del módulo de facturación para los tres integrantes. La defensa es
individual y sobre **todo** el sistema: cualquiera puede recibir una pregunta
sobre esta parte, aunque no la haya escrito.

Está escrita para leerse en diez minutos y poder contestar sin abrir el código.

---

## 1. Qué hace el módulo

Tres operaciones:

| Operación | Función | Ruta |
|---|---|---|
| Emitir una factura | `crearFactura()` | `POST /api/facturas` |
| Listar y buscar | `listarFacturas()` | `GET /api/facturas` |
| Ver un comprobante | `obtenerFactura()` | `GET /api/facturas/{id}` |
| Anular | `anularFactura()` | `POST /api/facturas/{id}/anulacion` |

---

## 2. Dónde está cada cosa

```
lib/servicios/facturas.ts     Las reglas. Todo el peso está acá.
lib/servicios/stock.ts        moverStock(): el único lugar que cambia la existencia.
app/api/facturas/             Adaptadores finos. Ninguno tiene reglas adentro.
app/(app)/ventas/             Pantallas: listado, nueva venta, comprobante.
```

**La regla de oro:** si te preguntan "¿dónde está la regla tal?", la respuesta
casi siempre es `lib/servicios/facturas.ts`. Las rutas no deciden nada.

---

## 3. El recorrido de una venta

```
Pantalla          POST /api/facturas con { clienteId, items, pago }
    ↓
Ruta              Exige sesión. Lee el JSON. Llama al servicio. Nada más.
    ↓
Servicio          Valida → abre la transacción → aplica las reglas → devuelve
    ↓
Base de datos     facturas, factura_items, movimientos_stock, movimientos_cuenta
```

### Lo que manda la pantalla

```json
{
  "clienteId": 7,
  "items": [{ "productoId": 12, "cantidad": 2 }],
  "pago": { "forma": "contado", "montoRecibido": 1000000 }
}
```

**La pantalla NO manda precios ni el total.** Los calcula el servidor leyendo
el precio de la base (sección 11.1 de la consigna). Si los mandara, cualquiera
podría cambiarlos desde el navegador y comprar a un peso.

De hecho el servicio **rechaza** cualquier campo que no esté en esta lista:

```ts
const CAMPOS_PERMITIDOS = ['clienteId', 'items', 'pago'];
```

Si llega `total` o `precio`, responde `422` en vez de ignorarlo en silencio.
Es mejor fallar fuerte que grabar algo raro sin que nadie se entere.

---

## 4. La transacción: el corazón del módulo

Una venta toca **cuatro tablas**: `facturas`, `factura_items`,
`movimientos_stock` y, si es en cuenta corriente, `movimientos_cuenta`.

Las cuatro pasan dentro de una sola transacción:

```ts
const facturaId = await db.transaction(async (tx) => {
  ...
});
```

### Qué es una transacción

Un "todo o nada". La base anota los cambios pero no los confirma hasta el
final. Si en el medio algo falla, los deshace **todos**.

Sin transacción podrían quedar estados imposibles: una factura sin ítems,
stock descontado sin factura, una deuda sin venta que la justifique.

### Cómo se corta

Lanzando un error:

```ts
throw new ApiError(409, 'STOCK_INSUFICIENTE', '...');
```

Drizzle ve el `throw`, deshace todo (*rollback*) y vuelve a lanzar el error.
La ruta lo atrapa y lo convierte en respuesta.

### El detalle que más se pregunta

Adentro de la transacción se usa **siempre `tx`, nunca `db`**. `tx` es la
conexión que está dentro de la transacción; `db` es la de afuera. Una consulta
hecha con `db` adentro de una transacción **no se desharía** si algo falla.

---

## 5. Las reglas y dónde viven

| Regla | Qué dice | Dónde está |
|---|---|---|
| 1 | La existencia nunca es negativa | `moverStock()`, con `WHERE existencia >= ?` |
| 2 | Todo cambio de stock deja un movimiento | `moverStock()`, misma transacción |
| 3 | El precio se congela | `factura_items` guarda `precioUnitarioCentavos` y la descripción copiada |
| 4 | Numeración correlativa sin huecos | El número se asigna dentro de la transacción |
| 5 | Una factura confirmada no se modifica | Solo `anularFactura()` |
| 6 | Consumidor final no compra en cuenta corriente | `crearFactura()`, antes de la transacción |
| 7 | Saldo = débitos − créditos, con límite | `crearFactura()`, dentro de la transacción |
| 9 | De la tarjeta solo tipo, marca y últimos 4 | La validación del pago |
| 11 | Trazabilidad: quién y cuándo | Cada insert graba `usuarioId` y `fecha` |
| 12 | Bajas lógicas | La anulación marca `estado`, no borra |

---

## 6. Las tres cosas que más se preguntan

### 6.1 ¿Por qué el número de factura se asigna al final?

```ts
const [ultima] = await tx
  .select({ maximo: max(facturas.numero) })
  .from(facturas)
  .where(eq(facturas.puntoVenta, PUNTO_VENTA));
const numero = (ultima.maximo ?? 0) + 1;
```

Porque está **dentro** de la transacción. Si la venta falla después (no hay
stock, se excede el límite), el número no se "gasta": la transacción se
deshace y el siguiente intento vuelve a tomar el mismo número.

Si se asignara antes, cada venta fallida dejaría un hueco en la numeración, y
la regla 4 dice que no puede haber huecos.

**Esto está probado:** una venta que falló no consumió número. La siguiente
factura exitosa salió con el número que le tocaba, no con uno más adelante.

### 6.2 ¿Qué pasa si dos vendedores venden la última unidad al mismo tiempo?

Sale **una sola factura**. Lo garantiza `moverStock()`:

```ts
UPDATE productos
SET existencia = existencia - 2
WHERE id = 12 AND existencia >= 2
```

La comprobación y la resta ocurren en la **misma** operación. No hay hueco
entre "leer" y "restar" donde se pueda colar otro pedido.

Si se hiciera leyendo primero:

```
Queda 1 unidad.
  Vendedor A lee: hay 1, alcanza.
  Vendedor B lee: hay 1, alcanza.
  A resta → queda 0.    B resta → queda -1.   ← stock negativo
```

Con el UPDATE condicional, el segundo ya ve `existencia = 0`, la condición
`0 >= 1` es falsa, no modifica ninguna fila, y el servicio lanza
`409 STOCK_INSUFICIENTE`.

Es el punto 4 de la lista de control de la sección 10.8.

### 6.3 ¿Qué hace exactamente una anulación?

Tres cosas, en una transacción:

1. **Marca la factura** como anulada, con el motivo, la fecha y quién la anuló.
   No la borra (regla 12).
2. **Devuelve el stock**: por cada ítem llama a `moverStock()` con cantidad
   **positiva**. La venta había grabado `-2`, la anulación graba `+2`, así la
   suma de movimientos sigue dando la existencia real.
3. **Acredita la cuenta** si fue en cuenta corriente, para que la deuda baje.

Y usa el mismo truco del UPDATE condicional para no anular dos veces:

```ts
.where(and(eq(facturas.id, factura.id), eq(facturas.estado, 'emitida')))
```

Si dos pedidos de anulación llegaran juntos, solo el primero encuentra la fila
en estado `emitida`. El segundo modifica cero filas y se corta **antes** de
devolver stock. Sin eso, el stock volvería dos veces.

---

## 7. La frase para acordarse

> **La base garantiza, el servicio explica.**

El UPDATE condicional y los índices únicos son los que realmente impiden el
error. Las verificaciones del servicio existen para devolver un mensaje claro
(`409 STOCK_INSUFICIENTE`) en vez de un error crudo de la base.

Si te preguntan "¿y si fallan los dos controles al mismo tiempo?", la respuesta
es que la base no deja, porque la condición está en el `WHERE`.

---

## 8. Cómo probarlo a mano

```bash
# 1. Iniciar sesión y guardar la cookie
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mostrador.test","contrasena":"LA-QUE-ESTE-EN-EL-README"}'

# 2. Vender
curl -b cookies.txt -X POST http://localhost:3000/api/facturas \
  -H "Content-Type: application/json" \
  -d '{"clienteId":null,"items":[{"productoId":35,"cantidad":1}],
       "pago":{"forma":"contado","montoRecibido":5000000}}'

# 3. Anular (poné el id que devolvió el paso 2)
curl -b cookies.txt -X POST http://localhost:3000/api/facturas/1/anulacion \
  -H "Content-Type: application/json" \
  -d '{"motivo":"Prueba"}'
```

Probar con `curl` y no desde la pantalla demuestra que **la regla está en el
servidor**, no en el formulario. Es lo que pide el punto 1 de la lista de
control.
