# La base de datos

Qué hay, dónde está y por qué se hizo así.
Escrito para que puedan entenderlo sin tener que preguntar nada.

---

## Los archivos

| Archivo | Qué hace |
|---|---|
| `db/schema.js` | Define las 8 tablas: nombres, columnas y relaciones |
| `db/index.js` | **El único lugar donde la app se conecta a la base** |
| `db/seed.mjs` | Carga los datos de prueba |
| `drizzle.config.js` | Config de la herramienta que crea las tablas |
| `drizzle/0000_*.sql` | La migración: el SQL que creó las tablas |
| `.env.local` | Las credenciales. **No está en el repo**, cada uno tiene el suyo |

---

## Cómo arrancar

1. Clonar el repo y correr `npm install`.
2. Pedirle a Agustín el contenido del `.env.local` (por privado, no por el grupo).
3. Crear el archivo `.env.local` en la raíz del proyecto con eso.
4. `npm run dev` y entrar a `http://localhost:3000`.

Las tablas **ya están creadas** en Turso. No hace falta que corran migraciones.

Si en algún momento los datos quedan hechos un desastre probando:

```
npm run db:seed
```

Eso borra todo y vuelve a cargar el estado inicial. Ojo: **borra para todos**, porque la base es compartida. Avisen antes.

---

## Usamos Turso siempre, también en desarrollo

No hay base local. Las tres trabajamos contra la misma base en la nube.

Ventaja: lo que carga una, lo ven las otras, y desaparece el error de "en mi máquina anda y publicado no".

Desventaja: si una borra datos, los borra para todas. Por eso avisar antes de correr el seed.

---

## Las 8 tablas

| Tabla | Guarda |
|---|---|
| `usuarios` | Quiénes pueden entrar. Nombre, acceso, hash de contraseña, perfil, activo |
| `sesiones` | Una fila por sesión abierta. El token, de quién es y cuándo vence |
| `productos` | El catálogo. Código, nombre, precio, stock, activo |
| `clientes` | Nombre o razón social, documento, teléfono, correo |
| `ventas` | La cabecera del comprobante: número, fecha, cliente, total, forma de pago |
| `venta_detalles` | Una fila por producto vendido dentro de una venta |
| `movimientos_stock` | El historial de entradas y salidas de cada producto |
| `pagos` | Los pagos que hacen los clientes de su cuenta corriente |

---

## Las cuatro decisiones importantes

Estas son las que nos van a preguntar en la defensa. Vale la pena entenderlas,
no memorizarlas.

### 1. Los importes se guardan en centavos enteros

En la base, un café de $ 6.500,00 se guarda como `650000`.

**Por qué:** los números con decimales en JavaScript son aproximaciones.
`0.1 + 0.2` da `0.30000000000000004`, no `0.3`. En el total de una venta con
varios productos esos errores se acumulan y terminás cobrando mal.

Con enteros no hay aproximación posible. La interfaz divide por 100 para
mostrar pesos, y multiplica por 100 antes de guardar.

Los campos que son importes terminan en `Centavos`: `precioCentavos`,
`totalCentavos`, `importeCentavos`.

### 2. `venta_detalles` guarda una copia del nombre y el precio

Podría guardar solo el `productoId` y traer el nombre y el precio desde
`productos`. **No lo hacemos a propósito.**

**Por qué:** si mañana el café sube a $ 7.000, un comprobante de ayer mostraría
el precio nuevo y el total no cerraría.

Un comprobante es un registro histórico: tiene que conservar los datos **tal
como eran en el momento de la venta**. Por eso cada detalle guarda el
`productoId` (para saber qué producto fue) y además una copia de `descripcion`
y `precioUnitarioCentavos` (para mostrar la verdad de ese día).

### 3. El stock se guarda, el saldo se calcula

Esta asimetría parece una inconsistencia y no lo es.

**El stock se guarda** en `productos.stock` porque se consulta en cada venta y
hay que verificarlo contra un límite —nunca negativo— de forma atómica.
Recalcularlo sumando todos los movimientos en cada venta sería lento y dejaría
huecos donde dos ventas simultáneas pasan las dos la validación.

`movimientos_stock` queda como el historial que explica cómo se llegó a ese
número.

**El saldo del cliente se calcula**: ventas en cuenta corriente menos pagos. Se
consulta pocas veces, son pocos registros por cliente, y al derivarlo siempre
coincide con el historial. Una columna guardada podría desincronizarse y mostrar
una deuda que no existe.

### 4. Las sesiones son una tabla, no una librería

Cuando alguien inicia sesión se genera un token al azar, se guarda una fila en
`sesiones` y el token va al navegador en una cookie. En cada pedido el servidor
busca esa fila.

**Por qué no usamos una librería como NextAuth:** porque nos van a preguntar
"¿dónde se verifica que el usuario inició sesión?" y tenemos que poder abrir el
archivo y señalarlo.

Además resuelve otra pregunta: si se desactiva a un usuario con la sesión
abierta, su próximo pedido falla, porque el servidor chequea la fila contra
`usuarios.activo`.

---

## Cómo agregar un campo a una tabla

Esto nos lo pueden pedir **en vivo** durante la defensa. Son tres pasos:

1. Agregar la columna en `db/schema.js`. Por ejemplo, para sumar "marca" a
   productos:

   ```js
   marca: text('marca'),
   ```

2. Generar la migración:

   ```
   npm run db:generate
   ```

   Eso crea un archivo nuevo en `drizzle/` con el `ALTER TABLE`.

3. Aplicarla:

   ```
   npm run db:migrate
   ```

Después hay que mostrarlo en la interfaz, pero eso ya es el módulo de cada una.

**Importante:** si agregan una columna obligatoria (`.notNull()`) a una tabla
que ya tiene filas, la migración va a fallar, porque las filas existentes no
tienen ese dato. Hay que darle un valor por defecto o dejarla opcional.

---

## Las credenciales

Las credenciales de Turso y las contraseñas iniciales están en `.env.local`,
que está en el `.gitignore` y **nunca se sube al repositorio**.

El código nunca contiene el token: lo pide por su nombre.

```js
url: process.env.TURSO_DATABASE_URL
```

En nuestras máquinas ese valor sale del `.env.local`. En el sitio publicado sale
de las variables de entorno que cargamos en Vercel.

El primer administrador se crea con el seed, y su contraseña sale de
`ADMIN_PASSWORD`, también en `.env.local`. El enunciado lo pide así:
la contraseña del administrador se configura fuera del repositorio.

---

## Los datos de prueba

El seed carga:

- **2 usuarios**: `admin` (perfil admin) y `operador` (perfil operador)
- **15 productos** de almacén, con precios realistas
- **14 movimientos de stock** (el stock inicial de cada producto que tiene más de cero)
- **5 clientes**: tres personas con DNI y dos empresas con CUIT

Algunos datos están elegidos a propósito para poder probar casos límite:

| Dato | Para qué sirve |
|---|---|
| `AGU2000` con stock 3 | Probar el error de stock insuficiente sin vaciar nada |
| `LAV1000` con stock 0 | Ver cómo se comporta un producto agotado |
| Un cliente sin correo | Verificar la regla "al menos un contacto" |
| Un cliente sin teléfono | Lo mismo, del otro lado |

**No hay ventas ni pagos cargados.** Se generan usando el sistema: esa es la
prueba real de que la integración entre ventas, stock y cuenta corriente
funciona.

---

## Preguntas de defensa que cubre este tema

Las respuestas están arriba. Esto es para que sepan qué les pueden preguntar.

| Pregunta | Dónde está la respuesta |
|---|---|
| ¿Dónde se definen las tablas? | `db/schema.js` |
| ¿Dónde se conecta la app con la base? | `db/index.js` |
| ¿Cómo sabe si usar la base local o la de Turso? | Siempre Turso. La URL sale de `TURSO_DATABASE_URL` |
| ¿Qué es una migración y dónde están? | Carpeta `drizzle/`. Ver "Cómo agregar un campo" |
| ¿Cómo se crea una tabla nueva o se agrega un campo? | Ver "Cómo agregar un campo" |
| ¿Dónde se cargan los datos de prueba? | `db/seed.mjs` |
| ¿Cómo se guardan los importes? ¿Por qué no con coma flotante? | Decisión 1 |
| ¿La existencia de un producto se guarda o se calcula? ¿Y el saldo? | Decisión 3 |
| ¿Cómo se guardan las contraseñas? | Con bcrypt, en `db/seed.mjs`. Ver sección "Credenciales" |
| ¿Dónde está el secreto? ¿Por qué no está en el repositorio? | `.env.local`, ignorado por Git |
| Si se cambia el precio de un producto, ¿qué pasa con las facturas emitidas? | Decisión 2 |
| ¿Qué tablas se modifican cuando se confirma una factura? | `ventas`, `venta_detalles`, `movimientos_stock`, `productos` y, si es cuenta corriente, el saldo pasa a derivarse de esa venta |
