import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

// ─────────────────────────────────────────────────────────────
// USUARIOS — quiénes pueden entrar al sistema
// ─────────────────────────────────────────────────────────────
export const usuarios = sqliteTable('usuarios', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nombre: text('nombre').notNull(),
  // Con esto inicia sesión. Único: no puede haber dos iguales.
  acceso: text('acceso').notNull().unique(),
  // Nunca guardamos la contraseña, solo su hash.
  contrasenaHash: text('contrasena_hash').notNull(),
  // 'admin' u 'operador'
  perfil: text('perfil').notNull().default('operador'),
  activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
  creadoEn: text('creado_en').notNull(),
});

// ─────────────────────────────────────────────────────────────
// SESIONES — una fila por sesión abierta
// ─────────────────────────────────────────────────────────────
export const sesiones = sqliteTable('sesiones', {
  // El token aleatorio que viaja en la cookie. Es la clave primaria.
  id: text('id').primaryKey(),
  usuarioId: integer('usuario_id').notNull().references(() => usuarios.id),
  expiraEn: text('expira_en').notNull(),
  creadaEn: text('creada_en').notNull(),
});

// ─────────────────────────────────────────────────────────────
// PRODUCTOS — el catálogo
// ─────────────────────────────────────────────────────────────
export const productos = sqliteTable('productos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  codigo: text('codigo').notNull().unique(),
  nombre: text('nombre').notNull(),
  // En centavos enteros: 650000 = $ 6.500,00
  precioCentavos: integer('precio_centavos').notNull(),
  // Se guarda. El historial está en movimientos_stock.
  stock: integer('stock').notNull().default(0),
  activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
  creadoEn: text('creado_en').notNull(),
});

// ─────────────────────────────────────────────────────────────
// CLIENTES
// ─────────────────────────────────────────────────────────────
export const clientes = sqliteTable('clientes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Nombre y apellido, o razón social
  nombre: text('nombre').notNull(),
  documento: text('documento').notNull(),
  // Opcionales en la tabla, pero el servidor exige al menos uno.
  telefono: text('telefono'),
  correo: text('correo'),
  creadoEn: text('creado_en').notNull(),
});

// ─────────────────────────────────────────────────────────────
// VENTAS — la cabecera del comprobante
// ─────────────────────────────────────────────────────────────
export const ventas = sqliteTable('ventas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Número de comprobante, visible para el usuario. Único.
  numero: integer('numero').notNull().unique(),
  fecha: text('fecha').notNull(),
  // NULL = consumidor final. Si es cuenta corriente, no puede ser NULL.
  clienteId: integer('cliente_id').references(() => clientes.id),
  totalCentavos: integer('total_centavos').notNull(),
  // 'contado' | 'tarjeta' | 'cuenta_corriente'
  formaPago: text('forma_pago').notNull(),
  // Quién hizo la venta
  usuarioId: integer('usuario_id').notNull().references(() => usuarios.id),
});

// ─────────────────────────────────────────────────────────────
// VENTA_DETALLES — una fila por producto vendido
// Guarda COPIA de la descripción y el precio: el comprobante
// debe conservar los datos tal como eran al momento de la venta.
// ─────────────────────────────────────────────────────────────
export const ventaDetalles = sqliteTable('venta_detalles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ventaId: integer('venta_id').notNull().references(() => ventas.id),
  // Para saber qué producto fue, aunque después cambie
  productoId: integer('producto_id').notNull().references(() => productos.id),
  // COPIA del nombre del producto en ese momento
  descripcion: text('descripcion').notNull(),
  cantidad: integer('cantidad').notNull(),
  // COPIA del precio en ese momento
  precioUnitarioCentavos: integer('precio_unitario_centavos').notNull(),
  // cantidad × precioUnitarioCentavos
  subtotalCentavos: integer('subtotal_centavos').notNull(),
});

// ─────────────────────────────────────────────────────────────
// MOVIMIENTOS_STOCK — el historial que explica el stock actual
// ─────────────────────────────────────────────────────────────
export const movimientosStock = sqliteTable('movimientos_stock', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productoId: integer('producto_id').notNull().references(() => productos.id),
  // 'entrada' | 'salida'
  tipo: text('tipo').notNull(),
  // Siempre positiva. El tipo dice si suma o resta.
  cantidad: integer('cantidad').notNull(),
  motivo: text('motivo').notNull(),
  // 'venta' | 'ajuste' | 'inicial'
  origen: text('origen').notNull(),
  fecha: text('fecha').notNull(),
});

// ─────────────────────────────────────────────────────────────
// PAGOS — lo que el cliente paga de su cuenta corriente
// El saldo NO se guarda: se calcula como
// (ventas en cuenta corriente) − (pagos)
// ─────────────────────────────────────────────────────────────
export const pagos = sqliteTable('pagos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id),
  fecha: text('fecha').notNull(),
  importeCentavos: integer('importe_centavos').notNull(),
  observacion: text('observacion'),
  usuarioId: integer('usuario_id').notNull().references(() => usuarios.id),
});
