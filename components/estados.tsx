// Los tres estados de un listado: carga, vacío y error.
//
// Consigna, sección 8: "cada listado contempla carga, vacío y error".
// Consigna 10.6: "lo que se repite se resuelve una vez". Antes cada pantalla
// escribía sus propios carteles con sus propias clases; ahora todos se ven
// igual porque salen de acá.
//
// No tienen 'use client': solo muestran un texto.

import { ApiError } from '@/lib/errores';

// "Cargando productos..." — va en el fallback de un <Suspense>
export function CartelCarga({ texto }: { texto: string }) {
    return <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">{texto}</p>;
}

// "No hay productos con estos filtros." — cuando la lista vino vacía
export function CartelVacio({ texto }: { texto: string }) {
    return <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">{texto}</p>;
}

// El mensaje de un error y, si los hay, el detalle de cada campo
// ("details" de la sección 11.1), para que se entienda QUÉ está mal.
export function CartelError({ mensaje, detalles = [] }: { mensaje: string; detalles?: string[] }) {
    return (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <p>{mensaje}</p>
            {detalles.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                    {detalles.map((d) => (
                        <li key={d}>{d}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// Convierte un error atrapado en el texto y los detalles para CartelError.
// Si es un ApiError (un error esperado, como un 422 o un 403), usa su
// mensaje; si es otra cosa, un mensaje genérico (el detalle técnico va a
// la consola del servidor, no al usuario).
export function textoDeError(error: unknown, mensajeGenerico: string) {
    if (error instanceof ApiError) {
        const detalles = (error.details ?? []).flatMap((d) =>
            'campo' in d && 'mensaje' in d ? [`${d.campo}: ${d.mensaje}`] : []
        );
        return { mensaje: error.message, detalles };
    }
    console.error(error);
    return { mensaje: mensajeGenerico, detalles: [] };
}
