'use client';
// Formulario de producto (RF-P2): UNO SOLO para el alta y la edición.
//
//   /productos/nuevo  → sin "producto": POST /api/productos con
//                       { codigo, descripcion, categoriaId, precio, stockMinimo, stockInicial }
//   /productos/63     → con "producto": PATCH /api/productos/63 con
//                       { codigo, descripcion, categoriaId, precio, stockMinimo }
//
// La existencia NO se edita acá (consigna 11.4: "existencia no se acepta en
// POST ni en PATCH"). En el alta se puede cargar un stock inicial, que el
// servidor registra como un movimiento de ingreso con motivo "Stock inicial".
//
// CLIENT COMPONENT: necesita estado (lo que se escribe, los errores).
// Las validaciones de verdad las hacen crearProducto() y modificarProducto()
// en lib/servicios/productos.ts; acá se adelantan (sección 8). Los errores
// del servidor se muestran debajo de cada campo: los nombres de "details"
// son los mismos que los de este formulario.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Campo from '@/components/campo';
import CampoImporte from '@/components/campo-importe';
import { pesosACentavos } from '@/lib/formato';
// Convierte "12.500,50" (pesos escritos) en 1250050 (centavos).

type ProductoExistente = {
    id: number;
    codigo: string;
    descripcion: string;
    categoria: { id: number; nombre: string };
    precio: number; // centavos
    stockMinimo: number;
};

type Props = {
    categorias: { id: number; nombre: string }[]; // las activas
    producto?: ProductoExistente; // si no viene, es un alta
};

type ErroresCampo = { [campo: string]: string };

// 1250050 centavos → "12500,50" (para mostrar el precio al editar)
function centavosATexto(centavos: number) {
    return String(centavos / 100).replace('.', ',');
}

// Texto → entero >= 0, o null si no es válido. Para stock mínimo e inicial.
function textoAEntero(texto: string): number | null {
    if (!/^\d+$/.test(texto.trim())) return null;
    return Number(texto.trim());
}

const claseSelect =
    'h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export default function FormularioProducto({ categorias, producto }: Props) {
    const router = useRouter();
    const esEdicion = producto !== undefined;

    // Si el producto está en una categoría que ya se desactivó, igual la
    // mostramos en el desplegable para no cambiarla sin querer.
    const opciones = [...categorias];
    if (producto && !categorias.some((c) => c.id === producto.categoria.id)) {
        opciones.push({ id: producto.categoria.id, nombre: `${producto.categoria.nombre} (inactiva)` });
    }

    const [codigo, setCodigo] = useState(producto?.codigo ?? '');
    const [descripcion, setDescripcion] = useState(producto?.descripcion ?? '');
    const [categoriaId, setCategoriaId] = useState(producto ? String(producto.categoria.id) : '');
    const [precioTexto, setPrecioTexto] = useState(producto ? centavosATexto(producto.precio) : '');
    const [stockMinimoTexto, setStockMinimoTexto] = useState(producto ? String(producto.stockMinimo) : '0');
    const [stockInicialTexto, setStockInicialTexto] = useState('');

    const [errores, setErrores] = useState<ErroresCampo>({});
    const [errorGeneral, setErrorGeneral] = useState('');
    const [guardado, setGuardado] = useState(false);
    const [enviando, setEnviando] = useState(false);

    async function guardar(evento: FormEvent<HTMLFormElement>) {
        evento.preventDefault();
        setErrorGeneral('');
        setGuardado(false);

        // ─── Validación adelantada (el servidor la repite) ───
        const nuevosErrores: ErroresCampo = {};
        if (codigo.trim() === '') nuevosErrores.codigo = 'Es obligatorio.';
        if (descripcion.trim() === '') nuevosErrores.descripcion = 'Es obligatoria.';
        if (categoriaId === '') nuevosErrores.categoriaId = 'Elegí una categoría.';

        // Regla 10: el precio se escribe en pesos y viaja en centavos enteros
        const precio = pesosACentavos(precioTexto);
        if (precio === null || precio <= 0) {
            nuevosErrores.precio = 'Escribí un precio válido, por ejemplo 12500 o 12.500,50.';
        }

        const stockMinimo = textoAEntero(stockMinimoTexto);
        if (stockMinimo === null) nuevosErrores.stockMinimo = 'Tiene que ser un número entero, 0 o más.';

        // Stock inicial: opcional, solo en el alta. Vacío = sin stock.
        let stockInicial: number | null = null;
        if (!esEdicion && stockInicialTexto.trim() !== '') {
            stockInicial = textoAEntero(stockInicialTexto);
            if (stockInicial === null) nuevosErrores.stockInicial = 'Tiene que ser un número entero, 0 o más.';
        }

        setErrores(nuevosErrores);
        if (Object.keys(nuevosErrores).length > 0) return;

        // ─── Enviar (nombres de campo de la consigna, sección 11.4) ───
        const datos: { [campo: string]: string | number } = {
            codigo,
            descripcion,
            categoriaId: Number(categoriaId),
            precio: precio as number,
            stockMinimo: stockMinimo as number,
        };
        if (stockInicial !== null) datos.stockInicial = stockInicial;

        setEnviando(true);
        try {
            const respuesta = await fetch(esEdicion ? `/api/productos/${producto.id}` : '/api/productos', {
                method: esEdicion ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos),
            });

            if (respuesta.ok) {
                if (esEdicion) {
                    // Se queda en la ficha y confirma (sección 8)
                    setGuardado(true);
                    setEnviando(false);
                    router.refresh();
                } else {
                    // Alta: vamos a la ficha del producto nuevo
                    const nuevo = await respuesta.json();
                    router.push(`/productos/${nuevo.id}`);
                    router.refresh();
                }
                return;
            }

            // Error { error: { code, message, details } } (sección 11.1).
            // Ej: CODIGO_DUPLICADO trae details [{ campo: 'codigo', ... }].
            const cuerpo = await respuesta.json().catch(() => null);
            const erroresServidor: ErroresCampo = {};
            for (const detalle of cuerpo?.error?.details ?? []) {
                if (detalle.campo && detalle.mensaje) erroresServidor[detalle.campo] = detalle.mensaje;
            }
            setErrores(erroresServidor);
            setErrorGeneral(cuerpo?.error?.message || 'No se pudo guardar el producto.');
        } catch {
            setErrorGeneral('No se pudo conectar con el servidor.');
        }
        setEnviando(false);
    }

    // Cada campo usa <Campo> (etiqueta + input + ayuda + error, components/campo.tsx)
    return (
        <form onSubmit={guardar} className="space-y-4 rounded-xl border bg-card p-4">
            <div className="grid gap-4 sm:grid-cols-3">
                <Campo id="codigo" etiqueta="Código" error={errores.codigo}>
                    <Input
                        id="codigo"
                        autoFocus
                        placeholder="ALM-010"
                        value={codigo}
                        onChange={(e) => setCodigo(e.target.value)}
                        aria-invalid={errores.codigo ? true : undefined}
                    />
                </Campo>

                <Campo id="descripcion" etiqueta="Descripción" error={errores.descripcion} className="sm:col-span-2">
                    <Input
                        id="descripcion"
                        placeholder="Yerba mate 1 kg"
                        value={descripcion}
                        onChange={(e) => setDescripcion(e.target.value)}
                        aria-invalid={errores.descripcion ? true : undefined}
                    />
                </Campo>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
                <Campo id="categoriaId" etiqueta="Categoría" error={errores.categoriaId}>
                    <select
                        id="categoriaId"
                        value={categoriaId}
                        onChange={(e) => setCategoriaId(e.target.value)}
                        className={claseSelect}
                    >
                        <option value="">Elegí una...</option>
                        {opciones.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.nombre}
                            </option>
                        ))}
                    </select>
                </Campo>

                {/* Campo de importe común: se escribe en pesos con el "$" adelante */}
                <Campo id="precio" etiqueta="Precio de venta" error={errores.precio}>
                    <CampoImporte
                        id="precio"
                        valor={precioTexto}
                        onCambio={setPrecioTexto}
                        invalido={errores.precio !== undefined}
                    />
                </Campo>

                <Campo
                    id="stockMinimo"
                    etiqueta="Stock mínimo"
                    error={errores.stockMinimo}
                    ayuda="Por debajo, el catálogo lo marca."
                >
                    <Input
                        id="stockMinimo"
                        inputMode="numeric"
                        value={stockMinimoTexto}
                        onChange={(e) => setStockMinimoTexto(e.target.value)}
                        aria-invalid={errores.stockMinimo ? true : undefined}
                    />
                </Campo>
            </div>

            {/* Solo en el alta: la existencia inicial entra como un ingreso */}
            {!esEdicion && (
                <Campo
                    id="stockInicial"
                    etiqueta="Stock inicial (opcional)"
                    error={errores.stockInicial}
                    ayuda="Se registra como un ingreso con motivo «Stock inicial»."
                    className="sm:w-1/3"
                >
                    <Input
                        id="stockInicial"
                        inputMode="numeric"
                        placeholder="0"
                        value={stockInicialTexto}
                        onChange={(e) => setStockInicialTexto(e.target.value)}
                        aria-invalid={errores.stockInicial ? true : undefined}
                    />
                </Campo>
            )}

            {errorGeneral && <p className="text-sm text-destructive">{errorGeneral}</p>}
            {guardado && <p className="text-sm text-primary">Cambios guardados.</p>}

            <Button type="submit" disabled={enviando}>
                {enviando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Crear producto'}
            </Button>
        </form>
    );
}
