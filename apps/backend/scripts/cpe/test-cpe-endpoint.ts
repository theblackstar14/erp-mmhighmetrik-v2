import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion

/**
 * POST /api/cpe/leer (in-process). Necesita fixtures/mmh (XML reales); sin ellos solo prueba rechazos.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/cpe/test-cpe-endpoint.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import { lucia } from '../../src/auth.js';
import cpeRoutes from '../../src/routes/cpe.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // empresa 1 = MM (20610639764) · empresa 2 = MG
const app = express();
app.use(authMiddleware);
app.use('/api/cpe', cpeRoutes);
const server = app.listen(0);
const base = `http://localhost:${(server.address() as { port: number }).port}`;
const session = await lucia.createSession(USER, {});
const cookie = lucia.createSessionCookie(session.id).serialize();

async function subir(rel: string | null, empresa = '1') {
  const form = new FormData();
  if (rel) form.append('file', new Blob([fs.readFileSync(path.join(DIR, rel))]), path.basename(rel));
  const r = await fetch(`${base}/api/cpe/leer`, { method: 'POST', headers: { cookie, 'x-empresa-id': empresa }, body: form });
  return { status: r.status, json: (await r.json()) as any };
}

try {
  assert.equal((await subir(null)).status, 400, 'sin archivo');
  const v20 = await subir('publicos/greenter/invoice/detraccion.xml');
  assert.deepEqual([v20.status, v20.json.code], [422, 'NO_SOPORTADO'], 'UBL 2.0');

  if (fs.existsSync(path.join(DIR, 'mmh'))) {
    const e72 = await subir('mmh/FACTURAE001-7220610639764.XML');
    assert.equal(e72.status, 200);
    assert.equal(e72.json.rol, 'venta', 'MMH emite E001-72');
    assert.deepEqual([e72.json.detraccion.calculada.monto, e72.json.detraccion.coincide], [1560, true], 'detraccion 030 coincide');

    const e69 = await subir('mmh/FACTURAE001-6920610639764.XML');
    assert.deepEqual([e69.json.detraccion.calculada.monto, e69.json.detraccion.coincide], [3761, true], '019 10% de 37,611.44 = 3,761');

    const bcp = await subir('mmh/20100047218-01-FN01-40548491.xml');
    assert.deepEqual([bcp.status, bcp.json.rol, bcp.json.detraccion], [200, 'compra', null], 'BCP le factura a MMH');

    const ajena = await subir('mmh/FACTURAE001-172020613703340.xml');
    assert.deepEqual([ajena.status, ajena.json.code], [422, 'EMPRESA_AJENA'], 'factura entre terceros');

    const otraEmpresa = await subir('mmh/FACTURAE001-7220610639764.XML', '2');
    assert.deepEqual([otraEmpresa.status, otraEmpresa.json.code], [422, 'EMPRESA_AJENA'], 'con MG activa, la factura de MM es ajena');
    console.log('  ✓ reales MMH');
  } else console.log('  ⏭  fixtures/mmh no existe');

  console.log('cpe-endpoint VERDE');
} finally {
  await lucia.invalidateSession(session.id);
  server.close();
}
process.exit(0);
