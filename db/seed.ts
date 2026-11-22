// Carga los datos de prueba que pide la consigna (sección 8):
// 2 usuarios (uno por rol), 5 categorías, 30 productos, 10 clientes
// y 50 facturas repartidas en los últimos 30 días.
//
// Se ejecuta con:  npm run db:seed
//
// Borra todo y vuelve a cargar, así se puede correr las veces que haga
// falta y siempre queda el mismo estado conocido.
//
// CONSIGNA 10.7: las OPERACIONES (stock inicial y facturas) se hacen con
// los mismos servicios que usa la aplicación: moverStock() y
// crearFactura(). Así los datos de prueba cumplen todas las reglas
// (stock nunca negativo, límite de crédito, numeración correlativa) y el
// seed sirve además como prueba de los servicios.
// Los datos BASE (usuarios, categorías, productos, clientes) se cargan
// directo: no son operaciones, no tienen reglas que respetar.

import bcrypt from 'bcryptjs';
import { eq, asc } from 'drizzle-orm';
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
import { ApiError } from '../lib/errores';
import { moverStock } from '../lib/servicios/stock';
import { crearFactura, type UsuarioSesion } from '../lib/servicios/facturas';
import { registrarPago } from '../lib/servicios/pagos';

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
// 3. Usuarios — uno por rol (dato base, directo)
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
const filaAdmin = usuariosGuardados.find((u) => u.rol === 'admin')!;
const filaVendedor = usuariosGuardados.find((u) => u.rol === 'vendedor')!;
const idAdmin = filaAdmin.id;
const idVendedor = filaVendedor.id;

// Los servicios reciben "el usuario que hace la operación", igual que
// cuando los llama una ruta con la sesión abierta.
const admin: UsuarioSesion = { id: filaAdmin.id, nombre: filaAdmin.nombre, rol: filaAdmin.rol };
const vendedor: UsuarioSesion = { id: filaVendedor.id, nombre: filaVendedor.nombre, rol: filaVendedor.rol };

// ─────────────────────────────────────────────────────────────
// 4. Categorías (dato base, directo)
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
// 5. Productos (dato base, directo)
// Los precios van en centavos enteros: 650000 = $ 6.500,00
// Se crean con existencia 0: el stock inicial entra en el paso 6.
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

await db.insert(productos).values(
  catalogo.map((p) => ({
    codigo: p.codigo,
    descripcion: p.descripcion,
    categoriaId: idCategoria(p.categoria),
    precioCentavos: p.precioCentavos,
    existencia: 0, // la carga el paso 6, con moverStock
    stockMinimo: p.stockMinimo,
    activo: true,
    creadoEn: ahora,
  }))
);

const productosGuardados = await db.select().from(productos);

// ─────────────────────────────────────────────────────────────
// 6. Stock inicial — con el SERVICIO moverStock() (RF-P2, consigna 10.2)
// La existencia no se escribe a mano: el stock inicial entra como un
// INGRESO, igual que cualquier compra. Así queda su movimiento y la suma
// de movimientos coincide con la existencia (regla 2).
// Una sola transacción: entra todo el stock inicial o nada.
// ─────────────────────────────────────────────────────────────
console.log('Cargando stock inicial...');
const fechaStockInicial = haceDias(31); // antes de la primera venta

await db.transaction(async (tx) => {
  for (const producto of productosGuardados) {
    await moverStock(tx, {
      productoId: producto.id,
      tipo: 'ingreso',
      cantidad: entreEnteros(60, 140), // positiva: suma
      motivo: 'Stock inicial',
      fecha: fechaStockInicial,
      usuarioId: idAdmin,
      facturaId: null,
    });
  }
});

// ─────────────────────────────────────────────────────────────
// 7. Clientes (dato base, directo)
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
const clientesACuenta = clientesGuardados.filter((c) => c.cuentaCorrienteHabilitada);

// ─────────────────────────────────────────────────────────────
// 8. Facturas — con el SERVICIO crearFactura() (consigna 10.7)
//
// Se le pasa el mismo objeto que recibiría POST /api/facturas:
//   { clienteId, formaPago, items, montoRecibidoCentavos, tarjeta }
// Sin precios ni totales: los calcula el servicio (sección 11.1).
//
// Con eso, sin que el seed lo controle a mano:
//   - no se vende más stock del que hay (regla 1)
//   - no se supera el límite de crédito de ningún cliente (regla 7)
//   - la numeración queda correlativa y sin huecos (regla 4)
//   - cada venta deja sus movimientos de stock y de cuenta (regla 2)
//
// Si el servicio rechaza una venta (ApiError, por ejemplo porque
// superaría el límite del cliente), NO cortamos el seed: la descartamos
// y probamos con otra combinación. Es exactamente lo que pasaría en el
// mostrador: el sistema no deja hacer esa venta.
// ─────────────────────────────────────────────────────────────
console.log('Creando facturas con crearFactura()...');

const FACTURAS_A_CREAR = 50;
const MAXIMO_INTENTOS = 300; // por las dudas, para que nunca quede en un ciclo infinito
const marcasTarjeta = ['Visa', 'Mastercard', 'American Express'];

let facturasCreadas = 0;
let ventasDescartadas = 0;
const motivosDescarte = new Map<string, number>(); // código de error → cuántas veces
let intentos = 0;

while (facturasCreadas < FACTURAS_A_CREAR && intentos < MAXIMO_INTENTOS) {
  intentos++;

  // La forma de pago define si hay cliente y si genera deuda
  const dado = azar();
  let formaPago: 'contado' | 'tarjeta' | 'cuenta_corriente';
  if (dado < 0.45) formaPago = 'contado';
  else if (dado < 0.75) formaPago = 'tarjeta';
  else formaPago = 'cuenta_corriente';

  // Cuenta corriente exige un cliente registrado y habilitado (regla 6).
  // En las otras formas de pago el cliente es opcional:
  // sin cliente = consumidor final.
  let clienteId: number | null = null;
  if (formaPago === 'cuenta_corriente') {
    clienteId = elegir(clientesACuenta).id;
  } else if (azar() < 0.4) {
    clienteId = elegir(clientesGuardados).id;
  }

  // Entre 1 y 5 productos distintos por factura, de 1 a 4 unidades
  const cantidadRenglones = entreEnteros(1, 5);
  const elegidos = new Set<number>();
  while (elegidos.size < cantidadRenglones) {
    elegidos.add(entreEnteros(0, productosGuardados.length - 1));
  }
  const items = [...elegidos].map((indice) => ({
    productoId: productosGuardados[indice].id,
    cantidad: entreEnteros(1, 4),
  }));

  // Lo que el cliente pagaría, igual que el body de la API
  const datos: {
    clienteId: number | null;
    formaPago: string;
    items: { productoId: number; cantidad: number }[];
    montoRecibidoCentavos?: number;
    tarjeta?: { tipo: string; marca: string; ultimos4: string };
  } = { clienteId, formaPago, items };

  if (formaPago === 'contado') {
    // El cliente entrega un monto redondo, el próximo múltiplo de
    // $ 1.000 por encima del total. Calculamos el total acá SOLO para
    // decidir cuánta plata "entrega"; el total que vale lo calcula el
    // servicio con los precios de la base.
    let totalEstimado = 0;
    for (const item of items) {
      const producto = productosGuardados.find((p) => p.id === item.productoId)!;
      totalEstimado = totalEstimado + producto.precioCentavos * item.cantidad;
    }
    datos.montoRecibidoCentavos = Math.ceil(totalEstimado / 100000) * 100000;
  }

  if (formaPago === 'tarjeta') {
    // Regla 9: solo tipo, marca y últimos 4 dígitos
    datos.tarjeta = {
      tipo: azar() < 0.5 ? 'debito' : 'credito',
      marca: elegir(marcasTarjeta),
      ultimos4: String(entreEnteros(1000, 9999)),
    };
  }

  // 70% las hace el vendedor, 30% el admin (los dos pueden facturar)
  const quienVende = azar() < 0.7 ? vendedor : admin;

  try {
    await crearFactura(quienVende, datos);
    facturasCreadas++;
  } catch (error) {
    // Un ApiError es el servicio diciendo "esta venta no se puede":
    // la descartamos y seguimos. Cualquier otro error es un problema
    // real (se cayó la base, un bug): ese sí corta el seed.
    if (error instanceof ApiError) {
      ventasDescartadas++;
      motivosDescarte.set(error.code, (motivosDescarte.get(error.code) ?? 0) + 1);
    } else {
      throw error;
    }
  }
}

if (facturasCreadas < FACTURAS_A_CREAR) {
  console.warn(`  ATENCIÓN: solo se pudieron crear ${facturasCreadas} facturas en ${MAXIMO_INTENTOS} intentos.`);
}

// ─────────────────────────────────────────────────────────────
// 9. Repartir las fechas en los últimos 30 días
//
// POR QUÉ: crearFactura() pone la fecha del servidor (y está bien: en la
// aplicación real el cliente no elige la fecha). Pero entonces las 50
// facturas quedarían de hoy y el tablero no tendría nada que graficar.
//
// Las REGLAS DE NEGOCIO ya las aplicó el servicio: stock, límites,
// numeración, movimientos. La fecha es solo presentación, para que el
// tablero muestre información desde el primer arranque (consigna,
// sección 8). Por eso se corrige después, sin tocar nada más.
//
// Para que todo quede consistente:
//   - las fechas se ordenan de más vieja a más nueva y se asignan en
//     orden de número: la factura 1 es la más vieja y la 50 la más
//     nueva, como en la realidad (regla 4: correlativa)
//   - se actualizan también los movimientos de stock y de cuenta de
//     cada factura, que tienen que tener la misma fecha que ella
// ─────────────────────────────────────────────────────────────
console.log('Repartiendo fechas en los últimos 30 días...');

const facturasEnOrden = await db.select().from(facturas).orderBy(asc(facturas.numero));

const fechasNuevas: string[] = [];
for (let i = 0; i < facturasEnOrden.length; i++) {
  fechasNuevas.push(haceDias(entreEnteros(0, 29)));
}
// Las fechas ISO se ordenan bien como texto
fechasNuevas.sort();

for (let i = 0; i < facturasEnOrden.length; i++) {
  const factura = facturasEnOrden[i];
  const fecha = fechasNuevas[i];

  await db.update(facturas).set({ fecha }).where(eq(facturas.id, factura.id));
  await db.update(movimientosStock).set({ fecha }).where(eq(movimientosStock.facturaId, factura.id));
  await db.update(movimientosCuenta).set({ fecha }).where(eq(movimientosCuenta.facturaId, factura.id));
}

// ─────────────────────────────────────────────────────────────
// 10. Pagos — algunos clientes cancelan parte de su deuda
//
// Usa registrarPago() del servicio, igual que las facturas usan
// crearFactura() (consigna 10.7). El servicio aplica la regla 8 por su
// cuenta: si el importe supera la deuda, lanza PAGO_SUPERA_DEUDA y el
// pago no se graba. Así los datos de prueba no pueden violar las reglas.
//
// El saldo se calcula igual acá, pero solo para DECIDIR cuánto pagar.
// Quien verifica que el pago sea válido es el servicio.
//
// Las fechas: registrarPago() pone la fecha del servidor (ahora), como
// corresponde en producción. Para que los datos de prueba queden
// repartidos en el tiempo, después se corrigen con un UPDATE — el mismo
// recurso que ya se usa con las facturas en el paso 9.
// ─────────────────────────────────────────────────────────────
console.log('Creando pagos...');

// Los nombres que acepta la API (sección 5.1). El servicio traduce
// 'tarjeta_debito' a 'tarjeta', que es como se guarda en la tabla.
const mediosPago = ['efectivo', 'transferencia', 'tarjeta_debito'] as const;

for (const cliente of clientesACuenta) {
  const movimientos = await db
    .select()
    .from(movimientosCuenta)
    .where(eq(movimientosCuenta.clienteId, cliente.id));

  let saldo = 0;
  let ultimaFechaDeuda = '';
  for (const mov of movimientos) {
    if (mov.tipo === 'debito') {
      saldo = saldo + mov.importeCentavos;
      if (mov.fecha > ultimaFechaDeuda) ultimaFechaDeuda = mov.fecha;
    } else {
      saldo = saldo - mov.importeCentavos;
    }
  }

  // Sin deuda no hay nada que pagar
  if (saldo <= 0) continue;

  // Solo la mitad de los clientes con deuda hizo algún pago, para que
  // queden saldos pendientes que mostrar
  if (azar() < 0.5) continue;

  // Paga entre el 30% y el 80% de lo que debe: nunca más que el saldo
  const importeCentavos = Math.floor(saldo * (0.3 + azar() * 0.5));
  if (importeCentavos <= 0 || importeCentavos > saldo) continue;

  // El pago va DESPUÉS de su última compra a cuenta: no tiene sentido
  // pagar una deuda antes de tenerla
  const desde = new Date(ultimaFechaDeuda).getTime();
  const hasta = Date.now();
  const fecha = new Date(desde + azar() * (hasta - desde)).toISOString();

  // El servicio hace todo: valida, numera el recibo, graba el pago y el
  // crédito en la cuenta, los dos en una transacción. El id del cliente
  // va como texto porque la función lo recibe tal como llega en la URL.
  const recibo = await registrarPago(vendedor, String(cliente.id), {
    importe: importeCentavos,
    medio: elegir([...mediosPago]),
  });

  // Retro-fechar el pago y su movimiento de cuenta, para que los datos
  // de prueba no queden todos con la fecha de hoy.
  await db.update(pagos).set({ fecha }).where(eq(pagos.id, recibo.id));
  await db.update(movimientosCuenta).set({ fecha }).where(eq(movimientosCuenta.pagoId, recibo.id));
}

// ─────────────────────────────────────────────────────────────
// 11. Verificación (consigna 10.8, punto 5)
// Así el seed sirve además como prueba de los servicios. Si algo no
// cierra, lo dice y termina con error.
// ─────────────────────────────────────────────────────────────
console.log('');
console.log('Verificando...');
let errores = 0;

// --- a) Existencia = suma de movimientos (regla 2), y nunca negativa (regla 1)
const todosLosProductos = await db.select().from(productos);
const todosLosMovStock = await db.select().from(movimientosStock);

for (const producto of todosLosProductos) {
  let suma = 0;
  for (const mov of todosLosMovStock) {
    if (mov.productoId === producto.id) suma = suma + mov.cantidad;
  }
  if (suma !== producto.existencia) {
    console.error(`  FALLA ${producto.codigo}: existencia ${producto.existencia}, suma de movimientos ${suma}`);
    errores++;
  }
  if (producto.existencia < 0) {
    console.error(`  FALLA ${producto.codigo}: existencia negativa (${producto.existencia})`);
    errores++;
  }
}
console.log(`  Existencia = suma de movimientos en ${todosLosProductos.length} productos`);

// --- b) Saldo = débitos − créditos, y coincide con lo que dicen las
//        facturas a cuenta y los pagos. Nunca negativo (regla 8) ni
//        por encima del límite (regla 7).
const todasLasFacturas = await db.select().from(facturas);
const todosLosPagos = await db.select().from(pagos);
const todosLosMovCuenta = await db.select().from(movimientosCuenta);

for (const cliente of clientesGuardados) {
  // Lo que dicen los movimientos de cuenta
  let saldoMovimientos = 0;
  for (const mov of todosLosMovCuenta) {
    if (mov.clienteId !== cliente.id) continue;
    if (mov.tipo === 'debito') saldoMovimientos = saldoMovimientos + mov.importeCentavos;
    else saldoMovimientos = saldoMovimientos - mov.importeCentavos;
  }

  // Lo que dicen los documentos: facturas a cuenta emitidas − pagos
  let saldoDocumentos = 0;
  for (const f of todasLasFacturas) {
    if (f.clienteId === cliente.id && f.formaPago === 'cuenta_corriente' && f.estado === 'emitida') {
      saldoDocumentos = saldoDocumentos + f.totalCentavos;
    }
  }
  for (const p of todosLosPagos) {
    if (p.clienteId === cliente.id) saldoDocumentos = saldoDocumentos - p.importeCentavos;
  }

  if (saldoMovimientos !== saldoDocumentos) {
    console.error(`  FALLA ${cliente.nombre}: movimientos dan ${saldoMovimientos}, facturas − pagos dan ${saldoDocumentos}`);
    errores++;
  }
  if (saldoMovimientos < 0) {
    console.error(`  FALLA ${cliente.nombre}: saldo a favor (${saldoMovimientos}), un pago superó la deuda`);
    errores++;
  }
  if (cliente.limiteCreditoCentavos !== null && saldoMovimientos > cliente.limiteCreditoCentavos) {
    console.error(`  FALLA ${cliente.nombre}: debe ${saldoMovimientos}, límite ${cliente.limiteCreditoCentavos}`);
    errores++;
  }
}
console.log(`  Saldo = débitos − créditos, sin saldos a favor ni límites superados, en ${clientesGuardados.length} clientes`);

// --- c) Numeración correlativa y sin huecos (regla 4)
const numeros = todasLasFacturas.map((f) => f.numero).sort((a, b) => a - b);
for (let i = 0; i < numeros.length; i++) {
  if (numeros[i] !== i + 1) {
    console.error(`  FALLA numeración: se esperaba la factura ${i + 1} y hay ${numeros[i]}`);
    errores++;
    break;
  }
}
console.log(`  Numeración correlativa de 1 a ${numeros.length}`);

// ─────────────────────────────────────────────────────────────
// Resumen
// ─────────────────────────────────────────────────────────────
console.log('');
console.log('Datos cargados:');
console.log(`  2 usuarios: admin@mostrador.com y vendedor@mostrador.com`);
console.log(`  ${categoriasGuardadas.length} categorías`);
console.log(`  ${productosGuardados.length} productos`);
console.log(`  ${clientesGuardados.length} clientes`);
console.log(`  ${facturasCreadas} facturas de los últimos 30 días`);
console.log(`  ${ventasDescartadas} ventas descartadas por el servicio`);
for (const [codigo, veces] of motivosDescarte) {
  console.log(`      ${codigo}: ${veces}`);
}
console.log(`  ${todosLosMovStock.length} movimientos de stock`);
console.log(`  ${todosLosPagos.length} pagos`);
console.log('');

if (errores > 0) {
  console.error(`VERIFICACIÓN FALLIDA: ${errores} problema(s). Revisar arriba.`);
  process.exit(1);
}
console.log('Verificación OK: todos los datos cumplen las reglas.');
process.exit(0);
