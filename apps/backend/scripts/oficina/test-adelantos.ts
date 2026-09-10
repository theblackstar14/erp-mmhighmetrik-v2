/**
 * Task 5 · Test adelantos como préstamo con saldo derivado.
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/oficina/test-adelantos.ts
 * Requiere DATABASE_URL=erp_mmh_test. Imprime 'adelantos VERDE' en éxito.
 * Note: exit code 9 on Windows is a cosmetic libuv issue — success = VERDE printed.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import planillaOficinaRoutes from '../../src/routes/planillaOficina.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin

let testEmpleadoId: string | null = null;
let testAdelantoId: string | null = null;

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
    console.log('════ adelantos · Task 5 ════');

    // ── Setup: create temp admin empleado ──
    const [testEmp] = await db
      .insert(schema.empleados)
      .values({
        nombre: 'TEST ADELANTO EMP',
        numDoc: '99999999TEST',
        sistemaPension: 'ONP',
        sueldoBaseMensual: '3000',
        asignacionFamiliar: false,
        tipoPlanilla: 'admin',
        activo: true,
      })
      .returning();
    testEmpleadoId = testEmp.id;
    console.log(`  setup: empleado TEST ADELANTO EMP creado id=${testEmp.id}`);

    // ── 1. POST /adelantos ──
    const r1 = await post('/api/oficina/adelantos', {
      empleadoId: testEmp.id,
      fecha: '2026-07-05',
      montoTotal: 900,
      numCuotas: 3,
      motivo: 'test',
    });
    assert.equal(r1.status, 200, `POST /adelantos status=${r1.status}`);
    const j1 = await r1.json() as { adelanto: any };
    assert.ok(j1.adelanto, 'POST /adelantos → adelanto');
    testAdelantoId = j1.adelanto.id;
    assert.equal(j1.adelanto.montoCuota, 300, `montoCuota=300, got ${j1.adelanto.montoCuota}`);
    assert.equal(j1.adelanto.saldoPendiente, 900, `saldoPendiente=900, got ${j1.adelanto.saldoPendiente}`);
    console.log(`  ✓ 1. POST /adelantos → id=${testAdelantoId} montoCuota=${j1.adelanto.montoCuota} saldoPendiente=${j1.adelanto.saldoPendiente}`);

    // ── 2. GET /adelantos?empleadoId= ──
    const r2 = await get(`/api/oficina/adelantos?empleadoId=${testEmp.id}`);
    assert.equal(r2.status, 200, `GET /adelantos status=${r2.status}`);
    const j2 = await r2.json() as { adelantos: any[] };
    assert.ok(Array.isArray(j2.adelantos), 'GET /adelantos → array');
    assert.equal(j2.adelantos.length, 1, `esperado 1 adelanto, got ${j2.adelantos.length}`);
    const a2 = j2.adelantos[0];
    assert.equal(a2.montoCuota, 300, `montoCuota=300, got ${a2.montoCuota}`);
    assert.equal(a2.saldoPendiente, 900, `saldoPendiente=900, got ${a2.saldoPendiente}`);
    console.log(`  ✓ 2. GET /adelantos → count=1 montoCuota=${a2.montoCuota} saldoPendiente=${a2.saldoPendiente}`);

    // ── 3. Insert cuota aplicada manually, re-GET → saldoPendiente=600 ──
    // We need a planilla_detalle row as FK anchor; create a minimal planilla + detalle first.
    const [mesRow] = await db
      .insert(schema.planillaOficinaMes)
      .values({ empresaId: 1, mes: '2099-01', estado: 'borrador', createdBy: USER })
      .returning();
    const [detRow] = await db
      .insert(schema.planillaOficinaDetalle)
      .values({
        planillaMesId: mesRow.id,
        empleadoId: testEmp.id,
        boletaCorrelativo: 'BOL-TEST-ADL',
        nombre: 'TEST ADELANTO EMP',
        sueldoMensual: '3000',
        totalBruto: '3000',
        netoPago: '3000',
        costoTotal: '3000',
        totalDescuento: '0',
        totalAporte: '0',
        diasTrab: 30,
        horasTrab: 240,
      })
      .returning();

    await db.insert(schema.adelantoCuotaAplicada).values({
      adelantoId: testAdelantoId!,
      planillaDetalleId: detRow.id,
      monto: '300',
      fecha: '2026-07-31',
    });

    const r3 = await get(`/api/oficina/adelantos?empleadoId=${testEmp.id}`);
    assert.equal(r3.status, 200, `GET /adelantos (post-cuota) status=${r3.status}`);
    const j3 = await r3.json() as { adelantos: any[] };
    const a3 = j3.adelantos[0];
    assert.equal(a3.saldoPendiente, 600, `saldoPendiente=600 after cuota, got ${a3.saldoPendiente}`);
    console.log(`  ✓ 3. saldo derivado tras cuota 300 → saldoPendiente=${a3.saldoPendiente}`);

    // Cleanup planilla+detalle (cascade deletes cuota_aplicada via detalle FK)
    await db.delete(schema.planillaOficinaMes).where(eq(schema.planillaOficinaMes.id, mesRow.id)).catch(() => {});

    console.log('\n  adelantos VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
    if (e?.stack) console.error(e.stack);
  } finally {
    // Cleanup cuotas sin cascade (adelanto → cuota tiene cascade pero solo via detalle FK)
    if (testAdelantoId) {
      await db
        .delete(schema.adelantoCuotaAplicada)
        .where(eq(schema.adelantoCuotaAplicada.adelantoId, testAdelantoId))
        .catch(() => {});
      await db
        .delete(schema.adelantoOficina)
        .where(eq(schema.adelantoOficina.id, testAdelantoId))
        .catch(() => {});
    }
    if (testEmpleadoId) {
      await db
        .delete(schema.empleados)
        .where(eq(schema.empleados.id, testEmpleadoId))
        .catch(() => {});
    }

    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})();
