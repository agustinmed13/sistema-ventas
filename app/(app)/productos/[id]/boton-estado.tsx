'use client';
// Dar de baja / reactivar un producto (RF-P3, regla 12: baja lógica).
//
// CLIENT COMPONENT chico: necesita estado (si la confirmación está abierta)
// y reaccionar a clics. Hace PATCH /api/productos/[id] con { "activo": false }
// o { "activo": true }. Nunca se borra nada: el producto conserva su
// historial y solo deja de ofrecerse en ventas.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type Props = {
    productoId: number;
    descripcion: string;
    activo: boolean;
};

export default function BotonEstado({ productoId, descripcion, activo }: Props) {
    const router = useRouter();

    const [confirmando, setConfirmando] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');

    async function cambiarEstado() {
        setEnviando(true);
        setError('');
        try {
            const respuesta = await fetch(`/api/productos/${productoId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activo: !activo }), // lo contrario de lo que está
            });

            if (respuesta.ok) {
                setConfirmando(false);
                setEnviando(false);
                router.refresh(); // vuelve a armar la ficha con el estado nuevo
                return;
            }

            const cuerpo = await respuesta.json().catch(() => null);
            setError(cuerpo?.error?.message || 'No se pudo cambiar el estado del producto.');
        } catch {
            setError('No se pudo conectar con el servidor.');
        }
        setEnviando(false);
    }

    // Reactivar no tiene riesgo: se hace directo, sin confirmación
    if (!activo) {
        return (
            <div className="space-y-2">
                <Button variant="outline" onClick={cambiarEstado} disabled={enviando}>
                    {enviando ? 'Reactivando...' : 'Reactivar producto'}
                </Button>
                {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
        );
    }

    if (!confirmando) {
        return (
            <Button variant="destructive" onClick={() => setConfirmando(true)}>
                Dar de baja
            </Button>
        );
    }

    // Confirmación (sección 8: las bajas se confirman)
    return (
        <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <div>
                <p className="font-medium">¿Dar de baja «{descripcion}»?</p>
                <p className="text-sm text-muted-foreground">
                    Deja de ofrecerse en ventas, pero no se borra: conserva su historial y se puede reactivar.
                </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={cambiarEstado} disabled={enviando}>
                    {enviando ? 'Dando de baja...' : 'Confirmar baja'}
                </Button>
                <Button
                    variant="outline"
                    onClick={() => {
                        setConfirmando(false);
                        setError('');
                    }}
                    disabled={enviando}
                >
                    Cancelar
                </Button>
            </div>
        </div>
    );
}
