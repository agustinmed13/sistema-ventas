// Carga los datos de prueba que pide la consigna (sección 8):
// 2 usuarios (uno por rol), 5 categorías, 30 productos, 10 clientes
// y 50 facturas repartidas en los últimos 30 días.
//
// Se ejecuta con:  npm run db:seed
//
// Borra todo y vuelve a cargar, así se puede correr las veces que haga
// falta y siempre queda el mismo estado conocido.

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from './index';
import {
  usuarios,
  sesiones,
  categorias,
  productos,
  clientes,
  facturas,
  facturaItems,
  movimientosStock,
  pagos,
  movimientosCuenta,
} from './schema';

// ─────────────────────────────────────────────────────────────
// Generador de números "al azar" pero reproducible.
//
// Math.random() daría datos distintos cada vez que corremos el seed.
// Con esto, el seed siempre genera exactamente los mismos datos, así
// todos vemos lo mismo y la demo es predecible.
// ─────────────────────────────────────────────────────────────
let semilla = 20261123;
function azar(): number {
  // Algoritmo congruencial lineal: una fórmula simple que, a partir de
  // un número, produce el siguiente de una secuencia que parece azarosa.
  semilla = (semilla * 1103515245 + 12345) % 2147483648;
  return semilla / 2147483648;
}

/** Devuelve un entero entre min y max, los dos incluidos. */
function entreEnteros(min: number, max: number): number {
  return Math.floor(azar() * (max - min + 1)) + min;
}

/** Elige un elemento al azar de una lista. */
function elegir<T>(lista: T[]): T {
  return lista[Math.floor(azar() * lista.length)];
}

/** Fecha ISO de hace N días, con una hora de comercio (9 a 20). */
function haceDias(dias: number): string {
  const f = new Date();
  f.setDate(f.getDate() - dias);
  f.setHours(entreEnteros(9, 20), entreEnteros(0, 59), 0, 0);
  return f.toISOString();
}

const ahora = new Date().toISOString();

// ─────────────────────────────────────────────────────────────
// 1. Verificar que estén las contraseñas
// La consigna pide que la contraseña del administrador se configure
// fuera del repositorio.
// ─────────────────────────────────────────────────────────────
const claveAdmin = process.env.ADMIN_PASSWORD;
const claveVendedor = process.env.VENDEDOR_PASSWORD;

if (!claveAdmin || !claveVendedor) {
  console.error('Faltan ADMIN_PASSWORD y/o VENDEDOR_PASSWORD en .env.local');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// 2. Vaciar las tablas
// El orden importa: primero las que apuntan a otras. No se puede
// borrar una factura si todavía hay ítems que la referencian.
// ─────────────────────────────────────────────────────────────
console.log('Vaciando tablas...');
await db.delete(movimientosCuenta);
await db.delete(pagos);
await db.delete(movimientosStock);
await db.delete(facturaItems);
await db.delete(facturas);
await db.delete(sesiones);
await db.delete(productos);
await db.delete(categorias);
await db.delete(clientes);
await db.delete(usuarios);

// ─────────────────────────────────────────────────────────────
// 3. Usuarios — uno por rol
// La contraseña nunca se guarda: se guarda su hash.
// El 10 es el "costo": bcrypt repite el cálculo 2^10 veces para que
// probar contraseñas por fuerza bruta sea inviable.
// ─────────────────────────────────────────────────────────────
console.log('Creando usuarios...');
await db.insert(usuarios).values([
  {
    email: 'admin@mostrador.com',
    nombre: 'Administrador',
    contrasenaHash: bcrypt.hashSync(claveAdmin, 10),
    rol: 'admin',
    activo: true,
    creadoEn: ahora,
  },
  {
    email: 'vendedor@mostrador.com',
    nombre: 'Vendedor de mostrador',
    contrasenaHash: bcrypt.hashSync(claveVendedor, 10),
    rol: 'vendedor',
    activo: true,
    creadoEn: ahora,
  },
]);

const usuariosGuardados = await db.select().from(usuarios);
const idAdmin = usuariosGuardados.find((u) => u.rol === 'admin')!.id;
const idVendedor = usuariosGuardados.find((u) => u.rol === 'vendedor')!.id;

// ─────────────────────────────────────────────────────────────
// 4. Categorías
// ─────────────────────────────────────────────────────────────
console.log('Creando categorías...');
await db.insert(categorias).values(
  ['Almacén', 'Bebidas', 'Lácteos', 'Limpieza', 'Perfumería'].map((nombre) => ({
    nombre,
    activa: true,
    creadaEn: ahora,
  }))
);

const categoriasGuardadas = await db.select().from(categorias);
const idCategoria = (nombre: string) =>
  categoriasGuardadas.find((c) => c.nombre === nombre)!.id;

// ─────────────────────────────────────────────────────────────
// 5. Productos
// Los precios van en centavos enteros: 650000 = $ 6.500,00
// ─────────────────────────────────────────────────────────────
console.log('Creando productos...');

const catalogo = [
  // Almacén
  { codigo: 'ALM-001', descripcion: 'Café molido La Morenita 250 g', categoria: 'Almacén', precioCentavos: 650000, stockMinimo: 10 },
  { codigo: 'ALM-002', descripcion: 'Yerba mate Taragüí 1 kg', categoria: 'Almacén', precioCentavos: 890000, stockMinimo: 15 },
  { codigo: 'ALM-003', descripcion: 'Azúcar Ledesma 1 kg', categoria: 'Almacén', precioCentavos: 215000, stockMinimo: 20 },
  { codigo: 'ALM-004', descripcion: 'Aceite de girasol Natura 900 ml', categoria: 'Almacén', precioCentavos: 412000, stockMinimo: 12 },
  { codigo: 'ALM-005', descripcion: 'Harina 000 Pureza 1 kg', categoria: 'Almacén', precioCentavos: 138000, stockMinimo: 25 },
  { codigo: 'ALM-006', descripcion: 'Fideos Matarazzo spaghetti 500 g', categoria: 'Almacén', precioCentavos: 174000, stockMinimo: 20 },
  { codigo: 'ALM-007', descripcion: 'Arroz Gallo Oro 1 kg', categoria: 'Almacén', precioCentavos: 268000, stockMinimo: 15 },
  { codigo: 'ALM-008', descripcion: 'Puré de tomate Arcor 520 g', categoria: 'Almacén', precioCentavos: 119000, stockMinimo: 24 },
  { codigo: 'ALM-009', descripcion: 'Atún Gomes da Costa 170 g', categoria: 'Almacén', precioCentavos: 352000, stockMinimo: 10 },
  { codigo: 'ALM-010', descripcion: 'Galletitas Oreo 300 g', categoria: 'Almacén', precioCentavos: 285000, stockMinimo: 18 },
  { codigo: 'ALM-011', descripcion: 'Mermelada Arcor durazno 454 g', categoria: 'Almacén', precioCentavos: 243000, stockMinimo: 10 },
  { codigo: 'ALM-012', descripcion: 'Polenta Presto Pronta 500 g', categoria: 'Almacén', precioCentavos: 156000, stockMinimo: 12 },

  // Bebidas
  { codigo: 'BEB-001', descripcion: 'Gaseosa Coca-Cola 2,25 L', categoria: 'Bebidas', precioCentavos: 398000, stockMinimo: 20 },
  { codigo: 'BEB-002', descripcion: 'Agua mineral Villavicencio 2 L', categoria: 'Bebidas', precioCentavos: 165000, stockMinimo: 24 },
  { codigo: 'BEB-003', descripcion: 'Cerveza Quilmes 1 L', categoria: 'Bebidas', precioCentavos: 287000, stockMinimo: 18 },
  { codigo: 'BEB-004', descripcion: 'Vino Toro tinto 1 L', categoria: 'Bebidas', precioCentavos: 320000, stockMinimo: 12 },
  { codigo: 'BEB-005', descripcion: 'Jugo Baggio naranja 1 L', categoria: 'Bebidas', precioCentavos: 142000, stockMinimo: 20 },
  { codigo: 'BEB-006', descripcion: 'Gaseosa Sprite 1,5 L', categoria: 'Bebidas', precioCentavos: 312000, stockMinimo: 15 },

  // Lácteos
  { codigo: 'LAC-001', descripcion: 'Leche entera La Serenísima 1 L', categoria: 'Lácteos', precioCentavos: 192000, stockMinimo: 24 },
  { codigo: 'LAC-002', descripcion: 'Manteca La Serenísima 200 g', categoria: 'Lácteos', precioCentavos: 345000, stockMinimo: 10 },
  { codigo: 'LAC-003', descripcion: 'Queso cremoso Punta del Agua 500 g', categoria: 'Lácteos', precioCentavos: 720000, stockMinimo: 8 },
  { codigo: 'LAC-004', descripcion: 'Yogur Ser frutilla 190 g', categoria: 'Lácteos', precioCentavos: 98000, stockMinimo: 30 },
  { codigo: 'LAC-005', descripcion: 'Dulce de leche Sancor 400 g', categoria: 'Lácteos', precioCentavos: 384000, stockMinimo: 10 },

  // Limpieza
  { codigo: 'LIM-001', descripcion: 'Detergente Magistral 750 ml', categoria: 'Limpieza', precioCentavos: 310000, stockMinimo: 15 },
  { codigo: 'LIM-002', descripcion: 'Lavandina Ayudín 1 L', categoria: 'Limpieza', precioCentavos: 148000, stockMinimo: 20 },
  { codigo: 'LIM-003', descripcion: 'Jabón en polvo Ala 800 g', categoria: 'Limpieza', precioCentavos: 462000, stockMinimo: 10 },
  { codigo: 'LIM-004', descripcion: 'Papel higiénico Elite 4 u', categoria: 'Limpieza', precioCentavos: 298000, stockMinimo: 18 },

  // Perfumería
  { codigo: 'PER-001', descripcion: 'Shampoo Sedal 340 ml', categoria: 'Perfumería', precioCentavos: 389000, stockMinimo: 10 },
  { codigo: 'PER-002', descripcion: 'Jabón de tocador Lux 125 g', categoria: 'Perfumería', precioCentavos: 87000, stockMinimo: 24 },
  { codigo: 'PER-003', descripcion: 'Pasta dental Colgate 90 g', categoria: 'Perfumería', precioCentavos: 215000, stockMinimo: 15 },
  { codigo: 'PER-004', descripcion: 'Desodorante Rexona 150 ml', categoria: 'Perfumería', precioCentavos: 428000, stockMinimo: 12 },
];

// La existencia inicial se carga como un ingreso de stock (RF-P2):
// nunca se escribe a mano.
const existenciaInicial = catalogo.map(() => entreEnteros(60, 140));

await db.insert(productos).values(
  catalogo.map((p, i) => ({
    codigo: p.codigo,
    descripcion: p.descripcion,
    categoriaId: idCategoria(p.categoria),
    precioCentavos: p.precioCentavos,
    existencia: existenciaInicial[i],
    stockMinimo: p.stockMinimo,
    activo: true,
    creadoEn: ahora,
  }))
);

const productosGuardados = await db.select().from(productos);

// Movimiento de ingreso por el stock inicial de cada producto
await db.insert(movimientosStock).values(
  productosGuardados.map((p) => ({
    productoId: p.id,
    tipo: 'ingreso' as const,
    cantidad: p.existencia, // positiva: suma
    existenciaResultante: p.existencia,
    motivo: 'Stock inicial',
    fecha: haceDias(31),
    usuarioId: idAdmin,
    facturaId: null,
  }))
);

// Llevamos la existencia en memoria para ir descontándola con cada venta
const existenciaActual = new Map<number, number>(
  productosGuardados.map((p) => [p.id, p.existencia])
);

// ─────────────────────────────────────────────────────────────
// 6. Clientes
// Solo los habilitados pueden comprar en cuenta corriente (regla 6)
// ─────────────────────────────────────────────────────────────
console.log('Creando clientes...');
await db.insert(clientes).values([
  { tipoDocumento: 'DNI', numeroDocumento: '27345678', nombre: 'González, María Elena', domicilio: 'Av. Belgrano 1240', telefono: '3815551234', email: 'maria.gonzalez@gmail.com', cuentaCorrienteHabilitada: true, limiteCreditoCentavos: 5000000, activo: true, creadoEn: ahora },
  { tipoDocumento: 'CUIT', numeroDocumento: '30712345678', nombre: 'Almacén Don Pedro S.R.L.', domicilio: 'San Martín 822', telefono: '3814447788', email: 'compras@donpedro.com.ar', cuentaCorrienteHabilitada: true, limiteCreditoCentavos: 20000000, activo: true, creadoEn: ahora },
  { tipoDocumento: 'DNI', numeroDocumento: '20456789', nombre: 'Ruiz, Jorge Alberto', domicilio: 'Catamarca 45', telefono: '3816662211', email: null, cuentaCorrienteHabilitada: true, limiteCreditoCentavos: 3000000, activo: true, creadoEn: ahora },
  { tipoDocumento: 'CUIT', numeroDocumento: '30698765432', nombre: 'Panadería La Esquina', domicilio: 'Mendoza 1501', telefono: null, email: 'laesquina.pan@gmail.com', cuentaCorrienteHabilitada: true, limiteCreditoCentavos: 10000000, activo: true, creadoEn: ahora },
  { tipoDocumento: 'DNI', numeroDocumento: '35123456', nombre: 'Sosa, Carla Noemí', domicilio: 'Junín 390', telefono: '3815558899', email: 'carlasosa@hotmail.com', cuentaCorrienteHabilitada: false, limiteCreditoCentavos: null, activo: true, creadoEn: ahora },
  { tipoDocumento: 'DNI', numeroDocumento: '31987654', nombre: 'Luna, Diego Martín', domicilio: 'Córdoba 712', telefono: '3814443322', email: 'dieluna@gmail.com', cuentaCorrienteHabilitada: true, limiteCreditoCentavos: 4000000, activo: true, creadoEn: ahora },
  { tipoDocumento: 'CUIT', numeroDocumento: '33556677889', nombre: 'Kiosco El Trébol', domicilio: 'Lamadrid 220', telefono: '3817778899', email: 'eltrebol.kiosco@gmail.com', cuentaCorrienteHabilitada: true, limiteCreditoCentavos: 8000000, activo: true, creadoEn: ahora },
  { tipoDocumento: 'DNI', numeroDocumento: '29111222', nombre: 'Figueroa, Ana Laura', domicilio: 'Salta 1033', telefono: '3815112233', email: 'analaura.f@gmail.com', cuentaCorrienteHabilitada: false, limiteCreditoCentavos: null, activo: true, creadoEn: ahora },
  { tipoDocumento: 'DNI', numeroDocumento: '33445566', nombre: 'Paz, Ricardo Omar', domicilio: 'Buenos Aires 88', telefono: '3816554433', email: null, cuentaCorrienteHabilitada: true, limiteCreditoCentavos: 2500000, activo: true, creadoEn: ahora },
  { tipoDocumento: 'CUIT', numeroDocumento: '30555444333', nombre: 'Rotisería Doña Nelly', domicilio: '25 de Mayo 640', telefono: '3814009988', email: 'donanelly@gmail.com', cuentaCorrienteHabilitada: true, limiteCreditoCentavos: 6000000, activo: true, creadoEn: ahora },
]);

const clientesGuardados = await db.select().from(clientes);
const clientesACuenta = clientesGuardados.filter(
  (c) => c.cuentaCorrienteHabilitada
);

// ─────────────────────────────────────────────────────────────
// 7. Facturas — 50 repartidas en los últimos 30 días
//
// Cada factura genera, además de sus ítems:
//   - un movimiento de stock negativo por producto vendido
//   - la actualización de la existencia del producto
//   - si es en cuenta corriente, un débito en movimientos_cuenta
//
// Es la misma cadena que tiene que hacer la API al confirmar una venta.
// ─────────────────────────────────────────────────────────────
console.log('Creando facturas...');

const marcasTarjeta = ['Visa', 'Mastercard', 'American Express'];
const saldoPorCliente = new Map<number, number>();

for (let numero = 1; numero <= 50; numero++) {
  const fecha = haceDias(entreEnteros(0, 29));

  // La forma de pago define si hay cliente y si genera deuda
  const dado = azar();
  let formaPago: 'contado' | 'tarjeta' | 'cuenta_corriente';
  if (dado < 0.45) formaPago = 'contado';
  else if (dado < 0.75) formaPago = 'tarjeta';
  else formaPago = 'cuenta_corriente';

  // Cuenta corriente exige un cliente registrado y habilitado (regla 6).
  // En las otras formas de pago el cliente es opcional:
  // sin cliente = consumidor final.
  let cliente = null;
  if (formaPago === 'cuenta_corriente') {
    cliente = elegir(clientesACuenta);
  } else if (azar() < 0.4) {
    cliente = elegir(clientesGuardados);
  }

  // Entre 1 y 5 productos distintos por factura
  const cantidadRenglones = entreEnteros(1, 5);
  const elegidos = new Set<number>();
  while (elegidos.size < cantidadRenglones) {
    elegidos.add(entreEnteros(0, productosGuardados.length - 1));
  }

  const renglones = [...elegidos].map((indice) => {
    const producto = productosGuardados[indice];
    const cantidad = entreEnteros(1, 4);
    return {
      producto,
      cantidad,
      // El precio se congela: se copia el del momento de la venta (regla 3)
      precioUnitarioCentavos: producto.precioCentavos,
      subtotalCentavos: producto.precioCentavos * cantidad,
    };
  });

  const totalCentavos = renglones.reduce((t, r) => t + r.subtotalCentavos, 0);

  // Datos de tarjeta: solo tipo, marca y últimos 4 dígitos (regla 9)
  const esTarjeta = formaPago === 'tarjeta';
  const esContado = formaPago === 'contado';

  const [facturaCreada] = await db
    .insert(facturas)
    .values({
      puntoVenta: 1,
      numero,
      fecha,
      clienteId: cliente ? cliente.id : null,
      usuarioId: azar() < 0.7 ? idVendedor : idAdmin,
      totalCentavos,
      formaPago,
      tarjetaTipo: esTarjeta ? (azar() < 0.5 ? 'debito' : 'credito') : null,
      tarjetaMarca: esTarjeta ? elegir(marcasTarjeta) : null,
      tarjetaUltimos4: esTarjeta ? String(entreEnteros(1000, 9999)) : null,
      // En contado se guarda lo que entregó el cliente, para el vuelto
      montoRecibidoCentavos: esContado
        ? Math.ceil(totalCentavos / 100000) * 100000
        : null,
      estado: 'emitida',
      motivoAnulacion: null,
      anuladaEn: null,
      anuladaPorId: null,
    })
    .returning();

  // Los ítems, con la descripción copiada del catálogo
  await db.insert(facturaItems).values(
    renglones.map((r) => ({
      facturaId: facturaCreada.id,
      productoId: r.producto.id,
      descripcion: r.producto.descripcion,
      cantidad: r.cantidad,
      precioUnitarioCentavos: r.precioUnitarioCentavos,
      subtotalCentavos: r.subtotalCentavos,
    }))
  );

  // Un movimiento de stock por producto, con la existencia que queda
  for (const r of renglones) {
    const quedaba = existenciaActual.get(r.producto.id)!;
    const queda = quedaba - r.cantidad;
    existenciaActual.set(r.producto.id, queda);

    await db.insert(movimientosStock).values({
      productoId: r.producto.id,
      tipo: 'venta',
      cantidad: -r.cantidad, // negativa: resta
      existenciaResultante: queda,
      motivo: `Venta 0001-${String(numero).padStart(8, '0')}`,
      fecha,
      usuarioId: facturaCreada.usuarioId,
      facturaId: facturaCreada.id,
    });
  }

  // Si fue a cuenta corriente, queda la deuda registrada
  if (formaPago === 'cuenta_corriente' && cliente) {
    await db.insert(movimientosCuenta).values({
      clienteId: cliente.id,
      tipo: 'debito',
      importeCentavos: totalCentavos,
      fecha,
      descripcion: `Factura 0001-${String(numero).padStart(8, '0')}`,
      facturaId: facturaCreada.id,
      pagoId: null,
    });

    saldoPorCliente.set(
      cliente.id,
      (saldoPorCliente.get(cliente.id) ?? 0) + totalCentavos
    );
  }
}

// Dejamos la existencia de los productos como quedó después de las ventas
for (const [productoId, existencia] of existenciaActual) {
  await db
    .update(productos)
    .set({ existencia })
    .where(eq(productos.id, productoId));
}

// ─────────────────────────────────────────────────────────────
// 8. Pagos — algunos clientes cancelan parte de su deuda
// Un pago nunca supera el saldo adeudado (regla 8)
// ─────────────────────────────────────────────────────────────
console.log('Creando pagos...');

const mediosPago = ['efectivo', 'transferencia', 'tarjeta'] as const;
let numeroRecibo = 1;

for (const [clienteId, saldo] of saldoPorCliente) {
  // Solo la mitad de los clientes con deuda hizo algún pago,
  // para que queden saldos pendientes que mostrar
  if (azar() < 0.5) continue;

  // Paga entre el 30% y el 80% de lo que debe
  const importeCentavos = Math.floor(saldo * (0.3 + azar() * 0.5));
  if (importeCentavos <= 0) continue;

  const fecha = haceDias(entreEnteros(0, 10));

  const [pagoCreado] = await db
    .insert(pagos)
    .values({
      numeroRecibo: numeroRecibo++,
      clienteId,
      fecha,
      importeCentavos,
      medio: elegir([...mediosPago]),
      observacion: null,
      usuarioId: idVendedor,
    })
    .returning();

  await db.insert(movimientosCuenta).values({
    clienteId,
    tipo: 'credito',
    importeCentavos,
    fecha,
    descripcion: `Recibo ${String(pagoCreado.numeroRecibo).padStart(8, '0')}`,
    facturaId: null,
    pagoId: pagoCreado.id,
  });
}

// ─────────────────────────────────────────────────────────────
// Resumen
// ─────────────────────────────────────────────────────────────
const totalPagos = await db.select().from(pagos);
const totalMovStock = await db.select().from(movimientosStock);

console.log('');
console.log('Datos cargados:');
console.log(`  2 usuarios: admin@mostrador.com y vendedor@mostrador.com`);
console.log(`  ${categoriasGuardadas.length} categorías`);
console.log(`  ${productosGuardados.length} productos`);
console.log(`  ${clientesGuardados.length} clientes`);
console.log(`  50 facturas de los últimos 30 días`);
console.log(`  ${totalMovStock.length} movimientos de stock`);
console.log(`  ${totalPagos.length} pagos`);

process.exit(0);
