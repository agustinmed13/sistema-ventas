'use client';
// Cambiar la propia contraseña (RF-U5) — en /perfil.
//
// Hace PUT /api/auth/password con { actual, nueva } (consigna, sección 11.3).
// "Repetir" NO viaja al servidor: solo sirve para que no se escriba mal
// la nueva sin darse cuenta.
//
// CLIENT COMPONENT: necesita estado (lo que se escribe, los errores).
// Las reglas de verdad las aplica cambiarPassword() en
// lib/servicios/usuarios.ts; acá se adelantan (sección 8).

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Campo from '@/components/campo';

// Mismo mínimo que el servidor (consigna 11.3). Si cambia, cambiarlo también
// en LARGO_MINIMO_PASSWORD de lib/servicios/usuarios.ts.
const LARGO_MINIMO_PASSWORD = 8;

type ErroresCampo = { [campo: string]: string };

export default function FormularioPassword() {
    const [actual, setActual] = useState('');
    const [nueva, setNueva] = useState('');
    const [repetir, setRepetir] = useState('');

    const [errores, setErrores] = useState<ErroresCampo>({});
    const [errorGeneral, setErrorGeneral] = useState('');
    const [cambiada, setCambiada] = useState(false);
    const [enviando, setEnviando] = useState(false);

    async function guardar(evento: FormEvent<HTMLFormElement>) {
        evento.preventDefault();
        setErrorGeneral('');
        setCambiada(false);

        // ─── Validación adelantada (el servidor la repite) ───
        const nuevosErrores: ErroresCampo = {};
        if (actual === '') nuevosErrores.actual = 'Es obligatoria.';
        if (nueva.length < LARGO_MINIMO_PASSWORD) {
            nuevosErrores.nueva = `Tiene que tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.`;
        }
        if (repetir !== nueva) nuevosErrores.repetir = 'No coincide con la nueva.';
        setErrores(nuevosErrores);
        if (Object.keys(nuevosErrores).length > 0) return;

        setEnviando(true);
        try {
            const respuesta = await fetch('/api/auth/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actual, nueva }),
            });

            // 204: salió bien. Vaciamos los campos y confirmamos (sección 8).
            if (respuesta.ok) {
                setActual('');
                setNueva('');
                setRepetir('');
                setCambiada(true);
                setEnviando(false);
                return;
            }

            // Ej: 422 CONTRASENA_ACTUAL_INCORRECTA, con details en "actual"
            const cuerpo = await respuesta.json().catch(() => null);
            const erroresServidor: ErroresCampo = {};
            for (const detalle of cuerpo?.error?.details ?? []) {
                if (detalle.campo && detalle.mensaje) erroresServidor[detalle.campo] = detalle.mensaje;
            }
            setErrores(erroresServidor);
            setErrorGeneral(cuerpo?.error?.message || 'No se pudo cambiar la contraseña.');
        } catch {
            setErrorGeneral('No se pudo conectar con el servidor.');
        }
        setEnviando(false);
    }

    // Cada campo usa <Campo> (etiqueta + input + ayuda + error, components/campo.tsx)
    return (
        <form onSubmit={guardar} className="space-y-4 rounded-xl border bg-card p-4">
            <h2 className="font-medium">Cambiar contraseña</h2>

            <Campo id="actual" etiqueta="Contraseña actual" error={errores.actual}>
                <Input
                    id="actual"
                    type="password"
                    autoComplete="current-password"
                    value={actual}
                    onChange={(e) => setActual(e.target.value)}
                    aria-invalid={errores.actual ? true : undefined}
                />
            </Campo>

            <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                    id="nueva"
                    etiqueta="Contraseña nueva"
                    error={errores.nueva}
                    ayuda={`Mínimo ${LARGO_MINIMO_PASSWORD} caracteres.`}
                >
                    <Input
                        id="nueva"
                        type="password"
                        autoComplete="new-password"
                        value={nueva}
                        onChange={(e) => setNueva(e.target.value)}
                        aria-invalid={errores.nueva ? true : undefined}
                    />
                </Campo>

                <Campo id="repetir" etiqueta="Repetir la nueva" error={errores.repetir}>
                    <Input
                        id="repetir"
                        type="password"
                        autoComplete="new-password"
                        value={repetir}
                        onChange={(e) => setRepetir(e.target.value)}
                        aria-invalid={errores.repetir ? true : undefined}
                    />
                </Campo>
            </div>

            {errorGeneral && <p className="text-sm text-destructive">{errorGeneral}</p>}
            {cambiada && <p className="text-sm text-primary">Contraseña cambiada.</p>}

            <Button type="submit" disabled={enviando}>
                {enviando ? 'Guardando...' : 'Cambiar contraseña'}
            </Button>
        </form>
    );
}
