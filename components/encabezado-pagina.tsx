// Encabezado de una pantalla: el título y, a la derecha, sus botones.
//
// Consigna 10.6: "lo que se repite se resuelve una vez", y el primero de la
// lista es el "encabezado de página". Así todas las pantallas tienen el
// título del mismo tamaño y los botones en el mismo lugar (sección 8).
//
//   <EncabezadoPagina titulo="Productos">
//       <Button>Nuevo producto</Button>
//   </EncabezadoPagina>

type Props = {
    titulo: React.ReactNode;
    children?: React.ReactNode; // los botones (opcional)
};

export default function EncabezadoPagina({ titulo, children }: Props) {
    return (
        // flex-wrap: en el celular, si no entran, los botones bajan de renglón
        <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-semibold">{titulo}</h1>
            {children}
        </div>
    );
}
