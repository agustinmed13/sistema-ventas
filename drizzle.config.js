import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Cargamos las credenciales desde .env.local.
// Hay que indicar el nombre del archivo: dotenv por defecto
// busca ".env" y el nuestro se llama ".env.local".
config({ path: '.env.local' });

export default defineConfig({
  // Dónde están definidas las tablas
  schema: './db/schema.js',
  // Dónde se van a guardar los archivos de migración
  out: './drizzle',
  // El tipo de base de datos
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});