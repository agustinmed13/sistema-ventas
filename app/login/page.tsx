'use client';
// 'use client' = este componente corre en el NAVEGADOR, no en el servidor.
// Hace falta porque usa estado (useState) y reacciona a lo que escribe el
// usuario. Los componentes de servidor no pueden hacer eso.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Receipt, PackageCheck, Wallet, ChartColumn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Lo que hace el sistema, para la zona de la marca. Para agregar o
// cambiar un punto, se toca esta lista.
const puntos = [
  { icono: Receipt, texto: 'Facturación rápida con control de stock' },
  { icono: PackageCheck, texto: 'Existencias siempre al día' },
  { icono: Wallet, texto: 'Cuentas corrientes de tus clientes' },
  { icono: ChartColumn, texto: 'Indicadores del negocio en el tablero' },
];

// El cuadrado con la "M": el mismo logo que el panel lateral del sistema
// (components/marco-app.tsx), para que se reconozca al entrar.
function Logo() {
  return (
    <div className="flex size-9 items-center justify-center rounded-md bg-sidebar-primary text-lg font-bold text-sidebar-primary-foreground">
      M
    </div>
  );
}

export default function PaginaLogin() {
  const router = useRouter();

  // Estado del formulario. Cada vez que cambia, React vuelve a dibujar.
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState(''); // mensaje a mostrar ('' = ninguno)
  const [cargando, setCargando] = useState(false); // true mientras espera al servidor

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    // Por defecto, un <form> recarga la página al enviarse. Lo evitamos:
    // el envío lo hacemos nosotros con fetch.
    evento.preventDefault();

    setCargando(true);
    setError('');

    try {
      // Pedido HTTP a nuestra API. Mandamos los datos como texto JSON y
      // avisamos en la cabecera que el cuerpo es JSON.
      const respuesta = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, contrasena }),
      });

      // respuesta.ok es true para los códigos 200-299.
      if (respuesta.ok) {
        // El servidor ya guardó la cookie de sesión en el navegador.
        // replace (en vez de push) para que el botón "atrás" no vuelva al login.
        // No ponemos cargando en false: el botón queda deshabilitado
        // mientras se cambia de página.
        router.replace('/');
        return;
      }

      // Error: la API siempre responde { error: { code, message, details } }
      // (sección 11.1). Si por algún motivo el cuerpo no fuera JSON, usamos
      // un mensaje genérico.
      const cuerpo = await respuesta.json().catch(() => null);
      setError(cuerpo?.error?.message || 'No se pudo iniciar sesión.');
    } catch {
      // fetch solo falla así si no hubo respuesta (sin internet, servidor caído).
      setError('No se pudo conectar con el servidor.');
    }

    // Llegamos acá solo si hubo error. Los campos NO se borran, para que
    // el usuario pueda corregir lo que escribió.
    setCargando(false);
  }

  // ─────────────────────────────────────────────────────────
  // PANTALLA PARTIDA
  // Los colores son los TOKENS del sistema de diseño (app/globals.css),
  // los mismos del panel lateral y la barra superior: así el login no es
  // una isla (consigna, sección 8: mismos colores, tipografía, botones
  // y espaciado en todas las pantallas).
  //   bg-sidebar / text-sidebar-foreground → el azul oscuro del menú
  //   bg-background / bg-card              → los fondos claros del sistema
  // ─────────────────────────────────────────────────────────
  return (
    // En el celular: una columna. Desde 768px (md): dos columnas iguales.
    <main className="grid min-h-screen bg-background text-foreground md:grid-cols-2">
      {/* ═══ IZQUIERDA: la marca y qué hace el sistema ═══
          hidden md:flex = no se muestra en pantallas chicas */}
      <section className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground md:flex">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="leading-tight">
            <p className="text-lg font-semibold text-white">Mostrador</p>
            <p className="text-sm">Gestión para almacenes y comercios de barrio</p>
          </div>
        </div>

        <div className="space-y-8">
          <h2 className="max-w-sm text-3xl font-semibold leading-tight text-white">
            Todo el negocio desde el mostrador.
          </h2>
          <ul className="space-y-4">
            {puntos.map((punto) => {
              const Icono = punto.icono;
              return (
                <li key={punto.texto} className="flex items-center gap-3">
                  {/* El ícono en un cuadradito con el color de acento */}
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-primary">
                    <Icono className="size-4" />
                  </span>
                  {punto.texto}
                </li>
              );
            })}
          </ul>
        </div>

        <p className="text-xs text-sidebar-foreground/60">2º Parcial · Programación IV</p>
      </section>

      {/* ═══ DERECHA: el formulario ═══ */}
      <section className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm space-y-6">
          {/* En el celular la zona izquierda no se ve: mostramos solo la
              marca arriba del formulario. md:hidden = se oculta desde 768px */}
          <div className="flex items-center gap-3 md:hidden">
            <Logo />
            <p className="text-lg font-semibold">Mostrador</p>
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Ingresá a tu cuenta</h1>
            <p className="text-sm text-muted-foreground">Usá tu email y tu contraseña.</p>
          </div>

          <form onSubmit={enviar} className="space-y-4">
            {/* Solo se muestra si hay un mensaje de error */}
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-10 bg-card"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contrasena">Contraseña</Label>
              <Input
                id="contrasena"
                type="password"
                autoComplete="current-password"
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
                required
                className="h-10 bg-card"
              />
            </div>

            {/* disabled mientras espera: evita mandar dos pedidos con doble clic */}
            <Button type="submit" disabled={cargando} className="h-10 w-full">
              {cargando ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
