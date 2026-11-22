'use client';
// Caja de confirmación de una acción irreversible.
//
// Consigna, sección 8: "confirmación de acciones irreversibles: anular,
// dar de baja, desactivar". Consigna 10.6: se resuelve una vez. La usan dar
// de baja un producto, desactivar un usuario, restablecer una contraseña y
// desactivar una categoría.
//
// Es CLIENT COMPONENT porque tiene botones con onClick. No hace el pedido:
// solo muestra la pregunta y avisa qué se eligió (onConfirmar / onCancelar).
// El componente que la usa es el que llama a la API.

import { Button } from '@/components/ui/button';

type Props = {
    pregunta: string; // "¿Dar de baja «Café molido»?"
    explicacion: React.ReactNode; // qué va a pasar
    textoConfirmar: string; // "Confirmar baja"
    textoEnviando: string; // "Dando de baja..."
    enviando: boolean; // true mientras espera al servidor (deshabilita los botones)
    error?: string; // el mensaje del servidor, si falló
    onConfirmar: () => void;
    onCancelar: () => void;
};

export default function Confirmacion({
    pregunta,
    explicacion,
    textoConfirmar,
    textoEnviando,
    enviando,
    error,
    onConfirmar,
    onCancelar,
}: Props) {
    return (
        <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <div>
                <p className="font-medium">{pregunta}</p>
                <p className="text-sm text-muted-foreground">{explicacion}</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-2">
                <Button variant="destructive" onClick={onConfirmar} disabled={enviando}>
                    {enviando ? textoEnviando : textoConfirmar}
                </Button>
                <Button variant="outline" onClick={onCancelar} disabled={enviando}>
                    Cancelar
                </Button>
            </div>
        </div>
    );
}
