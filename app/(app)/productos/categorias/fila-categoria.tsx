'use client';
// Una fila de la lista de categorías (RF-P7): renombrar y desactivar/reactivar.
// Las dos cosas hacen PATCH /api/categorias/[id], con { nombre } o con
// { activa } (consigna, sección 11.4: el campo se llama "activa").
//
// CLIENT COMPONENT chico: necesita estado (si se está editando el nombre,
// si la confirmación está abierta). Las reglas las aplica
// modificarCategoria() en el servidor:
//   - nombre repetido                         → 409 NOMBRE_DUPLICADO
//   - desactivar con productos activos        → 409 CATEGORIA_EN_USO
// y acá se muestra el mensaje que devuelve.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
    id: number;
    nombre: string;
    activa: boolean;
    productosActivos: number;
};

export default function FilaCategoria({ id, nombre, activa, productosActivos }: Props) {
    const router = useRouter();

    // Qué está abierto: nada, la edición del nombre o la confirmación de baja
    const [modo, setModo] = useState<'nada' | 'renombrar' | 'confirmar'>('nada');
    const [nombreNuevo, setNombreNuevo] = useState(nombre);
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);

    // Manda el PATCH. "cambios" es { nombre } o { activa }.
    async function guardar(cambios: { nombre?: string; activa?: boolean }) {
        setEnviando(true);
        setError('');
        try {
            const respuesta = await fetch(`/api/categorias/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cambios),
            });

            if (respuesta.ok) {
                setModo('nada');
                setEnviando(false);
                router.refresh(); // vuelve a armar la lista con el cambio
                return;
            }

            const cuerpo = await respuesta.json().catch(() => null);
            setError(cuerpo?.error?.message || 'No se pudo guardar el cambio.');
        } catch {
            setError('No se pudo conectar con el servidor.');
        }
        setEnviando(false);
    }

    function cancelar() {
        setModo('nada');
        setNombreNuevo(nombre);
        setError('');
    }

    return (
        <li className={`space-y-2 px-4 py-3 ${activa ? '' : 'text-muted-foreground'}`}>
            <div className="flex flex-wrap items-center gap-2">
                {/* ─── El nombre, o el campo para cambiarlo ─── */}
                {modo === 'renombrar' ? (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (nombreNuevo.trim() === '') {
                                setError('Escribí un nombre.');
                                return;
                            }
                            guardar({ nombre: nombreNuevo });
                        }}
                        className="flex flex-1 flex-wrap gap-2"
                    >
                        <Input
                            autoFocus
                            aria-label="Nombre de la categoría"
                            value={nombreNuevo}
                            onChange={(e) => setNombreNuevo(e.target.value)}
                            className="max-w-xs flex-1"
                        />
                        <Button type="submit" size="sm" disabled={enviando}>
                            {enviando ? 'Guardando...' : 'Guardar'}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={cancelar} disabled={enviando}>
                            Cancelar
                        </Button>
                    </form>
                ) : (
                    <div className="flex-1">
                        <span className="font-medium">{nombre}</span>
                        {!activa && (
                            <span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                                Inactiva
                            </span>
                        )}
                        <p className="text-xs text-muted-foreground">
                            {productosActivos === 1 ? '1 producto activo' : `${productosActivos} productos activos`}
                        </p>
                    </div>
                )}

                {/* ─── Botones de la fila ─── */}
                {modo === 'nada' && (
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => setModo('renombrar')}>
                            Renombrar
                        </Button>
                        {/* Reactivar no tiene riesgo: se hace directo */}
                        {activa ? (
                            <Button variant="destructive" size="sm" onClick={() => setModo('confirmar')}>
                                Desactivar
                            </Button>
                        ) : (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => guardar({ activa: true })}
                                disabled={enviando}
                            >
                                {enviando ? 'Reactivando...' : 'Reactivar'}
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {/* ─── Confirmación de la baja (sección 8) ─── */}
            {modo === 'confirmar' && (
                <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-sm">
                        ¿Desactivar «{nombre}»? Deja de ofrecerse al cargar productos; se puede reactivar.
                        {/* Se adelanta la regla; el servidor la controla igual (409) */}
                        {productosActivos > 0 &&
                            ` Ojo: tiene ${productosActivos} producto(s) activo(s), así que el servidor no lo va a permitir.`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => guardar({ activa: false })}
                            disabled={enviando}
                        >
                            {enviando ? 'Desactivando...' : 'Confirmar'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={cancelar} disabled={enviando}>
                            Cancelar
                        </Button>
                    </div>
                </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
        </li>
    );
}
