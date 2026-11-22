// Página de "cliente no encontrado" — /clientes/[id]
//
// Next.js la muestra sola cuando page.tsx llama a notFound(): por ejemplo
// en /clientes/9999 o /clientes/abc. Responde con código HTTP 404.
// Al estar dentro de (app), se ve con el menú y el diseño de la aplicación.

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function ClienteNoEncontrado() {
  return (
    <div className="mx-auto max-w-md space-y-3 rounded-xl border bg-card p-8 text-center">
      <h1 className="text-xl font-semibold">Cliente no encontrado</h1>
      <p className="text-sm text-muted-foreground">
        El cliente que buscás no existe. Puede que el link esté mal escrito.
      </p>
      <Button asChild>
        <Link href="/clientes">Volver al listado</Link>
      </Button>
    </div>
  );
}
