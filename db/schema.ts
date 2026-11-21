import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core';

// Modelo de datos según la sección 7 de requerimientos.md
// Todos los importes van en CENTAVOS ENTEROS: 650000 = $ 6.500,00

// ─────────────────────────────────────────────────────────────
// USUARIOS — quiénes pueden entrar. Dos roles: admin y vendedor.
// ─────────────────────────────────────────────────────────────
export const usuarios = sqliteTable('usuarios', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // La consigna pide inicio de sesión con email (RF-U1)
  email: text('email').notNull().unique(),
  nombre: text('nombre').notNull(),
  // Nunca la contraseña, solo su hash
  contrasenaHash: text('contrasena_hash').notNull(),
  rol: text('rol').$type<'admin' | 'vendedor'>().notNull(),
  activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
  creadoEn: text('creado_en').notNull(),
});

// ─────────────────────────────────────────────────────────────
// SESIONES — una fila por sesión abierta
// ─────────────────────────────────────────────────────────────
export const sesiones = sqliteTable('sesiones', {
  // El token aleatorio que viaja en la cookie
  id: text('id').primaryKey(),
  usuarioId: integer('usuario_id').notNull().references(() => usuarios.id),
  expiraEn: text('expira_en').notNull(),
  creadaEn: text('creada_en').notNull(),
});

// ─────────────────────────────────────────────────────────────
// CATEGORIAS — RF-P7
// ─────────────────────────────────────────────────────────────
export const categorias = sqliteTable('categorias', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nombre: text('nombre').notNull().unique(),
  activa: integer('activa', { mode: 'boolean' }).notNull().default(true),
  creadaEn: text('creada_en').notNull(),
});

// ─────────────────────────────────────────────────────────────
// PRODUCTOS — RF-P1, RF-P2
// La existencia se guarda. El historial que la explica está en
// movimientos_stock, y la suma de movimientos debe dar la existencia.
// ─────────────────────────────────────────────────────────────
export const productos = sqliteTable('productos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  codigo: text('codigo').notNull().unique(),
  descripcion: text('descripcion').notNull(),
  categoriaId: integer('categoria_id').notNull().references(() => categorias.id),
  precioCentavos: integer('precio_centavos').notNull(),
  existencia: integer('existencia').notNull().default(0),
  // Debajo de este valor el catálogo lo marca como bajo mínimo (RF-P1)
  stockMinimo: integer('stock_minimo').notNull().default(0),
  // Baja lógica (RF-P3): deja de ofrecerse pero conserva su historial
  activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
  creadoEn: text('creado_en').notNull(),
});

// ─────────────────────────────────────────────────────────────
// CLIENTES — RF-C2
// ─────────────────────────────────────────────────────────────
export const clientes = sqliteTable(
  'clientes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tipoDocumento: text('tipo_documento').$type<'DNI' | 'CUIT'>().notNull(),
    numeroDocumento: text('numero_documento').notNull(),
    // Nombre y apellido, o razón social
    nombre: text('nombre').notNull(),
    domicilio: text('domicilio'),
    telefono: text('telefono'),
    email: text('email'),
    // Solo un cliente habilitado puede comprar en cuenta corriente (regla 6)
    cuentaCorrienteHabilitada: integer('cuenta_corriente_habilitada', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    // Opcional. Si existe, una venta a cuenta no puede superarlo (regla 7)
    limiteCreditoCentavos: integer('limite_credito_centavos'),
    activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
    creadoEn: text('creado_en').notNull(),
  },
  (tabla) => [
    // El documento es único considerando tipo y número juntos:
    // puede existir el DNI 20123456 y el CUIT 20123456 sin chocar
    unique('clientes_documento_unico').on(
      tabla.tipoDocumento,
      tabla.numeroDocumento
    ),
  ]
);

// ─────────────────────────────────────────────────────────────
// FACTURAS — RF-V6, RF-V7, RF-V9
// ─────────────────────────────────────────────────────────────
export const facturas = sqliteTable(
  'facturas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Numeración formato 0001-00000001 (regla 4)
    puntoVenta: integer('punto_venta').notNull().default(1),
    numero: integer('numero').notNull(),
    fecha: text('fecha').notNull(),

    // NULL = consumidor final. Cuenta corriente exige cliente (regla 6)
    clienteId: integer('cliente_id').references(() => clientes.id),
    // Quién la emitió (regla 11, trazabilidad)
    usuarioId: integer('usuario_id').notNull().references(() => usuarios.id),

    totalCentavos: integer('total_centavos').notNull(),
    formaPago: text('forma_pago')
      .$type<'contado' | 'tarjeta' | 'cuenta_corriente'>()
      .notNull(),

    // Solo para pago con tarjeta. NUNCA el número completo (regla 9)
    tarjetaTipo: text('tarjeta_tipo').$type<'debito' | 'credito' | null>(),
    tarjetaMarca: text('tarjeta_marca'),
    tarjetaUltimos4: text('tarjeta_ultimos4'),

    // Solo para pago contado: lo que entregó el cliente, para calcular vuelto
    montoRecibidoCentavos: integer('monto_recibido_centavos'),

    // Una factura confirmada no se modifica, solo se anula (regla 5)
    estado: text('estado').$type<'emitida' | 'anulada'>().notNull().default('emitida'),
    motivoAnulacion: text('motivo_anulacion'),
    anuladaEn: text('anulada_en'),
    anuladaPorId: integer('anulada_por_id').references(() => usuarios.id),
  },
  (tabla) => [
    // Correlativa y sin huecos dentro de cada punto de venta
    unique('facturas_numero_unico').on(tabla.puntoVenta, tabla.numero),
  ]
);

// ─────────────────────────────────────────────────────────────
// FACTURA_ITEMS — un renglón por producto vendido
// Guarda COPIA de la descripción y el precio: el precio se congela
// y cambiar el catálogo no altera facturas emitidas (regla 3)
// ─────────────────────────────────────────────────────────────
export const facturaItems = sqliteTable('factura_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  facturaId: integer('factura_id').notNull().references(() => facturas.id),
  productoId: integer('producto_id').notNull().references(() => productos.id),
  // COPIA de la descripción del producto al momento de la venta
  descripcion: text('descripcion').notNull(),
  cantidad: integer('cantidad').notNull(),
  // COPIA del precio al momento de la venta
  precioUnitarioCentavos: integer('precio_unitario_centavos').notNull(),
  subtotalCentavos: integer('subtotal_centavos').notNull(),
});

// ─────────────────────────────────────────────────────────────
// MOVIMIENTOS_STOCK — RF-P6
// Todo cambio de existencia deja un movimiento, en la misma
// transacción que actualiza el producto (regla 2)
// ─────────────────────────────────────────────────────────────
export const movimientosStock = sqliteTable('movimientos_stock', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productoId: integer('producto_id').notNull().references(() => productos.id),
  tipo: text('tipo')
    .$type<'venta' | 'anulacion' | 'ingreso' | 'egreso'>()
    .notNull(),
  // CON SIGNO: positiva en ingreso y anulación, negativa en venta y egreso.
  // Así la suma de todos los movimientos da la existencia actual.
  cantidad: integer('cantidad').notNull(),
  // La existencia que quedó después de este movimiento
  existenciaResultante: integer('existencia_resultante').notNull(),
  motivo: text('motivo').notNull(),
  fecha: text('fecha').notNull(),
  usuarioId: integer('usuario_id').notNull().references(() => usuarios.id),
  // Solo cuando el movimiento viene de una venta o de su anulación
  facturaId: integer('factura_id').references(() => facturas.id),
});

// ─────────────────────────────────────────────────────────────
// PAGOS — RF-C5. Cada pago genera un recibo numerado
// ─────────────────────────────────────────────────────────────
export const pagos = sqliteTable('pagos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Numeración propia, independiente de las facturas (regla 4)
  numeroRecibo: integer('numero_recibo').notNull().unique(),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id),
  fecha: text('fecha').notNull(),
  importeCentavos: integer('importe_centavos').notNull(),
  medio: text('medio')
    .$type<'efectivo' | 'transferencia' | 'tarjeta'>()
    .notNull(),
  observacion: text('observacion'),
  usuarioId: integer('usuario_id').notNull().references(() => usuarios.id),
});

// ─────────────────────────────────────────────────────────────
// MOVIMIENTOS_CUENTA — RF-C4
// El saldo del cliente se deriva de acá: débitos menos créditos (regla 7).
// Débito  = venta en cuenta corriente
// Crédito = pago, o anulación de una factura a cuenta
// ─────────────────────────────────────────────────────────────
export const movimientosCuenta = sqliteTable('movimientos_cuenta', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clienteId: integer('cliente_id').notNull().references(() => clientes.id),
  tipo: text('tipo').$type<'debito' | 'credito'>().notNull(),
  importeCentavos: integer('importe_centavos').notNull(),
  fecha: text('fecha').notNull(),
  descripcion: text('descripcion').notNull(),
  // De dónde salió el movimiento: una factura o un pago
  facturaId: integer('factura_id').references(() => facturas.id),
  pagoId: integer('pago_id').references(() => pagos.id),
});
