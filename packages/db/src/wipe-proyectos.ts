/**
 * ⚠ DESTRUCTIVO · Wipe físico de TODOS los proyectos + inversiones.
 *
 * TRUNCATE ... CASCADE elimina en cascada las tablas hijas (partidas, avances,
 * valorizaciones, valorizaciones_partidas/reajustes, checklist, equipo_proyecto,
 * garantias, adelantos, penalidades_aplicadas, consorcios_integrantes, documentos
 * de proyecto, requerimientos/OC ligadas, formulas_polinomicas, imports_s10, etc.).
 *
 * Catálogos globales (clientes, recursos, apus, indices, plan_contable, users,
 * empresa) NO referencian proyectos → sobreviven.
 *
 * Para fase de prueba: slate limpio, luego onboarding end-to-end por la UI.
 *
 *   pnpm --filter @erp/db exec tsx src/wipe-proyectos.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = await import('./client.js');
const { proyectos, inversiones } = await import('./schema.js');
const { sql } = await import('drizzle-orm');

console.log('⚠  WIPE FÍSICO · proyectos + inversiones (CASCADE)\n');

const pAntes = await db.select({ c: sql<number>`count(*)::int` }).from(proyectos);
const iAntes = await db.select({ c: sql<number>`count(*)::int` }).from(inversiones);
console.log(`  ANTES · proyectos=${pAntes[0].c} · inversiones=${iAntes[0].c}`);

await db.execute(sql`TRUNCATE TABLE proyectos, inversiones RESTART IDENTITY CASCADE`);

const pDesp = await db.select({ c: sql<number>`count(*)::int` }).from(proyectos);
const iDesp = await db.select({ c: sql<number>`count(*)::int` }).from(inversiones);
console.log(`  DESPUÉS · proyectos=${pDesp[0].c} · inversiones=${iDesp[0].c}`);

console.log('\n✅ Slate limpio · listo para onboarding end-to-end por UI.');
process.exit(0);
