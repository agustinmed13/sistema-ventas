'use client';
// Botón de anular factura (RF-V9).
//
// Es un CLIENT COMPONENT chico, aparte: necesita estado (si el cuadro de
// confirmación está abierto, el motivo escrito) y reaccionar a clics.
// El resto del comprobante sigue siendo Server Component.
//
// OJO, PREGUNTA DE DEFENSA: que este botón solo se muestre al admin es
// COMODIDAD VISUAL, no seguridad. El permiso lo verifica el servidor en
// anularFactura() (lib/servicios/facturas.ts): un vendedor que llame
// directo a POST /api/facturas/[id]/anulacion recibe 403 SIN_PERMISO,
// aunque nunca vea este botón (consigna 10.8, punto 2).

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type Props = {
  facturaId: number;
  numero: string; // ya formateado, para el mensaje de confirmación
};

export default function BotonAnular({ facturaId, numero }: Props) {
  const router = useRouter();

  const [abierto, setAbierto] = useState(false); // ¿se ve el cuadro de confirmación?
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  async function anular(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault(); // que el formulario no recargue la página
    if (motivo.trim() === '') return;

    setEnviando(true);
    setError('');

    try {
      const respuesta = await fetch(`/api/facturas/${facturaId}/anulacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      });

      if (respuesta.ok) {
        // router.refresh() le pide al servidor que vuelva a armar esta
        // página: el comprobante se redibuja con estado "anulada" y el
        // cartel rojo, y este botón desaparece.
        setAbierto(false);
        setEnviando(false);
        router.refresh();
        return;
      }

      // Error: { error: { code, message, details } } (sección 11.1)
      const cuerpo = await respuesta.json().catch(() => null);
      setError(cuerpo?.error?.message || 'No se pudo anular la factura.');
    } catch {
      setError('No se pudo conectar con el servidor.');
    }
    setEnviando(false);
  }

  function cancelar() {
    setAbierto(false);
    setMotivo('');
    setError('');
  }

  // Cerrado: solo el botón. print:hidden = no aparece al imprimir.
  if (!abierto) {
    return (
      <Button variant="destructive" onClick={() => setAbierto(true)} className="print:hidden">
        Anular factura
      </Button>
    );
  }

  // Abierto: la confirmación con motivo obligatorio (sección 8: las
  // acciones irreversibles se confirman).
  return (
    <form
      onSubmit={anular}
      className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 print:hidden"
    >
      <div>
        <p className="font-medium">¿Anular la factura {numero}?</p>
        <p className="text-sm text-muted-foreground">
          No se puede deshacer. Se devuelve el stock y, si era a cuenta corriente, se acredita el saldo del cliente.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="motivo" className="text-sm font-medium">
          Motivo de la anulación (obligatorio)
        </label>
        <textarea
          id="motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          autoFocus
          className="w-full rounded-lg border border-input bg-card px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {/* Deshabilitado sin motivo: no se puede confirmar en blanco */}
        <Button type="submit" variant="destructive" disabled={enviando || motivo.trim() === ''}>
          {enviando ? 'Anulando...' : 'Confirmar anulación'}
        </Button>
        <Button type="button" variant="outline" onClick={cancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
