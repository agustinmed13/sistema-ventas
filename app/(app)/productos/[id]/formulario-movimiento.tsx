'use client';
// Ingreso o egreso manual de stock (RF-P4, RF-P5) — en la ficha del producto.
// Solo lo ve el admin.
//
// Hace POST /api/productos/[id]/movimientos con { tipo, cantidad, motivo }
// (consigna, sección 11.4). La cantidad se manda POSITIVA: el signo lo pone
// el servidor según el tipo.
//
// La API también acepta "observacion", pero la pantalla no la pide: la
// tabla movimientos_stock no tiene esa columna y no se guardaría.
//
// CLIENT COMPONENT: necesita estado (lo que se elige y se escribe).
// Las reglas de verdad las aplica registrarMovimiento() en
// lib/servicios/productos.ts; por ejemplo, si un egreso dejaría la
// existencia en negativo, el servidor responde 409 STOCK_INSUFICIENTE y
// acá se muestra el mensaje.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Campo from '@/components/campo';

type Props = {
    productoId: number;
    existencia: number;
    // Las listas vienen del servidor (MOTIVOS_INGRESO y MOTIVOS_EGRESO del
    // servicio), así la pantalla y la validación usan exactamente las mismas.
    motivosIngreso: string[];
    motivosEgreso: string[];
};

type ErroresCampo = { [campo: string]: string };

const claseSelect =
    'h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export default function FormularioMovimiento({ productoId, existencia, motivosIngreso, motivosEgreso }: Props) {
    const router = useRouter();

    const [tipo, setTipo] = useState<'ingreso' | 'egreso'>('ingreso');
    const [cantidadTexto, setCantidadTexto] = useState('');
    const [motivo, setMotivo] = useState(motivosIngreso[0]);

    const [errores, setErrores] = useState<ErroresCampo>({});
    const [errorGeneral, setErrorGeneral] = useState('');
    const [resultado, setResultado] = useState('');
    const [enviando, setEnviando] = useState(false);

    const motivos = tipo === 'ingreso' ? motivosIngreso : motivosEgreso;

    // Al cambiar el tipo, el motivo vuelve al primero de la otra lista
    // ("Rotura" no tiene sentido en un ingreso).
    function cambiarTipo(nuevo: 'ingreso' | 'egreso') {
        setTipo(nuevo);
        setMotivo(nuevo === 'ingreso' ? motivosIngreso[0] : motivosEgreso[0]);
    }

    async function registrar(evento: FormEvent<HTMLFormElement>) {
        evento.preventDefault();
        setErrorGeneral('');
        setResultado('');

        // ─── Validación adelantada (el servidor la repite) ───
        const nuevosErrores: ErroresCampo = {};
        const cantidad = /^\d+$/.test(cantidadTexto.trim()) ? Number(cantidadTexto.trim()) : 0;
        if (cantidad <= 0) {
            nuevosErrores.cantidad = 'Tiene que ser un número entero mayor que cero.';
        } else if (tipo === 'egreso' && cantidad > existencia) {
            // Regla 1: la existencia nunca es negativa. El servidor lo
            // controla de nuevo con el dato del momento.
            nuevosErrores.cantidad = `No puede ser mayor que la existencia (${existencia}).`;
        }
        setErrores(nuevosErrores);
        if (Object.keys(nuevosErrores).length > 0) return;

        setEnviando(true);
        try {
            const respuesta = await fetch(`/api/productos/${productoId}/movimientos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tipo, cantidad, motivo }),
            });

            if (respuesta.ok) {
                const movimiento = await respuesta.json();
                // Confirmación con la existencia que quedó (sección 8)
                setResultado(`Movimiento registrado. Existencia: ${movimiento.existenciaResultante}.`);
                setCantidadTexto('');
                setEnviando(false);
                router.refresh(); // vuelve a armar la ficha y el historial
                return;
            }

            const cuerpo = await respuesta.json().catch(() => null);
            const erroresServidor: ErroresCampo = {};
            for (const detalle of cuerpo?.error?.details ?? []) {
                if (detalle.campo && detalle.mensaje) erroresServidor[detalle.campo] = detalle.mensaje;
            }
            setErrores(erroresServidor);
            setErrorGeneral(cuerpo?.error?.message || 'No se pudo registrar el movimiento.');
        } catch {
            setErrorGeneral('No se pudo conectar con el servidor.');
        }
        setEnviando(false);
    }

    // Cada campo usa <Campo> (etiqueta + input + error, components/campo.tsx)
    return (
        <form onSubmit={registrar} className="space-y-4 rounded-xl border bg-card p-4">
            <h2 className="font-medium">Registrar ingreso o egreso</h2>

            <div className="grid gap-4 sm:grid-cols-3">
                <Campo id="tipo" etiqueta="Tipo" error={errores.tipo}>
                    <select
                        id="tipo"
                        value={tipo}
                        onChange={(e) => cambiarTipo(e.target.value === 'egreso' ? 'egreso' : 'ingreso')}
                        className={claseSelect}
                    >
                        <option value="ingreso">Ingreso (suma)</option>
                        <option value="egreso">Egreso (resta)</option>
                    </select>
                </Campo>

                <Campo id="cantidad" etiqueta="Cantidad" error={errores.cantidad}>
                    <Input
                        id="cantidad"
                        inputMode="numeric"
                        placeholder="1"
                        value={cantidadTexto}
                        onChange={(e) => setCantidadTexto(e.target.value)}
                        aria-invalid={errores.cantidad ? true : undefined}
                    />
                </Campo>

                <Campo id="motivo" etiqueta="Motivo" error={errores.motivo}>
                    <select
                        id="motivo"
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        className={claseSelect}
                    >
                        {motivos.map((m) => (
                            <option key={m} value={m}>
                                {m}
                            </option>
                        ))}
                    </select>
                </Campo>
            </div>

            {errorGeneral && <p className="text-sm text-destructive">{errorGeneral}</p>}
            {resultado && <p className="text-sm text-primary">{resultado}</p>}

            <Button type="submit" disabled={enviando}>
                {enviando ? 'Registrando...' : 'Registrar movimiento'}
            </Button>
        </form>
    );
}
