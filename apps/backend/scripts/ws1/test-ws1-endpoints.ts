/**
 * WS1 · Test de los 2 endpoints nuevos (in-process): /plan?q= con claseObra + /gastos/ultima-cuenta.
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/ws1/test-ws1-endpoints.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import finanzasRoutes from '../../src/routes/finanzas.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const RUC = '20999999999'; // proveedor de prueba

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api', finanzasRoutes);
  app.use('/api/contabilidad', contabilidadRoutes);
  const server = app.listen(0);
  const base = `http://localhost:${(server.address() as any).port}`;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const get = (p: string) => fetch(base + p, { headers: { cookie } }).then((r) => r.json());
  let gastoId = '';

  try {
    console.log('════ WS1 · endpoints ════');

    // /plan?q= trae claseObra (para el chip CD/GG del FE)
    const plan = await get('/api/contabilidad/plan?q=634');
    const c634 = plan.cuentas.find((c: any) => c.codigo === '634');
    assert.ok(c634, '634 en resultados');
    assert.equal(c634.claseObra, 'GG_OBRA', '634 trae claseObra=GG_OBRA');
    assert.equal(c634.clasificable, true, '634 clasificable');
    console.log(`  ✓ /plan?q=634 → claseObra=${c634.claseObra} · clasificable=${c634.clasificable}`);

    // /plan?q= no expone campos CD/GG editables (solo claseObra derivable)
    assert.ok(!('clasificacion' in c634), 'no expone clasificacion editable');
    console.log('  ✓ /plan?q= no expone CD/GG como input');

    // sugerir-cuenta nivel 2 (fallback mapa tipoGasto) cuando no hay historial de proveedor
    const fallback = await get(`/api/contabilidad/sugerir-cuenta?proveedorRuc=${RUC}&tipoGasto=Mantenimiento`);
    assert.ok(fallback.cuenta, 'fallback mapa tipoGasto devuelve cuenta');
    assert.equal(fallback.origen, 'AUTOMATICO', 'fallback → origen AUTOMATICO');
    console.log(`  ✓ /sugerir-cuenta nivel 2 (mapa Mantenimiento) → ${fallback.cuenta} · ${fallback.origen}`);

    // crear gasto con cuenta 602 para ese RUC → sugerir-cuenta nivel 1 = 602 (SUGERIDO)
    const r = await fetch(base + '/api/gastos', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ fecha: '2026-08-15', proveedorRuc: RUC, proveedorRazon: 'TEST', subtotal: 100, igv: 18, total: 118, tipoGasto: 'Compra Materiales', cuentaContable: '602', cuentaContableOrigen: 'USUARIO' }) });
    const jg = await r.json();
    gastoId = jg.gasto?.id ?? '';
    const suger = await get(`/api/contabilidad/sugerir-cuenta?proveedorRuc=${RUC}&tipoGasto=Mantenimiento`);
    assert.equal(suger.cuenta, '602', 'nivel 1 (proveedor) gana → 602');
    assert.equal(suger.origen, 'SUGERIDO', 'nivel 1 → origen SUGERIDO');
    console.log(`  ✓ /sugerir-cuenta nivel 1 (proveedor) → ${suger.cuenta} · ${suger.origen}`);

    console.log('\n  ✅ WS1 endpoints VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    if (gastoId) await db.delete(schema.gastos).where(eq(schema.gastos.id, gastoId)).catch(() => {});
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})();
