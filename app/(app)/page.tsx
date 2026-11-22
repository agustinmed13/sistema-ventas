// Tablero de inicio (RF-T1, RF-T2, RF-T3) — /
//
// SERVER COMPONENT: se ejecuta en el servidor y llama directo al servicio
// obtenerTablero() (lib/servicios/tablero.ts), sin pasar por la API
// (consigna 10.6). Es la misma información que GET /api/tablero.
//
// Los gráficos son el único Client Component (graficos-tablero.tsx),
// porque Chart.js dibuja en el navegador. Esta página les pasa los datos
// ya calculados.

import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { obtenerUsuarioActual } from '@/lib/auth';
import { obtenerTablero } from '@/lib/servicios/tablero';
import { formatearImporte } from '@/lib/formato';
import GraficosTablero from './graficos-tablero';

export default function TableroPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-2xl font-semibold">Tablero</h1>

      {/* Estado: carga. Mientras el servidor junta los números, se ve el
          cartel; después aparece el tablero. */}
      <Suspense
        fallback={
          <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">Cargando tablero...</p>
        }
      >
        <ContenidoTablero />
      </Suspense>
    </div>
  );
}

// Un indicador: título chico, número grande y una aclaración abajo.
// Si recibe "href", todo el recuadro es un link.
function Indicador({
  titulo,
  valor,
  detalle,
  href,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  href?: string;
}) {
  const contenido = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className="text-2xl font-semibold">{valor}</p>
      <p className="text-xs text-muted-foreground">{detalle}</p>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="block rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50">
        {contenido}
      </Link>
    );
  }
  return <div className="rounded-xl border bg-card p-4">{contenido}</div>;
}

// ═════════════════════════════════════════════════════════════
// EL CONTENIDO — espera los datos del servicio
// ═════════════════════════════════════════════════════════════
async function ContenidoTablero() {
  // El layout ya garantiza la sesión; este if es para TypeScript.
  const usuario = await obtenerUsuarioActual();
  if (!usuario) redirect('/login');

  // Estado: error. Si algo falla, un aviso en lugar de romper la página.
  let tablero;
  try {
    tablero = await obtenerTablero(usuario);
  } catch (error) {
    console.error(error);
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        No se pudo cargar el tablero. Probá de nuevo.
      </div>
    );
  }

  const { hoy, mes, cuentasCorrientes, bajoMinimo } = tablero;

  return (
    <div className="space-y-4">
      {/* ─── Indicadores (RF-T1) ─── importes con lib/formato.ts (regla 10) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador
          titulo="Ventas de hoy"
          valor={formatearImporte(hoy.importe)}
          detalle={hoy.cantidad === 1 ? '1 venta' : `${hoy.cantidad} ventas`}
        />
        <Indicador
          titulo="Ventas del mes"
          valor={formatearImporte(mes.importe)}
          detalle={`${mes.cantidad} ventas · ticket promedio ${formatearImporte(mes.ticketPromedio)}`}
        />
        {/* Lleva a los saldos de clientes (RF-C6) */}
        <Indicador
          titulo="Total adeudado"
          valor={formatearImporte(cuentasCorrientes.totalAdeudado)}
          detalle={
            cuentasCorrientes.clientesConSaldo === 1
              ? '1 cliente con saldo'
              : `${cuentasCorrientes.clientesConSaldo} clientes con saldo`
          }
          href="/clientes?conDeuda=true&orden=saldo"
        />
        {/* Lleva a la lista para reponer: sección 11.7, "la lista de
            productos para reponer sale de GET /api/productos?bajoMinimo=true" */}
        <Indicador
          titulo="Productos bajo el mínimo"
          valor={String(bajoMinimo.cantidad)}
          detalle={bajoMinimo.cantidad === 0 ? 'No hay nada para reponer' : 'Ver la lista para reponer'}
          href="/productos?bajoMinimo=true"
        />
      </div>

      {/* ─── Gráficos (RF-T2) ─── */}
      <GraficosTablero ventasDiarias={tablero.ventasDiarias} porFormaDePago={tablero.porFormaDePago} />

      {/* ─── Los 5 más vendidos del mes (RF-T3) ─── */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Más vendidos del mes</h2>
        {tablero.masVendidos.length === 0 ? (
          // Estado: vacío
          <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
            Todavía no hay ventas este mes.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Código</th>
                  <th className="px-3 py-2 font-medium">Producto</th>
                  <th className="px-3 py-2 text-right font-medium">Unidades</th>
                  <th className="px-3 py-2 text-right font-medium">Importe</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tablero.masVendidos.map((p, indice) => (
                  <tr key={p.productoId} className="hover:bg-muted/50">
                    <td className="px-3 py-2 text-muted-foreground">{indice + 1}</td>
                    <td className="hidden whitespace-nowrap px-3 py-2 font-mono sm:table-cell">{p.codigo}</td>
                    <td className="px-3 py-2">{p.descripcion}</td>
                    <td className="px-3 py-2 text-right font-semibold">{p.unidades}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatearImporte(p.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
