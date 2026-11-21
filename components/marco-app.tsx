'use client';
// 'use client' = este componente corre en el NAVEGADOR. Hace falta porque
// usa useState (recordar si el menú está abierto), usePathname (saber en qué
// página estamos) y reacciona a clics. Un Server Component no puede hacer eso.

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, ShoppingCart, Package, Users, UserCog, Menu, X, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Los cinco módulos del sistema. Para agregar o quitar uno, se toca esta lista.
const modulos = [
    { nombre: 'Inicio', ruta: '/', icono: Home, soloAdmin: false },
    { nombre: 'Ventas', ruta: '/ventas', icono: ShoppingCart, soloAdmin: false },
    { nombre: 'Productos', ruta: '/productos', icono: Package, soloAdmin: false },
    { nombre: 'Clientes', ruta: '/clientes', icono: Users, soloAdmin: false },
    { nombre: 'Usuarios', ruta: '/usuarios', icono: UserCog, soloAdmin: true },
];

type Props = {
    nombre: string;
    rol: string; // 'admin' o 'vendedor'
    children: React.ReactNode;
};

export default function MarcoApp({ nombre, rol, children }: Props) {
    const pathname = usePathname(); // la ruta actual, por ejemplo '/productos'
    const router = useRouter();

    // Estado: true si el menú del celular está abierto.
    const [menuAbierto, setMenuAbierto] = useState(false);
    // Estado: true mientras se cierra la sesión (para deshabilitar el botón).
    const [saliendo, setSaliendo] = useState(false);
    // Estado: mensaje si falló el cierre de sesión ('' = ninguno).
    const [errorSalida, setErrorSalida] = useState('');

    // "Usuarios" solo aparece para el admin.
    // OJO: esto solo oculta el enlace. No es seguridad: alguien podría escribir
    // /usuarios en la barra de direcciones. La seguridad real está en la API
    // (cada ruta revisa el rol en el servidor).
    const modulosVisibles = modulos.filter((m) => !m.soloAdmin || rol === 'admin');

    // ¿Este módulo es el de la página actual?
    function estaActivo(ruta: string) {
        // Inicio ('/') se compara exacto; si no, estaría activo en todas las páginas.
        if (ruta === '/') return pathname === '/';
        // Los demás: la ruta exacta o cualquier subpágina (/productos/nuevo).
        return pathname === ruta || pathname.startsWith(ruta + '/');
    }

    async function salir() {
        setSaliendo(true);
        setErrorSalida('');
        try {
            // POST a /api/auth/logout: el servidor borra la sesión y la cookie.
            const respuesta = await fetch('/api/auth/logout', { method: 'POST' });
            if (respuesta.ok) {
                // replace (y no push) para que "atrás" no vuelva al sistema.
                router.replace('/login');
                return;
            }
            setErrorSalida('No se pudo cerrar la sesión. Probá de nuevo.');
        } catch {
            // fetch falla así solo si no hubo respuesta (sin internet, servidor caído).
            setErrorSalida('No se pudo conectar con el servidor.');
        }
        setSaliendo(false);
    }

    // El contenido del panel lateral se arma UNA vez y se usa en dos lugares:
    // el panel fijo de escritorio y el menú desplegable del celular.
    const contenidoPanel = (
        <>
            <div className="flex h-14 items-center gap-3 px-4">
                <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-lg font-bold text-sidebar-primary-foreground">
                    M
                </div>
                <div className="leading-tight">
                    <p className="font-semibold text-white">Mostrador</p>
                    <p className="text-xs text-sidebar-foreground">Gestión comercial</p>
                </div>
            </div>

            <nav className="flex flex-col gap-1 p-3">
                {modulosVisibles.map((modulo) => {
                    const Icono = modulo.icono;
                    const activo = estaActivo(modulo.ruta);
                    return (
                        <Link
                            key={modulo.ruta}
                            href={modulo.ruta}
                            // Al tocar un enlace se cierra el menú del celular.
                            onClick={() => setMenuAbierto(false)}
                            aria-current={activo ? 'page' : undefined}
                            className={
                                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ' +
                                (activo
                                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')
                            }
                        >
                            <Icono className="size-4" />
                            {modulo.nombre}
                        </Link>
                    );
                })}
            </nav>
        </>
    );

    return (
        <div className="min-h-screen bg-background">
            {/* PANEL LATERAL FIJO: solo desde 768px (md) hacia arriba. */}
            <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-sidebar md:flex">
                {contenidoPanel}
            </aside>

            {/* MENÚ DEL CELULAR: solo existe mientras menuAbierto sea true. */}
            {menuAbierto && (
                <div className="fixed inset-0 z-40 md:hidden">
                    {/* Fondo oscuro: tocarlo cierra el menú. */}
                    <button
                        type="button"
                        aria-label="Cerrar menú"
                        onClick={() => setMenuAbierto(false)}
                        className="absolute inset-0 bg-black/50"
                    />
                    <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col bg-sidebar">
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Cerrar menú"
                            onClick={() => setMenuAbierto(false)}
                            className="absolute right-2 top-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
                        >
                            <X />
                        </Button>
                        {contenidoPanel}
                    </aside>
                </div>
            )}

            {/* Todo lo que no es el panel lateral. En escritorio se corre 16rem
          (md:pl-64) para no quedar tapado por el panel fijo. */}
            <div className="md:pl-64">
                {/* BARRA SUPERIOR */}
                <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-card px-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Abrir menú"
                        onClick={() => setMenuAbierto(true)}
                        className="md:hidden"
                    >
                        <Menu />
                    </Button>

                    {/* ml-auto empuja todo lo que sigue hacia la derecha. */}
                    <div className="ml-auto flex items-center gap-3">
                        <div className="text-right leading-tight">
                            {/* truncate: si el nombre es largo, lo corta con "..." (importante a 360px) */}
                            <p className="max-w-[140px] truncate text-sm font-medium">{nombre}</p>
                            <p className="text-xs text-muted-foreground">
                                {rol === 'admin' ? 'Administrador' : 'Vendedor'}
                            </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={salir} disabled={saliendo}>
                            <LogOut />
                            {saliendo ? 'Saliendo...' : 'Salir'}
                        </Button>
                    </div>
                </header>

                {errorSalida && (
                    <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                        {errorSalida}
                    </p>
                )}

                <main className="p-4 md:p-6">{children}</main>
            </div>
        </div>
    );
}