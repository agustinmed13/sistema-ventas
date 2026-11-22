# La base de datos

Guía del modelo de datos para los tres integrantes. La defensa es individual y
sobre todo el sistema, así que cualquiera puede recibir una pregunta sobre esta
parte.

---

## 1. Los archivos

```
db/schema.ts    Las 10 tablas: columnas, tipos, claves y restricciones.
db/index.ts     La conexión a Turso. Exporta "db", que usan los servicios.
db/seed.ts      Carga los datos de prueba usando los servicios reales.
drizzle/        Las migraciones que genera drizzle-kit. No se editan a mano.
```

---

## 2. Cómo arrancar

```bash
npm install
npm run db:push     # crea las tablas en Turso
npm run db:seed     # carga los datos de prueba
npm run dev
```

Para mirar los datos con una interfaz:

```bash
npm run db:studio
```

---

## 3. Usamos Turso siempre, también en desarrollo

No hay base local. La misma base de Turso sirve para desarrollo y para el sitio
de Vercel.

**Ventaja:** lo que se prueba en la máquina es exactamente lo que se ve en el
sitio público. No hay sorpresas de "en mi máquina andaba".

**Cuidado:** si alguien corre `npm run db:seed`, **borra y recarga los datos de
todos**. Avisar en el grupo antes de hacerlo.

---

## 4. Las 10 tablas

| Tabla | Guarda | Restricciones |
|---|---|---|
| `usuarios` | email, nombre, hash de contraseña, rol, activo | `email` único; `rol` es `admin` o `vendedor` |
| `sesiones` | token, usuario, vencimiento | El token es la clave primaria |
| `categorias` | nombre, activa | `nombre` único |
| `productos` | código, descripción, precio, existencia, stock mínimo, categoría | `codigo` único |
| `clientes` | tipo y número de documento, nombre, contacto, cuenta corriente, límite | `(tipo_documento, numero_documento)` único |
| `facturas` | punto de venta, número, fecha, total, forma de pago, tarjeta, estado | `(punto_venta, numero)` único |
| `factura_items` | cantidad, precio unitario, subtotal, descripción **copiada** | — |
| `movimientos_stock` | tipo, cantidad **con signo**, existencia resultante, motivo | — |
| `pagos` | número de recibo, fecha, importe, medio, cliente, usuario | `numero_recibo` único |
| `movimientos_cuenta` | tipo (débito/crédito), importe, descripción, origen | — |

---

## 5. Las cinco decisiones importantes

### 5.1 Los importes se guardan en centavos enteros

`$ 12.345,50` se guarda como `1234550`.

**Por qué:** los números con decimales de la computadora son aproximados.
`0.1 + 0.2` no da exactamente `0.3`. En una factura, ese error se acumula
renglón por renglón y el total termina dando mal por centavos.

Con enteros no hay aproximación: una suma de enteros da siempre el entero
exacto. Es la regla 10 de la consigna.

La conversión a `$ 12.345,50` ocurre **solo al mostrar**, en
`lib/formato.ts`. Ningún componente formatea por su cuenta.

### 5.2 `factura_items` guarda una copia de la descripción y el precio

Podría guardar solo el `producto_id` y leer el nombre y el precio actuales.
**No lo hace a propósito.**

Si mañana el producto sube de precio o le cambian la descripción, una factura
vieja tiene que seguir mostrando lo que decía el día que se emitió. Es la
regla 3: el precio se congela.

Por eso `factura_items` tiene `descripcion` y `precio_unitario_centavos`
propios, copiados en el momento de la venta.

### 5.3 El stock se guarda, el saldo se calcula

Son dos decisiones distintas, y es la pregunta de defensa más probable de
esta sección.

**La existencia se guarda** en una columna de `productos`. Se necesita leer
rápido, en cada búsqueda de producto, y la condición `WHERE existencia >= ?`
necesita una columna real.

**El saldo del cliente NO se guarda.** Se calcula sumando
`movimientos_cuenta`: débitos menos créditos (regla 7).

**¿Por qué distinto?** Un dato guardado puede quedar desincronizado. Si el
saldo viviera en una columna y un pago fallara a mitad de camino, quedaría
mintiendo para siempre y nadie se enteraría. Calculándolo, siempre es correcto
por construcción.

El riesgo equivalente en el stock se controla de otra forma: **cada cambio de
existencia graba un movimiento en la misma transacción**, así la suma de
`movimientos_stock` tiene que dar siempre la existencia guardada. Si no da,
hay un bug. Es el punto 5 de la lista de control de la sección 10.8, y el
seed lo verifica al final.

### 5.4 La cantidad de los movimientos de stock va con signo

Una venta de 2 unidades graba `-2`. La anulación de esa venta graba `+2`.

Así la suma de todos los movimientos de un producto da su existencia actual,
sin tener que mirar el tipo de cada uno.

### 5.5 Las sesiones son una tabla, no una librería

No usamos NextAuth. Hay una tabla `sesiones` y una cookie `HttpOnly` con
`SameSite=Lax`. La consigna lo acepta como alternativa (sección 2).

- **`HttpOnly`** significa que el JavaScript de la página no puede leer la
  cookie. Si alguien lograra inyectar código en el sitio, no podría robar la
  sesión.
- **`SameSite=Lax`** significa que la cookie no viaja en pedidos que vienen de
  otro sitio. Evita que una página ajena haga operaciones en nombre del
  usuario.

Cerrar sesión borra la fila de `sesiones`, así que la sesión muere del lado
del servidor, no solo en el navegador.

---

## 6. Cómo agregar un campo a una tabla

1. Agregar la columna en `db/schema.ts`.
2. `npm run db:generate` — drizzle-kit arma el archivo de migración.
3. `npm run db:push` — lo aplica en Turso.
4. Commitear **el schema y la migración juntos**.

**Nunca** editar a mano los archivos de `drizzle/`: los genera la herramienta.

**Avisar antes**, porque `db/schema.ts` es un archivo compartido (sección 9
del AGENTS.md).

---

## 7. Las credenciales

Las de Turso están en `.env.local`, que está en `.gitignore` y **no se sube**.
En producción, las mismas variables se cargan en Vercel.

La entrega incluye un `.env.example` con los **nombres** de las variables pero
sin los valores, más los usuarios de prueba por rol (sección 13).

---

## 8. Los datos de prueba

El seed crea, como mínimo: 2 usuarios (uno por rol), 5 categorías,
30 productos, 10 clientes y 50 facturas repartidas en los últimos 30 días.

**Lo importante:** el seed **no escribe directo en las tablas**. Llama a los
mismos servicios que usa la aplicación — `crearFactura()`, `moverStock()`,
`registrarPago()`.

**Por qué importa:** si escribiera directo, podría generar datos imposibles:
clientes debiendo más que su límite, stock que no coincide con sus
movimientos, facturas sin ítems. Pasando por los servicios, los datos de
prueba cumplen todas las reglas por construcción.

De hecho, cuando se reescribió así, el seed **descartó tres ventas** que
superaban el límite de crédito del cliente. Antes esas ventas se grababan
igual y dejaban la base en un estado que el sistema real nunca habría
permitido.

Es lo que pide la sección 10.7 de la consigna.

---

## 9. Preguntas de defensa que cubre este tema

| Pregunta | Dónde está la respuesta |
|---|---|
| ¿Por qué centavos enteros? | 5.1 |
| ¿Por qué `factura_items` repite la descripción? | 5.2 |
| ¿Por qué el saldo no está guardado? | 5.3 |
| ¿Cómo sabés que el stock es correcto? | 5.3 — suma de movimientos |
| ¿Por qué la cantidad va con signo? | 5.4 |
| ¿Por qué no usaron NextAuth? | 5.5 |
| ¿Cómo agregás un campo? | 6 |
| ¿Dónde están las contraseñas? | 7 |
| ¿Por qué el seed usa los servicios? | 8 |
