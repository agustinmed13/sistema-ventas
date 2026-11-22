// Categorías (RF-P7) — /productos/categorias. Solo admin.
// "Alta, edición y baja simples" (consigna, sección 5).
//
// SERVER COMPONENT: trae TODAS las categorías (también las inactivas, para
// poder reactivarlas) con listarTodasLasCategorias(), sin pasar por la API
// (consigna 10.6). El alta, el renombre y la baja son Client Components
// chicos que llaman a POST y PATCH /api/categorias.
//
// Vive dentro de productos porque las categorías son parte de ese módulo
// (la consigna habla de cinco módulos en el menú). "categorias" es un
// segmento FIJO: Next.js lo prioriza sobre [id], así que esta URL no llega
// a la ficha de un producto con id = "categorias".

import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import { listarTodasLasCategorias } from '@/lib/servicios/productos';
import NuevaCategoria from './nueva-categoria';
import FilaCategoria from './fila-categoria';

export default function CategoriasPage() {
    return (
        <div className="mx-auto max-w-3xl space-y-4">
            <Button asChild variant="ghost" size="sm">
                <Link href="/productos">
                    <ArrowLeft />
                    Volver al catálogo
                </Link>
            </Button>
            <h1 className="text-2xl font-semibold">Categorías</h1>

            <Suspense
                fallback={
                    <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
                        Cargando categorías...
                    </p>
                }
            >
                <ListaCategorias />
            </Suspense>
        </div>
    );
}

async function ListaCategorias() {
    // El layout ya garantiza la sesión; este if es para TypeScript.
    const usuario = await obtenerUsuarioActual();
    if (!usuario) redirect('/login');

    let categorias;
    try {
        categorias = await listarTodasLasCategorias(usuario);
    } catch (error) {
        // ─── Estado: error (403 para el vendedor que escribe la URL) ───
        if (error instanceof ApiError) {
            return (
                <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {error.message}
                </p>
            );
        }
        console.error(error);
        return (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                No se pudieron cargar las categorías. Probá de nuevo.
            </p>
        );
    }

    return (
        <>
            <NuevaCategoria />

            {/* ─── Estado: vacío ─── */}
            {categorias.length === 0 ? (
                <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
                    Todavía no hay categorías.
                </p>
            ) : (
                <ul className="divide-y rounded-xl border bg-card">
                    {categorias.map((c) => (
                        <FilaCategoria
                            // La key incluye nombre y estado: si cambian
                            // (router.refresh), la fila arranca de cero
                            key={`${c.id}-${c.nombre}-${c.activa}`}
                            id={c.id}
                            nombre={c.nombre}
                            activa={c.activa}
                            productosActivos={c.productosActivos}
                        />
                    ))}
                </ul>
            )}
        </>
    );
}
