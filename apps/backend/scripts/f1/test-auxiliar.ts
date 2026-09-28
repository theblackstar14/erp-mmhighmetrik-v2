/**
 * F3.3 · Test del auxiliar por tercero.
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-auxiliar.ts
 * A cuenta control (4212) → modo documentos con aging · B cuenta de gasto (63) → modo mayor
 * agrupado por contraparte · C cuenta requerida → 400. Read-only. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/contabilidad', contabilidadRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const get = async (qs: string) => {
    const r = await fetch(`http://localhost:${port}/api/contabilidad/auxiliar?${qs}`, { headers: { cookie } });
    return { status: r.status, body: await r.json() };
  };

  try {
    console.log('════ F3.3 · auxiliar por tercero ════');

    const A = await get('cuenta=4212');
    assert.equal(A.status, 200, 'A ok');
    assert.equal(A.body.modo, 'documentos', 'A: 4212 → modo documentos');
    assert.ok(A.body.filas.length > 0, 'A: hay terceros con saldo');
    assert.ok(A.body.filas.every((f: any) => Math.abs(f.corriente + f.d30 + f.d60 + f.d90 + f.mas90 - f.saldo) < 0.01), 'A: buckets suman el saldo');
    console.log(`  ✓ A 4212 documentos: ${A.body.filas.length} tercero(s) · saldo total ${A.body.totales.saldo.toFixed(2)}`);
    console.log(`    top: ${A.body.filas.slice(0, 3).map((f: any) => `${f.tercero.slice(0, 28)}=${f.saldo}`).join(' · ')}`);

    const B = await get('cuenta=63');
    assert.equal(B.status, 200, 'B ok');
    assert.equal(B.body.modo, 'mayor', 'B: 63 → modo mayor');
    assert.ok(B.body.filas.length > 0, 'B: hay contrapartes');
    console.log(`  ✓ B 63 mayor: ${B.body.filas.length} contraparte(s) · debe total ${B.body.totales.debe.toFixed(2)}`);
    console.log(`    top: ${B.body.filas.slice(0, 3).map((f: any) => `${f.tercero.slice(0, 28)}=${f.saldo}`).join(' · ')}`);

    const C = await get('');
    assert.equal(C.status, 400, 'C: sin cuenta → 400');
    console.log('  ✓ C validación de cuenta requerida');

    console.log('\n  ✅ F3.3 auxiliar VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
