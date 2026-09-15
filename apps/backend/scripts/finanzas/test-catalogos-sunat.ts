/**
 * Fase 0 · catálogos SUNAT cargados.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-catalogos-sunat.ts
 */
import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
import assert from 'node:assert/strict';
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';

type Row = { catalogo: string; n: number };
const rows = (await db.execute(sql`select catalogo, count(*)::int as n from catalogo_sunat group by catalogo`)) as unknown as Row[];
const n = Object.fromEntries(rows.map((r) => [r.catalogo, r.n]));

assert.equal(n['54'], 44, 'cat 54 detracciones: 44 codigos');
assert.equal(n['09'], 13, 'cat 09 motivos NC: 13');
for (const [cat, min] of Object.entries({ '01': 30, '06': 10, '07': 15, '10': 5, '51': 25, '52': 10, '53': 20, '59': 20 })) {
  assert.ok((n[cat] ?? 0) >= min, `cat ${cat} tiene >= ${min} (tiene ${n[cat]})`);
}

const uno = async (cat: string, cod: string) =>
  ((await db.execute(sql`select descripcion, extra from catalogo_sunat where catalogo = ${cat} and codigo = ${cod}`)) as unknown as { descripcion: string; extra: Record<string, string> }[])[0];

assert.match((await uno('01', '07'))?.descripcion ?? '', /Nota de cr/i, '01/07 nota de credito');
assert.match((await uno('54', '030'))?.descripcion ?? '', /construcci/i, '54/030 construccion');
assert.match((await uno('54', '027'))?.descripcion ?? '', /transporte de carga/i, '54/027 transporte de carga');
assert.match((await uno('09', '01'))?.descripcion ?? '', /Anulaci/i, '09/01 anulacion');
assert.match((await uno('51', '1001'))?.descripcion ?? '', /Detracci/i, '51/1001 sujeta a detraccion');
assert.equal((await uno('07', '10'))?.extra?.['Codigo de tributo'], '1000', '07/10 trae codigo de tributo en extra');

console.log('catalogos-sunat VERDE');
process.exit(0);
