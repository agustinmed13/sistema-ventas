'use client';
// Pantalla de nueva venta (RF-V1 a RF-V5). Por ahora: consumidor final y contado.
//
// 'use client' = corre en el NAVEGADOR. Hace falta porque la pantalla
// reacciona a lo que el usuario escribe y hace pedidos a la API.
//
// La carpeta (app) va entre paréntesis: Next.js NO la pone en la URL.
// Esta página se ve en /ventas/nueva.

import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';

// ─────────────────────────────────────────────────────────────
// FORMATO DE IMPORTES
// TEMPORAL: van acá porque lib/formato.ts todavía no existe.
// Cuando exista, hay que moverlas ahí y borrarlas de este archivo.
// ─────────────────────────────────────────────────────────────

// 1234550 → "$ 12.345,50"
function formatearPesos(centavos: number) {
  // Dividir por 100 acá es seguro: es solo para MOSTRAR, no para calcular.
  return (centavos / 100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
}

// Lo que escribe el usuario en pesos → centavos enteros. null si no es válido.
//   "15000"     → 1500000
//   "15.000"    → 1500000   (el punto es separador de miles, como en Argentina)
//   "15000,50"  → 1500050   (la coma es el decimal)
function pesosACentavos(texto: string): number | null {
  const limpio = texto.trim().replace(/\./g, '').replace(',', '.');
  // Solo dígitos, y opcionalmente un punto con 1 o 2 decimales
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  // Math.round corrige el error de los decimales en JavaScript:
  // 0.29 * 100 da 28.999999999999996, y redondeado da 29.
  return Math.round(Number(limpio) * 100);
}

// ─────────────────────────────────────────────────────────────
// TIPOS — la forma de los datos que maneja la pantalla
// ─────────────────────────────────────────────────────────────

// Lo que devuelve GET /api/productos
type Producto = {
  id: number;
  codigo: string;
  descripcion: string;
  precioCentavos: number;
  existencia: number;
};

// Un renglón de la venta: los datos del producto más la cantidad elegida
type Renglon = {
  productoId: number;
  codigo: string;
  descripcion: string;
  precioCentavos: number; // solo para mostrar: el precio que vale es el del servidor
  existencia: number;
  cantidad: number;
};

export default function NuevaVentaPage() {
  const router = useRouter();

  // ─────────────────────────────────────────────────────────
  // ESTADO
  // useState guarda un dato que, cuando cambia, hace que React vuelva
  // a dibujar la pantalla. Devuelve [valor, función para cambiarlo].
  // ─────────────────────────────────────────────────────────
  const [busqueda, setBusqueda] = useState(''); // lo que se escribe en el buscador
  const [resultados, setResultados] = useState<Producto[]>([]); // productos encontrados
  const [resaltado, setResaltado] = useState(0); // qué resultado está marcado (para el teclado)
  const [errorBusqueda, setErrorBusqueda] = useState('');

  const [renglones, setRenglones] = useState<Renglon[]>([]); // los ítems de la venta
  const [aviso, setAviso] = useState(''); // avisos de existencia

  const [recibidoTexto, setRecibidoTexto] = useState(''); // monto recibido, tal cual lo escribió
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(''); // error al confirmar

  // useRef guarda una referencia a un elemento de la pantalla, para
  // poder ponerle el foco (el cursor) desde el código.
  const refBuscador = useRef<HTMLInputElement>(null);
  const refRecibido = useRef<HTMLInputElement>(null);

  // ─────────────────────────────────────────────────────────
  // VALORES CALCULADOS
  // No se guardan en el estado: se recalculan en cada dibujo a partir
  // de los renglones y del monto. Por eso el total y el vuelto están
  // siempre actualizados solos.
  // El total es solo para MOSTRAR: el que vale lo calcula el servidor.
  // ─────────────────────────────────────────────────────────
  let totalCentavos = 0;
  for (const r of renglones) {
    totalCentavos = totalCentavos + r.precioCentavos * r.cantidad;
  }
  const recibidoCentavos = pesosACentavos(recibidoTexto);
  const cantidadesValidas = renglones.every((r) => r.cantidad >= 1);
  const pagoValido = recibidoCentavos !== null && recibidoCentavos >= totalCentavos;
  const puedeConfirmar = renglones.length > 0 && cantidadesValidas && pagoValido && !enviando;
  // La lista de resultados solo se ve si hay algo escrito en el buscador
  const mostrarResultados = busqueda.trim() !== '' && resultados.length > 0;

  // ─────────────────────────────────────────────────────────
  // BÚSQUEDA DE PRODUCTOS
  // useEffect ejecuta código DESPUÉS de dibujar, cada vez que cambia
  // lo que está en la lista del final ([busqueda]).
  // Esperamos 300 ms desde la última tecla antes de buscar, para no
  // mandar un pedido por cada letra.
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    // Buscador vacío: no buscamos nada. La lista de resultados no se
    // muestra (ver "mostrarResultados" más abajo).
    if (busqueda.trim() === '') return;

    // Se pone en true si el usuario sigue escribiendo: así descartamos
    // la respuesta de una búsqueda vieja que llegue tarde.
    let cancelado = false;

    const temporizador = setTimeout(async () => {
      try {
        // encodeURIComponent: convierte espacios y acentos para la URL
        const respuesta = await fetch('/api/productos?q=' + encodeURIComponent(busqueda.trim()));
        if (!respuesta.ok) {
          throw new Error('respuesta no ok');
        }
        const cuerpo = await respuesta.json();
        if (!cancelado) {
          setResultados(cuerpo.data);
          setResaltado(0);
          setErrorBusqueda('');
        }
      } catch {
        // La ruta de productos la hace otra compañera: si todavía no
        // existe o falla, avisamos y la pantalla sigue funcionando.
        if (!cancelado) {
          setResultados([]);
          setErrorBusqueda('No se pudo buscar productos. Puede que /api/productos todavía no esté disponible.');
        }
      }
    }, 300);

    // Esta función de "limpieza" se ejecuta antes de la próxima búsqueda:
    // cancela el temporizador pendiente y marca la búsqueda vieja.
    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [busqueda]);

  // ─────────────────────────────────────────────────────────
  // AGREGAR UN PRODUCTO A LA VENTA
  // ─────────────────────────────────────────────────────────
  function agregar(producto: Producto) {
    setAviso('');
    const existente = renglones.find((r) => r.productoId === producto.id);

    if (existente) {
      // RF-V3: si ya está en la venta, se suma 1 al renglón existente
      if (existente.cantidad + 1 > producto.existencia) {
        // RF-V4: no se puede vender más de lo que hay
        setAviso(`Solo hay ${producto.existencia} unidades de ${producto.descripcion}.`);
      } else {
        // .map arma una lista NUEVA: igual a la anterior, salvo el renglón
        // de este producto, que va con la cantidad + 1.
        // { ...r, cantidad: X } = "una copia de r, pero con otra cantidad".
        setRenglones(
          renglones.map((r) => (r.productoId === producto.id ? { ...r, cantidad: r.cantidad + 1 } : r))
        );
      }
    } else if (producto.existencia < 1) {
      setAviso(`${producto.descripcion} no tiene existencia.`);
    } else {
      // Producto nuevo en la venta: renglón con cantidad 1
      // [...renglones, nuevo] = "una lista nueva con todos los de antes, más este"
      setRenglones([
        ...renglones,
        {
          productoId: producto.id,
          codigo: producto.codigo,
          descripcion: producto.descripcion,
          precioCentavos: producto.precioCentavos,
          existencia: producto.existencia,
          cantidad: 1,
        },
      ]);
    }

    // Limpiamos el buscador y dejamos el cursor ahí para el próximo producto
    setBusqueda('');
    setResultados([]);
    refBuscador.current?.focus();
  }

  // ─────────────────────────────────────────────────────────
  // CAMBIAR LA CANTIDAD DE UN RENGLÓN
  // ─────────────────────────────────────────────────────────
  function cambiarCantidad(productoId: number, texto: string) {
    setAviso('');
    const renglon = renglones.find((r) => r.productoId === productoId);
    if (!renglon) return;

    let cantidad = parseInt(texto, 10);
    // Campo vacío mientras se escribe: queda en 0 y el renglón muestra
    // "mínimo 1". El botón de confirmar no se habilita hasta corregirlo.
    if (isNaN(cantidad) || cantidad < 0) cantidad = 0;

    // RF-V4: no más que la existencia. Si se pasa, dejamos el máximo y avisamos.
    if (cantidad > renglon.existencia) {
      setAviso(`Solo hay ${renglon.existencia} unidades de ${renglon.descripcion}.`);
      cantidad = renglon.existencia;
    }

    setRenglones(renglones.map((r) => (r.productoId === productoId ? { ...r, cantidad } : r)));
  }

  function quitar(productoId: number) {
    // .filter arma una lista nueva SIN ese renglón
    setRenglones(renglones.filter((r) => r.productoId !== productoId));
  }

  // ─────────────────────────────────────────────────────────
  // TECLADO EN EL BUSCADOR (venta ágil)
  //   ↓ ↑     moverse por los resultados
  //   Enter   agregar el resultado marcado
  //   Enter con el buscador vacío → saltar al monto recibido
  //   Esc     limpiar la búsqueda
  // ─────────────────────────────────────────────────────────
  function teclaEnBuscador(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault(); // evita que el cursor se mueva dentro del texto
      setResaltado(Math.min(resaltado + 1, resultados.length - 1));
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setResaltado(Math.max(resaltado - 1, 0));
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      if (busqueda.trim() === '') {
        refRecibido.current?.focus();
        return;
      }
      const producto = resultados[resaltado];
      if (producto) agregar(producto);
    } else if (evento.key === 'Escape') {
      setBusqueda('');
    }
  }

  // ─────────────────────────────────────────────────────────
  // CONFIRMAR LA VENTA
  // ─────────────────────────────────────────────────────────
  async function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault(); // que el formulario no recargue la página
    if (!puedeConfirmar) return;

    setEnviando(true);
    setError('');

    try {
      const respuesta = await fetch('/api/facturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // SOLO producto y cantidad. Nada de precios ni totales:
        // eso lo calcula el servidor con los precios de la base.
        body: JSON.stringify({
          clienteId: null,
          formaPago: 'contado',
          items: renglones.map((r) => ({ productoId: r.productoId, cantidad: r.cantidad })),
          montoRecibidoCentavos: recibidoCentavos,
        }),
      });

      if (respuesta.ok) {
        const factura = await respuesta.json();
        // Vamos al comprobante. enviando queda en true: el botón sigue
        // deshabilitado mientras cambia la página.
        router.push(`/ventas/${factura.id}`);
        return;
      }

      // Error: la API responde { error: { code, message, details } }
      // (consigna, seccion 11.1). El mensaje del servidor ya viene completo:
      // en STOCK_INSUFICIENTE incluye el producto, lo disponible y lo pedido.
      const cuerpo = await respuesta.json().catch(() => null);
      setError(cuerpo?.error?.message || 'No se pudo confirmar la venta.');
    } catch {
      setError('No se pudo conectar con el servidor.');
    }
    setEnviando(false);
  }

  // ─────────────────────────────────────────────────────────
  // LO QUE SE DIBUJA
  // ─────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 text-gray-900">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Nueva venta</h1>

        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {/* ═══ ZONA 1: COMPRADOR ═══ */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-medium text-gray-500">Comprador</h2>
          <p className="font-medium">Consumidor final</p>
        </section>

        {/* ═══ ZONA 2: ÍTEMS ═══ */}
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-medium text-gray-500">Ítems</h2>

          {/* Buscador */}
          <div className="relative">
            <input
              ref={refBuscador}
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={teclaEnBuscador}
              placeholder="Buscar por código o descripción…"
              autoFocus
              aria-label="Buscar producto"
              className="w-full rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {/* Resultados: lista debajo del buscador */}
            {mostrarResultados && (
              <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded border border-gray-200 bg-white shadow">
                {resultados.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => agregar(p)}
                      // El marcado con las flechas se pinta de azul
                      className={`flex w-full justify-between gap-2 px-3 py-2 text-left text-sm ${
                        i === resaltado ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span>
                        <span className="text-gray-500">{p.codigo}</span> {p.descripcion}
                      </span>
                      <span className="shrink-0 text-right">
                        {formatearPesos(p.precioCentavos)}
                        <span className={`block text-xs ${p.existencia < 1 ? 'text-red-600' : 'text-gray-500'}`}>
                          Existencia: {p.existencia}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-gray-500">
            ↑ ↓ para elegir · Enter para agregar · Enter con el buscador vacío para ir al pago
          </p>

          {errorBusqueda && (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {errorBusqueda}
            </p>
          )}
          {aviso && (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>
          )}

          {/* Renglones de la venta */}
          {renglones.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">Todavía no hay productos en la venta.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {renglones.map((r) => (
                // flex-wrap: en pantallas angostas la descripción ocupa una
                // línea y los números bajan a la siguiente
                <li key={r.productoId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="w-full sm:w-auto sm:flex-1">
                    <p className="font-medium">{r.descripcion}</p>
                    <p className="text-xs text-gray-500">
                      {formatearPesos(r.precioCentavos)} c/u · Existencia: {r.existencia}
                    </p>
                  </div>
                  <div>
                    <input
                      type="number"
                      min={1}
                      max={r.existencia}
                      value={r.cantidad === 0 ? '' : r.cantidad}
                      onChange={(e) => cambiarCantidad(r.productoId, e.target.value)}
                      aria-label={`Cantidad de ${r.descripcion}`}
                      className={`w-20 rounded border px-2 py-1 text-right ${
                        r.cantidad < 1 ? 'border-red-400' : 'border-gray-300'
                      }`}
                    />
                    {r.cantidad < 1 && <p className="text-xs text-red-600">Mínimo 1</p>}
                  </div>
                  <p className="ml-auto w-28 text-right font-medium">
                    {formatearPesos(r.precioCentavos * r.cantidad)}
                  </p>
                  <button
                    type="button"
                    onClick={() => quitar(r.productoId)}
                    aria-label={`Quitar ${r.descripcion}`}
                    className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-between border-t border-gray-200 pt-3 text-lg font-semibold">
            <span>Total</span>
            <span>{formatearPesos(totalCentavos)}</span>
          </div>
        </section>

        {/* ═══ ZONA 3: PAGO ═══
            Es un <form>: así Enter en el monto recibido confirma la venta */}
        <form onSubmit={confirmar} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-medium text-gray-500">Pago — Contado</h2>

          <div className="space-y-1">
            <label htmlFor="recibido" className="block text-sm font-medium">
              Monto recibido (en pesos)
            </label>
            <input
              id="recibido"
              ref={refRecibido}
              type="text"
              // inputMode="decimal": en el celular abre el teclado numérico
              inputMode="decimal"
              value={recibidoTexto}
              onChange={(e) => setRecibidoTexto(e.target.value)}
              placeholder="Ej: 15000 o 15.000,50"
              className="w-full rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-60"
            />
          </div>

          {/* Mensajes del pago: solo si escribió algo */}
          {recibidoTexto.trim() !== '' && recibidoCentavos === null && (
            <p className="text-sm text-red-600">El monto no es válido. Usá números, con coma para los centavos.</p>
          )}
          {recibidoCentavos !== null && recibidoCentavos < totalCentavos && (
            <p className="text-sm text-red-600">
              El monto recibido no alcanza. Faltan {formatearPesos(totalCentavos - recibidoCentavos)}.
            </p>
          )}
          {pagoValido && renglones.length > 0 && (
            <p className="text-lg">
              Vuelto: <span className="font-semibold">{formatearPesos(recibidoCentavos - totalCentavos)}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={!puedeConfirmar}
            className="w-full rounded bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {enviando ? 'Confirmando...' : 'Confirmar venta'}
          </button>
        </form>
      </div>
    </main>
  );
}
