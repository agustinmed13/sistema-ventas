// Layout compartido por todas las pantallas dentro de (app).
// Es un Server Component (no tiene 'use client'): corre en el servidor,
// y por eso puede leer la sesión.

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { obtenerUsuarioActual } from '@/lib/auth';
import MarcoApp from '@/components/marco-app';

// Este componente hace dos cosas: lee la sesión y protege el acceso.
// Es "async" porque consultar la sesión tarda (lee la cookie y consulta la
// base de datos), y hay que esperar ese resultado con "await".
async function ConSesion({ children }: { children: React.ReactNode }) {
    const usuario = await obtenerUsuarioActual();

    // PROTECCIÓN DE ACCESO: sin sesión válida, no se ve nada de (app).
    // redirect() corta acá y manda al navegador a /login.
    if (!usuario) {
        redirect('/login');
    }

    // Al componente cliente solo le pasamos lo que necesita (nombre y rol),
    // no el usuario entero.
    return (
        <MarcoApp nombre={usuario.nombre} rol={usuario.rol}>
            {children}
        </MarcoApp>
    );
}

export default function LayoutApp({ children }: { children: React.ReactNode }) {
    // <Suspense> es necesario porque next.config.mjs tiene cacheComponents:
    // Next prepara de antemano todo lo que puede, pero leer la cookie depende
    // de cada pedido. Suspense le dice: "mientras esperás la sesión, mostrá
    // este cartel de carga".
    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
                    Cargando...
                </div>
            }
        >
            <ConSesion>{children}</ConSesion>
        </Suspense>
    );
}