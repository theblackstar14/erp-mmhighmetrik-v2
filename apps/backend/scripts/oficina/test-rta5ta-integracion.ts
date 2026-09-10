/**
 * Integration test: Renta 5ta auto + override + snapshot de fechas en planilla oficina.
 * Ejecutar:
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/oficina/test-rta5ta-integracion.ts
 * Requiere DATABASE_URL=erp_mmh_test. Imprime 'rta5ta-integracion VERDE' en exito.
 * Note: exit code 9 on Windows is a cosmetic libuv issue -- success = VERDE printed.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import planillaOficinaRoutes from '../../src/routes/planillaOficina.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin
const MES = '2026-07';
const AFP_SISTEMA_PENSION = 'AFP Profuturo(F)';

let testEmpleadoId: string | null = null;
let testMesId: string | null = null;

(async () => {
  let failed = false;

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/oficina', planillaOficinaRoutes);

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://localhost:${port}`;

  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();

  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  const patch = (path: string, body: unknown) =>
    fetch(base + path, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

  try {
    console.log('==== rta5ta-integracion ====');

    // ── Setup: create temp admin empleado ──
    const [testEmp] = await db.insert(schema.empleados).values({
      nombre: 'TEST RTA5TA INTEGRACION',
      numDoc: '88888888RTA',
      sistemaPension: AFP_SISTEMA_PENSION,
      sueldoBaseMensual: '6000',
      asignacionFamiliar: false,
      tipoPlanilla: 'admin',
      activo: true,
      fechaIngreso: '2026-01-01',
    }).returning();
    testEmpleadoId = testEmp.id;
    console.log(`  setup: empleado creado id=${testEmp.id}`);

    // ── 1. POST /api/oficina/planilla {mes:'2026-07'} ──
    const r1 = await post('/api/oficina/planilla', { mes: MES });
    assert.equal(r1.status, 200, `POST /planilla status ${r1.status}`);
    const j1 = await r1.json() as { mes: any };
    assert.ok(j1.mes, 'POST /planilla => mes row');
    testMesId = j1.mes.id;
    console.log(`  1. planilla creada mesId=${testMesId}`);

    // ── 2. POST calcular ──
    const r2 = await post(`/api/oficina/planilla/${testMesId}/calcular`, {});
    assert.equal(r2.status, 200, `POST calcular status ${r2.status}`);
    const j2 = await r2.json() as { mes: any; detalle: any[] };
    assert.equal(j2.mes.estado, 'calculada', 'mes estado=calculada');

    // Find detalle for our test employee
    const det = j2.detalle.find((d: any) => d.empleado_id === testEmp.id || d.empleadoId === testEmp.id);
    assert.ok(det, `detalle not found for empleado ${testEmp.id} (total=${j2.detalle.length})`);

    const detalleId = det.id;
    const imptoRenta5taAuto = Number(det.impto_renta5ta ?? det.imptoRenta5ta);
    const renta5taManual1 = det.renta5ta_manual ?? det.renta5taManual;
    const fechaIngresoSnap = det.fecha_ingreso ?? det.fechaIngreso;

    // Assert: auto Rta5ta > 0 (6000 sueldo, mes 7 => should have positive retention)
    assert.ok(imptoRenta5taAuto > 0, `imptoRenta5ta should be > 0 (auto), got ${imptoRenta5taAuto}`);
    // Assert: renta5taManual = false (auto, not overridden)
    assert.equal(renta5taManual1, false, `renta5taManual should be false, got ${renta5taManual1}`);
    // Assert: fechaIngreso snapshotted from empleado
    assert.ok(fechaIngresoSnap, `fechaIngreso should be snapshotted, got ${fechaIngresoSnap}`);
    assert.ok(
      String(fechaIngresoSnap).startsWith('2026-01-01'),
      `fechaIngreso should be '2026-01-01', got '${fechaIngresoSnap}'`,
    );

    console.log(`  2. calcular OK: imptoRenta5ta=${imptoRenta5taAuto} (auto), renta5taManual=${renta5taManual1}, fechaIngreso=${fechaIngresoSnap}`);

    // ── 3. PATCH imptoRenta5ta:42 => renta5taManual must flip to true ──
    const r3 = await patch(`/api/oficina/planilla-detalle/${detalleId}`, { imptoRenta5ta: 42 });
    assert.equal(r3.status, 200, `PATCH detalle status ${r3.status}`);
    const j3 = await r3.json() as { detalle: any };
    const det3 = j3.detalle;

    const imptoRenta5ta3 = Number(det3.impto_renta5ta ?? det3.imptoRenta5ta);
    const renta5taManual3 = det3.renta5ta_manual ?? det3.renta5taManual;

    assert.equal(imptoRenta5ta3, 42, `After PATCH, imptoRenta5ta should be 42, got ${imptoRenta5ta3}`);
    assert.equal(renta5taManual3, true, `After PATCH, renta5taManual should be true, got ${renta5taManual3}`);

    console.log(`  3. PATCH OK: imptoRenta5ta=${imptoRenta5ta3}, renta5taManual=${renta5taManual3}`);

    // ── 4. Re-calcular => Kelly's override (42) must survive ──
    const r4 = await post(`/api/oficina/planilla/${testMesId}/calcular`, {});
    assert.equal(r4.status, 200, `Re-calcular status ${r4.status}`);
    const j4 = await r4.json() as { mes: any; detalle: any[] };

    const det4 = j4.detalle.find((d: any) => d.empleado_id === testEmp.id || d.empleadoId === testEmp.id);
    assert.ok(det4, `detalle not found for empleado ${testEmp.id} after re-calcular`);

    const imptoRenta5ta4 = Number(det4.impto_renta5ta ?? det4.imptoRenta5ta);
    const renta5taManual4 = det4.renta5ta_manual ?? det4.renta5taManual;

    assert.equal(imptoRenta5ta4, 42, `After re-calcular, imptoRenta5ta should still be 42 (Kelly override), got ${imptoRenta5ta4}`);
    assert.equal(renta5taManual4, true, `After re-calcular, renta5taManual should still be true, got ${renta5taManual4}`);

    console.log(`  4. Re-calcular OK: imptoRenta5ta=${imptoRenta5ta4} (override survives), renta5taManual=${renta5taManual4}`);

    console.log('\n  rta5ta-integracion VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  FALLO:', e?.message ?? e, '\n');
    if (e?.stack) console.error(e.stack);
  } finally {
    // ── Cleanup ──
    if (testMesId) {
      await db.delete(schema.planillaOficinaMes).where(eq(schema.planillaOficinaMes.id, testMesId)).catch(() => {});
    }
    if (testEmpleadoId) {
      await db.delete(schema.empleados).where(eq(schema.empleados.id, testEmpleadoId)).catch(() => {});
    }

    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})();
