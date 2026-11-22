// Tabla de movimientos de stock (RF-P6). Se escribe UNA vez y la usan dos
// pantallas (consigna 10.6: "lo que se repite se resuelve una vez"):
//   - la ficha de un producto (/productos/[id]), sin la columna Producto
//   - la pestaña Existencias (/productos/existencias), con la columna Producto
//
// No tiene 'use client': no tiene estado ni clics, así que se dibuja en el
// servidor como parte de la página que la usa.
//
// Muestra lo que pide RF-P6: fecha, tipo, cantidad, existencia resultante,
// usuario y referencia a la factura cuando la hay.

import Link from 'next/link';
import { formatearFechaHora } from '@/lib/formato';
import type { listarMovimientos } from '@/lib/servicios/productos';

// El tipo de un movimiento, tal como lo devuelve el servicio (sección 11.4).
// "typeof listarMovimientos" se lee: "lo que devuelve esa función", así
// si el servicio cambia, este tipo cambia solo.
type Movimiento = Awaited<ReturnType<typeof listarMovimientos>>['data'][number];

// Cómo se muestra cada tipo de movimiento
const NOMBRE_TIPO = { venta: 'Venta', anulacion: 'Anulación', ingreso: 'Ingreso', egreso: 'Egreso' };

type Props = {
    movimientos: Movimiento[];
    mostrarProducto: boolean; // true en Existencias, false en la ficha
};

export default function TablaMovimientos({ movimientos, mostrarProducto }: Props) {
    return (
        // overflow-x-auto: si no entra en 360 px, la tabla se desliza sola (sección 8)
        <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
                <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                    <tr>
                        <th className="px-3 py-2 font-medium">Fecha</th>
                        {mostrarProducto && <th className="px-3 py-2 font-medium">Producto</th>}
                        <th className="px-3 py-2 font-medium">Tipo</th>
                        <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                        <th className="px-3 py-2 text-right font-medium">Existencia</th>
                        <th className="hidden px-3 py-2 font-medium sm:table-cell">Motivo</th>
                        <th className="hidden px-3 py-2 font-medium md:table-cell">Usuario</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {movimientos.map((m) => (
                        <tr key={m.id}>
                            {/* Fechas con lib/formato.ts: dd/mm/aaaa y hora de Argentina */}
                            <td className="whitespace-nowrap px-3 py-2">{formatearFechaHora(m.fecha)}</td>
                            {mostrarProducto && (
                                <td className="whitespace-nowrap px-3 py-2 font-mono">
                                    <Link href={`/productos/${m.producto.id}`} className="text-primary hover:underline">
                                        {m.producto.codigo}
                                    </Link>
                                </td>
                            )}
                            <td className="px-3 py-2">{NOMBRE_TIPO[m.tipo]}</td>
                            {/* Con signo: + suma, − resta. La suma de la columna da la
                                existencia (sección 10.8, punto 5) */}
                            <td
                                className={`whitespace-nowrap px-3 py-2 text-right font-medium ${
                                    m.cantidad < 0 ? 'text-destructive' : 'text-primary'
                                }`}
                            >
                                {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                            </td>
                            <td className="px-3 py-2 text-right">{m.existenciaResultante}</td>
                            <td className="hidden px-3 py-2 sm:table-cell">
                                {/* En ventas y anulaciones, link al comprobante */}
                                {m.referencia ? (
                                    <Link href={`/ventas/${m.referencia.facturaId}`} className="text-primary hover:underline">
                                        Factura {m.referencia.numero}
                                    </Link>
                                ) : (
                                    m.motivo
                                )}
                            </td>
                            <td className="hidden px-3 py-2 md:table-cell">{m.usuario.nombre}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
