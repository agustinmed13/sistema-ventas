import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

// Carga las credenciales. Next.js lee .env.local solo,
// pero los scripts que corremos aparte (el seed) no.
config({ path: '.env.local' });

// El cliente que habla con Turso
const client = createClient({
  // "as string": TypeScript no sabe si la variable existe (podría ser
  // undefined). Le aseguramos que sí: sale del .env.local.
  url: process.env.TURSO_DATABASE_URL as string,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// El objeto que usa toda la aplicación para consultar la base
export const db = drizzle(client, { schema });