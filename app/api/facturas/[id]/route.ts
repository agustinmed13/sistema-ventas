// GET /api/facturas/[id] — el comprobante completo (RF-V7)
//
// La carpeta se llama [id] con corchetes: eso le dice a Next.js que esa
// parte de la URL es variable. /api/facturas/51 llega acá con id = "51".

import { eq } from 'drizzle-orm';
import { db } from '@/db/index';
import { facturas, facturaItems, clientes, usuarios } from '@/db/schema';
import { obtenerUsuarioActual } from '@/lib/auth';
import { errorNoAutorizado, errorNoEncontrado, errorInterno } from '@/lib/errores';

export async function GET(
  request: Request,
  // En Next.js 16, params es una promesa: hay que esperarla con await
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Los dos roles pueden consultar: alcanza con que haya sesión
    const usuario = await obtenerUsuarioActual();
    if (!usuario) return errorNoAutorizado();

    // El id llega como texto desde la URL. Si no es un número entero
    // positivo ("abc", "1.5"), esa factura no puede existir: 404.
    const { id } = await params;
    const facturaId = Number(id);
    if (!Number.isInteger(facturaId) || facturaId <= 0) {
      return errorNoEncontrado('La factura no existe.', { id });
    }

    // ─────────────────────────────────────────────────────────
    // La cabecera, con el cliente y el vendedor en una sola consulta.
    // leftJoin clientes: el consumidor final no tiene cliente; en ese
    //   caso "cliente" viene null.
    // innerJoin usuarios: del vendedor pedimos SOLO id y nombre
    //   (nunca la fila entera, que tiene el hash de la contraseña).
    // ─────────────────────────────────────────────────────────
    const filas = await db
      .select({
        factura: facturas,
        cliente: {
          id: clientes.id,
          nombre: clientes.nombre,
          tipoDocumento: clientes.tipoDocumento,
          numeroDocumento: clientes.numeroDocumento,
        },
        vendedor: { id: usuarios.id, nombre: usuarios.nombre },
      })
      .from(facturas)
      .leftJoin(clientes, eq(facturas.clienteId, clientes.id))
      .innerJoin(usuarios, eq(facturas.usuarioId, usuarios.id))
      .where(eq(facturas.id, facturaId));

    const fila = filas[0];
    if (!fila) {
      return errorNoEncontrado('La factura no existe.', { id: facturaId });
    }
    const factura = fila.factura;

    // ─────────────────────────────────────────────────────────
    // Los renglones. Descripción y precio salen de factura_items, que
    // guarda la COPIA del momento de la venta (regla 3), no del
    // catálogo actual.
    // ─────────────────────────────────────────────────────────
    const items = await db
      .select()
      .from(facturaItems)
      .where(eq(facturaItems.facturaId, factura.id))
      .orderBy(facturaItems.id);

    // ─────────────────────────────────────────────────────────
    // La respuesta. Es la MISMA forma que devuelve el POST de
    // /api/facturas, así la pantalla usa una sola estructura.
    // ─────────────────────────────────────────────────────────
    let vueltoCentavos = null;
    if (factura.formaPago === 'contado' && factura.montoRecibidoCentavos !== null) {
      vueltoCentavos = factura.montoRecibidoCentavos - factura.totalCentavos;
    }

    let tarjeta = null;
    if (factura.formaPago === 'tarjeta') {
      tarjeta = {
        tipo: factura.tarjetaTipo,
        marca: factura.tarjetaMarca,
        ultimos4: factura.tarjetaUltimos4,
      };
    }

    return Response.json({
      id: factura.id,
      numero: String(factura.puntoVenta).padStart(4, '0') + '-' + String(factura.numero).padStart(8, '0'),
      fecha: factura.fecha,
      estado: factura.estado,
      // Solo tienen valor si está anulada; si no, vienen null
      motivoAnulacion: factura.motivoAnulacion,
      anuladaEn: factura.anuladaEn,
      formaPago: factura.formaPago,
      totalCentavos: factura.totalCentavos,
      montoRecibidoCentavos: factura.montoRecibidoCentavos,
      vueltoCentavos,
      tarjeta,
      clienteNombre: fila.cliente ? fila.cliente.nombre : 'Consumidor final',
      cliente: fila.cliente,
      usuario: fila.vendedor,
      items: items.map((item) => ({
        productoId: item.productoId,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitarioCentavos: item.precioUnitarioCentavos,
        subtotalCentavos: item.subtotalCentavos,
      })),
    });
  } catch (error) {
    return errorInterno(error);
  }
}
