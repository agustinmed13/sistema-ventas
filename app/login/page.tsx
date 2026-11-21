'use client';
// 'use client' = este componente corre en el NAVEGADOR, no en el servidor.
// Hace falta porque usa estado (useState) y reacciona a lo que escribe el
// usuario. Los componentes de servidor no pueden hacer eso.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function PaginaLogin() {
  const router = useRouter();

  // Estado del formulario. Cada vez que cambia, React vuelve a dibujar.
  const [acceso, setAcceso] = useState('');
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
      const respuesta = await fetch('/api/sesion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceso, contrasena }),
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

      // Error: la API siempre responde { error: { codigo, mensaje, detalles } }.
      // Si por algún motivo el cuerpo no fuera JSON, usamos un mensaje genérico.
      const cuerpo = await respuesta.json().catch(() => null);
      setError(cuerpo?.error?.mensaje || 'No se pudo iniciar sesión.');
    } catch {
      // fetch solo falla así si no hubo respuesta (sin internet, servidor caído).
      setError('No se pudo conectar con el servidor.');
    }

    // Llegamos acá solo si hubo error. Los campos NO se borran, para que
    // el usuario pueda corregir lo que escribió.
    setCargando(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 px-4 text-gray-900">
      <form
        onSubmit={enviar}
        className="w-full max-w-sm bg-white rounded-lg shadow p-6 space-y-4"
      >
        <h1 className="text-xl font-semibold text-center">Iniciar sesión</h1>

        {/* Solo se muestra si hay un mensaje de error */}
        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="space-y-1">
          <label htmlFor="acceso" className="block text-sm font-medium">
            Acceso
          </label>
          <input
            id="acceso"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            value={acceso}
            onChange={(e) => setAcceso(e.target.value)}
            required
            className="w-full rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="contrasena" className="block text-sm font-medium">
            Contraseña
          </label>
          <input
            id="contrasena"
            type="password"
            autoComplete="current-password"
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            required
            className="w-full rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* disabled mientras espera: evita mandar dos pedidos con doble clic */}
        <button
          type="submit"
          disabled={cargando}
          className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {cargando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
