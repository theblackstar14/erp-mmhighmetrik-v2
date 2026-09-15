import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
/**
 * Fase 0 · tasas de detracción cargadas con % , mínimo, anexo, vigencia y conflictos.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-detracciones.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';

type T = { codigo: string; porcentaje: string | null; monto_minimo: string; anexo: string | null; vigencia_hasta: string | null; descripcion: string };
const rows = (await db.execute(sql`select codigo, porcentaje, monto_minimo, anexo, vigencia_hasta::text, descripcion from detraccion_tasa`)) as unknown as T[];
const by = Object.fromEntries(rows.map((r) => [r.codigo, r]));

assert.equal(rows.length, 48, '48 codigos (44 SUNAT + 4 solo Kelly)');
const pct = (c: string) => (by[c]?.porcentaje == null ? null : Number(by[c].porcentaje));
assert.equal(pct('019'), 10, '019 arrendamiento 10%');
assert.equal(pct('022'), 12, '022 otros servicios empresariales 12%');
assert.equal(pct('027'), 4, '027 transporte de carga 4%');
assert.equal(pct('030'), 4, '030 construccion 4%');
assert.equal(pct('037'), 12, '037 demas servicios 12%');
assert.equal(pct('003'), 4, '003 gana la lista principal (4), no el anexo (10)');
assert.equal(pct('046'), null, '046 solo SUNAT: sin %');
assert.equal(Number(by['027'].monto_minimo), 400, '027 minimo 400');
assert.equal(Number(by['030'].monto_minimo), 700, '030 minimo 700');
assert.equal(by['030'].anexo, '3', '030 anexo 3');
assert.equal(by['027'].anexo, 'transporte', '027 bloque transporte');
assert.equal(by['001'].anexo, '1', '001 anexo 1');
assert.equal(by['006'].vigencia_hasta, '2014-12-31', '006 algodon hasta 2014-12-31');
assert.equal(by['042'].vigencia_hasta, '2000-01-01', '042 no vigente');
assert.equal(by['019'].vigencia_hasta, null, '019 vigente');
assert.match(by['030'].descripcion, /Contratos de construcci/i, 'descripcion oficial SUNAT');

const json = JSON.parse(fs.readFileSync(new URL('../../../../packages/db/src/data/detracciones.json', import.meta.url), 'utf8')) as { conflictos: { codigo: string; tipo: string }[] };
const c = new Set(json.conflictos.map((x) => `${x.codigo}:${x.tipo}`));
for (const k of ['003:porcentaje', '045:porcentaje', '034:anexo_duplicado', '006:solo_kelly', '018:solo_kelly', '029:solo_kelly', '033:solo_kelly', '046:solo_sunat', '047:solo_sunat']) {
  assert.ok(c.has(k), `conflicto ${k}`);
}
assert.ok(!json.conflictos.some((x) => x.tipo === 'anexo_sin_match'), 'todas las filas de anexo encuentran su codigo');

console.log('detracciones VERDE');
process.exit(0);
