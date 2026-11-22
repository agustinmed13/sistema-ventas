// Ficha de un producto (RF-P1 a RF-P6) — /productos/[id]
//
// SERVER COMPONENT: trae el producto y sus movimientos con los servicios
// obtenerProducto() y listarMovimientosDeProducto(), sin pasar por la API
// (consigna 10.6).
//   - Los dos roles ven los datos y el historial de movimientos (RF-P6).
//   - El admin, además, ve el ingreso/egreso de stock (RF-P4, RF-P5), la
//     edición (RF-P2) y la baja (RF-P3). El vendedor no, porque no puede
//     tocar el stock ni los productos (sección 3 de la consigna). Ocultarlos
//     NO es la protección: si llamara a la API igual, recibiría 403.
//
// La página del historial va en la URL: /productos/63?page=2

import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import {
    MOTIVOS_EGRESO,
    MOTIVOS_INGRESO,
    listarCategorias,
    listarMovimientosDeProducto,
    obtenerProducto,
} from '@/lib/servicios/productos';
import { formatearFechaHora, formatearImporte } from '@/lib/formato';
import FormularioProducto from '../formulario-producto';
import BotonEstado from './boton-estado';
import FormularioMovimiento from './formulario-movimiento';

// Cómo se muestra cada tipo de movimiento
const NOMBRE_TIPO = { venta: 'Venta', anulacion: 'Anulación', ingreso: 'Ingreso', egreso: 'Egreso' };

export default async function FichaProductoPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ [clave: string]: string | string[] | undefined }>;
}) {
    const { id } = await params;
    const { page } = await searchParams;
    const pagina = typeof page === 'string' && page !== '' ? page : null;

    return (
        <div className="mx-auto max-w-3xl space-y-4">
            <Button asChild variant="ghost" size="sm">
                <Link href="/productos">
                    <ArrowLeft />
                    Volver al catálogo
                </Link>
            </Button>

            {/* Leer el producto depende de la sesión: va en su propio Suspense */}
            <Suspense fallback={<p className="text-muted-foreground">Cargando producto...</p>}>
                <ContenidoProducto id={id} />
            </Suspense>

            {/* La key cambia con la página: al pasar de página vuelve a
                mostrar el cartel de carga */}
            <Suspense
                key={pagina ?? '1'}
                fallback={<p className="text-muted-foreground">Cargando movimientos...</p>}
            >
                <HistorialMovimientos id={id} pagina={pagina} />
            </Suspense>
        </div>
    );
}

async function ContenidoProducto({ id }: { id: string }) {
    // El layout ya garantiza la sesión; este if es para TypeScript.
    const usuario = await obtenerUsuarioActual();
    if (!usuario) redirect('/login');

    let producto;
    try {
        producto = await obtenerProducto(usuario, id);
    } catch (error) {
        // No existe (o el id no es un número) → la página 404 de Next.js
        if (error instanceof ApiError && error.status === 404) notFound();
        throw error;
    }

    const esAdmin = usuario.rol === 'admin';

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">{producto.descripcion}</h1>
                {!producto.activo && (
                    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        Inactivo
                    </span>
                )}
            </div>

            {/* ─── Datos (los ven los dos roles) ─── */}
            <dl className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-3">
                <div>
                    <dt className="text-xs text-muted-foreground">Código</dt>
                    <dd className="font-mono font-medium">{producto.codigo}</dd>
                </div>
                <div>
                    <dt className="text-xs text-muted-foreground">Categoría</dt>
                    <dd className="font-medium">{producto.categoria.nombre}</dd>
                </div>
                <div>
                    <dt className="text-xs text-muted-foreground">Precio</dt>
                    {/* Importes con lib/formato.ts (regla 10) */}
                    <dd className="font-medium">{formatearImporte(producto.precio)}</dd>
                </div>
                <div>
                    <dt className="text-xs text-muted-foreground">Existencia</dt>
                    <dd className="font-medium">
                        {producto.existencia}
                        {/* RF-P1: misma marca que el catálogo; el dato lo calcula el servidor */}
                        {producto.bajoMinimo && (
                            <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                Bajo mínimo
                            </span>
                        )}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-muted-foreground">Stock mínimo</dt>
                    <dd className="font-medium">{producto.stockMinimo}</dd>
                </div>
            </dl>

            {/* ─── Ingreso y egreso de stock (RF-P4, RF-P5): solo admin ─── */}
            {esAdmin && (
                <FormularioMovimiento
                    productoId={producto.id}
                    existencia={producto.existencia}
                    motivosIngreso={MOTIVOS_INGRESO}
                    motivosEgreso={MOTIVOS_EGRESO}
                />
            )}

            {/* ─── Edición y baja: solo admin ─── */}
            {esAdmin && (
                <>
                    <h2 className="pt-2 text-lg font-semibold">Editar</h2>
                    <FormularioProducto
                        categorias={await listarCategorias(usuario)}
                        producto={{
                            id: producto.id,
                            codigo: producto.codigo,
                            descripcion: producto.descripcion,
                            categoria: producto.categoria,
                            precio: producto.precio,
                            stockMinimo: producto.stockMinimo,
                        }}
                    />
                    <p className="text-xs text-muted-foreground">
                        La existencia no se edita a mano: cambia solo con ventas, anulaciones y movimientos de
                        stock (RF-P2).
                    </p>
                    <BotonEstado
                        productoId={producto.id}
                        descripcion={producto.descripcion}
                        activo={producto.activo}
                    />
                </>
            )}
        </>
    );
}

// ═════════════════════════════════════════════════════════════
// HISTORIAL DE MOVIMIENTOS (RF-P6): fecha, tipo, cantidad, existencia
// resultante, usuario y referencia a la factura cuando la hay.
// Del más nuevo al más viejo, paginado.
// ═════════════════════════════════════════════════════════════
async function HistorialMovimientos({ id, pagina }: { id: string; pagina: string | null }) {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) redirect('/login');

    let resultado = null;
    let mensajeError = '';
    try {
        resultado = await listarMovimientosDeProducto(usuario, id, { page: pagina, pageSize: null });
    } catch (error) {
        // Si el producto no existe, ContenidoProducto ya muestra el 404
        if (error instanceof ApiError && error.status === 404) return null;
        if (error instanceof ApiError) {
            mensajeError = error.message; // por ejemplo ?page=abc (422)
        } else {
            console.error(error);
            mensajeError = 'No se pudieron cargar los movimientos. Probá de nuevo.';
        }
    }

    return (
        <section className="space-y-3 pt-2">
            <h2 className="text-lg font-semibold">Movimientos</h2>

            {/* ─── Estado: error ─── */}
            {!resultado && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {mensajeError}
                </p>
            )}

            {/* ─── Estado: vacío ─── */}
            {resultado && resultado.data.length === 0 && (
                <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">
                    {resultado.total === 0 ? 'Este producto todavía no tiene movimientos.' : 'Esta página no tiene movimientos.'}
                </p>
            )}

            {resultado && resultado.data.length > 0 && (
                <>
                    <div className="overflow-x-auto rounded-xl border bg-card">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 font-medium">Fecha</th>
                                    <th className="px-3 py-2 font-medium">Tipo</th>
                                    <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                                    <th className="px-3 py-2 text-right font-medium">Existencia</th>
                                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Motivo</th>
                                    <th className="hidden px-3 py-2 font-medium md:table-cell">Usuario</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {resultado.data.map((m) => (
                                    <tr key={m.id}>
                                        {/* Fechas con lib/formato.ts: dd/mm/aaaa y hora de Argentina */}
                                        <td className="whitespace-nowrap px-3 py-2">{formatearFechaHora(m.fecha)}</td>
                                        <td className="px-3 py-2">{NOMBRE_TIPO[m.tipo]}</td>
                                        {/* Con signo: + suma, − resta. Así se ve que la suma
                                            de la columna da la existencia (sección 10.8, punto 5) */}
                                        <td
                                            className={`whitespace-nowrap px-3 py-2 text-right font-medium ${
                                                m.cantidad < 0 ? 'text-destructive' : 'text-primary'
                                            }`}
                                        >
                                            {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                                        </td>
                                        <td className="px-3 py-2 text-right">{m.existenciaResultante}</td>
                                        <td className="hidden px-3 py-2 sm:table-cell">
                                            {/* En ventas y anulaciones, link al comprobante */}
                                            {m.referencia ? (
                                                <Link
                                                    href={`/ventas/${m.referencia.facturaId}`}
                                                    className="text-primary hover:underline"
                                                >
                                                    Factura {m.referencia.numero}
                                                </Link>
                                            ) : (
                                                m.motivo
                                            )}
                                        </td>
                                        <td className="hidden px-3 py-2 md:table-cell">{m.usuario.nombre}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <PaginadoMovimientos
                        id={id}
                        page={resultado.page}
                        totalPaginas={Math.ceil(resultado.total / resultado.pageSize)}
                        total={resultado.total}
                    />
                </>
            )}
        </section>
    );
}

// Anterior / Siguiente del historial: links a la misma ficha con otro ?page=
function PaginadoMovimientos({
    id,
    page,
    totalPaginas,
    total,
}: {
    id: string;
    page: number;
    totalPaginas: number;
    total: number;
}) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted-foreground">
                {total} movimientos · Página {page} de {totalPaginas}
            </p>
            <div className="flex gap-2">
                {page > 1 ? (
                    <Button asChild variant="outline" size="sm">
                        <Link href={`/productos/${id}?page=${page - 1}`}>Anterior</Link>
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" disabled>
                        Anterior
                    </Button>
                )}
                {page < totalPaginas ? (
                    <Button asChild variant="outline" size="sm">
                        <Link href={`/productos/${id}?page=${page + 1}`}>Siguiente</Link>
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" disabled>
                        Siguiente
                    </Button>
                )}
            </div>
        </div>
    );
}
