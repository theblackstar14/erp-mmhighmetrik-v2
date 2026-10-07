/**
 * WS-1 · Prueba de regresión reproducible (hardening).
 * Corre el ciclo completo contra erp_mmh_test y asevera invariantes.
 *   node --import tsx apps/backend/scripts/ws1/regression.ts
 * Cubre: dry-run → commit → invariantes → re-run NO-OP → input modificado ERROR →
 *        cambio de fecha ERROR → rollback → re-commit → invariantes ·
 *        + idempotencia de aplicaciones (N↔M) + saldo derivado + ORM read/write.
 * Deja la apertura de prueba cargada y cuadrada al terminar. Exit 0 = verde.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { db, schema } from '@erp/db';
import { and, eq, sql as dsql } from 'drizzle-orm';

const MG_RUC = '00000000002';
const MG_ID = 2;
const SCRIPT = 'apps/backend/scripts/ws1/apertura.ts';
const FIX = 'apps/backend/scripts/ws1/apertura_prueba_MG.xlsx';
const EPS = 0.005;

const TSX_CLI = 'apps/backend/node_modules/tsx/dist/cli.mjs';
// corre el script real de apertura como proceso hijo (fiel al CLI). Devuelve {code, out}.
function apertura(args: string[]) {
  const r = spawnSync(process.execPath, [TSX_CLI, SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test' },
  });
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

// genera un xlsx derivado del fixture con mutaciones {sheet: (rows)=>void, meta:{clave:valor}}
function mutateFixture(out: string, mut: { sheets?: Record<string, (rows: any[]) => void>; meta?: Record<string, string> }) {
  const wb = XLSX.read(readFileSync(FIX), { cellDates: true });
  if (mut.sheets)
    for (const [name, fn] of Object.entries(mut.sheets)) {
      const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[name]);
      fn(rows);
      wb.Sheets[name] = XLSX.utils.json_to_sheet(rows);
    }
  if (mut.meta) {
    const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets['META']);
    for (const [k, v] of Object.entries(mut.meta)) {
      const r = rows.find((x: any) => String(x.clave) === k);
      if (r) r.valor = v; else rows.push({ clave: k, valor: v });
    }
    wb.Sheets['META'] = XLSX.utils.json_to_sheet(rows);
  }
  writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ── lecturas ORM (task 1b: el ORM lee las nuevas estructuras sin SQL raw) ──
async function aperturaCount() {
  const rows = await db.select({ n: dsql<number>`count(*)::int` }).from(schema.asientos)
    .where(and(eq(schema.asientos.empresaId, MG_ID), eq(schema.asientos.origen, 'apertura'), dsql`${schema.asientos.status} <> 'anulado'`));
  return rows[0]?.n ?? 0;
}
async function invariantes() {
  // Σdebe=Σhaber (apertura MG)
  const [sumas] = await db.select({
    debe: dsql<number>`coalesce(sum(${schema.asientosLineas.debe}),0)::float8`,
    haber: dsql<number>`coalesce(sum(${schema.asientosLineas.haber}),0)::float8`,
  }).from(schema.asientosLineas).innerJoin(schema.asientos, eq(schema.asientos.id, schema.asientosLineas.asientoId))
    .where(and(eq(schema.asientos.empresaId, MG_ID), eq(schema.asientos.origen, 'apertura')));
  assert(Math.abs(Number(sumas.debe) - Number(sumas.haber)) < EPS, `Σdebe(${sumas.debe})≠Σhaber(${sumas.haber})`);

  // sub-mayor == mayor por cuenta control (empresa MG)
  const docs = await db.select().from(schema.documentoPendiente).where(eq(schema.documentoPendiente.empresaId, MG_ID));
  const subByCtrl = new Map<string, number>();
  for (const d of docs) {
    const signo = d.tipo === 'cxc' ? 1 : -1;
    subByCtrl.set(d.cuentaControl, (subByCtrl.get(d.cuentaControl) ?? 0) + signo * Number(d.montoPen));
    // saldo derivable: en apertura saldo == monto (0 aplicaciones)
    assert(Math.abs(Number(d.saldoPendiente) - Number(d.montoOriginal)) < EPS, `saldo≠monto en ${d.docSerie}-${d.docNumero}`);
  }
  const lineas = await db.select({ cta: schema.asientosLineas.cuentaContable, mayor: dsql<number>`sum(${schema.asientosLineas.debe}-${schema.asientosLineas.haber})::float8` })
    .from(schema.asientosLineas).innerJoin(schema.asientos, eq(schema.asientos.id, schema.asientosLineas.asientoId))
    .where(and(eq(schema.asientos.empresaId, MG_ID), dsql`${schema.asientosLineas.cuentaContable} in ('1212','4212')`))
    .groupBy(schema.asientosLineas.cuentaContable);
  for (const l of lineas) {
    const sub = subByCtrl.get(l.cta!) ?? 0;
    assert(Math.abs(Number(l.mayor) - sub) < EPS, `sub-mayor≠mayor en ${l.cta}: ${sub} vs ${l.mayor}`);
  }
  return { debe: Number(sumas.debe), controles: lineas.length, docs: docs.length };
}

function step(label: string) { console.log(`\n▶ ${label}`); }
function ok(msg: string) { console.log(`  ✓ ${msg}`); }

(async () => {
  let failed = false;
  try {
    console.log('════ WS-1 REGRESIÓN ════');

    // 0· pizarra limpia: si hay apertura MG, revertir
    if (await aperturaCount() > 0) { apertura(['--rollback', MG_RUC]); }
    assert.equal(await aperturaCount(), 0, 'MG debe empezar sin apertura');
    ok('estado inicial: MG sin apertura');

    // 1· dry-run
    step('dry-run');
    let r = apertura(['--file', FIX, '--dry-run']);
    assert.equal(r.code, 0, 'dry-run debe salir 0');
    assert.match(r.out, /Validacion OK/, 'dry-run OK');
    assert.equal(await aperturaCount(), 0, 'dry-run no escribe');
    ok('dry-run valida y no escribe');

    // 2· commit + invariantes
    step('commit');
    r = apertura(['--file', FIX, '--commit']);
    assert.equal(r.code, 0, 'commit debe salir 0');
    assert.equal(await aperturaCount(), 1, 'commit crea 1 apertura');
    let inv = await invariantes();
    ok(`commit OK · Σ=${inv.debe} · ${inv.controles} controles · ${inv.docs} docs · invariantes verdes`);

    // 3· re-run mismo Excel = NO-OP
    step('re-run mismo Excel (NO-OP)');
    r = apertura(['--file', FIX, '--commit']);
    assert.equal(r.code, 0, 're-run mismo Excel debe salir 0 (no-op)');
    assert.match(r.out, /NO-OP/, 'debe reportar NO-OP');
    assert.equal(await aperturaCount(), 1, 'sigue habiendo 1 apertura');
    ok('mismo Excel → NO-OP (hash idéntico)');

    // 4· input MODIFICADO (mismo empresa, distinto hash) = ERROR, sin 2ª apertura
    step('input modificado (ERROR)');
    const modFile = join(tmpdir(), 'ws1_mod.xlsx');
    mutateFixture(modFile, { sheets: { CXC: (rows) => { rows[0].monto_original = 31000; rows[0].saldo_pendiente = 31000; }, PATRIMONIO: (rows) => { rows[0].saldo = 95500; } } });
    r = apertura(['--file', modFile, '--commit']);
    assert.notEqual(r.code, 0, 'input modificado debe FALLAR');
    assert.match(r.out, /hash DISTINTO|rollback/, 'debe pedir rollback');
    assert.equal(await aperturaCount(), 1, 'no debe crear 2ª apertura');
    ok('Excel modificado → ERROR, sin 2ª apertura');

    // 5· cambio de FECHA (task 3: distinta fecha ⇒ distinto hash ⇒ mismo bloqueo)
    step('cambio de fecha (ERROR)');
    const dateFile = join(tmpdir(), 'ws1_date.xlsx');
    mutateFixture(dateFile, { meta: { fecha_apertura: '2025-11-30' } });
    r = apertura(['--file', dateFile, '--commit']);
    assert.notEqual(r.code, 0, 'cambio de fecha sobre empresa ya abierta debe FALLAR');
    assert.equal(await aperturaCount(), 1, 'sigue 1 apertura');
    ok('cambio de fecha → ERROR (idempotencia por empresa, no por fecha)');

    // 6· rollback → 0
    step('rollback');
    r = apertura(['--rollback', MG_RUC]);
    assert.equal(r.code, 0, 'rollback debe salir 0');
    assert.equal(await aperturaCount(), 0, 'rollback deja 0 aperturas');
    const [{ dn }] = await db.select({ dn: dsql<number>`count(*)::int` }).from(schema.documentoPendiente).where(eq(schema.documentoPendiente.empresaId, MG_ID));
    assert.equal(Number(dn), 0, 'rollback borra documentos');
    ok('rollback → 0 asientos, 0 documentos');

    // 7· re-cargar tras cambio+rollback (task 3: rollback → re-load funciona)
    step('re-commit tras rollback');
    r = apertura(['--file', dateFile, '--commit']); // ahora sí acepta la fecha nueva
    assert.equal(r.code, 0, 're-commit tras rollback debe salir 0');
    assert.equal(await aperturaCount(), 1, 're-commit crea apertura');
    await invariantes();
    ok('tras rollback se puede recargar (incl. otra fecha) · invariantes verdes');

    // 8· idempotencia de aplicaciones N↔M + saldo derivado + ORM WRITE (todo en tx con ROLLBACK)
    step('N↔M aplicaciones + saldo derivado (ORM write, rolled-back)');
    const SENTINEL = new Error('__rollback__');
    let residuo = -1;
    // Baseline: la tabla ya no es exclusiva de WS1 (hoy la llenan movimientos y notas de
    // crédito), así que "residuo" es lo que SUMÓ esta prueba, no el total de la tabla.
    const [{ dn: aplicAntes }] = await db.select({ dn: dsql<number>`count(*)::int` }).from(schema.aplicacionDocumento);
    try {
      await db.transaction(async (tx) => {
        const docs = await tx.select().from(schema.documentoPendiente).where(eq(schema.documentoPendiente.empresaId, MG_ID)).limit(2);
        const [d1, d2] = docs;
        const [ap] = await tx.select().from(schema.asientos).where(and(eq(schema.asientos.empresaId, MG_ID), eq(schema.asientos.origen, 'apertura'))).limit(1);
        const [a2] = await tx.insert(schema.asientos).values({
          correlativo: 'TMP-REG-NM', fecha: '2025-12-31', periodo: '2025-12', glosa: 'tmp regresión N↔M',
          origen: 'manual', moneda: 'PEN', empresaId: MG_ID, status: 'borrador',
        }).returning();
        // 1 documento (d1) → 2 aplicaciones (ap, a2)   ← N
        await tx.insert(schema.aplicacionDocumento).values({ documentoPendienteId: d1.id, asientoId: ap.id, montoAplicado: '100.00' });
        await tx.insert(schema.aplicacionDocumento).values({ documentoPendienteId: d1.id, asientoId: a2.id, montoAplicado: '50.00' });
        // 1 asiento (ap) → 2 documentos (d1, d2)        ← M
        await tx.insert(schema.aplicacionDocumento).values({ documentoPendienteId: d2.id, asientoId: ap.id, montoAplicado: '30.00' });
        // duplicado (ap,d1) bloqueado por unique → savepoint para no abortar la tx externa
        let dup = false;
        try { await tx.transaction(async (sp) => { await sp.insert(schema.aplicacionDocumento).values({ documentoPendienteId: d1.id, asientoId: ap.id, montoAplicado: '1.00' }); }); }
        catch { dup = true; }
        assert(dup, 'unique(asiento,documento) debe bloquear la aplicación duplicada');
        // saldo DERIVADO de d1 = monto - Σ aplicaciones activas (100+50=150)
        const [{ sumapl }] = await tx.select({ sumapl: dsql<number>`coalesce(sum(${schema.aplicacionDocumento.montoAplicado}),0)::float8` })
          .from(schema.aplicacionDocumento).where(and(eq(schema.aplicacionDocumento.documentoPendienteId, d1.id), eq(schema.aplicacionDocumento.estado, 'activa')));
        const saldoDerivado = Number(d1.montoOriginal) - Number(sumapl);
        assert(Math.abs(saldoDerivado - (Number(d1.montoOriginal) - 150)) < EPS, 'saldo debe derivar de las aplicaciones');
        ok(`N↔M OK · d1→2 aplic, ap→2 docs, duplicado bloqueado, saldo derivado=${saldoDerivado} (monto ${d1.montoOriginal} − 150)`);
        throw SENTINEL; // revertir todo: es una prueba conceptual, sin residuo
      });
    } catch (e) { if (e !== SENTINEL) throw e; }
    [{ dn: residuo }] = await db.select({ dn: dsql<number>`count(*)::int` }).from(schema.aplicacionDocumento) as any;
    assert.equal(Number(residuo), Number(aplicAntes), `la prueba N↔M no debe dejar residuo (rolled-back): ${aplicAntes} → ${residuo}`);
    assert.equal(await aperturaCount(), 1, 'apertura MG intacta tras la prueba');
    ok('cero residuo · saldo_pendiente es derivable, no fuente primaria');

    console.log('\n════════════════════════════════════');
    console.log('  ✅ WS-1 REGRESIÓN: TODO VERDE');
    console.log('════════════════════════════════════\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ REGRESIÓN FALLIDA:', e?.message ?? e, '\n');
  } finally {
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})();
