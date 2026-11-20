import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema.js';

// Carga las credenciales. Next.js lee .env.local solo,
// pero los scripts que corremos aparte (el seed) no.
config({ path: '.env.local' });

// El cliente que habla con Turso
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// El objeto que usa toda la aplicación para consultar la base
export const db = drizzle(client, { schema });