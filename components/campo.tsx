// Campo de formulario: la etiqueta, el input, un texto de ayuda y el error.
//
// Consigna 10.6: "lo que se repite se resuelve una vez", y en la lista está
// el "campo con etiqueta y error". Consigna, sección 8: "mensajes de error
// junto al campo". Antes cada formulario repetía este mismo bloque en cada
// campo; ahora todos los campos se arman igual.
//
// El input (o el select) va adentro, como children, porque cada campo tiene
// el suyo:
//
//   <Campo id="codigo" etiqueta="Código" error={errores.codigo}>
//       <Input id="codigo" value={codigo} onChange={...} />
//   </Campo>
//
// No tiene 'use client': no tiene estado propio. Se puede usar adentro de
// un formulario que sí es Client Component.

import { Label } from '@/components/ui/label';

type Props = {
    id: string; // el mismo id que el input: así tocar la etiqueta enfoca el campo
    etiqueta: React.ReactNode;
    error?: string; // el mensaje de error de este campo (del formulario o del servidor)
    ayuda?: React.ReactNode; // texto chico debajo, por ejemplo "Mínimo 8 caracteres."
    className?: string; // para ubicarlo en la grilla, por ejemplo "sm:col-span-2"
    children: React.ReactNode; // el input o el select
};

export default function Campo({ id, etiqueta, error, ayuda, className = '', children }: Props) {
    return (
        <div className={`space-y-1 ${className}`}>
            <Label htmlFor={id}>{etiqueta}</Label>
            {children}
            {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}
