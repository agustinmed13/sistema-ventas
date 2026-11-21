// Servicios del catálogo de productos (RF-P1).
// La ruta HTTP solo recibe los filtros y llama a estas funciones (sección 10.8).

import { and, count, eq, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/index';
import { categorias, productos } from '@/db/schema';
import { ApiError, type DetalleError } from '@/lib/errores';

// El usuario que hizo el pedido (lo que devuelve obtenerUsuarioActual).
type UsuarioSesion = {
    id: number;
    nombre: string;
    rol: 'admin' | 'vendedor';
};

// Los filtros llegan como texto desde los parámetros de la URL.
type FiltrosProductos = {
    q: string | null;
    categoriaId: string | null;
    activo: string | null;
    page: string | null;
    pageSize: string | null;
};

// Junta los errores para devolver el detalle de cada filtro inválido (sección 11.1).
function lanzarErroresValidacion(detalles: DetalleError[]) {
    if (detalles.length > 0) {
        throw new ApiError(
            422,
            'VALIDACION',
            'Hay campos con errores.',
            detalles
        );
    }
}

// Normaliza el texto para que "cafe", "CAFÉ" y "Café" coincidan (RF-P1).
function normalizarTexto(texto: string) {
    return texto
        .toLocaleLowerCase('es')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

// SQLite no tiene una función general para quitar tildes.
// Reemplazamos los caracteres acentuados antes de comparar.
function textoSQL(
    columna: typeof productos.codigo | typeof productos.descripcion
) {
    const reemplazos = [
        ['Á', 'a'], ['É', 'e'], ['Í', 'i'], ['Ó', 'o'], ['Ú', 'u'],
        ['Ü', 'u'], ['Ñ', 'n'],
        ['À', 'a'], ['È', 'e'], ['Ì', 'i'], ['Ò', 'o'], ['Ù', 'u'],
        ['á', 'a'], ['é', 'e'], ['í', 'i'], ['ó', 'o'], ['ú', 'u'],
        ['ü', 'u'], ['ñ', 'n'],
        ['à', 'a'], ['è', 'e'], ['ì', 'i'], ['ò', 'o'], ['ù', 'u'],
    ] as const;

    let expresion: SQL = sql`${columna}`;

    for (const [origen, destino] of reemplazos) {
        expresion = sql`replace(${expresion}, ${origen}, ${destino})`;
    }

    return sql`lower(${expresion})`;
}

// RF-P1: listado del catálogo con búsqueda, filtros, categoría y stock mínimo.
export async function listarProductos(
    usuario: UsuarioSesion,
    filtros: FiltrosProductos
) {
    // Los dos roles pueden consultar el catálogo.
    void usuario;

    const detalles: DetalleError[] = [];
    const condiciones: SQL[] = [];

    // --- Búsqueda por código O descripción, sin distinguir mayúsculas ni tildes ---
    const busqueda = filtros.q?.trim() ?? '';

    if (busqueda !== '') {
        const termino = normalizarTexto(busqueda);

        condiciones.push(
            or(
                sql`instr(${textoSQL(productos.codigo)}, ${termino}) > 0`,
                sql`instr(${textoSQL(productos.descripcion)}, ${termino}) > 0`
            )!
        );
    }

    // --- Categoría ---
    if (filtros.categoriaId !== null) {
        const categoriaId = Number(filtros.categoriaId);

        if (!Number.isInteger(categoriaId) || categoriaId <= 0) {
            detalles.push({
                campo: 'categoriaId',
                mensaje: 'La categoría tiene que ser un entero positivo.',
            });
        } else {
            condiciones.push(eq(productos.categoriaId, categoriaId));
        }
    }

    // --- Estado activo ---
    if (filtros.activo !== null) {
        if (filtros.activo !== 'true' && filtros.activo !== 'false') {
            detalles.push({
                campo: 'activo',
                mensaje: 'El filtro activo tiene que ser true o false.',
            });
        } else {
            condiciones.push(
                eq(productos.activo, filtros.activo === 'true')
            );
        }
    }

    // --- Paginación: page empieza en 1; pageSize por defecto 20 y máximo 100 ---
    let page = 1;

    if (filtros.page !== null) {
        page = Number(filtros.page);

        if (!Number.isInteger(page) || page < 1) {
            detalles.push({
                campo: 'page',
                mensaje: 'La página tiene que ser un entero desde 1.',
            });
        }
    }

    let pageSize = 20;

    if (filtros.pageSize !== null) {
        pageSize = Number(filtros.pageSize);

        if (
            !Number.isInteger(pageSize) ||
            pageSize < 1 ||
            pageSize > 100
        ) {
            detalles.push({
                campo: 'pageSize',
                mensaje: 'El tamaño de página tiene que ser un entero entre 1 y 100.',
            });
        }
    }

    // Si hay algún filtro inválido, devolvemos 422 antes de consultar.
    lanzarErroresValidacion(detalles);

    // COUNT cuenta todos los productos que cumplen los filtros, antes de paginar.
    const [conteo] = await db
        .select({ total: count() })
        .from(productos)
        .where(and(...condiciones));

    // JOIN relaciona cada producto con su categoría para devolver también el nombre.
    const filas = await db
        .select({
            id: productos.id,
            codigo: productos.codigo,
            descripcion: productos.descripcion,
            precioCentavos: productos.precioCentavos,
            existencia: productos.existencia,
            stockMinimo: productos.stockMinimo,
            activo: productos.activo,
            categoriaId: productos.categoriaId,
            categoriaNombre: categorias.nombre,
        })
        .from(productos)
        .innerJoin(
            categorias,
            eq(productos.categoriaId, categorias.id)
        )
        .where(and(...condiciones))
        .orderBy(productos.descripcion)
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    // RF-P1: el servidor informa si la existencia está en el mínimo o por debajo.
    const data = filas.map((producto) => ({
        ...producto,
        bajoMinimo: producto.existencia <= producto.stockMinimo,
    }));

    return {
        data,
        page,
        pageSize,
        total: conteo.total,
    };
}
