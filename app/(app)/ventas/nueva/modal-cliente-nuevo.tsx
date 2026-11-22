'use client';
// Modal para dar de alta un cliente SIN salir de la venta (RF-V2).
//
// MODAL = una ventana que aparece ENCIMA de la pantalla y bloquea lo de
// atrás hasta que se cierra. Usamos el <dialog> nativo del navegador:
//   - dialog.showModal() lo abre como modal (fondo oscuro, Esc lo cierra,
//     el Tab no se escapa hacia la página de atrás)
//   - dialog.close() lo cierra
//
// POR QUÉ NO SE PIERDE LA VENTA (RF-V2, paso 2 del guion de la defensa):
// el modal es parte de la MISMA página; abrirlo no navega a otra URL.
// Los productos y cantidades viven en el estado de la página
// (page.tsx), y este componente nunca los toca: solo maneja sus propios
// campos. Al cerrar el modal, la venta sigue exactamente como estaba.

import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { pesosACentavos } from '@/lib/formato';

// Lo que la pantalla de venta necesita saber del cliente creado
export type ClienteElegido = {
  id: number;
  nombre: string;
  tipoDoc: 'DNI' | 'CUIT';
  nroDoc: string;
  cuentaCorriente: boolean;
  limiteCredito: number | null;
  saldo: number;
};

type Props = {
  abierto: boolean; // lo decide la página
  onCerrar: () => void; // avisa a la página que se cerró (Cancelar, Esc)
  onCreado: (cliente: ClienteElegido) => void; // avisa a la página qué cliente se creó
};

const claseCampo =
  'h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export default function ModalClienteNuevo({ abierto, onCerrar, onCreado }: Props) {
  const refDialogo = useRef<HTMLDialogElement>(null);

  // Los campos del formulario: estado PROPIO del modal
  const [tipoDoc, setTipoDoc] = useState<'DNI' | 'CUIT'>('DNI');
  const [nroDoc, setNroDoc] = useState('');
  const [nombre, setNombre] = useState('');
  const [domicilio, setDomicilio] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [cuentaCorriente, setCuentaCorriente] = useState(false);
  const [limiteTexto, setLimiteTexto] = useState(''); // en pesos, opcional

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [erroresCampos, setErroresCampos] = useState<{ campo: string; mensaje: string }[]>([]);

  // ─────────────────────────────────────────────────────────
  // Abrir y cerrar el <dialog> cuando la página cambia "abierto".
  // useEffect sirve justamente para esto: sincronizar algo de afuera de
  // React (el <dialog> del navegador) con el estado.
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    const dialogo = refDialogo.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);

  function limpiar() {
    setTipoDoc('DNI');
    setNroDoc('');
    setNombre('');
    setDomicilio('');
    setTelefono('');
    setEmail('');
    setCuentaCorriente(false);
    setLimiteTexto('');
    setError('');
    setErroresCampos([]);
  }

  // Límite en centavos: null si está vacío (sin límite)
  const limiteCentavos = limiteTexto.trim() === '' ? null : pesosACentavos(limiteTexto);
  const limiteInvalido = limiteTexto.trim() !== '' && limiteCentavos === null;

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault(); // que el formulario no recargue la página
    // (además, este <form> está FUERA del formulario de pago, así que
    // guardar el cliente nunca confirma la venta)

    setGuardando(true);
    setError('');
    setErroresCampos([]);

    // Solo mandamos los campos que tienen algo escrito
    const datos: { [campo: string]: string | number | boolean } = {
      tipoDoc,
      nroDoc: nroDoc.trim(),
      nombre: nombre.trim(),
      cuentaCorriente: cuentaCorriente,
    };
    if (domicilio.trim() !== '') datos.domicilio = domicilio.trim();
    if (telefono.trim() !== '') datos.telefono = telefono.trim();
    if (email.trim() !== '') datos.email = email.trim();
    if (cuentaCorriente && limiteCentavos !== null) datos.limiteCredito = limiteCentavos;

    try {
      const respuesta = await fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
      });

      if (respuesta.ok) {
        const creado = await respuesta.json();
        // Le pasamos a la página el cliente nuevo para que quede
        // elegido como comprador. Un cliente recién creado no debe nada.
        onCreado({
          id: creado.id,
          nombre: creado.nombre,
          tipoDoc: creado.tipoDoc,
          nroDoc: creado.nroDoc,
          cuentaCorriente: creado.cuentaCorriente,
          limiteCredito: creado.limiteCredito ?? null,
          saldo: creado.saldo ?? 0,
        });
        limpiar();
        setGuardando(false);
        return;
      }

      // Error: { error: { code, message, details } } (sección 11.1).
      // details trae qué campo falló, por ejemplo DOCUMENTO_DUPLICADO.
      const cuerpo = await respuesta.json().catch(() => null);
      setError(
        cuerpo?.error?.message ||
          (respuesta.status === 404
            ? 'El alta de clientes (/api/clientes) todavía no está disponible.'
            : 'No se pudo guardar el cliente.')
      );
      if (Array.isArray(cuerpo?.error?.details)) setErroresCampos(cuerpo.error.details);
    } catch {
      setError('No se pudo conectar con el servidor.');
    }
    setGuardando(false);
  }

  function cancelar() {
    limpiar();
    onCerrar();
  }

  const puedeGuardar = nombre.trim() !== '' && nroDoc.trim() !== '' && !limiteInvalido && !guardando;

  return (
    // onClose: se dispara también cuando el usuario aprieta Esc
    // m-auto: centrado (Tailwind le saca el margen por defecto al dialog)
    // backdrop: = el fondo oscuro detrás del modal
    <dialog
      ref={refDialogo}
      onClose={cancelar}
      aria-labelledby="titulo-cliente-nuevo"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border bg-card p-0 text-foreground shadow-lg backdrop:bg-black/50"
    >
      <form onSubmit={guardar} className="space-y-3 p-4">
        <h2 id="titulo-cliente-nuevo" className="text-lg font-semibold">
          Cliente nuevo
        </h2>
        <p className="text-xs text-muted-foreground">La venta en curso no se pierde: al guardar, el cliente queda elegido.</p>

        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {erroresCampos.length > 0 && (
          <ul className="list-inside list-disc text-sm text-destructive">
            {erroresCampos.map((e) => (
              <li key={e.campo}>
                {e.campo}: {e.mensaje}
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label htmlFor="cn-tipo" className="text-xs font-medium text-muted-foreground">
              Documento
            </label>
            <select
              id="cn-tipo"
              value={tipoDoc}
              onChange={(e) => setTipoDoc(e.target.value === 'CUIT' ? 'CUIT' : 'DNI')}
              className={claseCampo}
            >
              <option value="DNI">DNI</option>
              <option value="CUIT">CUIT</option>
            </select>
          </div>
          <div className="col-span-2 space-y-1">
            <label htmlFor="cn-numero" className="text-xs font-medium text-muted-foreground">
              Número (sin puntos ni guiones)
            </label>
            <input
              id="cn-numero"
              value={nroDoc}
              // Solo dígitos: se borra cualquier otra cosa al escribir
              onChange={(e) => setNroDoc(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              maxLength={11}
              required
              autoFocus
              className={claseCampo}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="cn-nombre" className="text-xs font-medium text-muted-foreground">
            Nombre y apellido o razón social
          </label>
          <input id="cn-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required className={claseCampo} />
        </div>

        <div className="space-y-1">
          <label htmlFor="cn-domicilio" className="text-xs font-medium text-muted-foreground">
            Domicilio (opcional)
          </label>
          <input id="cn-domicilio" value={domicilio} onChange={(e) => setDomicilio(e.target.value)} className={claseCampo} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="cn-telefono" className="text-xs font-medium text-muted-foreground">
              Teléfono
            </label>
            <input
              id="cn-telefono"
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className={claseCampo}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="cn-email" className="text-xs font-medium text-muted-foreground">
              Email
            </label>
            <input
              id="cn-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={claseCampo}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cuentaCorriente} onChange={(e) => setCuentaCorriente(e.target.checked)} />
          Habilitar cuenta corriente
        </label>

        {cuentaCorriente && (
          <div className="space-y-1">
            <label htmlFor="cn-limite" className="text-xs font-medium text-muted-foreground">
              Límite de crédito en pesos (vacío = sin límite)
            </label>
            <input
              id="cn-limite"
              value={limiteTexto}
              onChange={(e) => setLimiteTexto(e.target.value)}
              inputMode="decimal"
              placeholder="Ej: 50.000"
              className={claseCampo}
            />
            {limiteInvalido && <p className="text-xs text-destructive">El límite no es un monto válido.</p>}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={cancelar} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!puedeGuardar}>
            {guardando ? 'Guardando...' : 'Guardar y elegir'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
