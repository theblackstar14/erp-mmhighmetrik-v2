import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
/**
 * Fase 0 · PCGE completo en plan_contable sin pisar las 150 cuentas existentes.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-pcge.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';

type C = { codigo: string; descripcion: string; tipo: string; nivel: number; parentCodigo: string | null; clasificable: boolean };
const { cuentas } = JSON.parse(fs.readFileSync(new URL('../../../../packages/db/src/data/pcge-2010.json', import.meta.url), 'utf8')) as { cuentas: C[] };
const codigos = new Set(cuentas.map((c) => c.codigo));

assert.ok(cuentas.length >= 1200 && cuentas.length <= 2600, `cantidad razonable (${cuentas.length})`);
assert.equal(codigos.size, cuentas.length, 'sin codigos duplicados');
const huerfanas = cuentas.filter((c) => c.parentCodigo && !codigos.has(c.parentCodigo)).map((c) => c.codigo);
assert.deepEqual(huerfanas, [], 'toda cuenta tiene a su padre en el catalogo');
for (const k of ['10', '104', '1041', '1071', '4011', '40111', '4212', '6032', '011']) assert.ok(codigos.has(k), `JSON trae ${k}`);
assert.match(cuentas.find((c) => c.codigo === '40')!.descripcion, /SALUD POR PAGAR$/, '40 con su linea partida unida');

type P = { codigo: string; descripcion: string; tipo: string; nivel: number; parent_codigo: string | null; clasificable: boolean };
const pc = (await db.execute(sql`select codigo, descripcion, tipo, nivel, parent_codigo, clasificable from plan_contable`)) as unknown as P[];
const by = Object.fromEntries(pc.map((r) => [r.codigo, r]));
assert.equal(by['10'].descripcion, 'Efectivo y equivalentes de efectivo', '10 existente no se piso');
assert.equal(by['1071'].descripcion, 'Detracciones · Banco de la Nación', '1071 existente no se piso');
assert.ok(cuentas.every((c) => by[c.codigo]), 'todas las cuentas del PCGE estan en plan_contable');
assert.deepEqual(
  { tipo: by['11111'].tipo, nivel: by['11111'].nivel, parent: by['11111'].parent_codigo, clasificable: by['11111'].clasificable },
  { tipo: 'Activo', nivel: 4, parent: '1111', clasificable: false },
  '11111 nueva con nivel/padre/tipo',
);
assert.equal(by['6032'].clasificable, true, '6032 clasificable');

console.log(`pcge VERDE · plan_contable ${pc.length} cuentas`);
process.exit(0);
