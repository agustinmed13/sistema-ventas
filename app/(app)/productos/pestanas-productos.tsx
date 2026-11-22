// Pestañas del módulo Productos: Catálogo | Existencias.
// La consigna (sección 4) pide que «Existencias» sea una pestaña dentro de
// Productos, no un módulo aparte del menú.
//
// Son links comunes: cada pestaña es una página con su propia URL
// (/productos y /productos/existencias), así se pueden recargar y compartir.
// No tiene 'use client': la pestaña activa la indica la página que la usa.

import Link from 'next/link';

type Props = {
    activa: 'catalogo' | 'existencias';
};

const PESTANAS = [
    { clave: 'catalogo', nombre: 'Catálogo', ruta: '/productos' },
    { clave: 'existencias', nombre: 'Existencias', ruta: '/productos/existencias' },
] as const;

export default function PestanasProductos({ activa }: Props) {
    return (
        <nav className="flex gap-1 border-b">
            {PESTANAS.map((p) => (
                <Link
                    key={p.clave}
                    href={p.ruta}
                    // aria-current: avisa a los lectores de pantalla cuál es la actual
                    aria-current={p.clave === activa ? 'page' : undefined}
                    className={
                        // -mb-px: la línea de la pestaña activa tapa el borde de abajo
                        '-mb-px border-b-2 px-3 py-2 text-sm font-medium ' +
                        (p.clave === activa
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground')
                    }
                >
                    {p.nombre}
                </Link>
            ))}
        </nav>
    );
}
