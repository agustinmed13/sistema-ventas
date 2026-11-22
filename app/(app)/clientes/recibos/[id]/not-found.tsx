// Página de "recibo no encontrado" — /clientes/recibos/[id]
// Next.js la muestra cuando page.tsx llama a notFound() (código HTTP 404).

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function ReciboNoEncontrado() {
  return (
    <div className="mx-auto max-w-md space-y-3 rounded-xl border bg-card p-8 text-center">
      <h1 className="text-xl font-semibold">Recibo no encontrado</h1>
      <p className="text-sm text-muted-foreground">
        El recibo que buscás no existe. Puede que el link esté mal escrito.
      </p>
      <Button asChild>
        <Link href="/clientes">Ir a clientes</Link>
      </Button>
    </div>
  );
}
