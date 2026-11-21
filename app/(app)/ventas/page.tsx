// Listado de facturas (RF-V8) — /ventas
//
// SERVER COMPONENT (no tiene 'use client'): se ejecuta en el SERVIDOR y le
// manda al navegador el HTML ya armado. Por eso puede llamar directamente
// al servicio listarFacturas(), sin pasar por la API (consigna 10.6:
// "las páginas de lectura son Server Components que llaman a los
// servicios").
//
// Los filtros y la página NO se guardan en useState: viven en la URL
// (consigna 10.6). Ejemplo:
//   /ventas?forma=contado&desde=2026-11-01&page=2
// Así el listado se puede recargar (F5) o compartir el link y se ve igual.
// Los nombres de los parámetros son los de la consigna 11.6: q, desde,
// hasta, clienteId, vendedorId, forma, estado, page y pageSize.

import { Suspense } from 'react';
import Link from 'next/link';
import Form from 'next/form';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import { listarFacturas } from '@/lib/servicios/facturas';
import { formatearFechaHora, formatearImporte } from '@/lib/formato';
import { InsigniaEstado, nombreFormaPago } from './etiquetas';

// Lo que llega en la URL después del "?". Cada valor puede ser un texto,
// una lista (si el parámetro se repite) o no venir.
type ParametrosURL = { [clave: string]: string | string[] | undefined };

type Filtros = {
  q: string | null;
  desde: string | null;
  hasta: string | null;
  clienteId: string | null;
  vendedorId: string | null;
  forma: string | null;
  estado: string | null;
  page: string | null;
  pageSize: string | null;
};

// Un parámetro de la URL → texto, o null si no vino o vino vacío.
// (El formulario manda los campos vacíos como "?desde=".)
function leer(valor: string | string[] | undefined): string | null {
  if (typeof valor === 'string' && valor.trim() !== '') return valor;
  return null;
}

// Arma la URL de otra página conservando los filtros actuales
function urlDePagina(filtros: Filtros, page: number) {
  const parametros = new URLSearchParams();
  if (filtros.q) parametros.set('q', filtros.q);
  if (filtros.desde) parametros.set('desde', filtros.desde);
  if (filtros.hasta) parametros.set('hasta', filtros.hasta);
  if (filtros.clienteId) parametros.set('clienteId', filtros.clienteId);
  if (filtros.vendedorId) parametros.set('vendedorId', filtros.vendedorId);
  if (filtros.forma) parametros.set('forma', filtros.forma);
  if (filtros.estado) parametros.set('estado', filtros.estado);
  if (filtros.pageSize) parametros.set('pageSize', filtros.pageSize);
  parametros.set('page', String(page));
  return '/ventas?' + parametros.toString();
}

// Estilo de los campos del filtro, parecido al de los botones de shadcn
const claseCampo =
  'h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

// ═════════════════════════════════════════════════════════════
// LA PÁGINA
// En Next.js 16, searchParams es una promesa: hay que esperarla con await.
// ═════════════════════════════════════════════════════════════
export default async function VentasPage({ searchParams }: { searchParams: Promise<ParametrosURL> }) {
  const parametros = await searchParams;

  const filtros: Filtros = {
    q: leer(parametros.q),
    desde: leer(parametros.desde),
    hasta: leer(parametros.hasta),
    clienteId: leer(parametros.clienteId),
    vendedorId: leer(parametros.vendedorId),
    forma: leer(parametros.forma),
    estado: leer(parametros.estado),
    page: leer(parametros.page),
    pageSize: leer(parametros.pageSize),
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Ventas</h1>
        {/* asChild: el Button de shadcn le pone su estilo al Link de adentro */}
        <Button asChild>
          <Link href="/ventas/nueva">
            <Plus />
            Nueva venta
          </Link>
        </Button>
      </div>

      {/* ─── Filtros (RF-V8) ───
          <Form> de Next.js es un <form> que, al enviarse, navega a
          action + los campos como parámetros:
            /ventas?q=gonzalez&desde=2026-11-01&hasta=&forma=contado&estado=
          No hace falta JavaScript propio ni useState: la URL es el estado.
          Como no lleva el campo "page", filtrar siempre vuelve a la página 1. */}
      <Form action="/ventas" className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 space-y-1 sm:col-span-3 lg:col-span-1">
          <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
            Número o cliente
          </label>
          <input
            id="q"
            name="q"
            type="text"
            placeholder="42 o González"
            defaultValue={filtros.q ?? ''}
            className={claseCampo}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="desde" className="text-xs font-medium text-muted-foreground">
            Desde
          </label>
          {/* type="date" devuelve AAAA-MM-DD, el formato que espera el servicio */}
          <input id="desde" name="desde" type="date" defaultValue={filtros.desde ?? ''} className={claseCampo} />
        </div>
        <div className="space-y-1">
          <label htmlFor="hasta" className="text-xs font-medium text-muted-foreground">
            Hasta
          </label>
          <input id="hasta" name="hasta" type="date" defaultValue={filtros.hasta ?? ''} className={claseCampo} />
        </div>
        <div className="space-y-1">
          <label htmlFor="forma" className="text-xs font-medium text-muted-foreground">
            Forma de pago
          </label>
          <select id="forma" name="forma" defaultValue={filtros.forma ?? ''} className={claseCampo}>
            <option value="">Todas</option>
            <option value="contado">Contado</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="cuenta_corriente">Cuenta corriente</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="estado" className="text-xs font-medium text-muted-foreground">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={filtros.estado ?? ''} className={claseCampo}>
            <option value="">Todos</option>
            <option value="emitida">Emitida</option>
            <option value="anulada">Anulada</option>
          </select>
        </div>
        {/* Los filtros que no tienen campo en pantalla (cliente, vendedor,
            tamaño de página) se conservan si ya estaban en la URL */}
        {filtros.clienteId && <input type="hidden" name="clienteId" value={filtros.clienteId} />}
        {filtros.vendedorId && <input type="hidden" name="vendedorId" value={filtros.vendedorId} />}
        {filtros.pageSize && <input type="hidden" name="pageSize" value={filtros.pageSize} />}
        <div className="flex items-end gap-2 sm:col-span-1">
          <Button type="submit" className="flex-1">
            Filtrar
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link href="/ventas">Limpiar</Link>
          </Button>
        </div>
      </Form>

      {/* ─── La tabla ───
          <Suspense> muestra el "fallback" (Cargando...) mientras la tabla
          espera los datos del servidor. La "key" cambia con los filtros:
          así, al filtrar o cambiar de página, vuelve a mostrar el cartel
          de carga en vez de dejar la tabla vieja. */}
      <Suspense
        key={JSON.stringify(filtros)}
        fallback={<p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">Cargando facturas...</p>}
      >
        <TablaFacturas filtros={filtros} />
      </Suspense>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// LA TABLA — también Server Component. Es "async": espera los datos
// del servicio antes de dibujarse.
// ═════════════════════════════════════════════════════════════
async function TablaFacturas({ filtros }: { filtros: Filtros }) {
  // El layout ya garantiza que hay sesión; este if es para que TypeScript
  // sepa que usuario no es null.
  const usuario = await obtenerUsuarioActual();
  if (!usuario) redirect('/login');

  // Llamamos al servicio directo (sin fetch). Si falla, guardamos el
  // mensaje para mostrar el estado de error.
  let resultado = null;
  let mensajeError = '';
  try {
    resultado = await listarFacturas(usuario, filtros);
  } catch (error) {
    if (error instanceof ApiError) {
      // Un error esperado, por ejemplo una fecha mal escrita en la URL (422)
      mensajeError = error.message;
    } else {
      // Un error inesperado: el detalle va a la consola del servidor,
      // al usuario un mensaje genérico
      console.error(error);
      mensajeError = 'No se pudieron cargar las facturas. Probá de nuevo.';
    }
  }

  // ─── Estado: error ───
  if (!resultado) {
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {mensajeError}
      </p>
    );
  }

  // ─── Estado: vacío ───
  if (resultado.data.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
        {resultado.total === 0 ? 'No hay facturas con estos filtros.' : 'Esta página no tiene facturas.'}
      </p>
    );
  }

  // ─── Paginado (RF-V8, sección 11.1) ───
  const { page, pageSize, total, totalEmitido } = resultado;
  const totalPaginas = Math.ceil(total / pageSize);
  const primera = (page - 1) * pageSize + 1; // "Mostrando 21–40 de 137"
  const ultima = primera + resultado.data.length - 1;

  return (
    <div className="space-y-3">
      {/* overflow-x-auto: si la tabla no entra (360px), se desliza ella
          sola de costado, sin romper el resto de la página */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Número</th>
              {/* hidden sm:table-cell: en el celular se ocultan las columnas
                  menos importantes para que la tabla entre */}
              <th className="hidden px-3 py-2 font-medium sm:table-cell">Fecha</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">Forma de pago</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {resultado.data.map((f) => (
              <tr key={f.id} className={f.estado === 'anulada' ? 'text-muted-foreground' : 'hover:bg-muted/50'}>
                <td className="px-3 py-2 font-mono">
                  {/* Cada fila lleva a su comprobante */}
                  <Link href={`/ventas/${f.id}`} className="font-medium text-primary hover:underline">
                    {f.numeroFormateado}
                  </Link>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">{formatearFechaHora(f.fecha)}</td>
                {/* cliente null = consumidor final */}
                <td className="px-3 py-2">{f.cliente ? f.cliente.nombre : 'Consumidor final'}</td>
                <td className="hidden px-3 py-2 md:table-cell">{nombreFormaPago(f.pago.forma)}</td>
                <td
                  className={`whitespace-nowrap px-3 py-2 text-right font-medium ${
                    f.estado === 'anulada' ? 'line-through' : ''
                  }`}
                >
                  {formatearImporte(f.total)}
                </td>
                <td className="px-3 py-2">
                  <InsigniaEstado estado={f.estado} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="text-muted-foreground">
          <p>
            Mostrando {primera}–{ultima} de {total} · Página {page} de {totalPaginas}
          </p>
          {/* totalEmitido (consigna 11.6): suma de las EMITIDAS que cumplen
              los filtros, de todas las páginas. Las anuladas no suman. */}
          <p>
            Total emitido: <span className="font-medium text-foreground">{formatearImporte(totalEmitido)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {/* Anterior y Siguiente son links a la misma página con otro
              "page" en la URL. En la primera o la última, se deshabilitan. */}
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={urlDePagina(filtros, page - 1)}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Anterior
            </Button>
          )}
          {page < totalPaginas ? (
            <Button asChild variant="outline" size="sm">
              <Link href={urlDePagina(filtros, page + 1)}>Siguiente</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Siguiente
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
