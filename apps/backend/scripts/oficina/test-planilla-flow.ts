/**
 * Task 6 · Test integral planilla oficina v2 (motor, params legales, YTD, snapshot).
 * Prueba original (Task 4 / C-2) + nuevos casos v2 (julio 2026 anchors cuadran el Excel,
 * sin circularidad — se usan literales del Excel, no el engine mismo como oráculo).
 * In-process, routers reales, lucia session.
 *   cd apps/backend && DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx scripts/oficina/test-planilla-flow.ts
 * Requiere DATABASE_URL=erp_mmh_test. Imprime 'planilla-flow VERDE' en éxito.
 * Note: exit code 9 on Windows is a cosmetic libuv issue — success = VERDE printed.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import planillaOficinaRoutes from '../../src/routes/planillaOficina.js';
import { calcularDetalleOficina } from '../../src/lib/planillaOficinaCalc.js';
import { resolverParamLegal, cargarTasasAfp } from '../../src/lib/paramLegalOficina.js';
import { calcularRta5ta } from '../../src/lib/rta5taCalc.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, eq } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin
const MES = '2026-07';

// The real production-style sistemaPension with (F) suffix
const AFP_SISTEMA_PENSION = 'AFP Profuturo(F)';
// The stripped key matching afp_tasas.afp
const AFP_KEY = 'AFP Profuturo';

// ── Anchor employee DNIs for July 2026 assertions ──
const DNI_GARCIA   = '48448443'; // AFP Profuturo saldo, sueldo 12850 → Excel literals
const DNI_HUERTA   = '43760364'; // AFP Profuturo flujo, sueldo 1130 → afpComision 19.10
const DNI_BAUTISTA = '47349935'; // ONP, sueldo 5000 → onp 650, essalud 450
const DNI_YANGARI  = '73653370'; // ONP, sueldo 3100, 29 días/31-day month → totalBruto≈2900, onp≈377

let testEmpleadoId: string | null = null;
let testMesId: string | null = null;

// ── Save originals so we can restore all anchor employees completely ──
type EmpleadoOrig = {
  sistemaPension: string | null;
  afpComisionTipo: string | null;
  sueldoBaseMensual: string | null;
  tipoPlanilla: string | null;
  activo: boolean | null;
};
let garciaOrig: EmpleadoOrig | null = null;
let huertaOrig: EmpleadoOrig | null = null;
let bautistaOrig: EmpleadoOrig | null = null;
let yangariOrig: EmpleadoOrig | null = null;

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
    // ══════════════════════════════════════════════════════════
    // ── PARTE A: Test original Task 4 (C-2 real data) ────────
    // ══════════════════════════════════════════════════════════
    console.log('════ planilla-flow · Task 4 (C-2 real data) ════');

    // ── Read REAL AFP Profuturo rates from DB (NO insert/delete) ──
    const [profuturoRow] = await db
      .select()
      .from(schema.afpTasas)
      .where(eq(schema.afpTasas.afp, AFP_KEY))
      .limit(1);
    assert.ok(profuturoRow, `afp_tasas row for '${AFP_KEY}' must exist in DB`);
    const profuturoSeguro = Number(profuturoRow.pctSeguro);   // already fraction e.g. 0.0137
    const profuturoComision = Number(profuturoRow.pctComision); // e.g. 0.0147 (pctComision used here for compat)
    console.log(`  DB rates for '${AFP_KEY}': pctSeguro=${profuturoSeguro}, pctComision=${profuturoComision}`);

    // ── Read REAL versioned params for July 2026 ──
    const param = await resolverParamLegal('2026-07-01');
    const afps = await cargarTasasAfp();
    const profuturoAfp = afps['AFP PROFUTURO'];
    assert.ok(profuturoAfp, 'AFP PROFUTURO must be in cargarTasasAfp() result');
    console.log(`  paramLegal (jul-2026): rmv=${param.rmv}, uit=${param.uit}, topeRma=${param.topeRma}`);
    console.log(`  AFP Profuturo: pctSeguro=${profuturoAfp.pctSeguro}, pctComisionFlujo=${profuturoAfp.pctComisionFlujo}`);

    // ── Compute EXPECTED detalle independently using the v2 engine ──
    // v2: use full month (diasMes=31 for July, diasTrab=31) + YTD-based renta5ta suggestion
    const TEST_SUELDO = 6000;
    const TEST_MES_NUM = 7;
    const TEST_DIAS_MES = 31; // July has 31 days
    const testRenta5ta = calcularRta5ta({
      sueldoMensual: TEST_SUELDO, mesNumero: TEST_MES_NUM, mesIngreso: 1,
      acumuladoPercibidoAntes: 0, retencionesPrevias: 0, uit: param.uit,
    }).retencionMes;
    const expectedDetalle = calcularDetalleOficina(
      {
        sueldoMensual: TEST_SUELDO,
        sistemaPension: 'AFP',
        afpComisionTipo: 'saldo',
        modalidadFormativa: false,
        asignacionFamiliar: false,
        cantHe25: 0,
        cantHe35: 0,
        dominical: 0,
        feriado: 0,
        gratificacion: 0,
        vacaciones: 0,
        comisiones: 0,
        bonificacion: 0,
        imptoRenta5ta: testRenta5ta,
        retencionJudicial: 0,
        adelantoCuota: 0,
        otrosDescuentos: 0,
        diasTrab: TEST_DIAS_MES,
        diasMes: TEST_DIAS_MES,
      },
      {
        rmv: param.rmv,
        uit: param.uit,
        topeRma: param.topeRma,
        pctEssalud: param.pctEssalud,
        pctOnp: param.pctOnp,
        pctAfpAporte: param.pctAfpAporte,
        pctAsigFamiliar: param.pctAsigFamiliar,
        afp: profuturoAfp,
      },
    );
    console.log(`  expected (engine v2): afpSeguro=${expectedDetalle.afpSeguro}, netoPago=${expectedDetalle.netoPago} (renta5ta=${testRenta5ta})`);
    assert.ok(expectedDetalle.afpSeguro > 0, `Expected afpSeguro must be > 0 (real rate ${profuturoAfp.pctSeguro})`);

    // ── Setup: create test admin empleado with production-style suffixed AFP ──
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
    // If the mes already exists and is cerrada, reopen it first
    const [existingMes] = await db
      .select()
      .from(schema.planillaOficinaMes)
      .where(and(eq(schema.planillaOficinaMes.empresaId, 1), eq(schema.planillaOficinaMes.mes, MES)))
      .limit(1);
    if (existingMes && existingMes.estado === 'cerrada') {
      const rReabrir = await post(`/api/oficina/planilla/${existingMes.id}/reabrir`, {});
      assert.equal(rReabrir.status, 200, `reabrir cerrada planilla status ${rReabrir.status}`);
      console.log(`  setup: planilla 2026-07 reabierta (era cerrada) id=${existingMes.id}`);
    }

    const r1 = await post('/api/oficina/planilla', { mes: MES });
    assert.equal(r1.status, 200, `POST /planilla status ${r1.status}`);
    const j1 = await r1.json() as { mes: any };
    assert.ok(j1.mes, 'POST /planilla → mes row');
    assert.ok(['borrador', 'calculada'].includes(j1.mes.estado), `mes estado is borrador or calculada (got ${j1.mes.estado})`);
    assert.equal(j1.mes.mes, MES, `mes.mes=${MES}`);
    testMesId = j1.mes.id;
    console.log(`  ✓ 1. POST /planilla → estado=${j1.mes.estado} mesId=${testMesId}`);

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
    // Assert: new netoPago adjusts by (originalRenta5ta - 95) relative to previous netoPago
    const originalRenta5ta = Number(det.impto_renta5ta ?? det.imptoRenta5ta ?? 0);
    const r3 = await patch(`/api/oficina/planilla-detalle/${detalleId}`, { imptoRenta5ta: 95 });
    assert.equal(r3.status, 200, `PATCH detalle status ${r3.status}`);
    const j3 = await r3.json() as { detalle: any };
    assert.ok(j3.detalle, 'PATCH → detalle');

    const netoPago2 = Number(j3.detalle.neto_pago ?? j3.detalle.netoPago);
    const renta2 = Number(j3.detalle.impto_renta5ta ?? j3.detalle.imptoRenta5ta);
    assert.equal(renta2, 95, `imptoRenta5ta=95, got ${renta2}`);
    // v2: neto changes by (originalRenta5ta - 95) — if original was higher, neto goes up
    const expectedNetoPago2 = netoPago + (originalRenta5ta - 95);
    assert.ok(
      Math.abs(netoPago2 - expectedNetoPago2) < 0.02,
      `netoPago2=${netoPago2} must equal ${expectedNetoPago2} (netoPago=${netoPago} + (origRenta${originalRenta5ta} - 95), within 0.02)`,
    );

    console.log(`  ✓ 3. PATCH detalle imptoRenta5ta=95 → netoPago=${netoPago2} (origRenta=${originalRenta5ta}, expected=${expectedNetoPago2})`);

    // ══════════════════════════════════════════════════════════
    // ── PARTE B: Task 6 — anchor employees cuadran el Excel ──
    //    AUTO-component literals from the real July 2026 Excel
    //    (NOT computed circularly by calling the engine).
    // ══════════════════════════════════════════════════════════
    console.log('\n════ planilla-flow · Task 6 (v2 anchors julio 2026) ════');

    // ── B-SETUP: read & save originals, then set deterministic attributes ──

    // García (48448443) — AFP Profuturo saldo, sueldo 12850
    const [garciaRow] = await db.select().from(schema.empleados).where(eq(schema.empleados.numDoc, DNI_GARCIA)).limit(1);
    assert.ok(garciaRow, `García (DNI ${DNI_GARCIA}) must exist`);
    garciaOrig = {
      sistemaPension: garciaRow.sistemaPension ?? null,
      afpComisionTipo: garciaRow.afpComisionTipo ?? null,
      sueldoBaseMensual: garciaRow.sueldoBaseMensual ?? null,
      tipoPlanilla: garciaRow.tipoPlanilla ?? null,
      activo: garciaRow.activo ?? null,
    };
    await db.update(schema.empleados).set({
      sistemaPension: 'AFP Profuturo(F)',
      afpComisionTipo: 'saldo',
      sueldoBaseMensual: '12850',
      tipoPlanilla: 'admin',
      activo: true,
    }).where(eq(schema.empleados.numDoc, DNI_GARCIA));
    console.log(`  setup: García → AFP Profuturo(F), saldo, sueldo=12850 (was sp=${garciaOrig.sistemaPension}, sueldo=${garciaOrig.sueldoBaseMensual})`);

    // Huerta (43760364) — AFP Profuturo flujo, sueldo 1130
    const [huertaRow] = await db.select().from(schema.empleados).where(eq(schema.empleados.numDoc, DNI_HUERTA)).limit(1);
    assert.ok(huertaRow, `Huerta (DNI ${DNI_HUERTA}) must exist`);
    huertaOrig = {
      sistemaPension: huertaRow.sistemaPension ?? null,
      afpComisionTipo: huertaRow.afpComisionTipo ?? null,
      sueldoBaseMensual: huertaRow.sueldoBaseMensual ?? null,
      tipoPlanilla: huertaRow.tipoPlanilla ?? null,
      activo: huertaRow.activo ?? null,
    };
    await db.update(schema.empleados).set({
      sistemaPension: 'AFP Profuturo(F)',
      afpComisionTipo: 'flujo',
      sueldoBaseMensual: '1130',
      tipoPlanilla: 'admin',
      activo: true,
    }).where(eq(schema.empleados.numDoc, DNI_HUERTA));
    console.log(`  setup: Huerta → AFP Profuturo(F), flujo, sueldo=1130 (was sp=${huertaOrig.sistemaPension}, tipo=${huertaOrig.afpComisionTipo})`);

    // Bautista (47349935) — ONP, sueldo 5000
    const [bautistaRow] = await db.select().from(schema.empleados).where(eq(schema.empleados.numDoc, DNI_BAUTISTA)).limit(1);
    assert.ok(bautistaRow, `Bautista (DNI ${DNI_BAUTISTA}) must exist`);
    bautistaOrig = {
      sistemaPension: bautistaRow.sistemaPension ?? null,
      afpComisionTipo: bautistaRow.afpComisionTipo ?? null,
      sueldoBaseMensual: bautistaRow.sueldoBaseMensual ?? null,
      tipoPlanilla: bautistaRow.tipoPlanilla ?? null,
      activo: bautistaRow.activo ?? null,
    };
    await db.update(schema.empleados).set({
      sistemaPension: 'ONP',
      sueldoBaseMensual: '5000',
      tipoPlanilla: 'admin',
      activo: true,
    }).where(eq(schema.empleados.numDoc, DNI_BAUTISTA));
    console.log(`  setup: Bautista → ONP, sueldo=5000 (was sp=${bautistaOrig.sistemaPension})`);

    // Yangari (73653370) — ONP, sueldo 3100, cese/prorrateo 29 días of a 31-day month
    const [yangariRow] = await db.select().from(schema.empleados).where(eq(schema.empleados.numDoc, DNI_YANGARI)).limit(1);
    assert.ok(yangariRow, `Yangari (DNI ${DNI_YANGARI}) must exist`);
    yangariOrig = {
      sistemaPension: yangariRow.sistemaPension ?? null,
      afpComisionTipo: yangariRow.afpComisionTipo ?? null,
      sueldoBaseMensual: yangariRow.sueldoBaseMensual ?? null,
      tipoPlanilla: yangariRow.tipoPlanilla ?? null,
      activo: yangariRow.activo ?? null,
    };
    await db.update(schema.empleados).set({
      sistemaPension: 'ONP',
      sueldoBaseMensual: '3100',
      tipoPlanilla: 'admin',
      activo: true,
    }).where(eq(schema.empleados.numDoc, DNI_YANGARI));
    console.log(`  setup: Yangari → ONP, sueldo=3100, admin, activo (was activo=${yangariOrig.activo}, sueldo=${yangariOrig.sueldoBaseMensual})`);

    // ── B-1: Recalcular con los anchor employees actualizados ──
    const r4 = await post(`/api/oficina/planilla/${testMesId}/calcular`, {});
    assert.equal(r4.status, 200, `POST calcular (v2 anchors) status ${r4.status}`);
    const j4 = await r4.json() as { mes: any; detalle: any[] };
    assert.equal(j4.mes.estado, 'calculada');

    // Verify calculoSnapshot was written
    const [mesAfterCalc] = await db.select().from(schema.planillaOficinaMes).where(eq(schema.planillaOficinaMes.id, testMesId!)).limit(1);
    assert.ok(mesAfterCalc?.calculoSnapshot, 'calculoSnapshot must be set on mes row');
    const snap = mesAfterCalc!.calculoSnapshot as any;
    assert.ok(snap.param, 'calculoSnapshot.param must exist');
    assert.ok(snap.afps, 'calculoSnapshot.afps must exist');
    assert.ok(snap.porTrabajador, 'calculoSnapshot.porTrabajador must exist');
    console.log(`  ✓ B-1. calcular v2 completado, detalle count=${j4.detalle.length}, snapshot OK`);

    // ── B-2: Assert AUTO anchor values (from Excel, NOT computed via the engine) ──
    const dets = await db
      .select()
      .from(schema.planillaOficinaDetalle)
      .where(eq(schema.planillaOficinaDetalle.planillaMesId, testMesId!));
    const byDni: Record<string, typeof dets[0]> = {};
    for (const d of dets) if (d.dni) byDni[d.dni] = d;

    // ── García AUTO anchors (renta-5ta-independent, tol 0.01) ──
    // Excel July 2026: sueldo=12850, AFP Profuturo saldo, full month
    //   totalBruto=12850, afpAporte=12850×0.10=1285, afpSeguro=topeRma(12599.27)×0.0137≈172.61,
    //   afpComision=0 (saldo mode), essalud=12850×0.09=1156.50
    assert.ok(byDni[DNI_GARCIA], `detalle for García (${DNI_GARCIA}) must exist`);
    const garciaTotalBruto = Number(byDni[DNI_GARCIA]!.totalBruto);
    const garciaAfpAporte  = Number(byDni[DNI_GARCIA]!.afpAporte);
    const garciaAfpSeguro  = Number(byDni[DNI_GARCIA]!.afpSeguro);
    const garciaAfpComision = Number(byDni[DNI_GARCIA]!.afpComision);
    const garciaEssalud    = Number(byDni[DNI_GARCIA]!.essalud);
    assert.ok(Math.abs(garciaTotalBruto - 12850) <= 0.01,   `García totalBruto=${garciaTotalBruto} must be 12850 (tol 0.01)`);
    assert.ok(Math.abs(garciaAfpAporte  -  1285) <= 0.01,   `García afpAporte=${garciaAfpAporte} must be 1285 (tol 0.01)`);
    assert.ok(Math.abs(garciaAfpSeguro  -  172.61) <= 0.01, `García afpSeguro=${garciaAfpSeguro} must be 172.61 (tol 0.01)`);
    assert.ok(Math.abs(garciaAfpComision -   0) <= 0.01,    `García afpComision=${garciaAfpComision} must be 0 (saldo, tol 0.01)`);
    assert.ok(Math.abs(garciaEssalud    - 1156.50) <= 0.01, `García essalud=${garciaEssalud} must be 1156.50 (tol 0.01)`);
    console.log(`  ✓ B-2a. García AUTO: totalBruto=${garciaTotalBruto}, afpAporte=${garciaAfpAporte}, afpSeguro=${garciaAfpSeguro}, afpComision=${garciaAfpComision}, essalud=${garciaEssalud}`);

    // ── Huerta AUTO anchors (tol 0.01) ──
    // Excel July 2026: sueldo=1130, AFP Profuturo flujo, full month
    //   afpAporte=1130×0.10=113, afpSeguro=1130×0.0137=15.48 (below topeRma), afpComision=1130×0.0169=19.10, neto=982.42
    assert.ok(byDni[DNI_HUERTA], `detalle for Huerta (${DNI_HUERTA}) must exist`);
    const huertaAfpAporte  = Number(byDni[DNI_HUERTA]!.afpAporte);
    const huertaAfpSeguro  = Number(byDni[DNI_HUERTA]!.afpSeguro);
    const huertaAfpComision = Number(byDni[DNI_HUERTA]!.afpComision);
    const huertaNeto       = Number(byDni[DNI_HUERTA]!.netoPago);
    assert.ok(Math.abs(huertaAfpAporte  -  113)    <= 0.01, `Huerta afpAporte=${huertaAfpAporte} must be 113 (tol 0.01)`);
    assert.ok(Math.abs(huertaAfpSeguro  -   15.48) <= 0.01, `Huerta afpSeguro=${huertaAfpSeguro} must be 15.48 (tol 0.01)`);
    assert.ok(Math.abs(huertaAfpComision -  19.10) <= 0.01, `Huerta afpComision=${huertaAfpComision} must be 19.10 (tol 0.01)`);
    assert.ok(Math.abs(huertaNeto       -  982.42) <= 0.01, `Huerta neto=${huertaNeto} must be 982.42 (tol 0.01)`);
    console.log(`  ✓ B-2b. Huerta AUTO: afpAporte=${huertaAfpAporte}, afpSeguro=${huertaAfpSeguro}, afpComision=${huertaAfpComision}, neto=${huertaNeto}`);

    // ── Bautista AUTO anchors (tol 0.01) ──
    // Excel July 2026: sueldo=5000, ONP, full month → onp=5000×0.13=650, essalud=5000×0.09=450
    assert.ok(byDni[DNI_BAUTISTA], `detalle for Bautista (${DNI_BAUTISTA}) must exist`);
    const bautistaOnp     = Number(byDni[DNI_BAUTISTA]!.onp);
    const bautistaEssalud = Number(byDni[DNI_BAUTISTA]!.essalud);
    assert.ok(Math.abs(bautistaOnp     - 650) <= 0.01, `Bautista onp=${bautistaOnp} must be 650 (tol 0.01)`);
    assert.ok(Math.abs(bautistaEssalud - 450) <= 0.01, `Bautista essalud=${bautistaEssalud} must be 450 (tol 0.01)`);
    console.log(`  ✓ B-2c. Bautista AUTO: onp=${bautistaOnp}, essalud=${bautistaEssalud}`);

    // Summary: sum of neto must be > 0
    const totalNeto = dets.reduce((s, d) => s + Number(d.netoPago ?? 0), 0);
    assert.ok(totalNeto > 0, `suma neto (${totalNeto}) must be > 0`);
    console.log(`  ✓ B-2d. totalNeto across all rows = ${totalNeto.toFixed(2)}`);

    // ── B-3: Yangari prorrateo — PATCH diasTrab=29 (of 31-day July), assert literals ──
    // Excel: sueldo=3100, ONP, 29/31 días → totalBruto≈2900 (3100×29/31), onp≈377 (2900×0.13)
    assert.ok(byDni[DNI_YANGARI], `detalle for Yangari (${DNI_YANGARI}) must exist`);
    const yangariDet = byDni[DNI_YANGARI]!;
    const rPatchYangari = await patch(`/api/oficina/planilla-detalle/${yangariDet.id}`, { diasTrab: 29 });
    assert.equal(rPatchYangari.status, 200, `PATCH Yangari diasTrab=29 status ${rPatchYangari.status}`);
    const jPatchYangari = await rPatchYangari.json() as { detalle: any };
    const yangariTotalBruto = Number(jPatchYangari.detalle.total_bruto ?? jPatchYangari.detalle.totalBruto);
    const yangariOnp        = Number(jPatchYangari.detalle.onp);
    // 3100 × 29/31 = 2900.00 (exact); onp = 2900 × 0.13 = 377.00
    const expectedYangariTotalBruto = Math.round(3100 * 29 / 31 * 100) / 100; // ≈ 2900.00
    const expectedYangariOnp        = Math.round(expectedYangariTotalBruto * 0.13 * 100) / 100; // ≈ 377.00
    assert.ok(
      Math.abs(yangariTotalBruto - expectedYangariTotalBruto) <= 0.01,
      `Yangari totalBruto=${yangariTotalBruto} must be ≈${expectedYangariTotalBruto} (29/31 prorrateo, tol 0.01)`,
    );
    assert.ok(
      Math.abs(yangariOnp - expectedYangariOnp) <= 0.01,
      `Yangari onp=${yangariOnp} must be ≈${expectedYangariOnp} (tol 0.01)`,
    );
    console.log(`  ✓ B-3. Yangari prorrateo: diasTrab=29/31, totalBruto=${yangariTotalBruto} (expected≈${expectedYangariTotalBruto}), onp=${yangariOnp} (expected≈${expectedYangariOnp})`);

    // ── B-4: García neto via PRODUCTION-HONEST override path ──
    // García's renta5ta = 1120 is a manual value in real production.
    // PATCH García detalle imptoRenta5ta=1120 → sets renta5taManual=true.
    // Recalcular → must preserve 1120.
    // Then assert netoPago ≈ 10272.39 (Excel literal, tol 0.01).
    const garciaDet = byDni[DNI_GARCIA]!;
    const rPatchGarcia = await patch(`/api/oficina/planilla-detalle/${garciaDet.id}`, { imptoRenta5ta: 1120 });
    assert.equal(rPatchGarcia.status, 200, `PATCH García imptoRenta5ta=1120 status ${rPatchGarcia.status}`);
    const jPatchGarcia = await rPatchGarcia.json() as { detalle: any };
    assert.ok(
      jPatchGarcia.detalle.renta5taManual ?? jPatchGarcia.detalle.renta5ta_manual,
      'García renta5taManual must be true after PATCH',
    );
    console.log(`  ✓ B-4a. García renta5taManual=true after PATCH imptoRenta5ta=1120`);

    // Recalcular — must NOT overwrite the manual renta5ta
    const r5 = await post(`/api/oficina/planilla/${testMesId}/calcular`, {});
    assert.equal(r5.status, 200, `POST calcular (after García override) status ${r5.status}`);

    const dets2 = await db
      .select()
      .from(schema.planillaOficinaDetalle)
      .where(eq(schema.planillaOficinaDetalle.planillaMesId, testMesId!));
    const byDni2: Record<string, typeof dets2[0]> = {};
    for (const d of dets2) if (d.dni) byDni2[d.dni] = d;

    const garciaAfterCalc = byDni2[DNI_GARCIA]!;
    assert.ok(garciaAfterCalc, 'García detalle must exist after recalcular');
    const garciaRentaAfter = Number(garciaAfterCalc.imptoRenta5ta);
    assert.ok(
      Math.abs(garciaRentaAfter - 1120) <= 0.01,
      `García imptoRenta5ta=${garciaRentaAfter} must remain 1120 (manual preserved), tol 0.01`,
    );
    assert.ok(garciaAfterCalc.renta5taManual, `García renta5taManual must remain true after recalcular, got ${garciaAfterCalc.renta5taManual}`);

    const garciaNetoAfterOverride = Number(garciaAfterCalc.netoPago);
    // Excel literal: neto=10272.39 = totalBruto(12850) − afpAporte(1285) − afpSeguro(172.61) − afpComision(0) − renta5ta(1120)
    assert.ok(
      Math.abs(garciaNetoAfterOverride - 10272.39) <= 0.01,
      `García netoPago=${garciaNetoAfterOverride} must be 10272.39 (Excel literal, tol 0.01)`,
    );
    console.log(`  ✓ B-4b. García override preserved: imptoRenta5ta=${garciaRentaAfter}, netoPago=${garciaNetoAfterOverride} (Excel=10272.39)`);

    // ── B-5: Override preservation test (Bautista) ──
    const bautistaDet = byDni2[DNI_BAUTISTA]!;
    assert.ok(bautistaDet, 'Bautista detalle must exist after recalcular');
    const rPatchBautista = await patch(`/api/oficina/planilla-detalle/${bautistaDet.id}`, { imptoRenta5ta: 500 });
    assert.equal(rPatchBautista.status, 200, `PATCH Bautista imptoRenta5ta=500 status ${rPatchBautista.status}`);
    const jPatchBautista = await rPatchBautista.json() as { detalle: any };
    assert.ok(jPatchBautista.detalle.renta5taManual ?? jPatchBautista.detalle.renta5ta_manual, 'renta5taManual must be true after PATCH');
    console.log(`  ✓ B-5a. Bautista renta5taManual=true after PATCH imptoRenta5ta=500`);

    // Recalcular — must NOT overwrite the manual renta5ta
    const r6 = await post(`/api/oficina/planilla/${testMesId}/calcular`, {});
    assert.equal(r6.status, 200, `POST calcular (after Bautista override) status ${r6.status}`);

    const dets3 = await db
      .select()
      .from(schema.planillaOficinaDetalle)
      .where(eq(schema.planillaOficinaDetalle.planillaMesId, testMesId!));
    const byDni3: Record<string, typeof dets3[0]> = {};
    for (const d of dets3) if (d.dni) byDni3[d.dni] = d;

    const bautistaAfterCalc = byDni3[DNI_BAUTISTA]!;
    assert.ok(bautistaAfterCalc, 'Bautista detalle must exist after recalcular');
    const bautistaRentaAfter = Number(bautistaAfterCalc.imptoRenta5ta);
    assert.ok(
      Math.abs(bautistaRentaAfter - 500) <= 0.01,
      `Bautista imptoRenta5ta=${bautistaRentaAfter} must remain 500 (manual preserved), tol 0.01`,
    );
    assert.ok(bautistaAfterCalc.renta5taManual, `Bautista renta5taManual must remain true after recalcular, got ${bautistaAfterCalc.renta5taManual}`);
    console.log(`  ✓ B-5b. Override preserved: Bautista imptoRenta5ta=${bautistaRentaAfter} (manual=true) after recalcular`);

    console.log('\n  planilla-flow VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
    if (e?.stack) console.error(e.stack);
  } finally {
    // ── Cleanup ──
    if (testMesId) {
      // Reopen if cerrada before deleting (cascade deletes planilla_oficina_detalle)
      const [mesRow] = await db.select().from(schema.planillaOficinaMes).where(eq(schema.planillaOficinaMes.id, testMesId)).limit(1).catch(() => []);
      if (mesRow?.estado === 'cerrada') {
        // delete asiento if linked
        if (mesRow.asientoId) {
          await db.delete(schema.asientos).where(eq(schema.asientos.id, mesRow.asientoId)).catch(() => {});
        }
        await db.update(schema.planillaOficinaMes).set({ estado: 'calculada', asientoId: null }).where(eq(schema.planillaOficinaMes.id, testMesId)).catch(() => {});
      }
      await db.delete(schema.planillaOficinaMes).where(eq(schema.planillaOficinaMes.id, testMesId)).catch(() => {});
    }
    if (testEmpleadoId) {
      await db.delete(schema.empleados).where(eq(schema.empleados.id, testEmpleadoId)).catch(() => {});
    }

    // ── Restore ALL anchor employee attributes ──
    if (garciaOrig !== null) {
      await db.update(schema.empleados)
        .set({
          sistemaPension: garciaOrig.sistemaPension,
          afpComisionTipo: garciaOrig.afpComisionTipo ?? 'saldo',
          sueldoBaseMensual: garciaOrig.sueldoBaseMensual,
          tipoPlanilla: garciaOrig.tipoPlanilla ?? 'admin',
          activo: garciaOrig.activo ?? true,
        })
        .where(eq(schema.empleados.numDoc, DNI_GARCIA))
        .catch(() => {});
    }
    if (huertaOrig !== null) {
      await db.update(schema.empleados)
        .set({
          sistemaPension: huertaOrig.sistemaPension,
          afpComisionTipo: huertaOrig.afpComisionTipo ?? 'saldo',
          sueldoBaseMensual: huertaOrig.sueldoBaseMensual,
          tipoPlanilla: huertaOrig.tipoPlanilla ?? 'admin',
          activo: huertaOrig.activo ?? true,
        })
        .where(eq(schema.empleados.numDoc, DNI_HUERTA))
        .catch(() => {});
    }
    if (bautistaOrig !== null) {
      await db.update(schema.empleados)
        .set({
          sistemaPension: bautistaOrig.sistemaPension,
          afpComisionTipo: bautistaOrig.afpComisionTipo ?? 'saldo',
          sueldoBaseMensual: bautistaOrig.sueldoBaseMensual,
          tipoPlanilla: bautistaOrig.tipoPlanilla ?? 'admin',
          activo: bautistaOrig.activo ?? true,
        })
        .where(eq(schema.empleados.numDoc, DNI_BAUTISTA))
        .catch(() => {});
    }
    if (yangariOrig !== null) {
      await db.update(schema.empleados)
        .set({
          sistemaPension: yangariOrig.sistemaPension,
          afpComisionTipo: yangariOrig.afpComisionTipo ?? 'saldo',
          sueldoBaseMensual: yangariOrig.sueldoBaseMensual,
          tipoPlanilla: yangariOrig.tipoPlanilla ?? 'obrero',
          activo: yangariOrig.activo ?? false,
        })
        .where(eq(schema.empleados.numDoc, DNI_YANGARI))
        .catch(() => {});
    }

    // NO afp_tasas cleanup — we did NOT insert any fake rows

    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})();
