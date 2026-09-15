import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
/**
 * Fase 0 · endpoints /api/catalogos (in-process). Usa fechas 2099 para no tocar TC reales.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-catalogos-endpoints.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import { db, schema } from '@erp/db';
import { and, eq, gte } from 'drizzle-orm';
import { authMiddleware } from '../../src/middleware/auth.js';
import { lucia } from '../../src/auth.js';
import catalogosRoutes from '../../src/routes/catalogos.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin@mmhighmetrik.com · MM y MG con edicion
const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/catalogos', catalogosRoutes);
const server = app.listen(0);
const base = `http://localhost:${(server.address() as { port: number }).port}`;
const session = await lucia.createSession(USER, {});
const headers = { cookie: lucia.createSessionCookie(session.id).serialize(), 'x-empresa-id': '1', 'content-type': 'application/json' };
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as any };
};

try {
  const s54 = await call('GET', '/api/catalogos/sunat/54');
  assert.equal(s54.status, 200);
  assert.equal(s54.json.filas.length, 44, 'cat 54 con 44 filas');
  assert.equal((await call('GET', '/api/catalogos/sunat/abc')).status, 400, 'catalogo invalido');

  const det = await call('GET', '/api/catalogos/detracciones?fecha=2026-01-15');
  const cods = new Map(det.json.tasas.map((t: any) => [t.codigo, t]));
  assert.equal((cods.get('030') as any)?.porcentaje, 4, '030 vigente al 4%');
  assert.equal((cods.get('027') as any)?.montoMinimo, 400, '027 minimo 400');
  for (const c of ['006', '042', '046']) assert.ok(!cods.has(c), `${c} no aparece (no vigente o sin %)`);

  const put = await call('PUT', '/api/catalogos/tipo-cambio', { filas: [
    { fecha: '2099-01-09', moneda: 'USD', compra: 3.361, venta: 3.368 },
    { fecha: '2099-01-12', moneda: 'USD', compra: 3.371, venta: 3.379 },
  ] });
  assert.deepEqual(put.json, { ok: true, n: 2 });
  const tc = await call('GET', '/api/catalogos/tipo-cambio?fecha=2099-01-10&moneda=USD');
  assert.deepEqual(tc.json, { fecha: '2099-01-09', moneda: 'USD', compra: 3.361, venta: 3.368, diasAtras: 1 }, 'sabado usa el viernes');
  assert.equal((await call('GET', '/api/catalogos/tipo-cambio?fecha=2099-02-01&moneda=USD')).status, 404, 'sin TC reciente');
  assert.equal((await call('PUT', '/api/catalogos/tipo-cambio', { filas: [{ fecha: '2099-01-09', moneda: 'XXX', compra: 1, venta: 1 }] })).status, 400, 'moneda invalida');

  assert.equal((await call('PUT', '/api/catalogos/tipo-cambio', { filas: [
    { fecha: '2099-01-20', moneda: 'USD', compra: 3.4, venta: 3.41 },
    { fecha: '2099-01-20', moneda: 'USD', compra: 3.5, venta: 3.51 },
  ] })).status, 400, 'fecha+moneda duplicado en la misma solicitud');

  const putReup = await call('PUT', '/api/catalogos/tipo-cambio', { filas: [
    { fecha: '2099-01-09', moneda: 'USD', compra: 3.362, venta: 3.370 },
  ] });
  assert.deepEqual(putReup.json, { ok: true, n: 1 }, 're-PUT del mismo fecha+moneda (rama UPDATE del upsert)');
  const tcReup = await call('GET', '/api/catalogos/tipo-cambio?fecha=2099-01-10&moneda=USD');
  assert.deepEqual(tcReup.json, { fecha: '2099-01-09', moneda: 'USD', compra: 3.362, venta: 3.37, diasAtras: 1 }, 'el re-PUT piso el valor anterior');

  console.log('catalogos-endpoints VERDE');
} finally {
  await db.delete(schema.tipoCambio).where(and(eq(schema.tipoCambio.moneda, 'USD'), gte(schema.tipoCambio.fecha, '2099-01-01')));
  await lucia.invalidateSession(session.id);
  server.close();
}
process.exit(0);
