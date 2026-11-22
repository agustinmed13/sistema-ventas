'use client';
// Formulario de usuario (RF-U4): UNO SOLO para el alta y la edición.
//
//   /usuarios/nuevo  → sin "usuario": POST /api/usuarios con
//                      { nombre, email, rol, password }
//   /usuarios/5      → con "usuario": PATCH /api/usuarios/5 con
//                      { nombre, email, rol }
//
// La contraseña solo se pide en el alta (es la temporal). Para cambiarla
// después está "Restablecer contraseña" en la misma pantalla de edición.
//
// CLIENT COMPONENT: necesita estado (lo que se escribe, los errores).
// Las validaciones de verdad las hace el servidor (lib/servicios/usuarios.ts);
// acá solo se ADELANTAN las obligatorias (sección 8: validación en ambos
// lados). Los errores del servidor se muestran debajo de cada campo: los
// nombres de "details" son los mismos que los de este formulario.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Campo from '@/components/campo';

type UsuarioExistente = {
    id: number;
    nombre: string;
    email: string;
    rol: 'admin' | 'vendedor';
};

type Props = {
    usuario?: UsuarioExistente; // si no viene, es un alta
    esUnoMismo?: boolean; // el admin editándose a sí mismo
};

// Errores por campo: { email: 'Ya existe.' }
type ErroresCampo = { [campo: string]: string };

// Mismo mínimo que el servidor (consigna 11.3). Si cambia, cambiarlo también
// en LARGO_MINIMO_PASSWORD de lib/servicios/usuarios.ts.
const LARGO_MINIMO_PASSWORD = 8;

const claseSelect =
    'h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50';

export default function FormularioUsuario({ usuario, esUnoMismo = false }: Props) {
    const router = useRouter();
    const esEdicion = usuario !== undefined;

    const [nombre, setNombre] = useState(usuario?.nombre ?? '');
    const [email, setEmail] = useState(usuario?.email ?? '');
    const [rol, setRol] = useState<'admin' | 'vendedor'>(usuario?.rol ?? 'vendedor');
    const [password, setPassword] = useState('');

    const [errores, setErrores] = useState<ErroresCampo>({});
    const [errorGeneral, setErrorGeneral] = useState('');
    const [guardado, setGuardado] = useState(false);
    const [enviando, setEnviando] = useState(false);

    async function guardar(evento: FormEvent<HTMLFormElement>) {
        evento.preventDefault();
        setErrorGeneral('');
        setGuardado(false);

        // ─── Validación adelantada (el servidor la repite) ───
        const nuevosErrores: ErroresCampo = {};
        if (nombre.trim() === '') nuevosErrores.nombre = 'Es obligatorio.';
        if (email.trim() === '') nuevosErrores.email = 'Es obligatorio.';
        if (!esEdicion && password.length < LARGO_MINIMO_PASSWORD) {
            nuevosErrores.password = `Tiene que tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.`;
        }
        setErrores(nuevosErrores);
        if (Object.keys(nuevosErrores).length > 0) return;

        // ─── Enviar (nombres de campo de la consigna, sección 11.3) ───
        const datos = esEdicion ? { nombre, email, rol } : { nombre, email, rol, password };

        setEnviando(true);
        try {
            const respuesta = await fetch(esEdicion ? `/api/usuarios/${usuario.id}` : '/api/usuarios', {
                method: esEdicion ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos),
            });

            if (respuesta.ok) {
                if (esEdicion) {
                    // Se queda en la pantalla y confirma (sección 8: cada
                    // operación confirma su resultado)
                    setGuardado(true);
                    setEnviando(false);
                    router.refresh();
                } else {
                    // Alta: vamos a la pantalla del usuario nuevo
                    const nuevo = await respuesta.json();
                    router.push(`/usuarios/${nuevo.id}`);
                    router.refresh();
                }
                return;
            }

            // Error { error: { code, message, details } } (sección 11.1).
            // Ej: EMAIL_DUPLICADO trae details [{ campo: 'email', ... }].
            const cuerpo = await respuesta.json().catch(() => null);
            const erroresServidor: ErroresCampo = {};
            for (const detalle of cuerpo?.error?.details ?? []) {
                if (detalle.campo && detalle.mensaje) erroresServidor[detalle.campo] = detalle.mensaje;
            }
            setErrores(erroresServidor);
            setErrorGeneral(cuerpo?.error?.message || 'No se pudo guardar el usuario.');
        } catch {
            setErrorGeneral('No se pudo conectar con el servidor.');
        }
        setEnviando(false);
    }

    // Cada campo usa <Campo> (etiqueta + input + ayuda + error, components/campo.tsx)
    return (
        <form onSubmit={guardar} className="space-y-4 rounded-xl border bg-card p-4">
            <div className="grid gap-4 sm:grid-cols-2">
                <Campo id="nombre" etiqueta="Nombre" error={errores.nombre}>
                    <Input
                        id="nombre"
                        autoFocus
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        aria-invalid={errores.nombre ? true : undefined}
                    />
                </Campo>

                <Campo id="email" etiqueta="Email" error={errores.email}>
                    <Input
                        id="email"
                        type="email"
                        placeholder="laura@mostrador.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        aria-invalid={errores.email ? true : undefined}
                    />
                </Campo>

                {/* Un admin no puede quitarse su propio rol (consigna 11.3).
                    El servidor lo rechaza igual con 422; acá se adelanta. */}
                <Campo
                    id="rol"
                    etiqueta="Rol"
                    error={errores.rol}
                    ayuda={esUnoMismo ? 'No podés quitarte tu propio rol de administrador.' : undefined}
                >
                    <select
                        id="rol"
                        value={rol}
                        onChange={(e) => setRol(e.target.value === 'admin' ? 'admin' : 'vendedor')}
                        disabled={esUnoMismo}
                        className={claseSelect}
                    >
                        <option value="vendedor">Vendedor</option>
                        <option value="admin">Administrador</option>
                    </select>
                </Campo>

                {!esEdicion && (
                    <Campo
                        id="password"
                        etiqueta="Contraseña temporal"
                        error={errores.password}
                        ayuda={`Mínimo ${LARGO_MINIMO_PASSWORD} caracteres. El usuario la cambia desde su perfil.`}
                    >
                        <Input
                            id="password"
                            type="password"
                            autoComplete="new-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            aria-invalid={errores.password ? true : undefined}
                        />
                    </Campo>
                )}
            </div>

            {errorGeneral && <p className="text-sm text-destructive">{errorGeneral}</p>}
            {guardado && <p className="text-sm text-primary">Cambios guardados.</p>}

            <Button type="submit" disabled={enviando}>
                {enviando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Crear usuario'}
            </Button>
        </form>
    );
}
