// Existencias (RF-P6) — /productos/existencias. Los dos roles.
// Pestaña del módulo Productos (consigna, sección 4): los movimientos de
// stock de TODOS los productos, del más nuevo al más viejo.
//
// SERVER COMPONENT: llama directo a listarMovimientos(), el mismo servicio
// que usa GET /api/movimientos-stock (consigna 10.6). Los filtros viven en
// la URL, igual que en los demás listados:
//   /productos/existencias?productoId=32&tipo=venta&desde=2026-11-01&page=2
//
// "existencias" es un segmento FIJO: Next.js lo prioriza sobre [id].

import { Suspense } from 'react';
import Link from 'next/link';
import Form from 'next/form';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import { listarMovimientos, listarProductos } from '@/lib/servicios/productos';
import PestanasProductos from '../pestanas-productos';
import TablaMovimientos from '../tabla-movimientos';

type ParametrosURL = { [clave: string]: string | string[] | undefined };

type Filtros = {
    productoId: string | null;
    tipo: string | null;
    desde: string | null;
    hasta: string | null;
    page: string | null;
    pageSize: string | null;
};

// Un parámetro de la URL → texto, o null si no vino o vino vacío.
function leer(valor: string | string[] | undefined): string | null {
    if (typeof valor === 'string' && valor.trim() !== '') return valor;
    return null;
}

// Arma la URL de otra página conservando los filtros actuales.
function urlDePagina(filtros: Filtros, page: number) {
    const parametros = new URLSearchParams();
    if (filtros.productoId) parametros.set('productoId', filtros.productoId);
    if (filtros.tipo) parametros.set('tipo', filtros.tipo);
    if (filtros.desde) parametros.set('desde', filtros.desde);
    if (filtros.hasta) parametros.set('hasta', filtros.hasta);
    if (filtros.pageSize) parametros.set('pageSize', filtros.pageSize);
    parametros.set('page', String(page));
    return '/productos/existencias?' + parametros.toString();
}

// Mismo estilo de campo que los demás filtros (sección 8: consistencia)
const claseCampo =
    'h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export default async function ExistenciasPage({ searchParams }: { searchParams: Promise<ParametrosURL> }) {
    const parametros = await searchParams;

    const filtros: Filtros = {
        productoId: leer(parametros.productoId),
        tipo: leer(parametros.tipo),
        desde: leer(parametros.desde),
        hasta: leer(parametros.hasta),
        page: leer(parametros.page),
        pageSize: leer(parametros.pageSize),
    };

    return (
        <div className="mx-auto max-w-5xl space-y-4">
            <h1 className="text-2xl font-semibold">Productos</h1>
            <PestanasProductos activa="existencias" />

            {/* El desplegable de productos se lee de la base: va en su Suspense */}
            <Suspense fallback={<div className="h-24 rounded-xl border bg-card" />}>
                <FiltrosExistencias filtros={filtros} />
            </Suspense>

            <Suspense
                key={JSON.stringify(filtros)}
                fallback={
                    <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
                        Cargando movimientos...
                    </p>
                }
            >
                <ListaMovimientos filtros={filtros} />
            </Suspense>
        </div>
    );
}

// ─── Filtros: producto, tipo, desde y hasta (consigna 11.4) ───
// <Form> navega a /productos/existencias?... (la URL es el estado).
async function FiltrosExistencias({ filtros }: { filtros: Filtros }) {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) redirect('/login');

    // Los productos para el desplegable. El admin ve también los dados de
    // baja (conservan su historial); el vendedor, solo los activos.
    let productos: { id: number; codigo: string; descripcion: string }[] = [];
    try {
        const resultado = await listarProductos(usuario, {
            q: null,
            categoriaId: null,
            bajoMinimo: null,
            activo: usuario.rol === 'admin' ? 'todos' : null,
            page: null,
            pageSize: '100',
        });
        productos = resultado.data;
    } catch (error) {
        // Si fallara, el filtro queda solo con "Todos" y la lista sigue andando
        console.error(error);
    }

    return (
        <Form
            action="/productos/existencias"
            className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3 lg:grid-cols-5"
        >
            <div className="col-span-2 space-y-1 sm:col-span-3 lg:col-span-2">
                <label htmlFor="productoId" className="text-xs font-medium text-muted-foreground">
                    Producto
                </label>
                <select id="productoId" name="productoId" defaultValue={filtros.productoId ?? ''} className={claseCampo}>
                    <option value="">Todos</option>
                    {productos.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.codigo} · {p.descripcion}
                        </option>
                    ))}
                </select>
            </div>
            <div className="space-y-1">
                <label htmlFor="tipo" className="text-xs font-medium text-muted-foreground">
                    Tipo
                </label>
                <select id="tipo" name="tipo" defaultValue={filtros.tipo ?? ''} className={claseCampo}>
                    <option value="">Todos</option>
                    <option value="venta">Venta</option>
                    <option value="anulacion">Anulación</option>
                    <option value="ingreso">Ingreso</option>
                    <option value="egreso">Egreso</option>
                </select>
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
            {filtros.pageSize && <input type="hidden" name="pageSize" value={filtros.pageSize} />}
            <div className="col-span-2 flex items-end gap-2 sm:col-span-3 lg:col-span-5 lg:justify-end">
                <Button type="submit" className="flex-1 lg:flex-none">
                    Filtrar
                </Button>
                <Button asChild variant="outline" className="flex-1 lg:flex-none">
                    <Link href="/productos/existencias">Limpiar</Link>
                </Button>
            </div>
        </Form>
    );
}

// ─── La lista, con sus estados de error, vacío y datos (sección 8) ───
async function ListaMovimientos({ filtros }: { filtros: Filtros }) {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) redirect('/login');

    let resultado = null;
    let mensajeError = '';
    let detallesError: string[] = [];
    try {
        resultado = await listarMovimientos(usuario, filtros);
    } catch (error) {
        if (error instanceof ApiError) {
            // Ej: una fecha mal escrita en la URL (422). Mostramos qué campo.
            mensajeError = error.message;
            detallesError = (error.details ?? []).flatMap((d) => ('mensaje' in d ? [`${d.campo}: ${d.mensaje}`] : []));
        } else {
            console.error(error);
            mensajeError = 'No se pudieron cargar los movimientos. Probá de nuevo.';
        }
    }

    // ─── Estado: error ───
    if (!resultado) {
        return (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                <p>{mensajeError}</p>
                {detallesError.length > 0 && (
                    <ul className="mt-1 list-disc pl-5">
                        {detallesError.map((d) => (
                            <li key={d}>{d}</li>
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
                {resultado.total === 0 ? 'No hay movimientos con estos filtros.' : 'Esta página no tiene movimientos.'}
            </p>
        );
    }

    const { page, pageSize, total } = resultado;
    const totalPaginas = Math.ceil(total / pageSize);
    const primera = (page - 1) * pageSize + 1;
    const ultima = primera + resultado.data.length - 1;

    return (
        <div className="space-y-3">
            {/* La misma tabla que la ficha del producto, con la columna Producto */}
            <TablaMovimientos movimientos={resultado.data} mostrarProducto={true} />

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
