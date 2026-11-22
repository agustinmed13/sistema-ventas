'use client';
// Acciones sobre un usuario (RF-U4, RF-U5), en su pantalla de edición:
//   - Desactivar / reactivar → PATCH /api/usuarios/[id] con { activo }
//   - Restablecer contraseña  → POST /api/usuarios/[id]/reset-password
//
// CLIENT COMPONENT chico: necesita estado (qué confirmación está abierta,
// la contraseña temporal) y reaccionar a clics.
//
// Las dos acciones se CONFIRMAN antes de hacerse (sección 8: "confirmación
// de acciones irreversibles"). Las reglas de verdad las aplica el servidor.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type Props = {
    usuarioId: number;
    nombre: string;
    activo: boolean;
    esUnoMismo: boolean;
};

export default function AccionesUsuario({ usuarioId, nombre, activo, esUnoMismo }: Props) {
    const router = useRouter();

    // Qué confirmación está abierta: ninguna, la de estado o la de contraseña
    const [confirmando, setConfirmando] = useState<'nada' | 'estado' | 'password'>('nada');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    // La contraseña temporal que devolvió el servidor. Se muestra UNA vez:
    // vive solo en este estado y se pierde al salir de la pantalla.
    const [passwordTemporal, setPasswordTemporal] = useState('');

    async function cambiarEstado() {
        setEnviando(true);
        setError('');
        try {
            const respuesta = await fetch(`/api/usuarios/${usuarioId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activo: !activo }), // lo contrario de lo que está
            });

            if (respuesta.ok) {
                setConfirmando('nada');
                setEnviando(false);
                router.refresh(); // vuelve a armar la pantalla con el estado nuevo
                return;
            }

            // Ej: OPERACION_SOBRE_SI_MISMO (consigna 11.3)
            const cuerpo = await respuesta.json().catch(() => null);
            setError(cuerpo?.error?.message || 'No se pudo cambiar el estado del usuario.');
        } catch {
            setError('No se pudo conectar con el servidor.');
        }
        setEnviando(false);
    }

    async function restablecer() {
        setEnviando(true);
        setError('');
        try {
            const respuesta = await fetch(`/api/usuarios/${usuarioId}/reset-password`, {
                method: 'POST',
            });

            if (respuesta.ok) {
                const cuerpo = await respuesta.json();
                setPasswordTemporal(cuerpo.passwordTemporal);
                setConfirmando('nada');
                setEnviando(false);
                return;
            }

            const cuerpo = await respuesta.json().catch(() => null);
            setError(cuerpo?.error?.message || 'No se pudo restablecer la contraseña.');
        } catch {
            setError('No se pudo conectar con el servidor.');
        }
        setEnviando(false);
    }

    function cancelar() {
        setConfirmando('nada');
        setError('');
    }

    return (
        <div className="space-y-3 rounded-xl border bg-card p-4">
            <h2 className="font-medium">Acciones</h2>

            {/* ─── La contraseña temporal, una sola vez ─── */}
            {passwordTemporal && (
                <div className="space-y-1 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                    <p>
                        Contraseña temporal de {nombre}:{' '}
                        <span className="font-mono text-base font-semibold select-all">{passwordTemporal}</span>
                    </p>
                    <p className="text-muted-foreground">
                        Anotala y pasásela ahora: no se va a volver a mostrar. Puede cambiarla desde su perfil.
                    </p>
                </div>
            )}

            {/* ─── Confirmación abierta ─── */}
            {confirmando === 'estado' && (
                <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <div>
                        <p className="font-medium">¿Desactivar a {nombre}?</p>
                        <p className="text-sm text-muted-foreground">
                            No va a poder entrar al sistema, y si tiene la sesión abierta queda afuera. No se
                            borra: se puede reactivar.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="destructive" onClick={cambiarEstado} disabled={enviando}>
                            {enviando ? 'Desactivando...' : 'Confirmar'}
                        </Button>
                        <Button variant="outline" onClick={cancelar} disabled={enviando}>
                            Cancelar
                        </Button>
                    </div>
                </div>
            )}

            {confirmando === 'password' && (
                <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <div>
                        <p className="font-medium">¿Restablecer la contraseña de {nombre}?</p>
                        <p className="text-sm text-muted-foreground">
                            Su contraseña actual deja de funcionar y se genera una temporal nueva.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="destructive" onClick={restablecer} disabled={enviando}>
                            {enviando ? 'Restableciendo...' : 'Confirmar'}
                        </Button>
                        <Button variant="outline" onClick={cancelar} disabled={enviando}>
                            Cancelar
                        </Button>
                    </div>
                </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            {/* ─── Botones (ocultos mientras hay una confirmación abierta) ─── */}
            {confirmando === 'nada' && (
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setConfirmando('password')}>
                        Restablecer contraseña
                    </Button>

                    {/* Reactivar no tiene riesgo: se hace directo, sin confirmación.
                        Desactivarse a uno mismo no se ofrece (el servidor lo
                        rechaza igual con 422 OPERACION_SOBRE_SI_MISMO). */}
                    {!activo ? (
                        <Button variant="outline" onClick={cambiarEstado} disabled={enviando}>
                            {enviando ? 'Reactivando...' : 'Reactivar usuario'}
                        </Button>
                    ) : (
                        !esUnoMismo && (
                            <Button variant="destructive" onClick={() => setConfirmando('estado')}>
                                Desactivar usuario
                            </Button>
                        )
                    )}
                </div>
            )}
        </div>
    );
}
