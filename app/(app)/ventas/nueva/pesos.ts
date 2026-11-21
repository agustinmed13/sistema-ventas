// Convierte lo que ESCRIBE el usuario en pesos a centavos enteros (regla 10).
// Es lo contrario de formatearImporte() de lib/formato.ts.
//
// La usan la pantalla de nueva venta (monto recibido) y el modal de
// cliente nuevo (límite de crédito).
// Candidata a moverse a lib/formato.ts, que es de otra compañera.
//
//   "15000"     → 1500000
//   "15.000"    → 1500000   (el punto es separador de miles, como en Argentina)
//   "15000,50"  → 1500050   (la coma es el decimal)
//   "abc"       → null      (no es un monto válido)
export function pesosACentavos(texto: string): number | null {
  const limpio = texto.trim().replace(/\./g, '').replace(',', '.');
  // Solo dígitos, y opcionalmente un punto con 1 o 2 decimales
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  // Math.round corrige el error de los decimales en JavaScript:
  // 0.29 * 100 da 28.999999999999996, y redondeado da 29.
  return Math.round(Number(limpio) * 100);
}
