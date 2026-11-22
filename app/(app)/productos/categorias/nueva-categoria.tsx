'use client';
// Alta de categoría (RF-P7) — en /productos/categorias.
// Hace POST /api/categorias con { nombre } (consigna, sección 11.4).
//
// CLIENT COMPONENT chico. La regla del nombre único (sin distinguir
// mayúsculas ni tildes) la aplica crearCategoria() en el servidor: si se
// repite, responde 409 NOMBRE_DUPLICADO y acá se muestra el mensaje.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function NuevaCategoria() {
    const router = useRouter();

    const [nombre, setNombre] = useState('');
    const [error, setError] = useState('');
    const [resultado, setResultado] = useState('');
    const [enviando, setEnviando] = useState(false);

    async function crear(evento: FormEvent<HTMLFormElement>) {
        evento.preventDefault();
        setError('');
        setResultado('');

        // Validación adelantada (el servidor la repite)
        if (nombre.trim() === '') {
            setError('Escribí un nombre.');
            return;
        }

        setEnviando(true);
        try {
            const respuesta = await fetch('/api/categorias', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre }),
            });

            if (respuesta.ok) {
                const nueva = await respuesta.json();
                setResultado(`Categoría «${nueva.nombre}» creada.`);
                setNombre('');
                setEnviando(false);
                router.refresh(); // vuelve a armar la lista con la nueva
                return;
            }

            const cuerpo = await respuesta.json().catch(() => null);
            setError(cuerpo?.error?.message || 'No se pudo crear la categoría.');
        } catch {
            setError('No se pudo conectar con el servidor.');
        }
        setEnviando(false);
    }

    return (
        <form onSubmit={crear} className="space-y-2 rounded-xl border bg-card p-4">
            <Label htmlFor="nombre-nueva">Nueva categoría</Label>
            <div className="flex flex-wrap gap-2">
                <Input
                    id="nombre-nueva"
                    placeholder="Ferretería"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    className="max-w-xs flex-1"
                />
                <Button type="submit" disabled={enviando}>
                    {enviando ? 'Creando...' : 'Crear'}
                </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {resultado && <p className="text-sm text-primary">{resultado}</p>}
        </form>
    );
}
