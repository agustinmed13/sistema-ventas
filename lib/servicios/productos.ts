// Servicios del catálogo: productos (RF-P1, RF-P2, RF-P3) y categorías (RF-P7).
// La ruta HTTP solo recibe los datos y llama a estas funciones (sección 10.8).

import { and, count, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/index';
import { categorias, productos } from '@/db/schema';
import { ApiError, type DetalleError } from '@/lib/errores';
import { moverStock } from '@/lib/servicios/stock';

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
    bajoMinimo: string | null;
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

// Las columnas que se leen de un producto, con el nombre de su categoría.
// Se usan en el listado y al devolver un producto creado o modificado,
// así las dos respuestas salen siempre con el mismo formato.
const columnasProducto = {
    id: productos.id,
    codigo: productos.codigo,
    descripcion: productos.descripcion,
    precioCentavos: productos.precioCentavos,
    existencia: productos.existencia,
    stockMinimo: productos.stockMinimo,
    activo: productos.activo,
    categoriaId: productos.categoriaId,
    categoriaNombre: categorias.nombre,
};

// Una fila de la base tal como sale del JOIN productos + categorias.
type FilaProducto = {
    id: number;
    codigo: string;
    descripcion: string;
    precioCentavos: number;
    existencia: number;
    stockMinimo: number;
    activo: boolean;
    categoriaId: number;
    categoriaNombre: string;
};

// Traduce la fila de la base al JSON exacto de la sección 11.4 (AGENTS.md 5.1).
// La columna se llama precio_centavos, pero en la API el campo es "precio"
// (en centavos enteros igual) y la categoría va anidada como { id, nombre }.
function aProductoApi(fila: FilaProducto) {
    return {
        id: fila.id,
        codigo: fila.codigo,
        descripcion: fila.descripcion,
        categoria: { id: fila.categoriaId, nombre: fila.categoriaNombre },
        precio: fila.precioCentavos,
        existencia: fila.existencia,
        stockMinimo: fila.stockMinimo,
        // RF-P1: el servidor informa si la existencia llegó al mínimo o está debajo.
        bajoMinimo: fila.existencia <= fila.stockMinimo,
        activo: fila.activo,
    };
}

// Filtro "activo" de los listados (productos y categorías), sección 11.4.
// Por defecto "true": solo lo activo. "false" y "todos" muestran registros
// dados de baja; es una consulta de administración, el vendedor recibe 403
// (sección 10.8, punto 2). Si el valor es inválido, agrega el error a
// "detalles" y devuelve null.
function leerFiltroActivo(
    valor: string | null,
    usuario: UsuarioSesion,
    detalles: DetalleError[]
): 'true' | 'false' | 'todos' | null {
    const activo = valor ?? 'true';

    if (activo !== 'true' && activo !== 'false' && activo !== 'todos') {
        detalles.push({
            campo: 'activo',
            mensaje: 'El filtro activo tiene que ser true, false o todos.',
        });
        return null;
    }

    if (activo !== 'true' && usuario.rol !== 'admin') {
        throw new ApiError(
            403,
            'SIN_PERMISO',
            'Solo un administrador puede ver los registros inactivos.'
        );
    }

    return activo;
}

// Paginación de los listados (sección 11.1): page empieza en 1;
// pageSize por defecto 20 y máximo 100. Los errores van a "detalles".
function leerPaginacion(
    pageTexto: string | null,
    pageSizeTexto: string | null,
    detalles: DetalleError[]
) {
    let page = 1;

    if (pageTexto !== null) {
        page = Number(pageTexto);

        if (!Number.isInteger(page) || page < 1) {
            detalles.push({
                campo: 'page',
                mensaje: 'La página tiene que ser un entero desde 1.',
            });
        }
    }

    let pageSize = 20;

    if (pageSizeTexto !== null) {
        pageSize = Number(pageSizeTexto);

        if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
            detalles.push({
                campo: 'pageSize',
                mensaje: 'El tamaño de página tiene que ser un entero entre 1 y 100.',
            });
        }
    }

    return { page, pageSize };
}

// RF-P1: listado del catálogo con búsqueda, filtros, categoría y stock mínimo.
export async function listarProductos(
    usuario: UsuarioSesion,
    filtros: FiltrosProductos
) {
    // Los dos roles pueden consultar el catálogo; el rol solo importa
    // para ver productos inactivos (ver filtro "activo").

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

    // --- Bajo mínimo (RF-P1): bajoMinimo=true trae solo los que hay que reponer ---
    if (filtros.bajoMinimo !== null) {
        if (filtros.bajoMinimo !== 'true' && filtros.bajoMinimo !== 'false') {
            detalles.push({
                campo: 'bajoMinimo',
                mensaje: 'El filtro bajoMinimo tiene que ser true o false.',
            });
        } else if (filtros.bajoMinimo === 'true') {
            // Misma regla que el campo bajoMinimo de la respuesta.
            condiciones.push(
                sql`${productos.existencia} <= ${productos.stockMinimo}`
            );
        }
        // bajoMinimo=false equivale a no filtrar.
    }

    // --- Estado activo (sección 11.4): por defecto, solo los activos ---
    const activo = leerFiltroActivo(filtros.activo, usuario, detalles);

    if (activo === 'true' || activo === 'false') {
        condiciones.push(eq(productos.activo, activo === 'true'));
    }
    // "todos" no agrega condición.

    // --- Paginación ---
    const { page, pageSize } = leerPaginacion(filtros.page, filtros.pageSize, detalles);

    // Si hay algún filtro inválido, devolvemos 422 antes de consultar.
    lanzarErroresValidacion(detalles);

    // COUNT cuenta todos los productos que cumplen los filtros, antes de paginar.
    const [conteo] = await db
        .select({ total: count() })
        .from(productos)
        .where(and(...condiciones));

    // JOIN relaciona cada producto con su categoría para devolver también el nombre.
    const filas = await db
        .select(columnasProducto)
        .from(productos)
        .innerJoin(
            categorias,
            eq(productos.categoriaId, categorias.id)
        )
        .where(and(...condiciones))
        .orderBy(productos.descripcion)
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    // Cada fila se traduce a los nombres de campo de la API (sección 5.1).
    const data = filas.map(aProductoApi);

    return {
        data,
        page,
        pageSize,
        total: conteo.total,
    };
}

// Lee un producto con su categoría y lo devuelve con el formato de la API.
// Lo usan crearProducto y (después) modificarProducto para responder.
async function buscarProductoApi(id: number) {
    const [fila] = await db
        .select(columnasProducto)
        .from(productos)
        .innerJoin(categorias, eq(productos.categoriaId, categorias.id))
        .where(eq(productos.id, id));

    if (!fila) {
        throw new ApiError(404, 'NO_ENCONTRADO', 'No existe ese producto.');
    }

    return aProductoApi(fila);
}

// GET /api/productos/{id} — un producto (RF-P1, sección 11.4). Los dos roles.
// idTexto: el {id} de la URL tal cual llega ("63").
export async function obtenerProducto(usuario: UsuarioSesion, idTexto: string) {
    // Los dos roles pueden consultar el catálogo: no hay chequeo de rol.
    void usuario;

    // Si el id no es un número válido, ese producto no existe (404).
    const id = Number(idTexto);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError(404, 'NO_ENCONTRADO', 'No existe ese producto.');
    }

    return buscarProductoApi(id);
}

// ═════════════════════════════════════════════════════════════
// crearProducto — RF-P2 (alta de producto)
//
// datos (sin validar), con los nombres de la sección 5.1:
// {
//   "codigo": "HE-001",
//   "descripcion": "Martillo carpintero 500 g",
//   "categoriaId": 1,
//   "precio": 1250000,        // en centavos enteros (regla 10)
//   "stockMinimo": 5,
//   "stockInicial": 24        // opcional
// }
//
// "existencia" NO se acepta: solo cambia con movimientos de stock (regla 2).
// "any" porque los datos llegan tal cual del JSON: esta función los revisa.
// ═════════════════════════════════════════════════════════════
export async function crearProducto(usuario: UsuarioSesion, datos: any) {
    // ═══ 1. VALIDAR ═══
    // Juntamos TODOS los errores para que el formulario marque varios a la vez.
    const detalles: DetalleError[] = [];

    // Regla 2: la existencia solo cambia por movimientos (moverStock).
    // Si el pedido la trae, lo rechazamos en vez de ignorarla en silencio,
    // así quien llama se entera de que tiene que usar stockInicial.
    if (datos.existencia !== undefined) {
        detalles.push({
            campo: 'existencia',
            mensaje: 'No se puede enviar. Usá stockInicial; después, movimientos de stock.',
        });
    }

    // codigo y descripcion: texto obligatorio. Primero chequeamos que sea
    // texto, porque si llega un número .trim() no existe y explotaría.
    if (typeof datos.codigo !== 'string' || datos.codigo.trim() === '') {
        detalles.push({ campo: 'codigo', mensaje: 'Es obligatorio.' });
    }
    if (typeof datos.descripcion !== 'string' || datos.descripcion.trim() === '') {
        detalles.push({ campo: 'descripcion', mensaje: 'Es obligatoria.' });
    }

    // categoriaId: entero positivo. Que exista lo vemos en el paso 3.
    if (!Number.isInteger(datos.categoriaId) || datos.categoriaId <= 0) {
        detalles.push({ campo: 'categoriaId', mensaje: 'Es obligatoria.' });
    }

    // precio: regla 10, centavos enteros. Number.isInteger rechaza de una
    // vez textos, decimales y null. Un producto a $ 0 no tiene sentido.
    if (!Number.isInteger(datos.precio) || datos.precio <= 0) {
        detalles.push({
            campo: 'precio',
            mensaje: 'Tiene que ser un entero positivo, en centavos.',
        });
    }

    // stockMinimo: entero, puede ser 0 (sin alerta de reposición).
    if (!Number.isInteger(datos.stockMinimo) || datos.stockMinimo < 0) {
        detalles.push({
            campo: 'stockMinimo',
            mensaje: 'Tiene que ser un entero mayor o igual a 0.',
        });
    }

    // stockInicial: opcional. Si no viene, el producto arranca con 0.
    let stockInicial = 0;
    if (datos.stockInicial !== undefined && datos.stockInicial !== null) {
        if (!Number.isInteger(datos.stockInicial) || datos.stockInicial < 0) {
            detalles.push({
                campo: 'stockInicial',
                mensaje: 'Tiene que ser un entero mayor o igual a 0.',
            });
        } else {
            stockInicial = datos.stockInicial;
        }
    }

    lanzarErroresValidacion(detalles);

    // A partir de acá los datos son válidos.
    const codigo: string = datos.codigo.trim();
    const descripcion: string = datos.descripcion.trim();
    const categoriaId: number = datos.categoriaId;

    // ═══ 2. PERMISO ═══
    // El alta de productos es tarea del administrador: el vendedor recibe
    // 403 aunque llame directo a la ruta (sección 10.8, punto 2).
    if (usuario.rol !== 'admin') {
        throw new ApiError(
            403,
            'SIN_PERMISO',
            'Solo un administrador puede dar de alta productos.'
        );
    }

    // ═══ 3. REGLAS ═══

    // La categoría tiene que existir y estar activa. Es 422 y no 404:
    // lo que no existe no es la URL sino un dato del cuerpo.
    const [categoria] = await db
        .select({ id: categorias.id, activa: categorias.activa })
        .from(categorias)
        .where(eq(categorias.id, categoriaId));

    if (!categoria || !categoria.activa) {
        throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', [
            { campo: 'categoriaId', mensaje: 'No existe o está desactivada.' },
        ]);
    }

    // El código es único (RF-P2). Comparamos sin distinguir mayúsculas:
    // "he-001" y "HE-001" son el mismo código escrito distinto.
    // 409 porque choca con un dato que YA EXISTE (criterio de la sección 11.8).
    const [repetido] = await db
        .select({ id: productos.id })
        .from(productos)
        .where(sql`lower(${productos.codigo}) = lower(${codigo})`);

    if (repetido) {
        throw new ApiError(
            409,
            'CODIGO_DUPLICADO',
            `Ya existe un producto con el código ${codigo}.`,
            [{ campo: 'codigo', mensaje: 'Ya existe.' }]
        );
    }

    // Guardar. Toca dos tablas (productos y movimientos_stock), así que va
    // en UNA transacción: si falla el movimiento, tampoco queda el producto
    // (sección 10.8, punto 3).
    const ahora = new Date().toISOString();

    const id = await db.transaction(async (tx) => {
        // El producto se crea SIEMPRE con existencia 0. La existencia
        // inicial entra como un movimiento, igual que cualquier otra.
        const [nuevo] = await tx
            .insert(productos)
            .values({
                codigo,
                descripcion,
                categoriaId,
                precioCentavos: datos.precio,
                existencia: 0,
                stockMinimo: datos.stockMinimo,
                activo: true,
                creadoEn: ahora,
            })
            .returning({ id: productos.id });

        // Regla 2: moverStock es la única función que cambia la existencia,
        // y graba el movimiento de ingreso con motivo "Stock inicial".
        // Con stockInicial 0 no hay movimiento: moverStock no acepta cero.
        // Así, la suma de los movimientos sigue dando la existencia
        // (sección 10.8, punto 5).
        if (stockInicial > 0) {
            await moverStock(tx, {
                productoId: nuevo.id,
                tipo: 'ingreso',
                cantidad: stockInicial,
                motivo: 'Stock inicial',
                fecha: ahora,
                usuarioId: usuario.id, // regla 11: quién lo cargó
                facturaId: null,
            });
        }

        return nuevo.id;
    });

    // ═══ 4. DEVOLVER ═══
    return buscarProductoApi(id);
}

// ═════════════════════════════════════════════════════════════
// modificarProducto — RF-P2 (edición) y RF-P3 (baja lógica)
//
// idTexto: el {id} de la URL, tal cual llega ("63").
// datos (sin validar): CUALQUIERA de estos campos, solo los que cambian:
// {
//   "codigo": "HE-001",
//   "descripcion": "Martillo carpintero 500 g",
//   "categoriaId": 1,
//   "precio": 1250000,     // en centavos enteros (regla 10)
//   "stockMinimo": 5,
//   "activo": false        // regla 12: baja lógica, no hay DELETE
// }
//
// "existencia" NO se acepta (regla 2), igual que en el alta.
// ═════════════════════════════════════════════════════════════
export async function modificarProducto(
    usuario: UsuarioSesion,
    idTexto: string,
    datos: any
) {
    // ═══ 1. VALIDAR ═══

    // El id de la URL. Si no es un número válido, ese producto no existe.
    const id = Number(idTexto);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError(404, 'NO_ENCONTRADO', 'No existe ese producto.');
    }

    const detalles: DetalleError[] = [];

    // "cambios" junta solo los campos que vinieron, ya con el nombre de la
    // COLUMNA de la base (precio → precioCentavos). Lo que no vino no se toca.
    const cambios: {
        codigo?: string;
        descripcion?: string;
        categoriaId?: number;
        precioCentavos?: number;
        stockMinimo?: number;
        activo?: boolean;
    } = {};

    // Regla 2: la existencia solo cambia por movimientos (moverStock).
    if (datos.existencia !== undefined) {
        detalles.push({
            campo: 'existencia',
            mensaje: 'No se puede modificar. Usá un movimiento de stock.',
        });
    }

    // Cada campo se revisa SOLO si vino: en un PATCH todos son opcionales.
    if (datos.codigo !== undefined) {
        if (typeof datos.codigo !== 'string' || datos.codigo.trim() === '') {
            detalles.push({ campo: 'codigo', mensaje: 'No puede quedar vacío.' });
        } else {
            cambios.codigo = datos.codigo.trim();
        }
    }

    if (datos.descripcion !== undefined) {
        if (typeof datos.descripcion !== 'string' || datos.descripcion.trim() === '') {
            detalles.push({ campo: 'descripcion', mensaje: 'No puede quedar vacía.' });
        } else {
            cambios.descripcion = datos.descripcion.trim();
        }
    }

    if (datos.categoriaId !== undefined) {
        if (!Number.isInteger(datos.categoriaId) || datos.categoriaId <= 0) {
            detalles.push({
                campo: 'categoriaId',
                mensaje: 'Tiene que ser un entero positivo.',
            });
        } else {
            cambios.categoriaId = datos.categoriaId;
        }
    }

    // Regla 3: cambiar el precio no altera las facturas ya emitidas, porque
    // cada renglón guardó su precio del momento.
    if (datos.precio !== undefined) {
        if (!Number.isInteger(datos.precio) || datos.precio <= 0) {
            detalles.push({
                campo: 'precio',
                mensaje: 'Tiene que ser un entero positivo, en centavos.',
            });
        } else {
            cambios.precioCentavos = datos.precio;
        }
    }

    if (datos.stockMinimo !== undefined) {
        if (!Number.isInteger(datos.stockMinimo) || datos.stockMinimo < 0) {
            detalles.push({
                campo: 'stockMinimo',
                mensaje: 'Tiene que ser un entero mayor o igual a 0.',
            });
        } else {
            cambios.stockMinimo = datos.stockMinimo;
        }
    }

    if (datos.activo !== undefined) {
        if (typeof datos.activo !== 'boolean') {
            detalles.push({ campo: 'activo', mensaje: 'Tiene que ser true o false.' });
        } else {
            cambios.activo = datos.activo;
        }
    }

    lanzarErroresValidacion(detalles);

    // Un PATCH sin ningún campo conocido no tiene nada que hacer.
    if (Object.keys(cambios).length === 0) {
        throw new ApiError(422, 'VALIDACION', 'No hay campos para modificar.');
    }

    // ═══ 2. PERMISO ═══
    // Editar y dar de baja productos es tarea del administrador
    // (sección 10.8, punto 2: el vendedor recibe 403).
    if (usuario.rol !== 'admin') {
        throw new ApiError(
            403,
            'SIN_PERMISO',
            'Solo un administrador puede modificar productos.'
        );
    }

    // ═══ 3. REGLAS ═══

    // El producto tiene que existir.
    const [actual] = await db
        .select({ id: productos.id })
        .from(productos)
        .where(eq(productos.id, id));

    if (!actual) {
        throw new ApiError(404, 'NO_ENCONTRADO', 'No existe ese producto.');
    }

    // Si cambia la categoría, la nueva tiene que existir y estar activa.
    if (cambios.categoriaId !== undefined) {
        const [categoria] = await db
            .select({ activa: categorias.activa })
            .from(categorias)
            .where(eq(categorias.id, cambios.categoriaId));

        if (!categoria || !categoria.activa) {
            throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', [
                { campo: 'categoriaId', mensaje: 'No existe o está desactivada.' },
            ]);
        }
    }

    // Si cambia el código, no puede chocar con el de OTRO producto (RF-P2).
    // "id <> este" deja afuera al propio producto: guardarlo con su mismo
    // código no es un duplicado.
    if (cambios.codigo !== undefined) {
        const [repetido] = await db
            .select({ id: productos.id })
            .from(productos)
            .where(
                and(
                    sql`lower(${productos.codigo}) = lower(${cambios.codigo})`,
                    ne(productos.id, id)
                )
            );

        if (repetido) {
            throw new ApiError(
                409,
                'CODIGO_DUPLICADO',
                `Ya existe un producto con el código ${cambios.codigo}.`,
                [{ campo: 'codigo', mensaje: 'Ya existe.' }]
            );
        }
    }

    // Guardar. Una sola tabla y un solo UPDATE: no hace falta transacción.
    // "cambios" nunca incluye existencia, así que este UPDATE no puede
    // tocar el stock (regla 2).
    await db.update(productos).set(cambios).where(eq(productos.id, id));

    // ═══ 4. DEVOLVER ═══
    return buscarProductoApi(id);
}

// ═════════════════════════════════════════════════════════════
// CATEGORÍAS — RF-P7
//
// Formato en la API: { "id": 1, "nombre": "Herramientas", "activa": true }
// Se llama "activa" (no "activo") porque así lo nombra la consigna en
// PATCH /api/categorias/{id} (sección 11.4), igual que la columna.
// ═════════════════════════════════════════════════════════════

type FilaCategoria = typeof categorias.$inferSelect;

function aCategoriaApi(fila: FilaCategoria) {
    return { id: fila.id, nombre: fila.nombre, activa: fila.activa };
}

// El nombre es único sin importar mayúsculas ni tildes (RF-P7):
// "Almacén", "almacen" y "ALMACEN" son la misma categoría.
// Son pocas filas, así que las traemos y comparamos con normalizarTexto,
// la misma función que usa la búsqueda del catálogo.
// idPropio deja afuera a la categoría que se está editando.
async function verificarNombreLibre(nombre: string, idPropio: number | null) {
    const todas = await db.select().from(categorias);
    const repetida = todas.find(
        (c) => c.id !== idPropio && normalizarTexto(c.nombre) === normalizarTexto(nombre)
    );

    if (repetida) {
        // 409: choca con un dato que YA EXISTE (criterio de la sección 11.8)
        throw new ApiError(
            409,
            'NOMBRE_DUPLICADO',
            `Ya existe la categoría ${repetida.nombre}.`,
            [{ campo: 'nombre', mensaje: 'Ya existe.' }]
        );
    }
}

// GET /api/categorias — los dos roles (el formulario de productos las necesita).
// Sección 11.4: "todas las categorías activas, sin paginar". Son pocas,
// así que se devuelve la lista entera, ordenada por nombre.
export async function listarCategorias(usuario: UsuarioSesion) {
    // Los dos roles pueden consultarlas: no hay chequeo de rol.
    void usuario;

    const filas = await db
        .select()
        .from(categorias)
        .where(eq(categorias.activa, true))
        .orderBy(categorias.nombre);

    return filas.map(aCategoriaApi);
}

// POST /api/categorias — alta (RF-P7). Solo admin.
// datos (sin validar): { "nombre": "Herramientas" }
export async function crearCategoria(usuario: UsuarioSesion, datos: any) {
    // ═══ 1. VALIDAR ═══
    if (typeof datos.nombre !== 'string' || datos.nombre.trim() === '') {
        throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', [
            { campo: 'nombre', mensaje: 'Es obligatorio.' },
        ]);
    }
    const nombre: string = datos.nombre.trim();

    // ═══ 2. PERMISO ═══
    if (usuario.rol !== 'admin') {
        throw new ApiError(403, 'SIN_PERMISO', 'Solo un administrador puede crear categorías.');
    }

    // ═══ 3. REGLAS ═══
    await verificarNombreLibre(nombre, null);

    // Una sola tabla: no hace falta transacción.
    const [nueva] = await db
        .insert(categorias)
        .values({ nombre, activa: true, creadaEn: new Date().toISOString() })
        .returning();

    // ═══ 4. DEVOLVER ═══
    return aCategoriaApi(nueva);
}

// PATCH /api/categorias/{id} — renombrar o desactivar (RF-P7). Solo admin.
// datos (sin validar): cualquiera de { "nombre": "...", "activa": false }
export async function modificarCategoria(
    usuario: UsuarioSesion,
    idTexto: string,
    datos: any
) {
    // ═══ 1. VALIDAR ═══
    const id = Number(idTexto);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError(404, 'NO_ENCONTRADO', 'No existe esa categoría.');
    }

    const detalles: DetalleError[] = [];
    const cambios: { nombre?: string; activa?: boolean } = {};

    if (datos.nombre !== undefined) {
        if (typeof datos.nombre !== 'string' || datos.nombre.trim() === '') {
            detalles.push({ campo: 'nombre', mensaje: 'No puede quedar vacío.' });
        } else {
            cambios.nombre = datos.nombre.trim();
        }
    }

    // "activa", como la nombra la consigna (sección 11.4)
    if (datos.activa !== undefined) {
        if (typeof datos.activa !== 'boolean') {
            detalles.push({ campo: 'activa', mensaje: 'Tiene que ser true o false.' });
        } else {
            cambios.activa = datos.activa;
        }
    }

    lanzarErroresValidacion(detalles);

    if (Object.keys(cambios).length === 0) {
        throw new ApiError(422, 'VALIDACION', 'No hay campos para modificar.');
    }

    // ═══ 2. PERMISO ═══
    if (usuario.rol !== 'admin') {
        throw new ApiError(403, 'SIN_PERMISO', 'Solo un administrador puede modificar categorías.');
    }

    // ═══ 3. REGLAS ═══
    const [actual] = await db.select().from(categorias).where(eq(categorias.id, id));
    if (!actual) {
        throw new ApiError(404, 'NO_ENCONTRADO', 'No existe esa categoría.');
    }

    if (cambios.nombre !== undefined) {
        await verificarNombreLibre(cambios.nombre, id);
    }

    // No se puede desactivar una categoría que todavía tiene productos
    // activos: quedarían en el catálogo colgando de una categoría dada de
    // baja. Primero hay que mover o desactivar esos productos.
    // 409 porque choca con el estado actual de los datos (sección 11.8).
    if (cambios.activa === false) {
        const [enUso] = await db
            .select({ cantidad: count() })
            .from(productos)
            .where(and(eq(productos.categoriaId, id), eq(productos.activo, true)));

        if (enUso.cantidad > 0) {
            throw new ApiError(
                409,
                'CATEGORIA_EN_USO',
                `La categoría tiene ${enUso.cantidad} producto(s) activo(s). ` +
                    'Movelos a otra categoría o desactivalos primero.'
            );
        }
    }

    // Una sola tabla: no hace falta transacción.
    const [modificada] = await db
        .update(categorias)
        .set(cambios)
        .where(eq(categorias.id, id))
        .returning();

    // ═══ 4. DEVOLVER ═══
    return aCategoriaApi(modificada);
}
