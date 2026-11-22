// Gestión de usuarios (RF-U4) — /usuarios. Solo admin.
//
// SERVER COMPONENT: llama directo al servicio listarUsuarios(), sin pasar
// por la API (consigna 10.6). Mismo esquema que los listados de ventas,
// productos y clientes.
//
// El menú ya oculta "Usuarios" al vendedor, pero eso NO es la protección:
// si un vendedor escribe /usuarios en la barra, el servicio le responde
// 403 y acá se muestra el mensaje (sección 3 de la consigna: "los permisos
// se verifican en el servidor, no solo ocultando botones").
//
// Filtros en la URL: /usuarios?q=laura&activo=false&page=2

import { Suspense } from 'react';
import Link from 'next/link';
import Form from 'next/form';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EncabezadoPagina from '@/components/encabezado-pagina';
import Paginador from '@/components/paginador';
import Insignia from '@/components/insignia';
import { CartelCarga, CartelError, CartelVacio, textoDeError } from '@/components/estados';
import { obtenerUsuarioActual } from '@/lib/auth';
import { listarUsuarios } from '@/lib/servicios/usuarios';

type ParametrosURL = { [clave: string]: string | string[] | undefined };

type Filtros = {
    q: string | null;
    activo: string | null;
    page: string | null;
    pageSize: string | null;
};

// Un parámetro de la URL → texto, o null si no vino o vino vacío.
function leer(valor: string | string[] | undefined): string | null {
    if (typeof valor === 'string' && valor.trim() !== '') return valor;
    return null;
}

// Arma la URL de otra página conservando los filtros actuales.
function urlDePagina(filtros: Filtros, page: number) {
    const parametros = new URLSearchParams();
    if (filtros.q) parametros.set('q', filtros.q);
    if (filtros.activo) parametros.set('activo', filtros.activo);
    if (filtros.pageSize) parametros.set('pageSize', filtros.pageSize);
    parametros.set('page', String(page));
    return '/usuarios?' + parametros.toString();
}

// Mismo estilo de campo que los demás filtros (sección 8: consistencia)
const claseCampo =
    'h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export default async function UsuariosPage({
    searchParams,
}: {
    searchParams: Promise<ParametrosURL>;
}) {
    const parametros = await searchParams;

    const filtros: Filtros = {
        q: leer(parametros.q),
        activo: leer(parametros.activo),
        page: leer(parametros.page),
        pageSize: leer(parametros.pageSize),
    };

    return (
        <div className="mx-auto max-w-5xl space-y-4">
            <EncabezadoPagina titulo="Usuarios">
                <Button asChild>
                    <Link href="/usuarios/nuevo">
                        <Plus />
                        Nuevo usuario
                    </Link>
                </Button>
            </EncabezadoPagina>

            {/* <Form> navega a /usuarios?q=...&activo=... (la URL es el estado).
                No lleva "page": filtrar vuelve siempre a la página 1. */}
            <Form
                action="/usuarios"
                className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-4"
            >
                <div className="col-span-2 space-y-1">
                    <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
                        Nombre o email
                    </label>
                    <input
                        id="q"
                        name="q"
                        type="search"
                        placeholder="Laura o laura@"
                        defaultValue={filtros.q ?? ''}
                        className={claseCampo}
                    />
                </div>
                <div className="space-y-1">
                    <label htmlFor="activo" className="text-xs font-medium text-muted-foreground">
                        Estado
                    </label>
                    <select
                        id="activo"
                        name="activo"
                        defaultValue={filtros.activo ?? ''}
                        className={claseCampo}
                    >
                        {/* Vacío = todos (activos e inactivos) */}
                        <option value="">Todos</option>
                        <option value="true">Activos</option>
                        <option value="false">Inactivos</option>
                    </select>
                </div>
                <div className="flex items-end gap-2">
                    <Button type="submit" className="flex-1">
                        Filtrar
                    </Button>
                    <Button asChild variant="outline" className="flex-1">
                        <Link href="/usuarios">Limpiar</Link>
                    </Button>
                </div>
            </Form>

            <Suspense key={JSON.stringify(filtros)} fallback={<CartelCarga texto="Cargando usuarios..." />}>
                <TablaUsuarios filtros={filtros} />
            </Suspense>
        </div>
    );
}

async function TablaUsuarios({ filtros }: { filtros: Filtros }) {
    // El layout ya garantiza la sesión; este if es para TypeScript.
    const usuario = await obtenerUsuarioActual();
    if (!usuario) redirect('/login');

    let resultado;
    try {
        resultado = await listarUsuarios(usuario, filtros);
    } catch (error) {
        // ─── Estado: error ─── (403 para el vendedor, o 422 si un filtro de la URL está mal)
        const { mensaje, detalles } = textoDeError(error, 'No se pudieron cargar los usuarios. Probá de nuevo.');
        return <CartelError mensaje={mensaje} detalles={detalles} />;
    }

    // ─── Estado: vacío ───
    if (resultado.data.length === 0) {
        return (
            <CartelVacio
                texto={resultado.total === 0 ? 'No hay usuarios con estos filtros.' : 'Esta página no tiene usuarios.'}
            />
        );
    }

    return (
        <div className="space-y-3">
            <div className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full text-sm">
                    <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 font-medium">Nombre</th>
                            <th className="hidden px-3 py-2 font-medium sm:table-cell">Email</th>
                            <th className="px-3 py-2 font-medium">Rol</th>
                            <th className="px-3 py-2 font-medium">Estado</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {resultado.data.map((u) => (
                            <tr
                                key={u.id}
                                className={u.activo ? 'hover:bg-muted/50' : 'text-muted-foreground'}
                            >
                                <td className="px-3 py-2">
                                    {/* Cada fila lleva a su pantalla de edición */}
                                    <Link
                                        href={`/usuarios/${u.id}`}
                                        className="font-medium text-primary hover:underline"
                                    >
                                        {u.nombre}
                                    </Link>
                                    {u.id === usuario.id && (
                                        <span className="ml-2 text-xs text-muted-foreground">(vos)</span>
                                    )}
                                </td>
                                <td className="hidden px-3 py-2 sm:table-cell">{u.email}</td>
                                <td className="px-3 py-2">
                                    {u.rol === 'admin' ? 'Administrador' : 'Vendedor'}
                                </td>
                                <td className="px-3 py-2">
                                    {u.activo ? (
                                        <Insignia variante="activo">Activo</Insignia>
                                    ) : (
                                        <Insignia variante="neutral">Inactivo</Insignia>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Paginador
                page={resultado.page}
                pageSize={resultado.pageSize}
                total={resultado.total}
                cantidadEnPagina={resultado.data.length}
                urlDePagina={(page) => urlDePagina(filtros, page)}
            />
        </div>
    );
}
