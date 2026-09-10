/**
 * Task 6 · Test cerrar + reabrir planilla oficina.
 * Verifies: WS1 asiento creation, cuota application, reversal.
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/oficina/test-cierre.ts
 * Requiere DATABASE_URL=erp_mmh_test. Imprime 'cierre VERDE' en éxito.
 * Note: exit code 9 on Windows is a cosmetic libuv issue — success = VERDE printed.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import planillaOficinaRoutes from '../../src/routes/planillaOficina.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin
const MES = '2026-07'; // Must be an open period

let testEmpleadoId: string | null = null;
let testAdelantoId: string | null = null;
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

  const get = (path: string) =>
    fetch(base + path, { headers: { cookie } });
  const post = (path: string, body: unknown) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });

  try {
    console.log('════ cierre · Task 6 ════');

    // ── Setup: create temp admin empleado with AFP Profuturo(F) ──
    const [testEmp] = await db
      .insert(schema.empleados)
      .values({
        nombre: 'TEST CIERRE EMP',
        numDoc: '88888888CIERRE',
        sistemaPension: 'AFP Profuturo(F)',
        sueldoBaseMensual: '6000',
        asignacionFamiliar: false,
        tipoPlanilla: 'admin',
        activo: true,
      })
      .returning();
    testEmpleadoId = testEmp.id;
    console.log(`  setup: empleado TEST CIERRE EMP id=${testEmp.id}`);

    // Create adelanto (montoTotal=900, numCuotas=3 → cuota=300)
    const [testAdel] = await db
      .insert(schema.adelantoOficina)
      .values({
        empleadoId: testEmp.id,
        fecha: '2026-07-01',
        montoTotal: '900',
        numCuotas: 3,
        motivo: 'test cierre',
        estado: 'vigente',
        createdBy: USER,
      })
      .returning();
    testAdelantoId = testAdel.id;
    console.log(`  setup: adelanto id=${testAdel.id} montoTotal=900 numCuotas=3`);

    // ── 1. POST /planilla {mes} → create/get mes ──
    const r1 = await post('/api/oficina/planilla', { mes: MES });
    assert.equal(r1.status, 200, `POST /planilla status ${r1.status}`);
    const j1 = await r1.json() as { mes: any };
    assert.ok(j1.mes, 'POST /planilla → mes');
    testMesId = j1.mes.id;
    console.log(`  ✓ 1. POST /planilla → mesId=${testMesId} estado=${j1.mes.estado}`);

    // ── 2. POST calcular ──
    const r2 = await post(`/api/oficina/planilla/${testMesId}/calcular`, {});
    assert.equal(r2.status, 200, `POST calcular status ${r2.status}`);
    const j2 = await r2.json() as { mes: any; detalle: any[] };
    assert.equal(j2.mes.estado, 'calculada', `estado=calculada, got ${j2.mes.estado}`);
    const det = j2.detalle.find((d: any) => d.empleado_id === testEmp.id || d.empleadoId === testEmp.id);
    assert.ok(det, `detalle found for empleado ${testEmp.id}`);
    const adelantoCuota = Number(det.adelanto_cuota ?? det.adelantoCuota);
    assert.equal(adelantoCuota, 300, `adelantoCuota=300 for this empleado, got ${adelantoCuota}`);
    console.log(`  ✓ 2. calcular → estado=calculada, adelantoCuota=${adelantoCuota}`);

    // ── 3. POST cerrar ──
    const r3 = await post(`/api/oficina/planilla/${testMesId}/cerrar`, {});
    if (r3.status !== 200) {
      const body = await r3.text();
      assert.fail(`POST cerrar failed ${r3.status}: ${body}`);
    }
    const j3 = await r3.json() as { mes: any; asientoId: string };
    assert.ok(j3.asientoId, `cerrar → asientoId present, got ${j3.asientoId}`);
    assert.equal(j3.mes.estado, 'cerrada', `mes estado=cerrada, got ${j3.mes.estado}`);
    const asientoId = j3.asientoId;
    console.log(`  ✓ 3. cerrar → estado=cerrada asientoId=${asientoId}`);

    // ── 4. Assert: asiento Σdebe === Σhaber ──
    const [sumas] = await db
      .select({
        sumDebe: sql<string>`COALESCE(SUM(debe::numeric), 0)`,
        sumHaber: sql<string>`COALESCE(SUM(haber::numeric), 0)`,
      })
      .from(schema.asientosLineas)
      .where(eq(schema.asientosLineas.asientoId, asientoId));

    const sumDebe = Math.round(Number(sumas.sumDebe) * 100) / 100;
    const sumHaber = Math.round(Number(sumas.sumHaber) * 100) / 100;
    console.log(`  ✓ 4. asiento Σdebe=${sumDebe} Σhaber=${sumHaber} delta=${Math.round((sumDebe - sumHaber) * 100) / 100}`);
    assert.ok(Math.abs(sumDebe - sumHaber) <= 0.50, `Σdebe (${sumDebe}) ≈ Σhaber (${sumHaber}), delta=${sumDebe - sumHaber}`);

    // ── 5. Assert: adelanto_cuota_aplicada row exists (300) ──
    const cuotasRows = await db
      .select()
      .from(schema.adelantoCuotaAplicada)
      .where(eq(schema.adelantoCuotaAplicada.adelantoId, testAdelantoId));
    assert.equal(cuotasRows.length, 1, `Expected 1 cuota_aplicada, got ${cuotasRows.length}`);
    assert.equal(Number(cuotasRows[0].monto), 300, `cuota monto=300, got ${cuotasRows[0].monto}`);
    console.log(`  ✓ 5. adelanto_cuota_aplicada: 1 row, monto=${cuotasRows[0].monto}`);

    // ── 6. Assert: GET /adelantos shows saldoPendiente=600 ──
    const r6 = await get(`/api/oficina/adelantos?empleadoId=${testEmp.id}`);
    assert.equal(r6.status, 200, `GET /adelantos status ${r6.status}`);
    const j6 = await r6.json() as { adelantos: any[] };
    const ade6 = j6.adelantos.find((a: any) => a.id === testAdelantoId);
    assert.ok(ade6, `adelanto ${testAdelantoId} found`);
    assert.equal(ade6.saldoPendiente, 600, `saldoPendiente=600 after cuota, got ${ade6.saldoPendiente}`);
    console.log(`  ✓ 6. adelanto saldoPendiente=${ade6.saldoPendiente} (was 900, cuota 300 applied)`);

    // ── 6b. Idempotency check: simulate orphan-then-retry scenario ──
    // Directly reset mes to estado='calculada', asientoId=null (leaving asiento in DB)
    await db
      .update(schema.planillaOficinaMes)
      .set({ estado: 'calculada', asientoId: null })
      .where(eq(schema.planillaOficinaMes.id, testMesId!));

    // Retry cerrar → should reuse the existing asiento, not create a duplicate
    const r6b = await post(`/api/oficina/planilla/${testMesId}/cerrar`, {});
    if (r6b.status !== 200) {
      const body = await r6b.text();
      assert.fail(`POST cerrar retry (idempotency) failed ${r6b.status}: ${body}`);
    }
    const j6b = await r6b.json() as { mes: any; asientoId: string };
    assert.ok(j6b.asientoId, `cerrar retry → asientoId present`);
    assert.equal(j6b.mes.estado, 'cerrada', `mes estado=cerrada after retry`);

    // Assert: still exactly ONE non-anulado asiento for this mes
    const asientoRowsRetry = await db
      .select({ id: schema.asientos.id })
      .from(schema.asientos)
      .where(and(
        eq(schema.asientos.origen, 'planilla_oficina'),
        eq(schema.asientos.origenId, testMesId!),
      ));
    assert.equal(asientoRowsRetry.length, 1, `Expected exactly 1 asiento after idempotent retry, got ${asientoRowsRetry.length}`);
    assert.equal(asientoRowsRetry[0].id, asientoId, `Retry reused same asientoId=${asientoId}, not a new one`);
    console.log(`  ✓ 6b. idempotency retry → 1 asiento (no duplicate), reused id=${asientoRowsRetry[0].id}`);

    // ── 7. POST reabrir → 200, estado=calculada ──
    const r7 = await post(`/api/oficina/planilla/${testMesId}/reabrir`, {});
    if (r7.status !== 200) {
      const body = await r7.text();
      assert.fail(`POST reabrir failed ${r7.status}: ${body}`);
    }
    const j7 = await r7.json() as { mes: any };
    assert.equal(j7.mes.estado, 'calculada', `mes estado=calculada after reabrir, got ${j7.mes.estado}`);
    assert.equal(j7.mes.asientoId, null, `asientoId=null after reabrir, got ${j7.mes.asientoId}`);
    console.log(`  ✓ 7. reabrir → estado=calculada asientoId=null`);

    // ── 8. Assert: asiento deleted ──
    const asientoRows = await db
      .select()
      .from(schema.asientos)
      .where(eq(schema.asientos.id, asientoId));
    assert.equal(asientoRows.length, 0, `asiento deleted, but found ${asientoRows.length} rows`);
    console.log(`  ✓ 8. asiento id=${asientoId} deleted`);

    // ── 9. Assert: adelanto_cuota_aplicada removed → saldoPendiente back to 900 ──
    const cuotasAfter = await db
      .select()
      .from(schema.adelantoCuotaAplicada)
      .where(eq(schema.adelantoCuotaAplicada.adelantoId, testAdelantoId));
    assert.equal(cuotasAfter.length, 0, `cuota_aplicada removed, but found ${cuotasAfter.length}`);

    const r9 = await get(`/api/oficina/adelantos?empleadoId=${testEmp.id}`);
    const j9 = await r9.json() as { adelantos: any[] };
    const ade9 = j9.adelantos.find((a: any) => a.id === testAdelantoId);
    assert.ok(ade9, `adelanto ${testAdelantoId} found after reabrir`);
    assert.equal(ade9.saldoPendiente, 900, `saldoPendiente=900 after reabrir, got ${ade9.saldoPendiente}`);
    console.log(`  ✓ 9. after reabrir: cuota_aplicada=0, saldoPendiente=${ade9.saldoPendiente}`);

    console.log('\n  cierre VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
    if (e?.stack) console.error(e.stack);
  } finally {
    // ── Cleanup ──
    // Delete cuota_aplicada for this adelanto (if any remain)
    if (testAdelantoId) {
      await db
        .delete(schema.adelantoCuotaAplicada)
        .where(eq(schema.adelantoCuotaAplicada.adelantoId, testAdelantoId))
        .catch(() => {});
    }

    // Delete planilla mes (cascade deletes detalle; asiento may already be deleted or remain)
    if (testMesId) {
      // Delete asiento linked to this mes (if cerrar succeeded but reabrir didn't)
      const [mesNow] = await db
        .select()
        .from(schema.planillaOficinaMes)
        .where(eq(schema.planillaOficinaMes.id, testMesId))
        .limit(1)
        .catch(() => []);
      if (mesNow?.asientoId) {
        await db.delete(schema.asientos).where(eq(schema.asientos.id, mesNow.asientoId)).catch(() => {});
      }
      // Also clean up any orphaned asientos for this mes (e.g. after idempotency reset)
      await db
        .delete(schema.asientos)
        .where(and(
          eq(schema.asientos.origen, 'planilla_oficina'),
          eq(schema.asientos.origenId, testMesId),
        ))
        .catch(() => {});
      await db.delete(schema.planillaOficinaMes).where(eq(schema.planillaOficinaMes.id, testMesId)).catch(() => {});
    }

    // Delete adelanto
    if (testAdelantoId) {
      await db.delete(schema.adelantoOficina).where(eq(schema.adelantoOficina.id, testAdelantoId)).catch(() => {});
    }

    // Delete empleado
    if (testEmpleadoId) {
      await db.delete(schema.empleados).where(eq(schema.empleados.id, testEmpleadoId)).catch(() => {});
    }

    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})();
