// Edición de cliente (RF-C2) — /clientes/[id]/editar
//
// SERVER COMPONENT: trae los datos actuales con el servicio obtenerCliente()
// y se los pasa al formulario (el mismo del alta) para que arranque
// completo. Guardar hace PATCH /api/clientes/[id].

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError } from '@/lib/errores';
import { obtenerCliente } from '@/lib/servicios/clientes';
import FormularioCliente from '../../formulario-cliente';

export default async function EditarClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // El layout ya garantiza la sesión; este if es para TypeScript.
  const usuario = await obtenerUsuarioActual();
  if (!usuario) redirect('/login');

  // Si no existe, la página de "no encontrado" de la ficha (../not-found.tsx)
  let cliente;
  try {
    cliente = await obtenerCliente(usuario, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/clientes/${cliente.id}`}>
          <ArrowLeft />
          Volver a la ficha
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold">Editar cliente</h1>
      {/* Solo le pasamos los campos que el formulario necesita */}
      <FormularioCliente
        cliente={{
          id: cliente.id,
          tipoDoc: cliente.tipoDoc,
          nroDoc: cliente.nroDoc,
          nombre: cliente.nombre,
          domicilio: cliente.domicilio,
          telefono: cliente.telefono,
          email: cliente.email,
          cuentaCorriente: cliente.cuentaCorriente,
          limiteCredito: cliente.limiteCredito,
        }}
      />
    </div>
  );
}
