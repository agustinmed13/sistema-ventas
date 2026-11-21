// Formatos del sistema: importes, fechas, número de factura y documentos.
//
// REGLA DEL PROYECTO (consigna 10.6 y AGENTS.md sección 11): ningún componente
// ni pantalla formatea por su cuenta. Todos importan de acá, así el formato es
// el mismo en todo el sistema y, si hay que cambiarlo, se cambia en un único
// lugar.

// ─────────────────────────────────────────────────────────────
// Importes — regla 10
// En la base y en la API los importes son centavos ENTEROS
// (1234550 = $ 12.345,50). Se usan enteros para evitar errores de
// redondeo con decimales. Solo se convierten a pesos al mostrarlos.
// formatearImporte(1234550)  →  "$ 12.345,50"
// ─────────────────────────────────────────────────────────────
export function formatearImporte(centavos: number): string {
  const esNegativo = centavos < 0;
  const absoluto = Math.abs(Math.round(centavos));

  const pesos = Math.floor(absoluto / 100); // 1234550 → 12345
  const resto = absoluto % 100; // 1234550 → 50

  // Pone un punto antes de cada grupo de 3 dígitos, contando desde la
  // derecha: "12345" → "12.345". (La expresión regular busca esos lugares.)
  const pesosConPuntos = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // padStart completa con ceros a la izquierda: 5 → "05"
  const centavosTexto = String(resto).padStart(2, '0');

  const signo = esNegativo ? '-' : '';
  return `${signo}$ ${pesosConPuntos},${centavosTexto}`;
}

// ─────────────────────────────────────────────────────────────
// Fechas — consigna 11.1 y AGENTS.md sección 11 (hora de Argentina)
// La API y la base guardan las fechas en ISO 8601 UTC, por ejemplo
// "2026-11-21T02:30:00.000Z". Para mostrarlas hay que pasarlas a hora de
// Argentina, que es UTC-3 y NO tiene horario de verano (siempre -3).
// Por eso alcanza con restarle 3 horas y leer los datos "en UTC".
// No depende de la zona horaria de la máquina: da lo mismo en tu PC que
// en el servidor de Vercel.
// ─────────────────────────────────────────────────────────────
const MS_POR_HORA = 60 * 60 * 1000;
const DIFERENCIA_ARGENTINA_MS = -3 * MS_POR_HORA;

// Convierte el texto ISO en sus partes, ya en hora de Argentina.
// Devuelve null si el texto no es una fecha válida.
function partesEnArgentina(iso: string) {
  const fecha = new Date(iso);
  if (isNaN(fecha.getTime())) return null;

  const enArgentina = new Date(fecha.getTime() + DIFERENCIA_ARGENTINA_MS);
  return {
    dia: String(enArgentina.getUTCDate()).padStart(2, '0'),
    mes: String(enArgentina.getUTCMonth() + 1).padStart(2, '0'), // los meses van de 0 a 11
    anio: String(enArgentina.getUTCFullYear()),
    hora: String(enArgentina.getUTCHours()).padStart(2, '0'),
    minuto: String(enArgentina.getUTCMinutes()).padStart(2, '0'),
  };
}

// formatearFecha("2026-11-21T14:30:00.000Z")  →  "21/11/2026"
export function formatearFecha(iso: string): string {
  const p = partesEnArgentina(iso);
  if (!p) return '';
  return `${p.dia}/${p.mes}/${p.anio}`;
}

// formatearFechaHora("2026-11-21T14:30:00.000Z")  →  "21/11/2026 11:30"
export function formatearFechaHora(iso: string): string {
  const p = partesEnArgentina(iso);
  if (!p) return '';
  return `${p.dia}/${p.mes}/${p.anio} ${p.hora}:${p.minuto}`;
}

// ─────────────────────────────────────────────────────────────
// Número de factura — regla 4
// Punto de venta de 4 dígitos + guion + número de 8 dígitos.
// formatearNumeroFactura(1, 42)  →  "0001-00000042"
// (Solo le da formato: el número lo asigna el servidor al confirmar.)
// ─────────────────────────────────────────────────────────────
export function formatearNumeroFactura(puntoVenta: number, numero: number): string {
  const pv = String(puntoVenta).padStart(4, '0');
  const nro = String(numero).padStart(8, '0');
  return `${pv}-${nro}`;
}

// ─────────────────────────────────────────────────────────────
// Documento del cliente
// En la base el número se guarda sin puntos ni guiones ("27345678");
// acá se le da el formato de lectura.
// formatearDocumento('DNI', '27345678')     →  "DNI 27.345.678"
// formatearDocumento('CUIT', '30712345678') →  "CUIT 30-71234567-8"
// ─────────────────────────────────────────────────────────────
export function formatearDocumento(tipo: 'DNI' | 'CUIT', numero: string): string {
  if (tipo === 'CUIT' && numero.length === 11) {
    // 2 dígitos - 8 dígitos - 1 dígito
    const inicio = numero.slice(0, 2);
    const medio = numero.slice(2, 10);
    const verificador = numero.slice(10);
    return `CUIT ${inicio}-${medio}-${verificador}`;
  }

  if (tipo === 'DNI') {
    // Puntos cada 3 dígitos desde la derecha, igual que en los importes.
    const conPuntos = numero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `DNI ${conPuntos}`;
  }

  // Un CUIT con largo raro se muestra tal cual, sin inventar el formato.
  return `${tipo} ${numero}`;
}