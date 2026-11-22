// Alta de usuario (RF-U4) — /usuarios/nuevo. Solo admin.
//
// Server Component mínimo: título y formulario. El permiso lo controla
// el servidor al guardar (POST /api/usuarios responde 403 al vendedor).
//
// La carpeta "nuevo" es un segmento FIJO: Next.js lo prioriza sobre [id],
// así que /usuarios/nuevo llega acá y no a la edición con id = "nuevo".

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import FormularioUsuario from '../formulario-usuario';

export default function NuevoUsuarioPage() {
    return (
        <div className="mx-auto max-w-3xl space-y-4">
            <Button asChild variant="ghost" size="sm">
                <Link href="/usuarios">
                    <ArrowLeft />
                    Volver al listado
                </Link>
            </Button>
            <h1 className="text-2xl font-semibold">Nuevo usuario</h1>
            <FormularioUsuario />
        </div>
    );
}
