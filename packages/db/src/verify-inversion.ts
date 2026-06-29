/**
 * Verificación A + B · estado de un proyecto tras import del cronograma valorizado.
 *   A = componentes inversión (mobiliario/ET/supervisión) + distribucionInversion
 *   B = partidas.distribucionMensual poblada (Abr-26..Ene-27)
 *
 *   pnpm --filter @erp/db exec tsx src/verify-inversion.ts [CODIGO]
 *   (default CODIGO=PG0002)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const { db } = await import('./client.js');
const { proyectos, partidas } = await import('./schema.js');
const { sql, eq } = await import('drizzle-orm');

const CODIGO = process.argv[2] ?? 'PG0002';
const [p] = await db.select().from(proyectos).where(eq(proyectos.codigo, CODIGO)).limit(1);
if (!p) { console.log(`✗ ${CODIGO} no existe`); process.exit(1); }

const di = (p.distribucionInversion ?? []) as Array<{ ym: string; monto: number }>;
const sumDi = di.reduce((s, d) => s + d.monto, 0);

const [{ leaves }] = await db.select({ leaves: sql<number>`count(*)::int` }).from(partidas)
  .where(sql`${partidas.proyectoId}=${p.id} AND jsonb_array_length(coalesce(${partidas.distribucionMensual},'[]'::jsonb)) > 0`);
const [{ conFechas }] = await db.select({ conFechas: sql<number>`count(*)::int` }).from(partidas)
  .where(sql`${partidas.proyectoId}=${p.id} AND ${partidas.fechaInicio} IS NOT NULL`);

console.log(`\n═══ ${CODIGO} · "${p.nombre?.slice(0, 40)}" ═══`);
console.log('\n── A · componentes inversión ──');
console.log(`  CD (costoDirecto)        ${p.costoDirecto}`);
console.log(`  Mobiliario               ${p.montoMobiliario}`);
console.log(`  Expediente técnico       ${p.montoExpedienteTecnico}`);
console.log(`  Superv. expediente       ${p.montoSupervisionExpediente}`);
console.log(`  Superv. obra             ${p.montoSupervisionObra}`);
console.log(`  Monto inversión (VR)     ${p.montoReferencial}`);
console.log('\n── A · distribucionInversion (PV mensual) ──');
console.log(`  items=${di.length} · Σ=${sumDi.toFixed(2)} · VR=${p.montoReferencial} · cuadra=${Math.abs(sumDi - Number(p.montoReferencial)) < 1 ? '✓' : '✗'}`);
for (const d of di) console.log(`    ${d.ym}  ${d.monto.toFixed(2)}`);
console.log('\n── B · distribución mensual partidas ──');
console.log(`  partidas con distribucionMensual>0 : ${leaves}`);
console.log(`  partidas con fechaInicio            : ${conFechas}`);
console.log(`\n${leaves > 0 && di.length > 0 ? '✅ A+B OK' : '✗ falta data · re-importar cronograma'}`);
process.exit(0);
