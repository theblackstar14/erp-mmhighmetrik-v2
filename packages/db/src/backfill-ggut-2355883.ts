/**
 * Backfill ggUtModo · colegios CUI 2355883 (PG0102 Pezantes, PG00101 San Martín).
 *
 * Importados como 'separado' (default) pero su estructura real es EMBEBIDO_CD:
 * el costo directo ya incluye GG+UT → pctGg/pctUtilidad DEBEN ir NULL (regla enum).
 *
 * NO destructivo: solo UPDATE de modo + pcts. montoContractual/costoDirecto
 * son autoritativos del cronograma valorizado y NO se tocan.
 *
 *   pnpm --filter @erp/db exec tsx src/backfill-ggut-2355883.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = await import('./client.js');
const { proyectos } = await import('./schema.js');
const { inArray } = await import('drizzle-orm');

const CODIGOS = ['PG0102', 'PG00101'];

console.log('🚀 Backfill ggUtModo → embebido_cd · CUI 2355883\n');

// 1 · Estado actual
const antes = await db
  .select({
    codigo: proyectos.codigo,
    ggUtModo: proyectos.ggUtModo,
    pctGg: proyectos.pctGg,
    pctUtilidad: proyectos.pctUtilidad,
    costoDirecto: proyectos.costoDirecto,
    montoContractual: proyectos.montoContractual,
  })
  .from(proyectos)
  .where(inArray(proyectos.codigo, CODIGOS));

console.log('  ANTES:');
for (const p of antes) {
  console.log(
    `   ${p.codigo} · modo=${p.ggUtModo} · pctGg=${p.pctGg} · pctUt=${p.pctUtilidad} · CD=${p.costoDirecto} · contractual=${p.montoContractual}`,
  );
}

if (antes.length === 0) {
  console.log('\n⚠ No se encontraron proyectos · nada que hacer.');
  process.exit(0);
}

// 2 · Update (no toca montos)
const upd = await db
  .update(proyectos)
  .set({ ggUtModo: 'embebido_cd', pctGg: null, pctUtilidad: null, updatedAt: new Date() })
  .where(inArray(proyectos.codigo, CODIGOS))
  .returning({
    codigo: proyectos.codigo,
    ggUtModo: proyectos.ggUtModo,
    pctGg: proyectos.pctGg,
    pctUtilidad: proyectos.pctUtilidad,
  });

console.log('\n  DESPUÉS:');
for (const p of upd) {
  console.log(`   ${p.codigo} · modo=${p.ggUtModo} · pctGg=${p.pctGg} · pctUt=${p.pctUtilidad}`);
}

console.log(`\n✅ ${upd.length} colegio(s) actualizados a embebido_cd · montos intactos.`);
process.exit(0);
