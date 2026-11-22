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
import EncabezadoPagina from '@/components/encabezado-pagina';
import Paginador from '@/components/paginador';
import Insignia from '@/components/insignia';
import { CartelCarga, CartelError, CartelVacio, textoDeError } from '@/components/estados';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import {
    MOTIVOS_EGRESO,
    MOTIVOS_INGRESO,
    listarCategorias,
    listarMovimientosDeProducto,
    obtenerProducto,
} from '@/lib/servicios/productos';
import { formatearImporte } from '@/lib/formato';
import FormularioProducto from '../formulario-producto';
import TablaMovimientos from '../tabla-movimientos';
import BotonEstado from './boton-estado';
import FormularioMovimiento from './formulario-movimiento';

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
            <Suspense fallback={<CartelCarga texto="Cargando producto..." />}>
                <ContenidoProducto id={id} />
            </Suspense>

            {/* La key cambia con la página: al pasar de página vuelve a
                mostrar el cartel de carga */}
            <Suspense
                key={pagina ?? '1'}
                fallback={<CartelCarga texto="Cargando movimientos..." />}
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
            <EncabezadoPagina titulo={producto.descripcion}>
                {!producto.activo && <Insignia variante="neutral">Inactivo</Insignia>}
            </EncabezadoPagina>

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
                            <span className="ml-2">
                                <Insignia variante="alerta">Bajo mínimo</Insignia>
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

    let resultado;
    try {
        resultado = await listarMovimientosDeProducto(usuario, id, { page: pagina, pageSize: null });
    } catch (error) {
        // Si el producto no existe, ContenidoProducto ya muestra el 404
        if (error instanceof ApiError && error.status === 404) return null;
        // ─── Estado: error ─── (por ejemplo ?page=abc, 422)
        const { mensaje, detalles } = textoDeError(error, 'No se pudieron cargar los movimientos. Probá de nuevo.');
        return (
            <section className="space-y-3 pt-2">
                <h2 className="text-lg font-semibold">Movimientos</h2>
                <CartelError mensaje={mensaje} detalles={detalles} />
            </section>
        );
    }

    return (
        <section className="space-y-3 pt-2">
            <h2 className="text-lg font-semibold">Movimientos</h2>

            {/* ─── Estado: vacío ─── */}
            {resultado.data.length === 0 ? (
                <CartelVacio
                    texto={
                        resultado.total === 0
                            ? 'Este producto todavía no tiene movimientos.'
                            : 'Esta página no tiene movimientos.'
                    }
                />
            ) : (
                <>
                    {/* La misma tabla que la pestaña Existencias, sin la columna Producto */}
                    <TablaMovimientos movimientos={resultado.data} mostrarProducto={false} />

                    {/* El mismo paginador que los listados: links a esta ficha con otro ?page= */}
                    <Paginador
                        page={resultado.page}
                        pageSize={resultado.pageSize}
                        total={resultado.total}
                        cantidadEnPagina={resultado.data.length}
                        urlDePagina={(page) => `/productos/${id}?page=${page}`}
                    />
                </>
            )}
        </section>
    );
}
