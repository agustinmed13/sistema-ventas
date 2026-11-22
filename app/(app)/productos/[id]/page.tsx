// Ficha de un producto (RF-P1, RF-P2, RF-P3) — /productos/[id]
//
// SERVER COMPONENT: trae el producto con el servicio obtenerProducto(),
// sin pasar por la API (consigna 10.6).
//   - Los dos roles ven los datos.
//   - El admin, además, ve el formulario de edición y el botón de baja.
//     El vendedor no, porque no puede editar productos (sección 3 de la
//     consigna). Ocultarlos NO es la protección: si el vendedor llamara a
//     la API igual, modificarProducto() le responde 403.

import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import { listarCategorias, obtenerProducto } from '@/lib/servicios/productos';
import { formatearImporte } from '@/lib/formato';
import FormularioProducto from '../formulario-producto';
import BotonEstado from './boton-estado';

export default async function FichaProductoPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

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
