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
            <Suspense fallback={<p className="text-muted-foreground">Cargando usuario...</p>}>
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
        if (error instanceof ApiError) {
            return (
                <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {error.message}
                </p>
            );
        }
        throw error;
    }

    // RF-U4: un admin no puede desactivarse ni quitarse el rol. La pantalla
    // lo adelanta ocultando esas opciones; el servidor lo controla igual.
    const esUnoMismo = usuario.id === actual.id;

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">{usuario.nombre}</h1>
                {!usuario.activo && (
                    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        Inactivo
                    </span>
                )}
            </div>

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
