// Listado de clientes (RF-C1) y saldos (RF-C6) — /clientes
//
// SERVER COMPONENT (no tiene 'use client'): se ejecuta en el SERVIDOR y
// llama directo al servicio listarClientes(), sin pasar por la API
// (consigna 10.6: "las páginas de lectura son Server Components que llaman
// a los servicios"). Mismo esquema que los listados de ventas y productos.
//
// Los filtros viven en la URL, no en useState (consigna 10.6). Ejemplo:
//   /clientes?q=perez&conDeuda=true&orden=saldo&page=2
// Así se puede recargar (F5) o compartir el link y se ve igual.
// Los nombres de los parámetros son los de la API (AGENTS.md 5.1).

import { Suspense } from 'react';
import Link from 'next/link';
import Form from 'next/form';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import { listarClientes } from '@/lib/servicios/clientes';
import { formatearImporte, formatearDocumento } from '@/lib/formato';

// Lo que llega en la URL después del "?".
type ParametrosURL = { [clave: string]: string | string[] | undefined };

type Filtros = {
  q: string | null;
  conDeuda: string | null;
  orden: string | null;
  page: string | null;
  pageSize: string | null;
};

// Un parámetro de la URL → texto, o null si no vino o vino vacío.
// (El formulario manda los campos vacíos como "?q=".)
function leer(valor: string | string[] | undefined): string | null {
  if (typeof valor === 'string' && valor.trim() !== '') return valor;
  return null;
}

// Arma la URL de otra página conservando los filtros actuales.
function urlDePagina(filtros: Filtros, page: number) {
  const parametros = new URLSearchParams();
  if (filtros.q) parametros.set('q', filtros.q);
  if (filtros.conDeuda) parametros.set('conDeuda', filtros.conDeuda);
  if (filtros.orden) parametros.set('orden', filtros.orden);
  if (filtros.pageSize) parametros.set('pageSize', filtros.pageSize);
  parametros.set('page', String(page));
  return '/clientes?' + parametros.toString();
}

// Mismo estilo de campo que los filtros de ventas y productos (sección 8)
const claseCampo =
  'h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

// ═════════════════════════════════════════════════════════════
// LA PÁGINA
// En Next.js 16, searchParams es una promesa: hay que esperarla con await.
// ═════════════════════════════════════════════════════════════
export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<ParametrosURL>;
}) {
  const parametros = await searchParams;

  const filtros: Filtros = {
    q: leer(parametros.q),
    conDeuda: leer(parametros.conDeuda),
    orden: leer(parametros.orden),
    page: leer(parametros.page),
    pageSize: leer(parametros.pageSize),
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">Clientes</h1>

      <FiltrosClientes filtros={filtros} />

      {/* La "key" cambia con los filtros: al filtrar o cambiar de página
          vuelve a mostrar el cartel de carga. */}
      <Suspense
        key={JSON.stringify(filtros)}
        fallback={
          <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
            Cargando clientes...
          </p>
        }
      >
        <TablaClientes filtros={filtros} />
      </Suspense>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// FILTROS — búsqueda, solo con deuda y orden.
//
// <Form> de Next.js es un <form> que, al enviarse, navega a action + los
// campos como parámetros: /clientes?q=perez&conDeuda=true&orden=saldo
// No hace falta useState: la URL es el estado. Como no lleva "page",
// filtrar siempre vuelve a la página 1.
// ═════════════════════════════════════════════════════════════
function FiltrosClientes({ filtros }: { filtros: Filtros }) {
  return (
    <Form
      action="/clientes"
      className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-4"
    >
      <div className="col-span-2 space-y-1">
        <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
          Nombre o documento
        </label>
        {/* La búsqueda no distingue mayúsculas, tildes, puntos ni guiones
            (RF-C1): lo resuelve el servicio. */}
        <input
          id="q"
          name="q"
          type="search"
          placeholder="López o 28.456.123"
          defaultValue={filtros.q ?? ''}
          className={claseCampo}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="orden" className="text-xs font-medium text-muted-foreground">
          Ordenar por
        </label>
        <select id="orden" name="orden" defaultValue={filtros.orden ?? ''} className={claseCampo}>
          {/* Vacío = el valor por defecto del servicio (nombre) */}
          <option value="">Nombre</option>
          <option value="saldo">Mayor deuda</option>
        </select>
      </div>

      {/* RF-C6: ver solo los que deben */}
      <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
        <input
          type="checkbox"
          name="conDeuda"
          value="true"
          defaultChecked={filtros.conDeuda === 'true'}
          className="size-4 accent-primary"
        />
        Solo con deuda
      </label>

      {filtros.pageSize && <input type="hidden" name="pageSize" value={filtros.pageSize} />}

      <div className="col-span-2 flex items-end gap-2 sm:col-span-4 sm:justify-end">
        <Button type="submit" className="flex-1 sm:flex-none">
          Filtrar
        </Button>
        <Button asChild variant="outline" className="flex-1 sm:flex-none">
          <Link href="/clientes">Limpiar</Link>
        </Button>
      </div>
    </Form>
  );
}

// ═════════════════════════════════════════════════════════════
// LA TABLA — también Server Component: espera los datos del servicio.
// ═════════════════════════════════════════════════════════════
async function TablaClientes({ filtros }: { filtros: Filtros }) {
  // El layout ya garantiza la sesión; este if es para TypeScript.
  const usuario = await obtenerUsuarioActual();
  if (!usuario) redirect('/login');

  let resultado = null;
  let mensajeError = '';
  let detallesError: string[] = [];
  try {
    resultado = await listarClientes(usuario, filtros);
  } catch (error) {
    if (error instanceof ApiError) {
      // Error esperado: un filtro mal escrito en la URL (422). Mostramos
      // el mensaje y el detalle de cada campo ("details", sección 11.1).
      mensajeError = error.message;
      // Algunos errores traen otros datos en details (por ejemplo los de
      // stock traen productoId): nos quedamos solo con los que tienen mensaje.
      detallesError = (error.details ?? []).flatMap((d) =>
        'mensaje' in d ? [String(d.mensaje)] : []
      );
    } else {
      console.error(error);
      mensajeError = 'No se pudieron cargar los clientes. Probá de nuevo.';
    }
  }

  // ─── Estado: error ───
  if (!resultado) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <p>{mensajeError}</p>
        {detallesError.length > 0 && (
          <ul className="mt-1 list-disc pl-5">
            {detallesError.map((mensaje) => (
              <li key={mensaje}>{mensaje}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ─── Estado: vacío ───
  if (resultado.data.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
        {resultado.total === 0 ? 'No hay clientes con estos filtros.' : 'Esta página no tiene clientes.'}
      </p>
    );
  }

  // ─── Paginado (sección 11.1) ───
  const { page, pageSize, total } = resultado;
  const totalPaginas = Math.ceil(total / pageSize);
  const primera = (page - 1) * pageSize + 1;
  const ultima = primera + resultado.data.length - 1;

  return (
    <div className="space-y-3">
      {/* RF-C6: con "Solo con deuda", el total adeudado de TODOS los que
          deben (no solo los de esta página). Lo calcula el servicio. */}
      {resultado.totalAdeudado !== undefined && (
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Total adeudado</p>
          <p className="text-2xl font-semibold">{formatearImporte(resultado.totalAdeudado)}</p>
        </div>
      )}

      {/* overflow-x-auto: si la tabla no entra en 360 px, se desliza de
          costado sin romper el resto de la página (sección 8) */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Nombre</th>
              <th className="px-3 py-2 font-medium">Documento</th>
              {/* En el celular se ocultan las columnas menos importantes */}
              <th className="hidden px-3 py-2 font-medium md:table-cell">Teléfono</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Límite</th>
              <th className="px-3 py-2 text-right font-medium">Saldo</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Disponible</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {resultado.data.map((c) => (
              <tr
                key={c.id}
                // Los dados de baja van en gris (regla 12: no se borran)
                className={c.activo ? 'hover:bg-muted/50' : 'text-muted-foreground'}
              >
                <td className="px-3 py-2">
                  {/* El nombre lleva a la ficha del cliente (RF-C3) */}
                  <Link href={`/clientes/${c.id}`} className="font-medium text-primary hover:underline">
                    {c.nombre}
                  </Link>
                  {!c.activo && (
                    <span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      Inactivo
                    </span>
                  )}
                </td>
                {/* Documento y teléfono con lib/formato.ts: DNI 28.456.123 */}
                <td className="whitespace-nowrap px-3 py-2">{formatearDocumento(c.tipoDoc, c.nroDoc)}</td>
                <td className="hidden whitespace-nowrap px-3 py-2 md:table-cell">{c.telefono ?? '—'}</td>
                {/* Sin cuenta corriente no hay límite ni disponible: se
                    aclara en lugar de dejar la celda vacía */}
                <td className="hidden whitespace-nowrap px-3 py-2 text-right sm:table-cell">
                  {!c.cuentaCorriente ? (
                    <span className="text-muted-foreground">Sin cuenta</span>
                  ) : c.limiteCredito === null ? (
                    <span className="text-muted-foreground">Sin límite</span>
                  ) : (
                    formatearImporte(c.limiteCredito)
                  )}
                </td>
                {/* Importes con lib/formato.ts: $ 12.345,50 (regla 10).
                    Con deuda, en negrita para que se vea de un vistazo. */}
                <td
                  className={
                    'whitespace-nowrap px-3 py-2 text-right ' + (c.saldo > 0 ? 'font-semibold' : '')
                  }
                >
                  {formatearImporte(c.saldo)}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-right sm:table-cell">
                  {c.disponible === null ? '—' : formatearImporte(c.disponible)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          Mostrando {primera}–{ultima} de {total} · Página {page} de {totalPaginas}
        </p>
        <div className="flex gap-2">
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
