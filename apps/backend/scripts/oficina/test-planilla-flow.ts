/**
 * Task 4 · Test integral planilla oficina (crear, calcular, editar detalle).
 * C-2 fix: proves AFP suffix stripping against REAL afp_tasas data (no fake rows).
 * In-process, routers reales, lucia session.
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/oficina/test-planilla-flow.ts
 * Requiere DATABASE_URL=erp_mmh_test. Imprime 'planilla-flow VERDE' en éxito.
 * Note: exit code 9 on Windows is a cosmetic libuv issue — success = VERDE printed.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import planillaOficinaRoutes from '../../src/routes/planillaOficina.js';
import { calcularDetalleOficina } from '../../src/lib/planillaOficinaCalc.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin
const MES = '2026-07';

// The real production-style sistemaPension with (F) suffix
const AFP_SISTEMA_PENSION = 'AFP Profuturo(F)';
// The stripped key matching afp_tasas.afp
const AFP_KEY = 'AFP Profuturo';

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

  const get = (path: string) =>
    fetch(base + path, { headers: { cookie } });
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  const patch = (path: string, body: unknown) =>
    fetch(base + path, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

  try {
    console.log('════ planilla-flow · Task 4 (C-2 real data) ════');

    // ── Read REAL AFP Profuturo rates from DB (NO insert/delete) ──
    const [profuturoRow] = await db
      .select()
      .from(schema.afpTasas)
      .where(eq(schema.afpTasas.afp, AFP_KEY))
      .limit(1);
    assert.ok(profuturoRow, `afp_tasas row for '${AFP_KEY}' must exist in DB`);
    const profuturoSeguro = Number(profuturoRow.pctSeguro);   // already fraction e.g. 0.0184
    const profuturoComision = Number(profuturoRow.pctComision); // e.g. 0.0147
    console.log(`  DB rates for '${AFP_KEY}': pctSeguro=${profuturoSeguro}, pctComision=${profuturoComision}`);

    // ── Read config from endpoint (for expected calculation) ──
    const rCfg = await get('/api/oficina/config-planilla');
    assert.equal(rCfg.status, 200, `GET config-planilla status ${rCfg.status}`);
    const cfg = await rCfg.json() as {
      pctEssalud: number; pctOnp: number; pctAfpAporte: number;
      rmv: number; horasMesBase: number; topeSeguroAfp: number;
    };
    console.log(`  config: pctEssalud=${cfg.pctEssalud}, horasMesBase=${cfg.horasMesBase}, topeSeguroAfp=${cfg.topeSeguroAfp}`);

    // ── Compute EXPECTED detalle independently using the engine ──
    const expectedDetalle = calcularDetalleOficina(
      {
        sueldoMensual: 6000,
        sistemaPension: 'AFP',
        asignacionFamiliar: false,
        cantHe25: 0,
        cantHe35: 0,
        dominical: 0,
        feriado: 0,
        gratificacion: 0,
        vacaciones: 0,
        comisiones: 0,
        bonificacion: 0,
        imptoRenta5ta: 0,
        retencionJudicial: 0,
        adelantoCuota: 0,
        otrosDescuentos: 0,
        diasTrab: 30,
        horasTrab: 240,
      },
      {
        pctEssalud: cfg.pctEssalud,
        pctOnp: cfg.pctOnp,
        pctAfpAporte: cfg.pctAfpAporte,
        rmv: cfg.rmv,
        horasMesBase: cfg.horasMesBase,
        topeSeguroAfp: cfg.topeSeguroAfp,
        afp: { pctSeguro: profuturoSeguro, pctComision: profuturoComision },
      },
    );
    console.log(`  expected (engine): afpSeguro=${expectedDetalle.afpSeguro}, netoPago=${expectedDetalle.netoPago}`);
    assert.ok(expectedDetalle.afpSeguro > 0, `Expected afpSeguro must be > 0 (real rate ${profuturoSeguro})`);

    // ── Setup: create test admin empleado with production-style sufixed AFP ──
    const [testEmp] = await db.insert(schema.empleados).values({
      nombre: 'TEST LEVANO',
      numDoc: '43170938TEST',
      sistemaPension: AFP_SISTEMA_PENSION,  // 'AFP Profuturo(F)' — production style with suffix
      sueldoBaseMensual: '6000',
      asignacionFamiliar: false,
      tipoPlanilla: 'admin',
      activo: true,
    }).returning();
    testEmpleadoId = testEmp.id;
    console.log(`  setup: empleado TEST LEVANO creado id=${testEmp.id} sistemaPension='${AFP_SISTEMA_PENSION}'`);

    // ── 1. POST /api/oficina/planilla {mes:'2026-07'} ──
    const r1 = await post('/api/oficina/planilla', { mes: MES });
    assert.equal(r1.status, 200, `POST /planilla status ${r1.status}`);
    const j1 = await r1.json() as { mes: any };
    assert.ok(j1.mes, 'POST /planilla → mes row');
    assert.equal(j1.mes.estado, 'borrador', 'mes estado=borrador');
    assert.equal(j1.mes.mes, MES, `mes.mes=${MES}`);
    testMesId = j1.mes.id;
    console.log(`  ✓ 1. POST /planilla → borrador mesId=${testMesId}`);

    // ── Idempotent: second POST returns same row ──
    const r1b = await post('/api/oficina/planilla', { mes: MES });
    const j1b = await r1b.json() as { mes: any };
    assert.equal(j1b.mes.id, testMesId, 'idempotent: same mes id');
    console.log('  ✓ 1b. POST /planilla idempotente');

    // ── 2. POST /api/oficina/planilla/:mesId/calcular ──
    const r2 = await post(`/api/oficina/planilla/${testMesId}/calcular`, {});
    assert.equal(r2.status, 200, `POST calcular status ${r2.status}`);
    const j2 = await r2.json() as { mes: any; detalle: any[] };
    assert.ok(j2.mes, 'calcular → mes');
    assert.equal(j2.mes.estado, 'calculada', 'mes estado=calculada');
    assert.ok(Array.isArray(j2.detalle), 'calcular → detalle array');

    // Find detalle for test empleado
    const det = j2.detalle.find((d: any) => d.empleado_id === testEmp.id || d.empleadoId === testEmp.id);
    assert.ok(det, `detalle found for empleado ${testEmp.id} (detalle count=${j2.detalle.length})`);

    const totalBruto = Number(det.total_bruto ?? det.totalBruto);
    const essalud = Number(det.essalud);
    const afpAporte = Number(det.afp_aporte ?? det.afpAporte);
    const afpSeguro = Number(det.afp_seguro ?? det.afpSeguro);
    const netoPago = Number(det.neto_pago ?? det.netoPago);
    const boletaCorrelativo = det.boleta_correlativo ?? det.boletaCorrelativo;

    assert.equal(totalBruto, 6000, `totalBruto=6000, got ${totalBruto}`);

    // KEY assertion C-2: afpSeguro must be > 0 (proves suffix was stripped; bug would give 0)
    assert.ok(afpSeguro > 0, `afpSeguro must be > 0 (AFP suffix stripping working), got ${afpSeguro}`);
    assert.ok(
      Math.abs(afpSeguro - expectedDetalle.afpSeguro) < 0.02,
      `afpSeguro=${afpSeguro} must match engine expected=${expectedDetalle.afpSeguro} (within 0.02)`,
    );

    // netoPago must match engine expected
    assert.ok(
      Math.abs(netoPago - expectedDetalle.netoPago) < 0.02,
      `netoPago=${netoPago} must match engine expected=${expectedDetalle.netoPago} (within 0.02)`,
    );

    assert.ok(
      typeof boletaCorrelativo === 'string' && boletaCorrelativo.startsWith('BOL-'),
      `boletaCorrelativo starts with BOL-, got ${boletaCorrelativo}`,
    );

    const detalleId = det.id;
    console.log(`  ✓ 2. calcular → detalle encontrado id=${detalleId}`);
    console.log(`       totalBruto=${totalBruto} essalud=${essalud} afpAporte=${afpAporte} afpSeguro=${afpSeguro} netoPago=${netoPago}`);
    console.log(`       boletaCorrelativo=${boletaCorrelativo}`);
    console.log(`       (expected afpSeguro=${expectedDetalle.afpSeguro}, expected netoPago=${expectedDetalle.netoPago})`);

    // ── 3. PATCH /api/oficina/planilla-detalle/:id {imptoRenta5ta:95} ──
    // Assert: new netoPago == (previous netoPago - 95) within 0.02 (rate-agnostic)
    const r3 = await patch(`/api/oficina/planilla-detalle/${detalleId}`, { imptoRenta5ta: 95 });
    assert.equal(r3.status, 200, `PATCH detalle status ${r3.status}`);
    const j3 = await r3.json() as { detalle: any };
    assert.ok(j3.detalle, 'PATCH → detalle');

    const netoPago2 = Number(j3.detalle.neto_pago ?? j3.detalle.netoPago);
    const renta2 = Number(j3.detalle.impto_renta5ta ?? j3.detalle.imptoRenta5ta);
    assert.equal(renta2, 95, `imptoRenta5ta=95, got ${renta2}`);
    assert.ok(
      Math.abs(netoPago2 - (netoPago - 95)) < 0.02,
      `netoPago2=${netoPago2} must equal (netoPago - 95)=${netoPago - 95} (within 0.02)`,
    );

    console.log(`  ✓ 3. PATCH detalle imptoRenta5ta=95 → netoPago=${netoPago2} (prev ${netoPago} - 95 = ${netoPago - 95})`);

    console.log('\n  planilla-flow VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
    if (e?.stack) console.error(e.stack);
  } finally {
    // ── Cleanup ──
    if (testMesId) {
      // cascade deletes planilla_oficina_detalle
      await db.delete(schema.planillaOficinaMes).where(eq(schema.planillaOficinaMes.id, testMesId)).catch(() => {});
    }
    if (testEmpleadoId) {
      await db.delete(schema.empleados).where(eq(schema.empleados.id, testEmpleadoId)).catch(() => {});
    }
    // NO afp_tasas cleanup — we did NOT insert any fake rows

    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})();
