// Alta de cliente (RF-C2) — /clientes/nuevo
//
// Server Component mínimo: solo pone el título y el formulario. El
// formulario (Client Component) es el mismo que se usa para editar.
//
// OJO: la carpeta "nuevo" es un segmento FIJO, y Next.js lo prioriza sobre
// [id]. Por eso /clientes/nuevo llega acá y no a la ficha con id = "nuevo".

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import FormularioCliente from '../formulario-cliente';

export default function NuevoClientePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/clientes">
          <ArrowLeft />
          Volver al listado
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold">Nuevo cliente</h1>
      <FormularioCliente />
    </div>
  );
}
