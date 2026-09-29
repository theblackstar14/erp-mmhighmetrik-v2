/**
 * Task 6 · Test integral planilla oficina v2 (motor, params legales, YTD, snapshot).
 * Prueba original (Task 4 / C-2) + nuevos casos v2 (julio 2026 anchors + override manual).
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
const DNI_GARCIA   = '48448443'; // AFP Profuturo saldo
const DNI_HUERTA   = '43760364'; // AFP Profuturo flujo → afpComision 19.10
const DNI_BAUTISTA = '47349935'; // ONP → onp 650
const DNI_YANGARI  = '73653370'; // prorrateo test

let testEmpleadoId: string | null = null;
let testMesId: string | null = null;

// Track which anchor employees we modified so we can restore them
let huertaOriginalSP: string | null = null;
let huertaOriginalAfpTipo: string | null = null;
let bautistaOriginalSP: string | null = null;
let yangariOriginalActivo: boolean = false;

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
    // ══════════════════════════════════════════════════════════
    console.log('\n════ planilla-flow · Task 6 (v2 anchors julio 2026) ════');

    // ── B-SETUP: ensure anchor employees have correct attributes ──
    // Huerta → AFP Profuturo(F), afpComisionTipo=flujo
    const [huertaRow] = await db.select().from(schema.empleados).where(eq(schema.empleados.numDoc, DNI_HUERTA)).limit(1);
    assert.ok(huertaRow, `Huerta (DNI ${DNI_HUERTA}) must exist`);
    huertaOriginalSP = huertaRow.sistemaPension;
    huertaOriginalAfpTipo = huertaRow.afpComisionTipo;
    await db.update(schema.empleados).set({ sistemaPension: 'AFP Profuturo(F)', afpComisionTipo: 'flujo', tipoPlanilla: 'admin', activo: true }).where(eq(schema.empleados.numDoc, DNI_HUERTA));
    console.log(`  setup: Huerta → AFP Profuturo(F), flujo (was sp=${huertaOriginalSP}, tipo=${huertaOriginalAfpTipo})`);

    // Bautista → ONP, sueldo 5000, tipoPlanilla=admin, activo=true
    const [bautistaRow] = await db.select().from(schema.empleados).where(eq(schema.empleados.numDoc, DNI_BAUTISTA)).limit(1);
    assert.ok(bautistaRow, `Bautista (DNI ${DNI_BAUTISTA}) must exist`);
    bautistaOriginalSP = bautistaRow.sistemaPension;
    await db.update(schema.empleados).set({ sistemaPension: 'ONP', sueldoBaseMensual: '5000', tipoPlanilla: 'admin', activo: true }).where(eq(schema.empleados.numDoc, DNI_BAUTISTA));
    console.log(`  setup: Bautista → ONP, sueldo=5000 (was sp=${bautistaOriginalSP})`);

    // García → ensure saldo, admin, activo
    await db.update(schema.empleados).set({ afpComisionTipo: 'saldo', tipoPlanilla: 'admin', activo: true }).where(eq(schema.empleados.numDoc, DNI_GARCIA));
    console.log(`  setup: García → afpComisionTipo=saldo, admin, activo`);

    // Yangari → ensure admin, activo (for prorrateo sub-test)
    const [yangariRow] = await db.select().from(schema.empleados).where(eq(schema.empleados.numDoc, DNI_YANGARI)).limit(1);
    assert.ok(yangariRow, `Yangari (DNI ${DNI_YANGARI}) must exist`);
    yangariOriginalActivo = yangariRow.activo ?? false;
    await db.update(schema.empleados).set({ tipoPlanilla: 'admin', activo: true }).where(eq(schema.empleados.numDoc, DNI_YANGARI));
    console.log(`  setup: Yangari → admin, activo (was activo=${yangariOriginalActivo})`);

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

    // ── B-2: Assert anchor values ──
    const dets = await db
      .select()
      .from(schema.planillaOficinaDetalle)
      .where(eq(schema.planillaOficinaDetalle.planillaMesId, testMesId!));
    const byDni: Record<string, typeof dets[0]> = {};
    for (const d of dets) if (d.dni) byDni[d.dni] = d;

    // Compute expected García neto using the exact engine (v2, no YTD)
    const garciaRow = await db.select().from(schema.empleados).where(eq(schema.empleados.numDoc, DNI_GARCIA)).limit(1);
    const garciaSueldo = Number(garciaRow[0]!.sueldoBaseMensual ?? 0);
    const garciaRenta5ta = calcularRta5ta({
      sueldoMensual: garciaSueldo, mesNumero: 7, mesIngreso: 1,
      acumuladoPercibidoAntes: 0, retencionesPrevias: 0, uit: param.uit,
    }).retencionMes;
    const garciaTasas = {
      rmv: param.rmv, uit: param.uit, topeRma: param.topeRma,
      pctEssalud: param.pctEssalud, pctOnp: param.pctOnp,
      pctAfpAporte: param.pctAfpAporte, pctAsigFamiliar: param.pctAsigFamiliar,
      afp: afps['AFP PROFUTURO'],
    };
    const garciaExpected = calcularDetalleOficina({
      sueldoMensual: garciaSueldo, sistemaPension: 'AFP',
      afpComisionTipo: 'saldo', modalidadFormativa: false, asignacionFamiliar: false,
      imptoRenta5ta: garciaRenta5ta, diasTrab: 31, diasMes: 31,
    }, garciaTasas);

    assert.ok(byDni[DNI_GARCIA], `detalle for García (${DNI_GARCIA}) must exist`);
    const garciaActualNeto = Number(byDni[DNI_GARCIA]!.netoPago);
    assert.ok(
      Math.abs(garciaActualNeto - garciaExpected.netoPago) <= 0.01,
      `García neto=${garciaActualNeto} must match engine=${garciaExpected.netoPago} (tol 0.01)`,
    );
    console.log(`  ✓ B-2a. García neto=${garciaActualNeto} (expected=${garciaExpected.netoPago})`);

    // Huerta: afpComision=19.10, neto=982.42
    assert.ok(byDni[DNI_HUERTA], `detalle for Huerta (${DNI_HUERTA}) must exist`);
    const huertaAfpComision = Number(byDni[DNI_HUERTA]!.afpComision);
    const huertaNeto = Number(byDni[DNI_HUERTA]!.netoPago);
    assert.ok(Math.abs(huertaAfpComision - 19.10) <= 0.01, `Huerta afpComision=${huertaAfpComision} must be 19.10 (tol 0.01)`);
    assert.ok(Math.abs(huertaNeto - 982.42) <= 0.01, `Huerta neto=${huertaNeto} must be 982.42 (tol 0.01)`);
    console.log(`  ✓ B-2b. Huerta afpComision=${huertaAfpComision}, neto=${huertaNeto}`);

    // Bautista: onp=650
    assert.ok(byDni[DNI_BAUTISTA], `detalle for Bautista (${DNI_BAUTISTA}) must exist`);
    const bautistaOnp = Number(byDni[DNI_BAUTISTA]!.onp);
    assert.ok(Math.abs(bautistaOnp - 650) <= 0.01, `Bautista onp=${bautistaOnp} must be 650 (tol 0.01)`);
    console.log(`  ✓ B-2c. Bautista onp=${bautistaOnp}`);

    // Yangari exists in detalle
    assert.ok(byDni[DNI_YANGARI], `detalle for Yangari (${DNI_YANGARI}) must exist`);

    // Summary: sum of neto must be > 0
    const totalNeto = dets.reduce((s, d) => s + Number(d.netoPago ?? 0), 0);
    assert.ok(totalNeto > 0, `suma neto (${totalNeto}) must be > 0`);
    console.log(`  ✓ B-2d. totalNeto across all rows = ${totalNeto.toFixed(2)}`);

    // ── B-3: Prorrateo sub-test — PATCH Yangari diasTrab=15, recalcular, verify prorrateo ──
    const yangariDet = byDni[DNI_YANGARI]!;
    const rPatchYangari = await patch(`/api/oficina/planilla-detalle/${yangariDet.id}`, { diasTrab: 15 });
    assert.equal(rPatchYangari.status, 200, `PATCH Yangari diasTrab=15 status ${rPatchYangari.status}`);
    const jPatchYangari = await rPatchYangari.json() as { detalle: any };
    const yangariSueldoProrrateado = Number(jPatchYangari.detalle.sueldoMensual ?? jPatchYangari.detalle.sueldo_mensual);
    const yangariSueldoBase = Number(yangariRow.sueldoBaseMensual ?? 0);
    // After prorrateo: sueldoMensual (column = prorrateado) < full sueldo
    assert.ok(
      yangariSueldoProrrateado < yangariSueldoBase,
      `Yangari prorrateado (${yangariSueldoProrrateado}) must be < sueldo base (${yangariSueldoBase})`,
    );
    console.log(`  ✓ B-3. Yangari prorrateo: diasTrab=15, sueldoProrrateado=${yangariSueldoProrrateado} < base=${yangariSueldoBase}`);

    // ── B-4: Override sub-test (Kelly manual renta5ta) ──
    // PATCH Bautista imptoRenta5ta=500 (mark renta5taManual=true)
    const bautistaDet = byDni[DNI_BAUTISTA]!;
    const rPatchBautista = await patch(`/api/oficina/planilla-detalle/${bautistaDet.id}`, { imptoRenta5ta: 500 });
    assert.equal(rPatchBautista.status, 200, `PATCH Bautista imptoRenta5ta=500 status ${rPatchBautista.status}`);
    const jPatchBautista = await rPatchBautista.json() as { detalle: any };
    assert.ok(jPatchBautista.detalle.renta5taManual ?? jPatchBautista.detalle.renta5ta_manual, 'renta5taManual must be true after PATCH');
    console.log(`  ✓ B-4a. Bautista renta5taManual=true after PATCH imptoRenta5ta=500`);

    // Recalcular — must NOT overwrite the manual renta5ta
    const r5 = await post(`/api/oficina/planilla/${testMesId}/calcular`, {});
    assert.equal(r5.status, 200, `POST calcular (after override) status ${r5.status}`);

    const dets2 = await db
      .select()
      .from(schema.planillaOficinaDetalle)
      .where(eq(schema.planillaOficinaDetalle.planillaMesId, testMesId!));
    const byDni2: Record<string, typeof dets2[0]> = {};
    for (const d of dets2) if (d.dni) byDni2[d.dni] = d;

    const bautistaAfterCalc = byDni2[DNI_BAUTISTA]!;
    assert.ok(bautistaAfterCalc, 'Bautista detalle must exist after recalcular');
    const bautistaRentaAfter = Number(bautistaAfterCalc.imptoRenta5ta);
    assert.ok(
      Math.abs(bautistaRentaAfter - 500) <= 0.01,
      `Bautista imptoRenta5ta=${bautistaRentaAfter} must remain 500 (manual preserved), tol 0.01`,
    );
    const bautistaManualFlagAfter = bautistaAfterCalc.renta5taManual;
    assert.ok(bautistaManualFlagAfter, `Bautista renta5taManual must remain true after recalcular, got ${bautistaManualFlagAfter}`);
    console.log(`  ✓ B-4b. Override preserved: Bautista imptoRenta5ta=${bautistaRentaAfter} (manual=true) after recalcular`);

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

    // Restore anchor employee attributes
    if (huertaOriginalSP !== null) {
      await db.update(schema.empleados)
        .set({ sistemaPension: huertaOriginalSP, afpComisionTipo: huertaOriginalAfpTipo ?? 'saldo' })
        .where(eq(schema.empleados.numDoc, DNI_HUERTA))
        .catch(() => {});
    }
    if (bautistaOriginalSP !== null) {
      await db.update(schema.empleados)
        .set({ sistemaPension: bautistaOriginalSP })
        .where(eq(schema.empleados.numDoc, DNI_BAUTISTA))
        .catch(() => {});
    }
    if (!yangariOriginalActivo) {
      await db.update(schema.empleados)
        .set({ activo: false })
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
