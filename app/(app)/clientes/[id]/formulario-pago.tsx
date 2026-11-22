'use client';
// Formulario para registrar un pago (RF-C5).
//
// Es un CLIENT COMPONENT chico, aparte: necesita estado (lo que se escribe,
// si se está enviando, el resultado) y reaccionar a clics. El resto de la
// ficha sigue siendo Server Component.
//
// Manda el pago a POST /api/clientes/[id]/pagos. Las reglas de verdad
// (regla 8: no superar la deuda, la transacción, el número de recibo)
// las aplica el servidor en registrarPago() de lib/servicios/pagos.ts.
// Acá solo se ADELANTAN algunas validaciones para avisar antes de enviar
// (sección 8: "validación en ambos lados"); el servidor igual las repite.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { formatearImporte, pesosACentavos } from '@/lib/formato';
// Convierte "15.000,50" (pesos escritos) en 1500050 (centavos). Es de
// Agustín: la reusamos para no tener la misma conversión en dos lugares.

type Props = {
  clienteId: number;
  saldo: number; // centavos: lo que debe hoy
};

// El recibo que devuelve la API (sección 5.1), solo lo que mostramos
type Recibo = {
  id: number;
  numeroRecibo: string;
  importe: number;
  saldoCliente: number;
};

const claseCampo =
  'h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export default function FormularioPago({ clienteId, saldo }: Props) {
  const router = useRouter();

  const [abierto, setAbierto] = useState(false); // ¿se ve el formulario?
  const [importeTexto, setImporteTexto] = useState('');
  const [medio, setMedio] = useState('efectivo');
  const [observacion, setObservacion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [recibo, setRecibo] = useState<Recibo | null>(null); // el último pago hecho

  // Validación adelantada del importe, mientras se escribe.
  // pesosACentavos devuelve null si no es un monto válido.
  const importe = pesosACentavos(importeTexto);
  let avisoImporte = '';
  if (importeTexto.trim() !== '') {
    if (importe === null || importe <= 0) {
      avisoImporte = 'Escribí un importe válido, por ejemplo 15000 o 15.000,50.';
    } else if (importe > saldo) {
      // Regla 8 adelantada. El servidor la vuelve a controlar.
      avisoImporte = `No puede superar la deuda de ${formatearImporte(saldo)}.`;
    }
  }
  const puedeEnviar = importe !== null && importe > 0 && avisoImporte === '' && !enviando;

  async function registrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault(); // que el formulario no recargue la página
    if (!puedeEnviar) return;

    setEnviando(true);
    setError('');

    try {
      const respuesta = await fetch(`/api/clientes/${clienteId}/pagos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Nombres de la sección 5.1. El importe va en centavos enteros.
        body: JSON.stringify({ importe, medio, observacion }),
      });

      if (respuesta.ok) {
        const creado: Recibo = await respuesta.json();
        setRecibo(creado);
        setAbierto(false);
        setImporteTexto('');
        setObservacion('');
        setEnviando(false);
        // router.refresh() le pide al servidor que vuelva a armar la ficha:
        // el saldo y la cuenta corriente se actualizan con el pago nuevo.
        router.refresh();
        return;
      }

      // Error: { error: { code, message, details } } (sección 11.1).
      // Por ejemplo PAGO_SUPERA_DEUDA si alguien registró otro pago mientras
      // tanto: el servidor tiene la última palabra.
      const cuerpo = await respuesta.json().catch(() => null);
      setError(cuerpo?.error?.message || 'No se pudo registrar el pago.');
    } catch {
      setError('No se pudo conectar con el servidor.');
    }
    setEnviando(false);
  }

  function cancelar() {
    setAbierto(false);
    setImporteTexto('');
    setObservacion('');
    setError('');
  }

  return (
    <div className="space-y-3">
      {/* Confirmación del último pago (sección 8: cada operación confirma
          su resultado) */}
      {recibo && (
        // Mismo estilo que los avisos de ventas (amber), pero en verde
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p className="font-medium">Pago registrado — recibo {recibo.numeroRecibo}</p>
          <p>
            Pagó {formatearImporte(recibo.importe)}. Saldo restante: {formatearImporte(recibo.saldoCliente)}.
          </p>
          {/* RF-C5: el recibo numerado e imprimible */}
          <Link href={`/clientes/recibos/${recibo.id}`} className="font-medium underline underline-offset-2">
            Ver e imprimir recibo
          </Link>
        </div>
      )}

      {!abierto ? (
        // Sin deuda no hay nada que pagar (regla 8): el botón se deshabilita.
        // Es comodidad visual: el servidor igual rechaza el pago.
        <Button onClick={() => setAbierto(true)} disabled={saldo <= 0}>
          Registrar pago
        </Button>
      ) : (
        <form onSubmit={registrar} className="space-y-3 rounded-xl border bg-card p-4">
          <p className="font-medium">
            Registrar pago <span className="font-normal text-muted-foreground">· debe {formatearImporte(saldo)}</span>
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="importe" className="text-sm font-medium">
                Importe ($)
              </label>
              {/* autoFocus: se puede escribir apenas se abre, sin el mouse */}
              <input
                id="importe"
                inputMode="decimal"
                autoFocus
                placeholder="15.000,50"
                value={importeTexto}
                onChange={(e) => setImporteTexto(e.target.value)}
                className={claseCampo}
              />
              {avisoImporte && <p className="text-xs text-destructive">{avisoImporte}</p>}
              {/* Atajo: completar con la deuda total */}
              <button
                type="button"
                onClick={() => setImporteTexto(String(saldo / 100).replace('.', ','))}
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                Pagar todo ({formatearImporte(saldo)})
              </button>
            </div>

            <div className="space-y-1">
              <label htmlFor="medio" className="text-sm font-medium">
                Medio de pago
              </label>
              {/* Los valores son los de la API (sección 5.1) */}
              <select id="medio" value={medio} onChange={(e) => setMedio(e.target.value)} className={claseCampo}>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta_debito">Tarjeta de débito</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="observacion" className="text-sm font-medium">
              Observación (opcional)
            </label>
            <input
              id="observacion"
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              className={claseCampo}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!puedeEnviar}>
              {enviando ? 'Registrando...' : 'Confirmar pago'}
            </Button>
            <Button type="button" variant="outline" onClick={cancelar} disabled={enviando}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
