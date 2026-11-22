// Ficha del cliente (RF-C3) con su cuenta corriente (RF-C4) — /clientes/[id]
//
// SERVER COMPONENT: se ejecuta en el servidor y llama directo a los
// servicios obtenerCliente() y obtenerCuentaCorriente(), sin pasar por la
// API (consigna 10.6). Solo el formulario de pago es Client Component
// (formulario-pago.tsx), porque es lo único interactivo.
//
// Los filtros de la cuenta corriente viven en la URL, como en los listados:
//   /clientes/12?desde=2026-11-01&hasta=2026-11-30

import Link from 'next/link';
import Form from 'next/form';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import { obtenerCliente, obtenerCuentaCorriente } from '@/lib/servicios/clientes';
import { formatearDocumento, formatearFecha, formatearFechaHora, formatearImporte } from '@/lib/formato';
import { InsigniaEstado, nombreFormaPago } from '../../ventas/etiquetas';
import FormularioPago from './formulario-pago';

type ParametrosURL = { [clave: string]: string | string[] | undefined };

// Un parámetro de la URL → texto, o null si no vino o vino vacío
function leer(valor: string | string[] | undefined): string | null {
  if (typeof valor === 'string' && valor.trim() !== '') return valor;
  return null;
}

const claseCampo =
  'h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

// En Next.js 16, params y searchParams son promesas: hay que esperarlas.
// /clientes/12 llega acá con id = "12".
export default async function FichaClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParametrosURL>;
}) {
  const { id } = await params;
  const parametros = await searchParams;
  const desde = leer(parametros.desde);
  const hasta = leer(parametros.hasta);

  // El layout ya garantiza la sesión; este if es para TypeScript.
  const usuario = await obtenerUsuarioActual();
  if (!usuario) redirect('/login');

  // ─────────────────────────────────────────────────────────
  // Traer el cliente. Si el servicio dice 404 (no existe, o el id es
  // "abc"), notFound() muestra la página de "no encontrado" de Next.js.
  // Cualquier otro error se relanza y lo muestra la página de error.
  // ─────────────────────────────────────────────────────────
  let cliente;
  try {
    cliente = await obtenerCliente(usuario, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // ─────────────────────────────────────────────────────────
  // La cuenta corriente. Si las fechas de la URL están mal (422), no se
  // rompe la ficha: se muestra el error en la sección de la cuenta.
  // ─────────────────────────────────────────────────────────
  let cuenta = null;
  let errorCuenta = '';
  try {
    cuenta = await obtenerCuentaCorriente(usuario, id, { desde, hasta });
  } catch (error) {
    if (error instanceof ApiError) {
      const detalles = (error.details ?? []).flatMap((d) => ('mensaje' in d ? [String(d.mensaje)] : []));
      errorCuenta = [error.message, ...detalles].join(' ');
    } else {
      throw error;
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/clientes">
          <ArrowLeft />
          Volver al listado
        </Link>
      </Button>

      {/* ─── Encabezado ─── */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold">{cliente.nombre}</h1>
        <span className="text-muted-foreground">{formatearDocumento(cliente.tipoDoc, cliente.nroDoc)}</span>
        {!cliente.activo && (
          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Inactivo</span>
        )}
      </div>

      {/* ─── Datos y saldo (RF-C3) ─── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 rounded-xl border bg-card p-4 text-sm">
          <p>
            <span className="text-muted-foreground">Domicilio: </span>
            {cliente.domicilio ?? '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Teléfono: </span>
            {cliente.telefono ?? '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Email: </span>
            {cliente.email ?? '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Cuenta corriente: </span>
            {cliente.cuentaCorriente ? 'Habilitada' : 'No habilitada'}
          </p>
        </div>

        {/* Saldo, límite y disponible: los calcula el servidor (regla 7) */}
        <div className="grid grid-cols-3 gap-2 rounded-xl border bg-card p-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Saldo</p>
            <p className="text-xl font-semibold">{formatearImporte(cliente.saldo)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Límite</p>
            <p className="text-xl font-semibold">
              {cliente.limiteCredito === null ? '—' : formatearImporte(cliente.limiteCredito)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Disponible</p>
            <p className="text-xl font-semibold">
              {cliente.disponible === null ? '—' : formatearImporte(cliente.disponible)}
            </p>
          </div>
        </div>
      </div>

      {/* ─── Registrar pago (RF-C5) ───
          Solo tiene sentido con cuenta corriente (regla 6). Ocultarlo es
          comodidad visual: el servidor igual responde 422 si no la tiene. */}
      {cliente.cuentaCorriente && <FormularioPago clienteId={cliente.id} saldo={cliente.saldo} />}

      {/* ─── Últimas facturas (RF-C3) ─── */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Últimas facturas</h2>
        {cliente.ultimasFacturas.length === 0 ? (
          <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
            Todavía no tiene facturas.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Número</th>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Forma de pago</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cliente.ultimasFacturas.map((f) => (
                  <tr key={f.id} className="hover:bg-muted/50">
                    {/* Link al comprobante del módulo de ventas */}
                    <td className="whitespace-nowrap px-3 py-2 font-mono">
                      <Link href={`/ventas/${f.id}`} className="text-primary hover:underline">
                        {f.numeroFormateado}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{formatearFecha(f.fecha)}</td>
                    <td className="hidden px-3 py-2 sm:table-cell">{nombreFormaPago(f.pago.forma)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatearImporte(f.total)}</td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      <InsigniaEstado estado={f.estado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Cuenta corriente (RF-C4) ─── */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Cuenta corriente</h2>

        {/* Filtro por fechas. <Form> navega a esta misma ficha con
            ?desde=...&hasta=... ; type="date" manda AAAA-MM-DD, el formato
            que espera el servicio (sección 11.1). */}
        <Form action={`/clientes/${cliente.id}`} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
          <div className="space-y-1">
            <label htmlFor="desde" className="text-xs font-medium text-muted-foreground">
              Desde
            </label>
            <input id="desde" name="desde" type="date" defaultValue={desde ?? ''} className={claseCampo} />
          </div>
          <div className="space-y-1">
            <label htmlFor="hasta" className="text-xs font-medium text-muted-foreground">
              Hasta
            </label>
            <input id="hasta" name="hasta" type="date" defaultValue={hasta ?? ''} className={claseCampo} />
          </div>
          <Button type="submit" size="sm">
            Filtrar
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/clientes/${cliente.id}`}>Ver todo</Link>
          </Button>
        </Form>

        {/* Estado: error (fechas mal escritas en la URL) */}
        {!cuenta ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {errorCuenta}
          </div>
        ) : cuenta.movimientos.length === 0 ? (
          // Estado: vacío
          <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
            No hay movimientos en este período.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Descripción</th>
                  <th className="px-3 py-2 text-right font-medium">Débito</th>
                  <th className="px-3 py-2 text-right font-medium">Crédito</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {/* Con "desde", el primer renglón es lo que ya debía antes:
                    así el saldo acumulado no arranca de cero */}
                {desde && (
                  <tr className="text-muted-foreground">
                    <td className="px-3 py-2" colSpan={4}>
                      Saldo anterior al {formatearFecha(desde + 'T12:00:00Z')}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatearImporte(cuenta.saldoAnterior)}</td>
                  </tr>
                )}
                {cuenta.movimientos.map((m, indice) => (
                  <tr key={indice} className="hover:bg-muted/50">
                    <td className="whitespace-nowrap px-3 py-2">{formatearFechaHora(m.fecha)}</td>
                    <td className="px-3 py-2">
                      {/* Si viene de una factura, link al comprobante */}
                      {m.facturaId !== null ? (
                        <Link href={`/ventas/${m.facturaId}`} className="text-primary hover:underline">
                          {m.descripcion}
                        </Link>
                      ) : (
                        m.descripcion
                      )}
                    </td>
                    {/* Débito aumenta la deuda, crédito la baja (regla 7) */}
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {m.tipo === 'debito' ? formatearImporte(m.importe) : ''}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {m.tipo === 'credito' ? formatearImporte(m.importe) : ''}
                    </td>
                    {/* El saldo acumulado lo calcula el servicio */}
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{formatearImporte(m.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
