// Piezas chicas que usan el listado y el comprobante de ventas.
// No es una página: Next.js solo trata como página a los archivos que se
// llaman page.tsx. Este archivo vive acá porque es del módulo de ventas.

// 'cuenta_corriente' → 'Cuenta corriente'
export function nombreFormaPago(formaPago: string) {
  if (formaPago === 'contado') return 'Contado';
  if (formaPago === 'tarjeta') return 'Tarjeta';
  if (formaPago === 'cuenta_corriente') return 'Cuenta corriente';
  return formaPago;
}

// Insignia de estado (RF-V8, RF-V9): las anuladas se distinguen a simple
// vista, en rojo.
export function InsigniaEstado({ estado }: { estado: string }) {
  if (estado === 'anulada') {
    return (
      <span className="inline-flex rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        Anulada
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
      Emitida
    </span>
  );
}
