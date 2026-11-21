// Comprobante de una factura (RF-V7) — /ventas/[id]
//
// SERVER COMPONENT: se ejecuta en el servidor y llama directo al servicio
// obtenerFactura(), sin pasar por la API (consigna 10.6).
// Solo el botón de anular es Client Component (boton-anular.tsx).

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import { obtenerFactura } from '@/lib/servicios/facturas';
import { formatearDocumento, formatearFechaHora, formatearImporte } from '@/lib/formato';
import { InsigniaEstado, nombreFormaPago } from '../etiquetas';
import BotonAnular from './boton-anular';

// En Next.js 16, params es una promesa: hay que esperarla con await.
// /ventas/53 llega acá con id = "53".
export default async function ComprobantePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // El layout ya garantiza que hay sesión, pero acá necesitamos el ROL
  // para decidir si se muestra el botón de anular.
  const usuario = await obtenerUsuarioActual();
  if (!usuario) redirect('/login');

  // ─────────────────────────────────────────────────────────
  // Traer la factura.
  // Si el servicio dice 404 (no existe, o el id es "abc"), llamamos a
  // notFound(): corta acá y Next.js muestra su página de "no encontrado"
  // con código HTTP 404. Cualquier otro error se relanza: lo muestra la
  // página de error de Next.js.
  // ─────────────────────────────────────────────────────────
  let factura;
  try {
    factura = await obtenerFactura(usuario, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const anulada = factura.estado === 'anulada';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* ─── Acciones (no se imprimen) ─── */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/ventas">
            <ArrowLeft />
            Volver al listado
          </Link>
        </Button>

        {/* RF-V9: el botón solo aparece para el admin y si la factura
            sigue emitida. Es COMODIDAD VISUAL: el permiso real lo verifica
            el servidor, que responde 403 a un vendedor aunque llame
            directo a la ruta (ver el comentario en boton-anular.tsx). */}
        {usuario.rol === 'admin' && !anulada && <BotonAnular facturaId={factura.id} numero={factura.numero} />}
      </div>

      {/* ─── Cartel de anulada (RF-V9) ─── */}
      {anulada && (
        <div className="rounded-xl border-2 border-destructive bg-destructive/5 p-4 text-destructive">
          <p className="text-lg font-semibold">FACTURA ANULADA</p>
          {factura.anuladaEn && <p className="text-sm">Anulada el {formatearFechaHora(factura.anuladaEn)}</p>}
          <p className="text-sm">Motivo: {factura.motivoAnulacion}</p>
        </div>
      )}

      {/* ─── El comprobante ───
          print:border-0 print:shadow-none: en papel sin el recuadro */}
      <article className="space-y-6 rounded-xl border bg-card p-4 sm:p-6 print:border-0 print:p-0">
        {/* Cabecera */}
        <header className="flex flex-wrap items-start justify-between gap-2 border-b pb-4">
          <div>
            <p className="text-sm text-muted-foreground">Factura</p>
            {/* El número llega ya formateado del servicio: 0001-00000053 */}
            <h1 className="font-mono text-2xl font-semibold">{factura.numero}</h1>
          </div>
          <InsigniaEstado estado={factura.estado} />
        </header>

        {/* Datos generales */}
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Fecha y hora</dt>
            <dd className="font-medium">{formatearFechaHora(factura.fecha)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Vendedor</dt>
            <dd className="font-medium">{factura.usuario.nombre}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Comprador</dt>
            <dd className="font-medium">{factura.clienteNombre}</dd>
            {/* Consumidor final no tiene documento */}
            {factura.cliente && (
              <dd className="text-muted-foreground">
                {formatearDocumento(factura.cliente.tipoDocumento, factura.cliente.numeroDocumento)}
              </dd>
            )}
          </div>
        </dl>

        {/* Ítems: descripción y precio son la COPIA del momento de la
            venta (regla 3), no los del catálogo actual */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-2 font-medium">Descripción</th>
                <th className="px-2 py-2 text-right font-medium">Cant.</th>
                <th className="px-2 py-2 text-right font-medium">P. unitario</th>
                <th className="py-2 pl-2 text-right font-medium">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {factura.items.map((item) => (
                <tr key={item.productoId}>
                  <td className="py-2 pr-2">{item.descripcion}</td>
                  <td className="px-2 py-2 text-right">{item.cantidad}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {formatearImporte(item.precioUnitarioCentavos)}
                  </td>
                  <td className="whitespace-nowrap py-2 pl-2 text-right">{formatearImporte(item.subtotalCentavos)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td colSpan={3} className="py-3 pr-2 text-right font-semibold">
                  Total
                </td>
                <td className="whitespace-nowrap py-3 pl-2 text-right text-lg font-semibold">
                  {formatearImporte(factura.totalCentavos)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Forma de pago (RF-V5) — lo que se muestra depende de cuál fue */}
        <section className="space-y-1 rounded-lg bg-muted p-4 text-sm">
          <p>
            <span className="text-muted-foreground">Forma de pago: </span>
            <span className="font-medium">{nombreFormaPago(factura.formaPago)}</span>
          </p>

          {factura.formaPago === 'contado' && factura.montoRecibidoCentavos !== null && (
            <>
              <p>
                <span className="text-muted-foreground">Recibido: </span>
                {formatearImporte(factura.montoRecibidoCentavos)}
              </p>
              {factura.vueltoCentavos !== null && (
                <p>
                  <span className="text-muted-foreground">Vuelto: </span>
                  <span className="font-medium">{formatearImporte(factura.vueltoCentavos)}</span>
                </p>
              )}
            </>
          )}

          {/* Regla 9: de la tarjeta solo existen tipo, marca y últimos 4 */}
          {factura.formaPago === 'tarjeta' && factura.tarjeta && (
            <p>
              {factura.tarjeta.tipo === 'credito' ? 'Crédito' : 'Débito'} · {factura.tarjeta.marca} · terminada en{' '}
              {factura.tarjeta.ultimos4}
            </p>
          )}

          {factura.formaPago === 'cuenta_corriente' && (
            <p className="text-muted-foreground">El total se cargó a la cuenta corriente del cliente.</p>
          )}
        </section>
      </article>
    </div>
  );
}
