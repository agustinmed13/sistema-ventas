'use client';
// Los dos gráficos del tablero (RF-T2), con Chart.js y react-chartjs-2
// (stack obligatorio, AGENTS.md sección 2).
//
// Es CLIENT COMPONENT porque Chart.js dibuja en un <canvas> del navegador:
// en el servidor no hay pantalla donde dibujar. La página (page.tsx) es
// Server Component, trae los datos y se los pasa ya calculados: este
// archivo solo los DIBUJA, no calcula nada.
//
// react-chartjs-2 es el "puente": da componentes de React (<Bar>,
// <Doughnut>) que por dentro usan Chart.js.

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  type TooltipItem,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { formatearImporte } from '@/lib/formato';

// Chart.js viene "desarmado" para que el sitio pese menos: hay que
// registrar solo las piezas que se usan.
//   CategoryScale, LinearScale → los ejes del gráfico de barras
//   BarElement                 → las barras
//   ArcElement                 → las porciones del gráfico de dona
//   Tooltip, Legend            → el cartelito al pasar el mouse y la leyenda
ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

// Colores de la paleta de gráficos del tema (--chart-1 a --chart-3 en
// app/globals.css). Chart.js necesita el color concreto, no la clase.
const COLOR_1 = '#0f766e';
const COLOR_2 = '#14b8a6';
const COLOR_3 = '#5eead4';

type Props = {
  ventasDiarias: { fecha: string; importe: number }[]; // 30 días, centavos
  porFormaDePago: { forma: string; importe: number }[]; // del mes, centavos
};

// 'cuenta_corriente' → 'Cuenta corriente'
function nombreForma(forma: string) {
  if (forma === 'contado') return 'Contado';
  if (forma === 'tarjeta') return 'Tarjeta';
  if (forma === 'cuenta_corriente') return 'Cuenta corriente';
  return forma;
}

// "2026-11-21" → "21/11" (las etiquetas del eje, cortas para que entren)
function diaYMes(fecha: string) {
  return fecha.slice(8, 10) + '/' + fecha.slice(5, 7);
}

export default function GraficosTablero({ ventasDiarias, porFormaDePago }: Props) {
  // ─── Gráfico 1: ventas diarias de los últimos 30 días (barras) ───
  const datosDiarios = {
    labels: ventasDiarias.map((d) => diaYMes(d.fecha)),
    datasets: [
      {
        label: 'Ventas',
        // Chart.js dibuja la altura de cada barra con estos números.
        // Van en centavos: el formato en pesos se pone en el cartelito.
        data: ventasDiarias.map((d) => d.importe),
        backgroundColor: COLOR_1,
        borderRadius: 4,
      },
    ],
  };

  const opcionesDiarias = {
    responsive: true, // se adapta al ancho de la pantalla (sección 8)
    maintainAspectRatio: false, // usa el alto del recuadro que lo contiene
    plugins: {
      legend: { display: false }, // hay una sola serie: la leyenda sobra
      tooltip: {
        callbacks: {
          // El cartelito al pasar el mouse: el importe con lib/formato.ts
          label: (item: TooltipItem<'bar'>) => formatearImporte(Number(item.raw)),
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        // Las marcas del eje vertical también en pesos
        ticks: { callback: (valor: string | number) => formatearImporte(Number(valor)) },
      },
    },
  };

  // ─── Gráfico 2: ventas del mes por forma de pago (dona) ───
  const datosFormas = {
    labels: porFormaDePago.map((f) => nombreForma(f.forma)),
    datasets: [
      {
        data: porFormaDePago.map((f) => f.importe),
        backgroundColor: [COLOR_1, COLOR_2, COLOR_3],
      },
    ],
  };

  const opcionesFormas = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const },
      tooltip: {
        callbacks: {
          label: (item: TooltipItem<'doughnut'>) => `${item.label}: ${formatearImporte(Number(item.raw))}`,
        },
      },
    },
  };

  // Sin ninguna venta en el mes, la dona saldría vacía: mejor un aviso
  const hayVentasEnElMes = porFormaDePago.some((f) => f.importe > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-xl border bg-card p-4 lg:col-span-2">
        <h2 className="mb-3 font-semibold">Ventas diarias · últimos 30 días</h2>
        {/* El alto lo fija este recuadro (maintainAspectRatio: false) */}
        <div className="h-64">
          <Bar data={datosDiarios} options={opcionesDiarias} />
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 font-semibold">Ventas del mes por forma de pago</h2>
        <div className="h-64">
          {hayVentasEnElMes ? (
            <Doughnut data={datosFormas} options={opcionesFormas} />
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Todavía no hay ventas este mes.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
