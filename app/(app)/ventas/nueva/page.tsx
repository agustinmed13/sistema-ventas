'use client';
// Pantalla de nueva venta (RF-V1 a RF-V5).
//
// 'use client' = corre en el NAVEGADOR. Hace falta porque la pantalla
// reacciona a lo que el usuario escribe y hace pedidos a la API.
//
// La carpeta (app) va entre paréntesis: Next.js NO la pone en la URL.
// Esta página se ve en /ventas/nueva.
//
// Tres zonas (RF-V1): comprador, ítems y pago.

import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatearImporte, formatearDocumento, pesosACentavos } from '@/lib/formato';
import ModalClienteNuevo, { type ClienteElegido } from './modal-cliente-nuevo';

// ─────────────────────────────────────────────────────────────
// TIPOS — la forma de los datos que maneja la pantalla
// ─────────────────────────────────────────────────────────────

// Lo que devuelve GET /api/productos.
// El campo de la API se llama "precio" (sección 11.4): viene en centavos
// enteros igual, pero sin el sufijo. Adentro de esta pantalla le seguimos
// diciendo precioCentavos, que es más claro para nosotros.
type Producto = {
  id: number;
  codigo: string;
  descripcion: string;
  precio: number;
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

type FormaPago = 'contado' | 'tarjeta' | 'cuenta_corriente';

// Estilo de los campos, parecido al de los botones de shadcn
const claseCampo =
  'h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export default function NuevaVentaPage() {
  const router = useRouter();

  // ─────────────────────────────────────────────────────────
  // ESTADO
  // useState guarda un dato que, cuando cambia, hace que React vuelva
  // a dibujar la pantalla. Devuelve [valor, función para cambiarlo].
  // ─────────────────────────────────────────────────────────

  // --- Comprador (RF-V2) ---
  // null = consumidor final
  const [cliente, setCliente] = useState<ClienteElegido | null>(null);
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [resultadosClientes, setResultadosClientes] = useState<ClienteElegido[]>([]);
  const [resaltadoCliente, setResaltadoCliente] = useState(0);
  const [errorBusquedaCliente, setErrorBusquedaCliente] = useState('');
  const [modalAbierto, setModalAbierto] = useState(false);

  // --- Ítems (RF-V3, RF-V4) ---
  const [busqueda, setBusqueda] = useState(''); // lo que se escribe en el buscador de productos
  const [resultados, setResultados] = useState<Producto[]>([]); // productos encontrados
  const [resaltado, setResaltado] = useState(0); // qué resultado está marcado (para el teclado)
  const [errorBusqueda, setErrorBusqueda] = useState('');
  const [renglones, setRenglones] = useState<Renglon[]>([]); // los ítems de la venta
  const [aviso, setAviso] = useState(''); // avisos de existencia

  // --- Pago (RF-V5) ---
  const [formaPago, setFormaPago] = useState<FormaPago>('contado');
  const [recibidoTexto, setRecibidoTexto] = useState(''); // contado: monto recibido, tal cual lo escribió
  const [tarjetaTipo, setTarjetaTipo] = useState<'debito' | 'credito'>('debito');
  const [tarjetaMarca, setTarjetaMarca] = useState('');
  const [tarjetaUltimos4, setTarjetaUltimos4] = useState('');

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(''); // error al confirmar

  // useRef guarda una referencia a un elemento de la pantalla, para
  // poder ponerle el foco (el cursor) desde el código.
  const refBuscador = useRef<HTMLInputElement>(null);
  const refRecibido = useRef<HTMLInputElement>(null);
  const refMarca = useRef<HTMLInputElement>(null);
  const refConfirmar = useRef<HTMLButtonElement>(null);

  // ─────────────────────────────────────────────────────────
  // VALORES CALCULADOS
  // No se guardan en el estado: se recalculan en cada dibujo a partir
  // del resto. Por eso el total, el vuelto y los avisos están siempre
  // actualizados solos.
  // El total es solo para MOSTRAR: el que vale lo calcula el servidor.
  // ─────────────────────────────────────────────────────────
  let totalCentavos = 0;
  for (const r of renglones) {
    totalCentavos = totalCentavos + r.precioCentavos * r.cantidad;
  }
  const cantidadesValidas = renglones.every((r) => r.cantidad >= 1);

  // Contado
  const recibidoCentavos = pesosACentavos(recibidoTexto);

  // Cuenta corriente: solo con cliente registrado Y habilitado (regla 6)
  const puedeCuentaCorriente = cliente !== null && cliente.cuentaCorriente;
  let motivoSinCuentaCorriente = '';
  if (cliente === null) {
    motivoSinCuentaCorriente = 'Consumidor final no puede comprar en cuenta corriente.';
  } else if (!cliente.cuentaCorriente) {
    motivoSinCuentaCorriente = 'Este cliente no tiene cuenta corriente habilitada.';
  }

  // Límite de crédito (regla 7): saldo actual + esta venta no puede
  // superarlo. Es un AVISO ADELANTADO para dar mejor experiencia: el
  // servidor lo vuelve a verificar al confirmar y es el control que vale
  // (consigna, sección 6).
  const superaLimite =
    formaPago === 'cuenta_corriente' &&
    cliente !== null &&
    cliente.limiteCredito !== null &&
    cliente.saldo + totalCentavos > cliente.limiteCredito;

  // ¿El pago está completo, según la forma elegida?
  let pagoValido = false;
  if (formaPago === 'contado') {
    pagoValido = recibidoCentavos !== null && recibidoCentavos >= totalCentavos;
  } else if (formaPago === 'tarjeta') {
    pagoValido = tarjetaMarca.trim() !== '' && /^\d{4}$/.test(tarjetaUltimos4);
  } else {
    pagoValido = puedeCuentaCorriente && !superaLimite;
  }

  const puedeConfirmar = renglones.length > 0 && cantidadesValidas && pagoValido && !enviando;
  const mostrarResultados = busqueda.trim() !== '' && resultados.length > 0;
  const mostrarResultadosClientes = busquedaCliente.trim() !== '' && resultadosClientes.length > 0;

  // ─────────────────────────────────────────────────────────
  // BÚSQUEDA DE CLIENTES (RF-V2)
  // Misma idea que la de productos (ver más abajo): esperar 300 ms
  // desde la última tecla y descartar respuestas viejas.
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (busquedaCliente.trim() === '') return;
    let cancelado = false;

    const temporizador = setTimeout(async () => {
      try {
        const respuesta = await fetch('/api/clientes?q=' + encodeURIComponent(busquedaCliente.trim()));
        if (!respuesta.ok) throw new Error('respuesta no ok');
        const cuerpo = await respuesta.json();
        if (!cancelado) {
          // Formato de listado de la sección 11.1: { data, page, pageSize, total }
          setResultadosClientes(cuerpo.data);
          setResaltadoCliente(0);
          setErrorBusquedaCliente('');
        }
      } catch {
        // La ruta de clientes la hace otra compañera: si todavía no
        // existe o falla, avisamos y la venta sigue con consumidor final.
        if (!cancelado) {
          setResultadosClientes([]);
          setErrorBusquedaCliente(
            'No se pudo buscar clientes. Puede que /api/clientes todavía no esté disponible. La venta sigue como consumidor final.'
          );
        }
      }
    }, 300);

    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [busquedaCliente]);

  // ─────────────────────────────────────────────────────────
  // BÚSQUEDA DE PRODUCTOS
  // useEffect ejecuta código DESPUÉS de dibujar, cada vez que cambia
  // lo que está en la lista del final ([busqueda]).
  // Esperamos 300 ms desde la última tecla antes de buscar, para no
  // mandar un pedido por cada letra.
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    // Buscador vacío: no buscamos nada. La lista de resultados no se
    // muestra (ver "mostrarResultados" más arriba).
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
  // ELEGIR / QUITAR EL COMPRADOR (RF-V2)
  // Ninguna de estas funciones toca "renglones": cambiar de comprador
  // no afecta los productos cargados.
  // ─────────────────────────────────────────────────────────
  function elegirCliente(elegido: ClienteElegido) {
    setCliente(elegido);
    setBusquedaCliente('');
    setResultadosClientes([]);
    // Si estaba en cuenta corriente y este cliente no la tiene, volvemos
    // a contado para no dejar una opción que no se puede usar (regla 6)
    if (formaPago === 'cuenta_corriente' && !elegido.cuentaCorriente) {
      setFormaPago('contado');
    }
    refBuscador.current?.focus(); // seguimos con los productos
  }

  function volverAConsumidorFinal() {
    setCliente(null);
    // Consumidor final no compra en cuenta corriente (regla 6)
    if (formaPago === 'cuenta_corriente') setFormaPago('contado');
  }

  function teclaEnBuscadorCliente(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setResaltadoCliente(Math.min(resaltadoCliente + 1, resultadosClientes.length - 1));
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setResaltadoCliente(Math.max(resaltadoCliente - 1, 0));
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      const elegido = resultadosClientes[resaltadoCliente];
      if (elegido) elegirCliente(elegido);
    } else if (evento.key === 'Escape') {
      setBusquedaCliente('');
    }
  }

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
          precioCentavos: producto.precio,
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
  // TECLADO EN EL BUSCADOR DE PRODUCTOS (venta ágil)
  //   ↓ ↑     moverse por los resultados
  //   Enter   agregar el resultado marcado
  //   Enter con el buscador vacío → saltar al pago
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
        // Saltamos al primer dato que pide la forma de pago elegida
        if (formaPago === 'contado') refRecibido.current?.focus();
        else if (formaPago === 'tarjeta') refMarca.current?.focus();
        else refConfirmar.current?.focus();
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

    // El cuerpo cambia según la forma de pago. Los campos que no
    // corresponden NO se mandan. Nunca precios ni totales: los calcula
    // el servidor con los precios de la base.
    const items = renglones.map((r) => ({ productoId: r.productoId, cantidad: r.cantidad }));
    const clienteId = cliente ? cliente.id : null; // null = consumidor final

    // La forma de pago va ANIDADA dentro de "pago" (consigna, seccion 11.6).
    // El importe se llama montoRecibido, sin el sufijo Centavos: va en
    // centavos enteros igual, pero el campo de la API no lleva ese nombre.
    let cuerpoPedido;
    if (formaPago === 'contado') {
      cuerpoPedido = {
        clienteId,
        items,
        pago: { forma: 'contado', montoRecibido: recibidoCentavos },
      };
    } else if (formaPago === 'tarjeta') {
      cuerpoPedido = {
        clienteId,
        items,
        pago: {
          forma: 'tarjeta',
          tarjeta: { tipo: tarjetaTipo, marca: tarjetaMarca.trim(), ultimos4: tarjetaUltimos4 },
        },
      };
    } else {
      cuerpoPedido = { clienteId, items, pago: { forma: 'cuenta_corriente' } };
    }

    try {
      const respuesta = await fetch('/api/facturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoPedido),
      });

      if (respuesta.ok) {
        const factura = await respuesta.json();
        // Vamos al comprobante. enviando queda en true: el botón sigue
        // deshabilitado mientras cambia la página.
        router.push(`/ventas/${factura.id}`);
        return;
      }

      // Error: la API responde { error: { code, message, details } }
      // (consigna, sección 11.1). El mensaje del servidor ya viene completo:
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
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Nueva venta</h1>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* ═══ ZONA 1: COMPRADOR (RF-V2) ═══ */}
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Comprador</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => setModalAbierto(true)}>
            <UserPlus />
            Cliente nuevo
          </Button>
        </div>

        {cliente === null ? (
          <>
            {/* Por defecto: consumidor final, sin pedir datos */}
            <p className="font-medium">Consumidor final</p>

            <div className="relative">
              <input
                type="text"
                value={busquedaCliente}
                onChange={(e) => setBusquedaCliente(e.target.value)}
                onKeyDown={teclaEnBuscadorCliente}
                placeholder="Buscar cliente por nombre o documento…"
                aria-label="Buscar cliente"
                className={claseCampo}
              />
              {mostrarResultadosClientes && (
                <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-card shadow">
                  {resultadosClientes.map((c, i) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => elegirCliente(c)}
                        className={`flex w-full flex-wrap justify-between gap-x-2 px-3 py-2 text-left text-sm ${
                          i === resaltadoCliente ? 'bg-accent' : 'hover:bg-muted'
                        }`}
                      >
                        <span className="font-medium">{c.nombre}</span>
                        <span className="text-muted-foreground">
                          {formatearDocumento(c.tipoDoc, c.nroDoc)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {errorBusquedaCliente && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {errorBusquedaCliente}
              </p>
            )}
          </>
        ) : (
          // Cliente elegido: nombre, documento y, si tiene cuenta, saldo y límite
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="text-sm">
              <p className="text-base font-medium">{cliente.nombre}</p>
              <p className="text-muted-foreground">{formatearDocumento(cliente.tipoDoc, cliente.nroDoc)}</p>
              {cliente.cuentaCorriente ? (
                <p className="text-muted-foreground">
                  Saldo: {formatearImporte(cliente.saldo)} · Límite:{' '}
                  {cliente.limiteCredito !== null ? formatearImporte(cliente.limiteCredito) : 'sin límite'}
                </p>
              ) : (
                <p className="text-muted-foreground">Sin cuenta corriente</p>
              )}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={volverAConsumidorFinal}>
              <X />
              Consumidor final
            </Button>
          </div>
        )}
      </section>

      {/* ═══ ZONA 2: ÍTEMS (RF-V3, RF-V4) ═══ */}
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Ítems</h2>

        {/* Buscador */}
        <div className="relative">
          <input
            ref={refBuscador}
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={teclaEnBuscador}
            placeholder="Buscar producto por código o descripción…"
            autoFocus
            aria-label="Buscar producto"
            className={claseCampo}
          />

          {/* Resultados: lista debajo del buscador */}
          {mostrarResultados && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-card shadow">
              {resultados.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => agregar(p)}
                    // El marcado con las flechas se pinta resaltado
                    className={`flex w-full justify-between gap-2 px-3 py-2 text-left text-sm ${
                      i === resaltado ? 'bg-accent' : 'hover:bg-muted'
                    }`}
                  >
                    <span>
                      <span className="text-muted-foreground">{p.codigo}</span> {p.descripcion}
                    </span>
                    <span className="shrink-0 text-right">
                      {formatearImporte(p.precio)}
                      <span className={`block text-xs ${p.existencia < 1 ? 'text-destructive' : 'text-muted-foreground'}`}>
                        Existencia: {p.existencia}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          ↑ ↓ para elegir · Enter para agregar · Enter con el buscador vacío para ir al pago
        </p>

        {errorBusqueda && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{errorBusqueda}</p>
        )}
        {aviso && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>
        )}

        {/* Renglones de la venta */}
        {renglones.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Todavía no hay productos en la venta.</p>
        ) : (
          <ul className="divide-y">
            {renglones.map((r) => (
              // flex-wrap: en pantallas angostas la descripción ocupa una
              // línea y los números bajan a la siguiente
              <li key={r.productoId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div className="w-full sm:w-auto sm:flex-1">
                  <p className="font-medium">{r.descripcion}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatearImporte(r.precioCentavos)} c/u · Existencia: {r.existencia}
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
                    className={`h-8 w-20 rounded-lg border bg-card px-2 text-right text-sm ${
                      r.cantidad < 1 ? 'border-destructive' : 'border-input'
                    }`}
                  />
                  {r.cantidad < 1 && <p className="text-xs text-destructive">Mínimo 1</p>}
                </div>
                <p className="ml-auto w-28 text-right font-medium">{formatearImporte(r.precioCentavos * r.cantidad)}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => quitar(r.productoId)}
                  aria-label={`Quitar ${r.descripcion}`}
                  className="text-destructive"
                >
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-between border-t pt-3 text-lg font-semibold">
          <span>Total</span>
          <span>{formatearImporte(totalCentavos)}</span>
        </div>
      </section>

      {/* ═══ ZONA 3: PAGO (RF-V5) ═══
          Es un <form>: así Enter en un campo del pago confirma la venta */}
      <form onSubmit={confirmar} className="space-y-4 rounded-xl border bg-card p-4">
        {/* Las tres formas de pago como "radio buttons": se elige UNA.
            Con el teclado: Tab llega al grupo y las flechas cambian la opción. */}
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-muted-foreground">Forma de pago</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-accent">
              <input
                type="radio"
                name="formaPago"
                value="contado"
                checked={formaPago === 'contado'}
                onChange={() => setFormaPago('contado')}
              />
              Contado
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-accent">
              <input
                type="radio"
                name="formaPago"
                value="tarjeta"
                checked={formaPago === 'tarjeta'}
                onChange={() => setFormaPago('tarjeta')}
              />
              Tarjeta
            </label>
            {/* Cuenta corriente: deshabilitada sin cliente habilitado (regla 6) */}
            <label
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-accent ${
                puedeCuentaCorriente ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
              }`}
            >
              <input
                type="radio"
                name="formaPago"
                value="cuenta_corriente"
                checked={formaPago === 'cuenta_corriente'}
                onChange={() => setFormaPago('cuenta_corriente')}
                disabled={!puedeCuentaCorriente}
              />
              Cuenta corriente
            </label>
          </div>
          {/* El motivo a la vista, no escondido */}
          {!puedeCuentaCorriente && <p className="text-xs text-muted-foreground">{motivoSinCuentaCorriente}</p>}
        </fieldset>

        {/* ─── Contado: monto recibido y vuelto ─── */}
        {formaPago === 'contado' && (
          <div className="space-y-2">
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
                className={`${claseCampo} sm:w-60`}
              />
            </div>

            {/* Mensajes del pago: solo si escribió algo */}
            {recibidoTexto.trim() !== '' && recibidoCentavos === null && (
              <p className="text-sm text-destructive">El monto no es válido. Usá números, con coma para los centavos.</p>
            )}
            {recibidoCentavos !== null && recibidoCentavos < totalCentavos && (
              <p className="text-sm text-destructive">
                El monto recibido no alcanza. Faltan {formatearImporte(totalCentavos - recibidoCentavos)}.
              </p>
            )}
            {recibidoCentavos !== null && recibidoCentavos >= totalCentavos && renglones.length > 0 && (
              <p className="text-lg">
                Vuelto: <span className="font-semibold">{formatearImporte(recibidoCentavos - totalCentavos)}</span>
              </p>
            )}
          </div>
        )}

        {/* ─── Tarjeta: tipo, marca y últimos 4 dígitos ───
            REGLA 9 — PREGUNTA DE DEFENSA: "¿dónde se ingresa el número de
            tarjeta?" En NINGÚN lado. El sistema nunca pide ni guarda el
            número completo: solo tipo, marca y los últimos 4 dígitos, que
            alcanzan para identificar el pago en el comprobante. El cobro
            con tarjeta es simulado. */}
        {formaPago === 'tarjeta' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="tarjeta-tipo" className="block text-sm font-medium">
                Tipo
              </label>
              <select
                id="tarjeta-tipo"
                value={tarjetaTipo}
                onChange={(e) => setTarjetaTipo(e.target.value === 'credito' ? 'credito' : 'debito')}
                className={claseCampo}
              >
                <option value="debito">Débito</option>
                <option value="credito">Crédito</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="tarjeta-marca" className="block text-sm font-medium">
                Marca
              </label>
              {/* list="marcas": sugiere las marcas comunes, pero deja escribir otra */}
              <input
                id="tarjeta-marca"
                ref={refMarca}
                list="marcas"
                value={tarjetaMarca}
                onChange={(e) => setTarjetaMarca(e.target.value)}
                placeholder="Visa, Mastercard…"
                className={claseCampo}
              />
              <datalist id="marcas">
                <option value="Visa" />
                <option value="Mastercard" />
                <option value="American Express" />
                <option value="Cabal" />
                <option value="Naranja" />
              </datalist>
            </div>
            <div className="space-y-1">
              <label htmlFor="tarjeta-ultimos4" className="block text-sm font-medium">
                Últimos 4 dígitos
              </label>
              <input
                id="tarjeta-ultimos4"
                value={tarjetaUltimos4}
                // Solo dígitos y como máximo 4: es imposible escribir el número completo
                onChange={(e) => setTarjetaUltimos4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                maxLength={4}
                placeholder="1234"
                className={claseCampo}
              />
              {tarjetaUltimos4 !== '' && tarjetaUltimos4.length < 4 && (
                <p className="text-xs text-destructive">Tienen que ser 4 dígitos.</p>
              )}
            </div>
          </div>
        )}

        {/* ─── Cuenta corriente ─── */}
        {formaPago === 'cuenta_corriente' && cliente !== null && (
          <div className="space-y-1 text-sm">
            <p>
              Se carga {formatearImporte(totalCentavos)} a la cuenta de <span className="font-medium">{cliente.nombre}</span>.
            </p>
            {/* Aviso adelantado del límite (regla 7). El servidor lo vuelve
                a verificar al confirmar: esto no reemplaza ese control. */}
            {superaLimite && cliente.limiteCredito !== null && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
                Esta venta supera el límite de crédito. Saldo actual: {formatearImporte(cliente.saldo)} · Esta venta:{' '}
                {formatearImporte(totalCentavos)} · Límite: {formatearImporte(cliente.limiteCredito)}.
              </p>
            )}
          </div>
        )}

        <Button ref={refConfirmar} type="submit" size="lg" disabled={!puedeConfirmar} className="w-full sm:w-auto">
          {enviando ? 'Confirmando...' : 'Confirmar venta'}
        </Button>
      </form>

      {/* El modal va FUERA del formulario de pago: así guardar un cliente
          nunca confirma la venta. Abrirlo y cerrarlo no toca "renglones":
          la venta en curso sigue intacta (RF-V2). */}
      <ModalClienteNuevo
        abierto={modalAbierto}
        onCerrar={() => setModalAbierto(false)}
        onCreado={(nuevo) => {
          elegirCliente(nuevo);
          setModalAbierto(false);
        }}
      />
    </div>
  );
}
