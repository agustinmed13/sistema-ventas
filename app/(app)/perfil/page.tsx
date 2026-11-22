// Mi perfil (RF-U5) — /perfil. Los dos roles.
//
// SERVER COMPONENT: muestra los datos del usuario conectado (los lee
// obtenerUsuarioActual, igual que GET /api/auth/me) y el formulario para
// cambiar la propia contraseña, que es un Client Component chico.
//
// Se llega tocando el nombre en la barra superior (components/marco-app.tsx).

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { obtenerUsuarioActual } from '@/lib/auth';
import EncabezadoPagina from '@/components/encabezado-pagina';
import FormularioPassword from './formulario-password';

export default function PerfilPage() {
    return (
        <div className="mx-auto max-w-3xl space-y-4">
            <EncabezadoPagina titulo="Mi perfil" />

            {/* Leer la sesión depende de cada pedido: va en Suspense */}
            <Suspense fallback={<div className="h-24 rounded-xl border bg-card" />}>
                <DatosUsuario />
            </Suspense>

            <FormularioPassword />
        </div>
    );
}

async function DatosUsuario() {
    // El layout ya garantiza la sesión; este if es para TypeScript.
    const usuario = await obtenerUsuarioActual();
    if (!usuario) redirect('/login');

    return (
        <dl className="grid gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-3">
            <div>
                <dt className="text-xs text-muted-foreground">Nombre</dt>
                <dd className="font-medium">{usuario.nombre}</dd>
            </div>
            <div>
                <dt className="text-xs text-muted-foreground">Email</dt>
                <dd className="font-medium break-all">{usuario.email}</dd>
            </div>
            <div>
                <dt className="text-xs text-muted-foreground">Rol</dt>
                <dd className="font-medium">{usuario.rol === 'admin' ? 'Administrador' : 'Vendedor'}</dd>
            </div>
        </dl>
    );
}
