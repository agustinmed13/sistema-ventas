// Alta de producto (RF-P2) — /productos/nuevo. Solo admin.
//
// SERVER COMPONENT: trae las categorías activas para el desplegable y
// muestra el formulario (el mismo que se usa para editar).
// Al vendedor le mostramos un aviso en vez del formulario; igual, si
// llamara a la API, crearProducto() le responde 403.
//
// La carpeta "nuevo" es un segmento FIJO: Next.js lo prioriza sobre [id],
// así que /productos/nuevo llega acá y no a la ficha con id = "nuevo".

import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EncabezadoPagina from '@/components/encabezado-pagina';
import { CartelCarga, CartelError } from '@/components/estados';
import { obtenerUsuarioActual } from '@/lib/auth';
import { listarCategorias } from '@/lib/servicios/productos';
import FormularioProducto from '../formulario-producto';

export default function NuevoProductoPage() {
    return (
        <div className="mx-auto max-w-3xl space-y-4">
            <Button asChild variant="ghost" size="sm">
                <Link href="/productos">
                    <ArrowLeft />
                    Volver al catálogo
                </Link>
            </Button>
            <EncabezadoPagina titulo="Nuevo producto" />

            <Suspense fallback={<CartelCarga texto="Cargando..." />}>
                <Contenido />
            </Suspense>
        </div>
    );
}

async function Contenido() {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) redirect('/login');

    if (usuario.rol !== 'admin') {
        return <CartelError mensaje="Solo un administrador puede dar de alta productos." />;
    }

    const categorias = await listarCategorias(usuario);

    return <FormularioProducto categorias={categorias} />;
}
