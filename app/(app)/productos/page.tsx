// Catálogo de productos (RF-P1) — /productos
//
// SERVER COMPONENT (no tiene 'use client'): se ejecuta en el SERVIDOR y
// llama directo a los servicios, sin pasar por la API (consigna 10.6:
// "las páginas de lectura son Server Components que llaman a los
// servicios"). Mismo esquema que el listado de ventas.
//
// Los filtros viven en la URL, no en useState (consigna 10.6). Ejemplo:
//   /productos?q=cafe&categoriaId=6&bajoMinimo=true&page=2
// Así se puede recargar (F5) o compartir el link y se ve igual.
// Los nombres de los parámetros son los de la API (AGENTS.md 5.1).

import { Suspense } from 'react';
import Link from 'next/link';
import Form from 'next/form';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import { listarCategorias, listarProductos } from '@/lib/servicios/productos';
import { formatearImporte } from '@/lib/formato';

// Lo que llega en la URL después del "?".
type ParametrosURL = { [clave: string]: string | string[] | undefined };

type Filtros = {
    q: string | null;
    categoriaId: string | null;
    bajoMinimo: string | null;
    activo: string | null;
    page: string | null;
    pageSize: string | null;
};

// Un parámetro de la URL → texto, o null si no vino o vino vacío.
// (El formulario manda los campos vacíos como "?categoriaId=".)
function leer(valor: string | string[] | undefined): string | null {
    if (typeof valor === 'string' && valor.trim() !== '') return valor;
    return null;
}

// Arma la URL de otra página conservando los filtros actuales.
function urlDePagina(filtros: Filtros, page: number) {
    const parametros = new URLSearchParams();
    if (filtros.q) parametros.set('q', filtros.q);
    if (filtros.categoriaId) parametros.set('categoriaId', filtros.categoriaId);
    if (filtros.bajoMinimo) parametros.set('bajoMinimo', filtros.bajoMinimo);
    if (filtros.activo) parametros.set('activo', filtros.activo);
    if (filtros.pageSize) parametros.set('pageSize', filtros.pageSize);
    parametros.set('page', String(page));
    return '/productos?' + parametros.toString();
}

// Mismo estilo de campo que el filtro de ventas (consistencia, sección 8).
const claseCampo =
    'h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

// ═════════════════════════════════════════════════════════════
// LA PÁGINA
// En Next.js 16, searchParams es una promesa: hay que esperarla con await.
// ═════════════════════════════════════════════════════════════
export default async function ProductosPage({
    searchParams,
}: {
    searchParams: Promise<ParametrosURL>;
}) {
    const parametros = await searchParams;

    const filtros: Filtros = {
        q: leer(parametros.q),
        categoriaId: leer(parametros.categoriaId),
        bajoMinimo: leer(parametros.bajoMinimo),
        activo: leer(parametros.activo),
        page: leer(parametros.page),
        pageSize: leer(parametros.pageSize),
    };

    return (
        <div className="mx-auto max-w-5xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-2xl font-semibold">Productos</h1>
                {/* El botón depende del rol, que se lee de la sesión */}
                <Suspense fallback={null}>
                    <BotonNuevoProducto />
                </Suspense>
            </div>

            {/* Los filtros necesitan la lista de categorías y el rol del
                usuario, que se leen en el servidor: por eso van en su
                propio Suspense. */}
            <Suspense
                fallback={<div className="h-24 rounded-xl border bg-card" />}
            >
                <FiltrosCatalogo filtros={filtros} />
            </Suspense>

            {/* La "key" cambia con los filtros: al filtrar o cambiar de
                página vuelve a mostrar el cartel de carga. */}
            <Suspense
                key={JSON.stringify(filtros)}
                fallback={
                    <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
                        Cargando productos...
                    </p>
                }
            >
                <TablaProductos filtros={filtros} />
            </Suspense>
        </div>
    );
}

// "Categorías" (RF-P7) y "Nuevo producto" (RF-P2), solo para el admin.
// Ocultarlos no es la protección: el servidor le responde 403 al vendedor igual.
async function BotonNuevoProducto() {
    const usuario = await obtenerUsuarioActual();
    if (!usuario || usuario.rol !== 'admin') return null;

    return (
        <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
                <Link href="/productos/categorias">Categorías</Link>
            </Button>
            <Button asChild>
                <Link href="/productos/nuevo">
                    <Plus />
                    Nuevo producto
                </Link>
            </Button>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════
// FILTROS — búsqueda, categoría, bajo mínimo y (solo admin) estado.
//
// <Form> de Next.js es un <form> que, al enviarse, navega a action + los
// campos como parámetros: /productos?q=cafe&categoriaId=6&bajoMinimo=true
// No hace falta useState: la URL es el estado. Como no lleva "page",
// filtrar siempre vuelve a la página 1.
// ═════════════════════════════════════════════════════════════
async function FiltrosCatalogo({ filtros }: { filtros: Filtros }) {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) redirect('/login');

    // Las categorías activas, para el desplegable.
    // Si fallara, el filtro queda solo con "Todas" y la tabla sigue andando.
    let categorias: { id: number; nombre: string }[] = [];
    try {
        categorias = await listarCategorias(usuario);
    } catch (error) {
        console.error(error);
    }

    const esAdmin = usuario.rol === 'admin';

    return (
        <Form
            action="/productos"
            className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3 lg:grid-cols-5"
        >
            <div className="col-span-2 space-y-1 sm:col-span-3 lg:col-span-2">
                <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
                    Código o descripción
                </label>
                {/* La búsqueda no distingue mayúsculas ni tildes (RF-P1):
                    lo resuelve el servicio. */}
                <input
                    id="q"
                    name="q"
                    type="search"
                    placeholder="ALM-001 o café"
                    defaultValue={filtros.q ?? ''}
                    className={claseCampo}
                />
            </div>

            <div className="col-span-2 space-y-1 sm:col-span-1">
                <label htmlFor="categoriaId" className="text-xs font-medium text-muted-foreground">
                    Categoría
                </label>
                <select
                    id="categoriaId"
                    name="categoriaId"
                    defaultValue={filtros.categoriaId ?? ''}
                    className={claseCampo}
                >
                    <option value="">Todas</option>
                    {categorias.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.nombre}
                        </option>
                    ))}
                </select>
            </div>

            {/* El estado (activos / inactivos / todos) solo lo ve el admin:
                el servicio le responde 403 al vendedor si lo pide. */}
            {esAdmin && (
                <div className="space-y-1">
                    <label htmlFor="activo" className="text-xs font-medium text-muted-foreground">
                        Estado
                    </label>
                    <select
                        id="activo"
                        name="activo"
                        defaultValue={filtros.activo ?? ''}
                        className={claseCampo}
                    >
                        {/* Vacío = el valor por defecto del servicio (activos) */}
                        <option value="">Activos</option>
                        <option value="false">Inactivos</option>
                        <option value="todos">Todos</option>
                    </select>
                </div>
            )}

            {/* RF-P1: ver solo lo que hay que reponer */}
            <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
                <input
                    type="checkbox"
                    name="bajoMinimo"
                    value="true"
                    defaultChecked={filtros.bajoMinimo === 'true'}
                    className="size-4 accent-primary"
                />
                Solo bajo mínimo
            </label>

            {filtros.pageSize && (
                <input type="hidden" name="pageSize" value={filtros.pageSize} />
            )}

            <div className="col-span-2 flex items-end gap-2 sm:col-span-3 lg:col-span-5 lg:justify-end">
                <Button type="submit" className="flex-1 lg:flex-none">
                    Filtrar
                </Button>
                <Button asChild variant="outline" className="flex-1 lg:flex-none">
                    <Link href="/productos">Limpiar</Link>
                </Button>
            </div>
        </Form>
    );
}

// ═════════════════════════════════════════════════════════════
// LA TABLA — también Server Component: espera los datos del servicio.
// ═════════════════════════════════════════════════════════════
async function TablaProductos({ filtros }: { filtros: Filtros }) {
    // El layout ya garantiza la sesión; este if es para TypeScript.
    const usuario = await obtenerUsuarioActual();
    if (!usuario) redirect('/login');

    let resultado = null;
    let mensajeError = '';
    let detallesError: string[] = [];
    try {
        resultado = await listarProductos(usuario, filtros);
    } catch (error) {
        if (error instanceof ApiError) {
            // Error esperado: un filtro mal escrito en la URL (422) o un
            // vendedor pidiendo inactivos (403). Mostramos el mensaje y,
            // si hay, el detalle de cada campo ("details", sección 11.1),
            // para que se entienda QUÉ filtro está mal.
            mensajeError = error.message;
            detallesError = (error.details ?? []).flatMap((d) =>
                'mensaje' in d ? [String(d.mensaje)] : []
            );
        } else {
            console.error(error);
            mensajeError = 'No se pudieron cargar los productos. Probá de nuevo.';
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
                {resultado.total === 0
                    ? 'No hay productos con estos filtros.'
                    : 'Esta página no tiene productos.'}
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
            {/* overflow-x-auto: si la tabla no entra en 360 px, se desliza
                de costado sin romper el resto de la página (sección 8) */}
            <div className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full text-sm">
                    <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 font-medium">Código</th>
                            <th className="px-3 py-2 font-medium">Descripción</th>
                            {/* En el celular se ocultan las columnas menos importantes */}
                            <th className="hidden px-3 py-2 font-medium md:table-cell">Categoría</th>
                            <th className="px-3 py-2 text-right font-medium">Precio</th>
                            <th className="px-3 py-2 text-right font-medium">Existencia</th>
                            <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Mínimo</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {resultado.data.map((p) => (
                            <tr
                                key={p.id}
                                // Los inactivos (solo los ve el admin) van en gris
                                className={p.activo ? 'hover:bg-muted/50' : 'text-muted-foreground'}
                            >
                                <td className="whitespace-nowrap px-3 py-2 font-mono">{p.codigo}</td>
                                <td className="px-3 py-2">
                                    {/* Cada producto lleva a su ficha */}
                                    <Link
                                        href={`/productos/${p.id}`}
                                        className="font-medium text-primary hover:underline"
                                    >
                                        {p.descripcion}
                                    </Link>
                                    {!p.activo && (
                                        <span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                                            Inactivo
                                        </span>
                                    )}
                                </td>
                                <td className="hidden px-3 py-2 md:table-cell">{p.categoria.nombre}</td>
                                {/* Importes con lib/formato.ts: $ 12.345,50 (regla 10) */}
                                <td className="whitespace-nowrap px-3 py-2 text-right">
                                    {formatearImporte(p.precio)}
                                </td>
                                {/* RF-P1: marca visible de bajo mínimo. El dato
                                    bajoMinimo lo calcula el servidor; la
                                    pantalla solo lo muestra. */}
                                <td className="whitespace-nowrap px-3 py-2 text-right">
                                    {p.bajoMinimo ? (
                                        <span
                                            className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800"
                                            title={`Bajo el mínimo de ${p.stockMinimo}`}
                                        >
                                            {p.existencia}
                                            <span className="text-xs font-medium">Bajo mínimo</span>
                                        </span>
                                    ) : (
                                        p.existencia
                                    )}
                                </td>
                                <td className="hidden px-3 py-2 text-right text-muted-foreground sm:table-cell">
                                    {p.stockMinimo}
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
