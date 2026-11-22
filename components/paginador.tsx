// Paginador de los listados (sección 11.1 de la consigna: page desde 1).
//
// Consigna 10.6: "lo que se repite se resuelve una vez". Antes cada listado
// tenía su propio "Mostrando 21–40 de 137 · Página 2 de 7" con sus botones;
// ahora todos usan este.
//
// No tiene 'use client': "Anterior" y "Siguiente" son links comunes a la
// misma página con otro ?page=. La página que lo usa dice cómo se arma esa
// URL (urlDePagina), porque cada listado conserva sus propios filtros.

import Link from 'next/link';
import { Button } from '@/components/ui/button';

type Props = {
    page: number; // la página actual (desde 1)
    pageSize: number; // cuántos por página
    total: number; // cuántos hay en total, en todas las páginas
    cantidadEnPagina: number; // cuántos vinieron en esta página
    urlDePagina: (page: number) => string; // ej: (2) => '/productos?q=cafe&page=2'
};

export default function Paginador({ page, pageSize, total, cantidadEnPagina, urlDePagina }: Props) {
    const totalPaginas = Math.max(1, Math.ceil(total / pageSize));
    const primera = (page - 1) * pageSize + 1; // "Mostrando 21–40 de 137"
    const ultima = primera + cantidadEnPagina - 1;

    return (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted-foreground">
                Mostrando {primera}–{ultima} de {total} · Página {page} de {totalPaginas}
            </p>
            <div className="flex gap-2">
                {/* En la primera o la última página, el botón queda deshabilitado */}
                {page > 1 ? (
                    <Button asChild variant="outline" size="sm">
                        <Link href={urlDePagina(page - 1)}>Anterior</Link>
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" disabled>
                        Anterior
                    </Button>
                )}
                {page < totalPaginas ? (
                    <Button asChild variant="outline" size="sm">
                        <Link href={urlDePagina(page + 1)}>Siguiente</Link>
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" disabled>
                        Siguiente
                    </Button>
                )}
            </div>
        </div>
    );
}
