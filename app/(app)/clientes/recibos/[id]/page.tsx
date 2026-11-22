// Recibo de pago imprimible (RF-C5) — /clientes/recibos/[id]
//
// SERVER COMPONENT: trae el recibo con el servicio obtenerPago()
// (lib/servicios/pagos.ts), sin pasar por la API (consigna 10.6). Es el
// mismo objeto que devuelve GET /api/pagos/[id].
//
// Se llega desde el aviso de "Pago registrado" y desde cada renglón de
// pago en la cuenta corriente de la ficha.
//
// OJO: "recibos" es un segmento FIJO y Next.js lo prioriza sobre [id].
// Por eso /clientes/recibos/7 llega acá y no a la ficha de un cliente.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import { obtenerPago } from '@/lib/servicios/pagos';
import { formatearFechaHora, formatearImporte } from '@/lib/formato';
import BotonImprimir from './boton-imprimir';

// 'tarjeta_debito' → 'Tarjeta de débito' (valores de la sección 5.1)
function nombreMedio(medio: string) {
  if (medio === 'efectivo') return 'Efectivo';
  if (medio === 'transferencia') return 'Transferencia';
  if (medio === 'tarjeta_debito') return 'Tarjeta de débito';
  return medio;
}

// Al imprimir, se oculta TODO menos el recibo: así no salen en el papel el
// menú lateral ni la barra de arriba (que son del layout general).
// Cómo funciona: "visibility: hidden" esconde todo el body; después se
// vuelve visible solo #recibo y lo que tiene adentro, y se lo pone arriba
// de todo en la hoja. Vive acá para no tocar el layout, que es compartido.
const estiloImpresion = `
@media print {
  body * { visibility: hidden; }
  #recibo, #recibo * { visibility: visible; }
  #recibo { position: absolute; left: 0; top: 0; width: 100%; }
}
`;

export default async function ReciboPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // El layout ya garantiza la sesión; este if es para TypeScript.
  const usuario = await obtenerUsuarioActual();
  if (!usuario) redirect('/login');

  // Si el servicio dice 404, la página de "no encontrado" (not-found.tsx)
  let recibo;
  try {
    recibo = await obtenerPago(usuario, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <style>{estiloImpresion}</style>

      {/* ─── Acciones (no se imprimen) ─── */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/clientes/${recibo.cliente.id}`}>
            <ArrowLeft />
            Volver a la ficha
          </Link>
        </Button>
        <BotonImprimir />
      </div>

      {/* ─── El recibo ─── print:border-0: en papel sin el recuadro */}
      <article id="recibo" className="space-y-6 rounded-xl border bg-card p-4 sm:p-6 print:border-0 print:p-0">
        <header className="border-b pb-4">
          <p className="text-sm text-muted-foreground">Recibo de pago</p>
          {/* numeroRecibo es texto: "R 0001-00000003" (regla 4) */}
          <h1 className="font-mono text-2xl font-semibold">{recibo.numeroRecibo}</h1>
        </header>

        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Fecha y hora</dt>
            <dd className="font-medium">{formatearFechaHora(recibo.fecha)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Recibimos de</dt>
            <dd className="font-medium">{recibo.cliente.nombre}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Medio de pago</dt>
            <dd className="font-medium">{nombreMedio(recibo.medio)}</dd>
          </div>
          <div>
            {/* Regla 11: quién registró el pago */}
            <dt className="text-muted-foreground">Atendió</dt>
            <dd className="font-medium">{recibo.usuario.nombre}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-end justify-between gap-4 border-t pt-4">
          <div>
            <p className="text-sm text-muted-foreground">Importe recibido</p>
            <p className="text-3xl font-semibold">{formatearImporte(recibo.importe)}</p>
          </div>
          <div className="text-right">
            {/* El saldo que le quedó DESPUÉS de este pago, no el de hoy:
                así el recibo reimpreso dice lo mismo que el original */}
            <p className="text-sm text-muted-foreground">Saldo después del pago</p>
            <p className="text-xl font-semibold">{formatearImporte(recibo.saldoCliente)}</p>
          </div>
        </div>
      </article>
    </div>
  );
}
