// Campo de importe: un input para escribir PESOS, con el "$" adelante.
//
// Consigna 10.6: en la lista de "lo que se repite se resuelve una vez" está
// el "campo de importe". Lo que se escribe es texto ("12.500,50"); quien lo
// usa lo convierte a centavos con pesosACentavos() antes de mandarlo, porque
// la API recibe importes en centavos enteros (regla 10).
//
// No tiene 'use client': no tiene estado propio. El valor y el cambio los
// maneja el formulario que lo usa.

import { Input } from '@/components/ui/input';

type Props = {
    id: string;
    valor: string; // lo que está escrito, por ejemplo "12.500,50"
    onCambio: (texto: string) => void;
    invalido?: boolean; // true pinta el borde en rojo
    placeholder?: string;
};

export default function CampoImporte({ id, valor, onCambio, invalido, placeholder = '12.500,50' }: Props) {
    return (
        // relative + absolute: el "$" queda adentro del input, a la izquierda
        <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
            </span>
            <Input
                id={id}
                // inputMode="decimal": en el celular abre el teclado numérico con coma
                inputMode="decimal"
                placeholder={placeholder}
                value={valor}
                onChange={(e) => onCambio(e.target.value)}
                aria-invalid={invalido ? true : undefined}
                className="pl-6"
            />
        </div>
    );
}
