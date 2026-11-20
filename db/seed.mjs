// Carga datos de prueba en la base.
// Se ejecuta con:  node db/seed.mjs
//
// Borra todo y vuelve a cargar, así se puede correr las veces
// que haga falta y siempre queda el mismo estado conocido.

import bcrypt from 'bcryptjs';
import { db } from './index.js';
import {
  usuarios,
  sesiones,
  productos,
  clientes,
  ventas,
  ventaDetalles,
  movimientosStock,
  pagos,
} from './schema.js';

// Fecha actual en formato ISO, como acordamos en AGENTS.md
const ahora = new Date().toISOString();

// ─────────────────────────────────────────────────────────────
// 1. Verificar que estén las contraseñas
// ─────────────────────────────────────────────────────────────
const claveAdmin = process.env.ADMIN_PASSWORD;
const claveOperador = process.env.OPERADOR_PASSWORD;

if (!claveAdmin || !claveOperador) {
  console.error(
    'Faltan ADMIN_PASSWORD y/o OPERADOR_PASSWORD en .env.local'
  );
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// 2. Vaciar las tablas
// El orden importa: primero las que apuntan a otras.
// No se puede borrar un cliente si todavía hay pagos suyos.
// ─────────────────────────────────────────────────────────────
console.log('Vaciando tablas...');
await db.delete(pagos);
await db.delete(ventaDetalles);
await db.delete(movimientosStock);
await db.delete(ventas);
await db.delete(sesiones);
await db.delete(productos);
await db.delete(clientes);
await db.delete(usuarios);

// ─────────────────────────────────────────────────────────────
// 3. Usuarios
// La contraseña nunca se guarda: se guarda su hash.
// bcrypt.hashSync(clave, 10) aplica la función 2^10 veces,
// para que probar contraseñas por fuerza bruta sea lento.
// ─────────────────────────────────────────────────────────────
console.log('Creando usuarios...');
await db.insert(usuarios).values([
  {
    nombre: 'Administrador',
    acceso: 'admin',
    contrasenaHash: bcrypt.hashSync(claveAdmin, 10),
    perfil: 'admin',
    activo: true,
    creadoEn: ahora,
  },
  {
    nombre: 'Vendedor de mostrador',
    acceso: 'operador',
    contrasenaHash: bcrypt.hashSync(claveOperador, 10),
    perfil: 'operador',
    activo: true,
    creadoEn: ahora,
  },
]);

// ─────────────────────────────────────────────────────────────
// 4. Productos
// Los precios van en centavos enteros: 650000 = $ 6.500,00
// ─────────────────────────────────────────────────────────────
console.log('Creando productos...');

const catalogo = [
  { codigo: 'CAF250', nombre: 'Café molido La Morenita 250 g', precioCentavos: 650000, stock: 24 },
  { codigo: 'YER1000', nombre: 'Yerba mate Taragüí 1 kg', precioCentavos: 890000, stock: 30 },
  { codigo: 'AZU1000', nombre: 'Azúcar Ledesma 1 kg', precioCentavos: 215000, stock: 40 },
  { codigo: 'ACE900', nombre: 'Aceite de girasol Natura 900 ml', precioCentavos: 412000, stock: 18 },
  { codigo: 'HAR1000', nombre: 'Harina 000 Pureza 1 kg', precioCentavos: 138000, stock: 50 },
  { codigo: 'FID500', nombre: 'Fideos Matarazzo spaghetti 500 g', precioCentavos: 174000, stock: 36 },
  { codigo: 'ARR1000', nombre: 'Arroz Gallo Oro 1 kg', precioCentavos: 268000, stock: 28 },
  { codigo: 'LEC1000', nombre: 'Leche entera La Serenísima 1 L', precioCentavos: 192000, stock: 15 },
  { codigo: 'MAN200', nombre: 'Manteca La Serenísima 200 g', precioCentavos: 345000, stock: 12 },
  { codigo: 'QUE500', nombre: 'Queso cremoso Punta del Agua 500 g', precioCentavos: 720000, stock: 8 },
  { codigo: 'GAL300', nombre: 'Galletitas Oreo 300 g', precioCentavos: 285000, stock: 45 },
  { codigo: 'GAS2250', nombre: 'Gaseosa Coca-Cola 2,25 L', precioCentavos: 398000, stock: 32 },
  { codigo: 'AGU2000', nombre: 'Agua mineral Villavicencio 2 L', precioCentavos: 165000, stock: 3 },
  { codigo: 'DET750', nombre: 'Detergente Magistral 750 ml', precioCentavos: 310000, stock: 20 },
  { codigo: 'LAV1000', nombre: 'Lavandina Ayudín 1 L', precioCentavos: 148000, stock: 0 },
];

await db.insert(productos).values(
  catalogo.map((p) => ({ ...p, activo: true, creadoEn: ahora }))
);

// ─────────────────────────────────────────────────────────────
// 5. Movimientos de stock iniciales
// El enunciado pide que el stock inicial se registre como una
// entrada, si es mayor que cero. Así el historial explica de
// dónde salió cada unidad.
// ─────────────────────────────────────────────────────────────
console.log('Registrando stock inicial...');

const productosGuardados = await db.select().from(productos);

const movimientosIniciales = productosGuardados
  .filter((p) => p.stock > 0)
  .map((p) => ({
    productoId: p.id,
    tipo: 'entrada',
    cantidad: p.stock,
    motivo: 'Stock inicial',
    origen: 'inicial',
    fecha: ahora,
  }));

await db.insert(movimientosStock).values(movimientosIniciales);

// ─────────────────────────────────────────────────────────────
// 6. Clientes
// ─────────────────────────────────────────────────────────────
console.log('Creando clientes...');
await db.insert(clientes).values([
  {
    nombre: 'González, María Elena',
    documento: '27345678',
    telefono: '3815551234',
    correo: 'maria.gonzalez@gmail.com',
    creadoEn: ahora,
  },
  {
    nombre: 'Almacén Don Pedro S.R.L.',
    documento: '30712345678',
    telefono: '3814447788',
    correo: 'compras@donpedro.com.ar',
    creadoEn: ahora,
  },
  {
    nombre: 'Ruiz, Jorge Alberto',
    documento: '20456789',
    telefono: '3816662211',
    correo: null,
    creadoEn: ahora,
  },
  {
    nombre: 'Panadería La Esquina',
    documento: '30698765432',
    telefono: null,
    correo: 'laesquina.pan@gmail.com',
    creadoEn: ahora,
  },
  {
    nombre: 'Sosa, Carla Noemí',
    documento: '35123456',
    telefono: '3815558899',
    correo: 'carlasosa@hotmail.com',
    creadoEn: ahora,
  },
]);

// ─────────────────────────────────────────────────────────────
// Listo
// ─────────────────────────────────────────────────────────────
console.log('');
console.log('Datos cargados:');
console.log(`  ${2} usuarios (admin / operador)`);
console.log(`  ${catalogo.length} productos`);
console.log(`  ${movimientosIniciales.length} movimientos de stock`);
console.log(`  ${5} clientes`);
console.log('');
console.log('No hay ventas ni pagos: se generan usando el sistema.');

process.exit(0);