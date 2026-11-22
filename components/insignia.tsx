// Insignia de estado: la "pastillita" de color al lado de un dato.
//
// Consigna 10.6: "lo que se repite se resuelve una vez", y entre lo que
// nombra están las "insignias de estado". Así "Inactivo", "Bajo mínimo" o
// "Activo" se ven igual en todas las pantallas.
//
// Colores (sección 8: consistentes en todo el sistema):
//   neutral → gris    (Inactivo, Inactiva)
//   activo  → acento  (Activo)
//   alerta  → ámbar   (Bajo mínimo, RF-P1). No es rojo: el rojo del
//                      sistema significa "anulada" o "error".

type Props = {
    variante: 'neutral' | 'activo' | 'alerta';
    children: React.ReactNode;
    title?: string; // texto que aparece al pasar el mouse
};

const COLORES = {
    neutral: 'bg-muted text-muted-foreground',
    activo: 'bg-accent text-accent-foreground',
    alerta: 'bg-amber-100 text-amber-800',
};

export default function Insignia({ variante, children, title }: Props) {
    return (
        <span
            title={title}
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${COLORES[variante]}`}
        >
            {children}
        </span>
    );
}
