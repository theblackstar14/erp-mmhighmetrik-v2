import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = await import('./client.js');
const { proyectos, valorizaciones } = await import('./schema.js');
const { eq } = await import('drizzle-orm');

const proy = await db.select().from(proyectos).where(eq(proyectos.codigo, 'PG0005')).limit(1);
if (!proy.length) {
  console.error('PG0005 no encontrado');
  process.exit(1);
}

const vals = await db.select().from(valorizaciones).where(eq(valorizaciones.proyectoId, proy[0]!.id));
for (const v of vals) {
  await db.delete(valorizaciones).where(eq(valorizaciones.id, v.id));
}
console.log(`✓ ${vals.length} valorizaciones eliminadas (cascade limpia detalle)`);
process.exit(0);
