'use client';
// Formulario de cliente (RF-C2): UNO SOLO para el alta y la edición.
//
//   /clientes/nuevo        → sin "cliente": hace POST /api/clientes
//   /clientes/12/editar    → con "cliente": hace PATCH /api/clientes/12
//
// Es CLIENT COMPONENT porque necesita estado (lo que se escribe, los
// errores) y reaccionar a clics.
//
// Las validaciones de verdad las hace el servidor en validarDatosCliente()
// (lib/servicios/clientes.ts). Acá solo se ADELANTAN las obligatorias para
// avisar antes de enviar (sección 8: "validación en ambos lados"). Si el
// servidor encuentra otro error, lo muestra debajo del campo que corresponde:
// los nombres de "details" (tipoDoc, nroDoc, ...) son los mismos que los
// de este formulario.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// Convierte "50.000" (pesos escritos) en 5000000 (centavos). Es de Agustín.
import { pesosACentavos } from '@/app/(app)/ventas/nueva/pesos';

// Los datos actuales del cliente, cuando se edita (sección 5.1)
type ClienteExistente = {
  id: number;
  tipoDoc: 'DNI' | 'CUIT';
  nroDoc: string;
  nombre: string;
  domicilio: string | null;
  telefono: string | null;
  email: string | null;
  cuentaCorriente: boolean;
  limiteCredito: number | null;
};

type Props = {
  cliente?: ClienteExistente; // "?" = opcional: si no viene, es un alta
};

// Errores por campo: { nombre: 'Es obligatorio.', nroDoc: 'Ya existe.' }
type ErroresCampo = { [campo: string]: string };

// 5000000 centavos → "50000" (para mostrar el límite al editar)
function centavosATexto(centavos: number | null) {
  if (centavos === null) return '';
  return String(centavos / 100).replace('.', ',');
}

const claseSelect =
  'h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export default function FormularioCliente({ cliente }: Props) {
  const router = useRouter();
  const esEdicion = cliente !== undefined;

  // Cada campo arranca con el valor actual (edición) o vacío (alta)
  const [tipoDoc, setTipoDoc] = useState<'DNI' | 'CUIT'>(cliente?.tipoDoc ?? 'DNI');
  const [nroDoc, setNroDoc] = useState(cliente?.nroDoc ?? '');
  const [nombre, setNombre] = useState(cliente?.nombre ?? '');
  const [domicilio, setDomicilio] = useState(cliente?.domicilio ?? '');
  const [telefono, setTelefono] = useState(cliente?.telefono ?? '');
  const [email, setEmail] = useState(cliente?.email ?? '');
  const [cuentaCorriente, setCuentaCorriente] = useState(cliente?.cuentaCorriente ?? false);
  const [limiteTexto, setLimiteTexto] = useState(centavosATexto(cliente?.limiteCredito ?? null));

  const [errores, setErrores] = useState<ErroresCampo>({});
  const [errorGeneral, setErrorGeneral] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault(); // que el formulario no recargue la página
    setErrorGeneral('');

    // ─── Validación adelantada (el servidor la repite) ───
    const nuevosErrores: ErroresCampo = {};
    if (nroDoc.trim() === '') nuevosErrores.nroDoc = 'Es obligatorio.';
    if (nombre.trim() === '') nuevosErrores.nombre = 'Es obligatorio.';

    // El límite se escribe en pesos y viaja en centavos (regla 10).
    // Vacío = sin límite (null).
    let limiteCredito: number | null = null;
    if (cuentaCorriente && limiteTexto.trim() !== '') {
      limiteCredito = pesosACentavos(limiteTexto);
      if (limiteCredito === null || limiteCredito <= 0) {
        nuevosErrores.limiteCredito = 'Escribí un importe válido, por ejemplo 50000 o 50.000,50.';
      }
    }

    setErrores(nuevosErrores);
    if (Object.keys(nuevosErrores).length > 0) return;

    // ─── Enviar ───
    // Los nombres de campo son los de la sección 5.1.
    const datos = {
      tipoDoc,
      nroDoc,
      nombre,
      domicilio,
      telefono,
      email,
      cuentaCorriente,
      limiteCredito,
    };

    setEnviando(true);
    try {
      const respuesta = await fetch(esEdicion ? `/api/clientes/${cliente.id}` : '/api/clientes', {
        method: esEdicion ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
      });

      if (respuesta.ok) {
        // Listo: vamos a la ficha del cliente (la del nuevo, o la del editado).
        // router.refresh() hace que la ficha se arme con los datos nuevos.
        const guardado = await respuesta.json();
        router.push(`/clientes/${guardado.id}`);
        router.refresh();
        return;
      }

      // Error: { error: { code, message, details } } (sección 11.1).
      // Cada elemento de details trae { campo, mensaje }: lo ponemos debajo
      // del campo con ese nombre. Ej: DOCUMENTO_DUPLICADO → debajo de nroDoc.
      const cuerpo = await respuesta.json().catch(() => null);
      const erroresServidor: ErroresCampo = {};
      for (const detalle of cuerpo?.error?.details ?? []) {
        if (detalle.campo && detalle.mensaje) erroresServidor[detalle.campo] = detalle.mensaje;
      }
      setErrores(erroresServidor);
      // El mensaje general siempre, por ejemplo SALDO_PENDIENTE (no trae campo)
      setErrorGeneral(cuerpo?.error?.message || 'No se pudo guardar el cliente.');
    } catch {
      setErrorGeneral('No se pudo conectar con el servidor.');
    }
    setEnviando(false);
  }

  // Un mensaje de error chico debajo de un campo, si lo hay
  function errorDe(campo: string) {
    if (!errores[campo]) return null;
    return <p className="text-xs text-destructive">{errores[campo]}</p>;
  }

  return (
    <form onSubmit={guardar} className="space-y-4 rounded-xl border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="tipoDoc">Tipo de documento</Label>
          <select
            id="tipoDoc"
            value={tipoDoc}
            onChange={(e) => setTipoDoc(e.target.value === 'CUIT' ? 'CUIT' : 'DNI')}
            className={claseSelect}
          >
            <option value="DNI">DNI</option>
            <option value="CUIT">CUIT</option>
          </select>
          {errorDe('tipoDoc')}
        </div>

        <div className="space-y-1 sm:col-span-2">
          {/* "(obligatorio)" avisa ANTES de enviar qué campos hay que completar */}
          <Label htmlFor="nroDoc">
            Número de documento <span className="font-normal text-muted-foreground">(obligatorio)</span>
          </Label>
          {/* autoFocus: se puede escribir apenas abre, sin el mouse.
              aria-invalid pinta el borde en rojo si hay error. */}
          <Input
            id="nroDoc"
            autoFocus
            inputMode="numeric"
            placeholder="28.456.123"
            value={nroDoc}
            onChange={(e) => setNroDoc(e.target.value)}
            aria-invalid={errores.nroDoc ? true : undefined}
          />
          {errorDe('nroDoc')}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="nombre">
          Nombre y apellido o razón social <span className="font-normal text-muted-foreground">(obligatorio)</span>
        </Label>
        <Input
          id="nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          aria-invalid={errores.nombre ? true : undefined}
        />
        {errorDe('nombre')}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="domicilio">Domicilio</Label>
          <Input id="domicilio" value={domicilio} onChange={(e) => setDomicilio(e.target.value)} />
          {errorDe('domicilio')}
        </div>
        <div className="space-y-1">
          <Label htmlFor="telefono">Teléfono</Label>
          <Input id="telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          {errorDe('telefono')}
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {errorDe('email')}
        </div>
      </div>

      {/* Cuenta corriente y límite (reglas 6 y 7) */}
      <div className="space-y-3 rounded-lg border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={cuentaCorriente}
            onChange={(e) => setCuentaCorriente(e.target.checked)}
            className="size-4 accent-primary"
          />
          Habilitar cuenta corriente
        </label>

        {/* El límite solo tiene sentido con cuenta corriente: sin ella, el
            servidor lo guarda en null igual (crearCliente/actualizarCliente) */}
        {cuentaCorriente && (
          <div className="space-y-1 sm:max-w-xs">
            <Label htmlFor="limiteCredito">Límite de crédito ($) — vacío = sin límite</Label>
            <Input
              id="limiteCredito"
              inputMode="decimal"
              placeholder="50.000"
              value={limiteTexto}
              onChange={(e) => setLimiteTexto(e.target.value)}
              aria-invalid={errores.limiteCredito ? true : undefined}
            />
            {errorDe('limiteCredito')}
          </div>
        )}
        {errorDe('cuentaCorriente')}
      </div>

      {errorGeneral && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {errorGeneral}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={enviando}>
          {enviando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Crear cliente'}
        </Button>
        <Button asChild variant="outline">
          {/* Cancelar vuelve a donde estaba: la ficha (edición) o el listado (alta) */}
          <Link href={esEdicion ? `/clientes/${cliente.id}` : '/clientes'}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
