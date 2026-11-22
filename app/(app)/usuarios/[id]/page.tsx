// Edición de un usuario (RF-U4, RF-U5) — /usuarios/[id]. Solo admin.
//
// SERVER COMPONENT: trae el usuario con el servicio obtenerUsuario() y se
// lo pasa al formulario (el mismo del alta) y a las acciones (desactivar,
// restablecer contraseña), que son Client Components chicos.
//
// Si un vendedor escribe la URL a mano, el servicio responde 403 y se
// muestra el mensaje: el permiso lo controla el servidor.

import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EncabezadoPagina from '@/components/encabezado-pagina';
import Insignia from '@/components/insignia';
import { CartelCarga, CartelError, textoDeError } from '@/components/estados';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import { obtenerUsuario } from '@/lib/servicios/usuarios';
import FormularioUsuario from '../formulario-usuario';
import AccionesUsuario from './acciones-usuario';

export default async function EditarUsuarioPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    return (
        <div className="mx-auto max-w-3xl space-y-4">
            <Button asChild variant="ghost" size="sm">
                <Link href="/usuarios">
                    <ArrowLeft />
                    Volver al listado
                </Link>
            </Button>

            {/* Leer el usuario depende de la sesión: va en su propio Suspense */}
            <Suspense fallback={<CartelCarga texto="Cargando usuario..." />}>
                <ContenidoUsuario id={id} />
            </Suspense>
        </div>
    );
}

async function ContenidoUsuario({ id }: { id: string }) {
    // El layout ya garantiza la sesión; este if es para TypeScript.
    const actual = await obtenerUsuarioActual();
    if (!actual) redirect('/login');

    let usuario;
    try {
        usuario = await obtenerUsuario(actual, id);
    } catch (error) {
        // No existe → la página 404 de Next.js
        if (error instanceof ApiError && error.status === 404) notFound();
        // Vendedor → 403: mostramos el mensaje del servidor
        const { mensaje, detalles } = textoDeError(error, 'No se pudo cargar el usuario. Probá de nuevo.');
        return <CartelError mensaje={mensaje} detalles={detalles} />;
    }

    // RF-U4: un admin no puede desactivarse ni quitarse el rol. La pantalla
    // lo adelanta ocultando esas opciones; el servidor lo controla igual.
    const esUnoMismo = usuario.id === actual.id;

    return (
        <>
            <EncabezadoPagina titulo={usuario.nombre}>
                {!usuario.activo && <Insignia variante="neutral">Inactivo</Insignia>}
            </EncabezadoPagina>

            <FormularioUsuario
                usuario={{ id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol }}
                esUnoMismo={esUnoMismo}
            />

            <AccionesUsuario
                usuarioId={usuario.id}
                nombre={usuario.nombre}
                activo={usuario.activo}
                esUnoMismo={esUnoMismo}
            />
        </>
    );
}
