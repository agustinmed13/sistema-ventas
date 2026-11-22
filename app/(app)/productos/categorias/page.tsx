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
import EncabezadoPagina from '@/components/encabezado-pagina';
import { CartelCarga, CartelError, CartelVacio, textoDeError } from '@/components/estados';
import { obtenerUsuarioActual } from '@/lib/auth';
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
            <EncabezadoPagina titulo="Categorías" />

            <Suspense fallback={<CartelCarga texto="Cargando categorías..." />}>
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
        const { mensaje, detalles } = textoDeError(error, 'No se pudieron cargar las categorías. Probá de nuevo.');
        return <CartelError mensaje={mensaje} detalles={detalles} />;
    }

    return (
        <>
            <NuevaCategoria />

            {/* ─── Estado: vacío ─── */}
            {categorias.length === 0 ? (
                <CartelVacio texto="Todavía no hay categorías." />
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
