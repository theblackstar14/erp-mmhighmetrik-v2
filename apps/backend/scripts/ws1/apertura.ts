/**
 * WS-1 · Carga de saldos de APERTURA (migracion de datos, NO formulario).
 * Contrato: docs/superpowers/specs/2026-08-07-ws1-contrato-apertura.md · Modelo WS0 v0.2.1.
 *
 * Uso:
 *   tsx apps/backend/scripts/ws1/apertura.ts --file <xlsx> --dry-run
 *   tsx apps/backend/scripts/ws1/apertura.ts --file <xlsx> --commit
 *   tsx apps/backend/scripts/ws1/apertura.ts --rollback <empresa_ruc>
 *
 * Reglas duras:
 *  - una empresa por ejecucion · una sola transaccion · validacion completa antes del INSERT
 *  - idempotente: mismo Excel = NO-OP (hash); Excel distinto sobre empresa ya abierta = ERROR
 *  - saldo_pendiente NO es fuente de verdad: en apertura = monto_original (0 aplicaciones);
 *    si el Excel trae saldo_pendiente != monto_original -> inconsistencia (abortar).
 *  - no toca frontend, no pagos/aplicaciones, no caminos contables paralelos.
 */
import * as XLSX from 'xlsx';
import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const CONN = process.env.DATABASE_URL ?? 'postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test';

// ── GUARD de entorno: WS-1 solo corre contra DBs de desarrollo permitidas ──
// Aborta si la DB objetivo no está en WS1_ALLOW_DATABASE (default: erp_mmh_test).
// Impide ejecución accidental contra erp_mmh / f4d / producción.
function assertDevDatabase(conn: string): string {
  let dbName = '';
  try { dbName = new URL(conn).pathname.replace(/^\//, ''); } catch { dbName = ''; }
  const allow = (process.env.WS1_ALLOW_DATABASE ?? 'erp_mmh_test').split(',').map((x) => x.trim()).filter(Boolean);
  if (!dbName || !allow.includes(dbName)) {
    console.error(`\n  ✗ GUARD DE ENTORNO: DB objetivo '${dbName || '?'}' NO permitida.`);
    console.error(`    Permitidas (WS1_ALLOW_DATABASE): ${allow.join(', ')}`);
    console.error(`    WS-1 no puede ejecutarse contra esta DB. Aborta.\n`);
    process.exit(2);
  }
  return dbName;
}
const TARGET_DB = assertDevDatabase(CONN);

const sql = postgres(CONN, { max: 4 });
const EPS = 0.005; // tolerancia centavos

// ── args ──────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const has = (k: string) => argv.includes(k);
const MODE = has('--rollback') ? 'rollback' : has('--commit') ? 'commit' : 'dry-run';
const FILE = arg('--file');
const ROLLBACK_RUC = arg('--rollback');
const STRICT_TERCEROS = has('--strict-terceros');
const FAIL_INJECTION = has('--fail-injection'); // prueba de atomicidad (Fase 5): inserta y luego lanza

// ── helpers ───────────────────────────────────────────────────
const n = (v: any) => (v === '' || v == null ? 0 : Number(v));
const s = (v: any) => (v == null ? '' : String(v).trim());
const fdate = (v: any): string | null => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const str = String(v).trim();
  return str.slice(0, 10);
};
const money = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (x: number) => Math.round(x * 100) / 100;

type Doc = {
  cuenta_control: string; tercero_ruc: string; tercero_razon: string;
  doc_tipo: string; doc_serie: string; doc_numero: string;
  fecha_emision: string | null; fecha_venc: string | null;
  moneda: string; tipo_cambio: number; monto_original: number; saldo_pendiente: number;
  obra_codigo: string; monto_pen: number;
};

function fail(msg: string): never {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

function readModel(file: string) {
  const wb = XLSX.read(readFileSync(file), { cellDates: true });
  const sheet = (name: string) => {
    const ws = wb.Sheets[name];
    if (!ws) return [] as any[];
    return XLSX.utils.sheet_to_json<any>(ws, { defval: '' });
  };
  const metaRows = sheet('META');
  const meta: Record<string, string> = {};
  for (const r of metaRows) meta[s(r.clave)] = s(r.valor);

  const empresaRuc = meta['empresa_ruc'];
  const fechaApertura = fdate(meta['fecha_apertura']);
  if (!empresaRuc) fail('META.empresa_ruc ausente');
  if (!fechaApertura) fail('META.fecha_apertura ausente');

  const bancos = sheet('BANCOS').map((r) => ({
    cuenta: s(r.cuenta_contable), moneda: s(r.moneda) || 'PEN', tc: n(r.tipo_cambio), saldo: n(r.saldo),
  }));
  const detracciones = sheet('DETRACCIONES').map((r) => ({ cuenta: s(r.cuenta_contable), saldo: n(r.saldo) }));
  const patrimonio = sheet('PATRIMONIO').map((r) => ({ cuenta: s(r.cuenta_contable), saldo: n(r.saldo) }));

  const mapDoc = (r: any): Doc => {
    const moneda = s(r.moneda) || 'PEN';
    const tc = n(r.tipo_cambio);
    const monto = round2(n(r.monto_original));
    const saldo = r.saldo_pendiente === '' ? monto : round2(n(r.saldo_pendiente));
    const monto_pen = moneda === 'PEN' ? monto : round2(monto * tc);
    return {
      cuenta_control: s(r.cuenta_control), tercero_ruc: s(r.tercero_ruc), tercero_razon: s(r.tercero_razon),
      doc_tipo: s(r.doc_tipo), doc_serie: s(r.doc_serie), doc_numero: s(r.doc_numero),
      fecha_emision: fdate(r.fecha_emision), fecha_venc: fdate(r.fecha_venc),
      moneda, tipo_cambio: tc, monto_original: monto, saldo_pendiente: saldo, obra_codigo: s(r.obra_codigo), monto_pen,
    };
  };
  const cxc = sheet('CXC').map(mapDoc);
  const cxp = sheet('CXP').map(mapDoc);

  return { empresaRuc, fechaApertura, bancos, detracciones, patrimonio, cxc, cxp };
}

type Model = ReturnType<typeof readModel>;

// Hash determinista del contenido (para idempotencia). Ordena todo.
function contentHash(m: Model, empresaId: number) {
  const norm = {
    empresaId, fecha: m.fechaApertura,
    bancos: [...m.bancos].sort((a, b) => a.cuenta.localeCompare(b.cuenta)),
    detracciones: [...m.detracciones].sort((a, b) => a.cuenta.localeCompare(b.cuenta)),
    patrimonio: [...m.patrimonio].sort((a, b) => a.cuenta.localeCompare(b.cuenta)),
    cxc: [...m.cxc].sort((a, b) => (a.doc_serie + a.doc_numero).localeCompare(b.doc_serie + b.doc_numero)),
    cxp: [...m.cxp].sort((a, b) => (a.doc_serie + a.doc_numero).localeCompare(b.doc_serie + b.doc_numero)),
  };
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

// Construye las lineas CONTROL del asiento de apertura (agregadas).
function buildLineas(m: Model) {
  const lineas: { cuenta: string; descripcion: string; debe: number; haber: number; obra_id: null }[] = [];
  for (const b of m.bancos) {
    const pen = b.moneda === 'PEN' ? b.saldo : round2(b.saldo * b.tc);
    lineas.push({ cuenta: b.cuenta, descripcion: `Apertura banco/caja ${b.cuenta}`, debe: pen, haber: 0, obra_id: null });
  }
  for (const d of m.detracciones)
    lineas.push({ cuenta: d.cuenta, descripcion: `Apertura detracciones ${d.cuenta}`, debe: d.saldo, haber: 0, obra_id: null });

  // CxC control agrupado por cuenta_control (debe)
  const cxcByCtrl = new Map<string, number>();
  for (const d of m.cxc) cxcByCtrl.set(d.cuenta_control, round2((cxcByCtrl.get(d.cuenta_control) ?? 0) + d.monto_pen));
  for (const [cta, tot] of cxcByCtrl)
    lineas.push({ cuenta: cta, descripcion: `Apertura CxC (control) ${cta}`, debe: tot, haber: 0, obra_id: null });

  // CxP control agrupado por cuenta_control (haber)
  const cxpByCtrl = new Map<string, number>();
  for (const d of m.cxp) cxpByCtrl.set(d.cuenta_control, round2((cxpByCtrl.get(d.cuenta_control) ?? 0) + d.monto_pen));
  for (const [cta, tot] of cxpByCtrl)
    lineas.push({ cuenta: cta, descripcion: `Apertura CxP (control) ${cta}`, debe: 0, haber: tot, obra_id: null });

  for (const p of m.patrimonio) {
    if (p.saldo >= 0) lineas.push({ cuenta: p.cuenta, descripcion: `Apertura patrimonio ${p.cuenta}`, debe: 0, haber: p.saldo, obra_id: null });
    else lineas.push({ cuenta: p.cuenta, descripcion: `Apertura patrimonio ${p.cuenta}`, debe: -p.saldo, haber: 0, obra_id: null });
  }
  return { lineas, cxcByCtrl, cxpByCtrl };
}

// ── VALIDACION (checklist §9) ─────────────────────────────────
async function validate(m: Model) {
  const errors: string[] = [];
  const warns: string[] = [];

  // empresa
  const [emp] = await sql`select id, razon_social from empresa where ruc = ${m.empresaRuc}`;
  if (!emp) fail(`empresa ruc ${m.empresaRuc} no existe`);
  const empresaId = emp.id as number;

  // fecha en periodo ABIERTO (ausencia de fila cerrada = abierto)
  const [cerrado] = await sql`
    select 1 from periodos_contables
    where proyecto_id is null and estado <> 'abierto'
      and ${m.fechaApertura}::date between fecha_inicio and fecha_fin limit 1`;
  if (cerrado) errors.push(`fecha ${m.fechaApertura} cae en periodo CERRADO`);

  // cuentas existen y activas
  const cuentas = new Set<string>();
  m.bancos.forEach((b) => cuentas.add(b.cuenta));
  m.detracciones.forEach((d) => cuentas.add(d.cuenta));
  m.patrimonio.forEach((p) => cuentas.add(p.cuenta));
  m.cxc.forEach((d) => cuentas.add(d.cuenta_control));
  m.cxp.forEach((d) => cuentas.add(d.cuenta_control));
  const planRows = await sql`select codigo, activa from plan_contable where codigo in ${sql([...cuentas])}`;
  const planMap = new Map(planRows.map((r) => [r.codigo, r.activa]));
  for (const c of cuentas) {
    if (!planMap.has(c)) errors.push(`cuenta ${c} no existe en el plan`);
    else if (planMap.get(c) === false) errors.push(`cuenta ${c} esta inactiva`);
  }

  // obras (obra_codigo -> proyecto)
  const obraCodes = new Set<string>();
  [...m.cxc, ...m.cxp].forEach((d) => { if (d.obra_codigo) obraCodes.add(d.obra_codigo); });
  const obraMap = new Map<string, string>();
  if (obraCodes.size) {
    const pr = await sql`select id, codigo from proyectos where codigo in ${sql([...obraCodes])}`;
    pr.forEach((r) => obraMap.set(r.codigo, r.id));
    for (const c of obraCodes) if (!obraMap.has(c)) errors.push(`obra_codigo ${c} no existe`);
  }

  // terceros (warn por defecto)
  const rucs = new Set<string>();
  [...m.cxc, ...m.cxp].forEach((d) => { if (d.tercero_ruc) rucs.add(d.tercero_ruc); });
  if (rucs.size) {
    const prov = await sql`select ruc from proveedores where ruc in ${sql([...rucs])}`;
    const cli = await sql`select ruc from clientes where ruc in ${sql([...rucs])}`;
    const known = new Set([...prov.map((r) => r.ruc), ...cli.map((r) => r.ruc)]);
    for (const r of rucs) if (!known.has(r)) (STRICT_TERCEROS ? errors : warns).push(`tercero ruc ${r} no esta en maestro`);
  }

  // saldo_pendiente == monto_original (apertura)
  for (const d of [...m.cxc, ...m.cxp]) {
    if (Math.abs(d.saldo_pendiente - d.monto_original) > EPS)
      errors.push(`doc ${d.doc_serie}-${d.doc_numero}: saldo_pendiente(${d.saldo_pendiente}) != monto_original(${d.monto_original}) en apertura`);
    if (d.moneda !== 'PEN' && !(d.tipo_cambio > 0))
      errors.push(`doc ${d.doc_serie}-${d.doc_numero}: moneda ${d.moneda} sin tipo_cambio`);
    if (d.monto_original < 0) errors.push(`doc ${d.doc_serie}-${d.doc_numero}: monto negativo`);
  }
  for (const b of m.bancos) if (b.moneda !== 'PEN' && !(b.tc > 0)) errors.push(`banco ${b.cuenta}: moneda ${b.moneda} sin TC`);

  // duplicados dentro del Excel
  const seen = new Set<string>();
  for (const d of [...m.cxc.map((x) => ['cxc', x] as const), ...m.cxp.map((x) => ['cxp', x] as const)]) {
    const [tipo, doc] = d;
    const k = `${tipo}|${doc.doc_tipo}|${doc.doc_serie}|${doc.doc_numero}`;
    if (seen.has(k)) errors.push(`documento duplicado en Excel: ${k}`);
    seen.add(k);
  }

  // duplicados vs DB
  const dbDups = await sql`
    select tipo, doc_tipo, doc_serie, doc_numero from documento_pendiente
    where empresa_id = ${empresaId}`;
  const dbSet = new Set(dbDups.map((r) => `${r.tipo}|${r.doc_tipo}|${r.doc_serie}|${r.doc_numero}`));
  for (const d of [...m.cxc.map((x) => ['cxc', x] as const), ...m.cxp.map((x) => ['cxp', x] as const)]) {
    const [tipo, doc] = d;
    const k = `${tipo}|${doc.doc_tipo}|${doc.doc_serie}|${doc.doc_numero}`;
    if (dbSet.has(k)) errors.push(`documento ya existe en DB: ${k}`);
  }

  // cuadre
  const { lineas, cxcByCtrl, cxpByCtrl } = buildLineas(m);
  const totDebe = round2(lineas.reduce((a, l) => a + l.debe, 0));
  const totHaber = round2(lineas.reduce((a, l) => a + l.haber, 0));
  if (Math.abs(totDebe - totHaber) > EPS)
    errors.push(`Σdebe(${money(totDebe)}) != Σhaber(${money(totHaber)}) · descuadre ${money(totDebe - totHaber)} (patrimonio no cuadra)`);

  // sub-mayor == linea control
  for (const [cta, tot] of cxcByCtrl) {
    const suma = round2(m.cxc.filter((d) => d.cuenta_control === cta).reduce((a, d) => a + d.monto_pen, 0));
    if (Math.abs(suma - tot) > EPS) errors.push(`sub-mayor CxC ${cta} (${money(suma)}) != linea control (${money(tot)})`);
  }
  for (const [cta, tot] of cxpByCtrl) {
    const suma = round2(m.cxp.filter((d) => d.cuenta_control === cta).reduce((a, d) => a + d.monto_pen, 0));
    if (Math.abs(suma - tot) > EPS) errors.push(`sub-mayor CxP ${cta} (${money(suma)}) != linea control (${money(tot)})`);
  }

  return { empresaId, empresaRazon: emp.razon_social as string, obraMap, lineas, totDebe, totHaber, cxcByCtrl, cxpByCtrl, errors, warns };
}

function report(m: Model, v: Awaited<ReturnType<typeof validate>>, hash: string) {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  WS-1 APERTURA · ${MODE.toUpperCase()}`);
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Empresa      : ${m.empresaRuc} · ${v.empresaRazon} (id ${v.empresaId})`);
  console.log(`  Fecha        : ${m.fechaApertura}`);
  console.log(`  Hash         : ${hash.slice(0, 16)}…`);
  console.log(`  Bancos/caja  : ${m.bancos.length} · Detracciones: ${m.detracciones.length} · Patrimonio: ${m.patrimonio.length}`);
  console.log(`  CxC docs     : ${m.cxc.length} · CxP docs: ${m.cxp.length}`);
  console.log('  ─ Lineas control del asiento ─────────────────────────');
  for (const l of v.lineas)
    console.log(`    ${l.cuenta.padEnd(7)} ${l.debe ? 'D ' + money(l.debe).padStart(14) : '  ' + ''.padStart(14)}  ${l.haber ? 'H ' + money(l.haber).padStart(14) : ''}`);
  console.log('  ───────────────────────────────────────────────────────');
  console.log(`    Σ debe  = ${money(v.totDebe)}`);
  console.log(`    Σ haber = ${money(v.totHaber)}`);
  console.log('  ─ Cuadre sub-mayor vs control ────────────────────────');
  for (const [cta, tot] of v.cxcByCtrl) console.log(`    CxC ${cta}: Σdocs = ${money(tot)} = linea control ✓`);
  for (const [cta, tot] of v.cxpByCtrl) console.log(`    CxP ${cta}: Σdocs = ${money(tot)} = linea control ✓`);
  if (v.warns.length) { console.log('  ⚠ Avisos:'); v.warns.forEach((w) => console.log(`    - ${w}`)); }
  console.log('══════════════════════════════════════════════════════════\n');
}

// ── COMMIT ────────────────────────────────────────────────────
async function commit(m: Model, v: Awaited<ReturnType<typeof validate>>, hash: string) {
  const periodo = m.fechaApertura!.slice(0, 7);

  // idempotencia: apertura previa de esta empresa?
  const [prev] = await sql`
    select id, hash from asientos
    where empresa_id = ${v.empresaId} and origen = 'apertura' and status <> 'anulado' limit 1`;
  if (prev) {
    if (prev.hash === hash) { console.log(`  ↺ NO-OP · apertura ya cargada con hash identico (asiento ${prev.id})`); return { asientoId: prev.id, noop: true }; }
    fail(`ya existe apertura para esta empresa con hash DISTINTO (asiento ${prev.id}). Corre --rollback ${m.empresaRuc} antes.`);
  }

  let asientoId = '';
  await sql.begin(async (tx) => {
    const correlativo = `AP-${v.empresaId}-${periodo}`;
    const [a] = await tx`
      insert into asientos (correlativo, fecha, periodo, glosa, origen, moneda, empresa_id, status, hash)
      values (${correlativo}, ${m.fechaApertura}, ${periodo},
              ${'Asiento de apertura ' + v.empresaRazon + ' ' + m.fechaApertura},
              'apertura', 'PEN', ${v.empresaId}, 'registrado', ${hash})
      returning id`;
    asientoId = a.id;

    // lineas control
    let i = 0;
    for (const l of v.lineas) {
      i++;
      await tx`
        insert into asientos_lineas (asiento_id, correlativo, cuenta, cuenta_contable, descripcion, debe, haber, obra_id, clase_derivada)
        values (${asientoId}, ${i}, ${l.cuenta}, ${l.cuenta}, ${l.descripcion}, ${l.debe}, ${l.haber}, ${l.obra_id}, ${null})`;
    }

    // documento_pendiente (sub-mayor)
    const insDoc = async (tipo: 'cxc' | 'cxp', d: Doc) => {
      const obraId = d.obra_codigo ? v.obraMap.get(d.obra_codigo) ?? null : null;
      await tx`
        insert into documento_pendiente
          (empresa_id, tipo, cuenta_control, tercero_ruc, tercero_razon, doc_tipo, doc_serie, doc_numero,
           fecha_emision, fecha_venc, moneda, tipo_cambio, monto_original, monto_pen, saldo_pendiente,
           estado, obra_id, asiento_origen_id, doc_origen_tipo)
        values
          (${v.empresaId}, ${tipo}, ${d.cuenta_control}, ${d.tercero_ruc || null}, ${d.tercero_razon || null},
           ${d.doc_tipo || null}, ${d.doc_serie || null}, ${d.doc_numero || null},
           ${d.fecha_emision}, ${d.fecha_venc}, ${d.moneda}, ${d.moneda === 'PEN' ? null : d.tipo_cambio},
           ${d.monto_original}, ${d.monto_pen}, ${d.saldo_pendiente}, 'abierto', ${obraId}, ${asientoId}, 'apertura')`;
    };
    for (const d of m.cxc) await insDoc('cxc', d);
    for (const d of m.cxp) await insDoc('cxp', d);

    // re-validar sub-mayor == control DENTRO de la transaccion (§5)
    for (const [cta, tot] of v.cxcByCtrl) {
      const [{ suma }] = await tx`select coalesce(sum(monto_pen),0)::float8 as suma from documento_pendiente where asiento_origen_id=${asientoId} and tipo='cxc' and cuenta_control=${cta}`;
      if (Math.abs(Number(suma) - tot) > EPS) throw new Error(`re-check CxC ${cta}: ${suma} != ${tot}`);
    }
    for (const [cta, tot] of v.cxpByCtrl) {
      const [{ suma }] = await tx`select coalesce(sum(monto_pen),0)::float8 as suma from documento_pendiente where asiento_origen_id=${asientoId} and tipo='cxp' and cuenta_control=${cta}`;
      if (Math.abs(Number(suma) - tot) > EPS) throw new Error(`re-check CxP ${cta}: ${suma} != ${tot}`);
    }
    // re-validar Σ=Σ
    const [{ d, h }] = await tx`select coalesce(sum(debe),0)::float8 d, coalesce(sum(haber),0)::float8 h from asientos_lineas where asiento_id=${asientoId}`;
    if (Math.abs(Number(d) - Number(h)) > EPS) throw new Error(`re-check Σ=Σ: ${d} != ${h}`);

    await tx`insert into audit_log (action, entity_type, entity_id, changes)
             values ('apertura', 'asiento', ${asientoId},
                     ${tx.json({ empresa: m.empresaRuc, fecha: m.fechaApertura, hash, cxc: m.cxc.length, cxp: m.cxp.length })})`;

    if (FAIL_INJECTION) throw new Error('FAIL INJECTION · prueba de atomicidad (todo lo insertado debe revertirse)');
  });

  console.log(`  ✓ COMMIT · asiento apertura ${asientoId}`);
  return { asientoId, noop: false };
}

// ── ROLLBACK ──────────────────────────────────────────────────
async function rollback(ruc: string) {
  const [emp] = await sql`select id, razon_social from empresa where ruc = ${ruc}`;
  if (!emp) fail(`empresa ruc ${ruc} no existe`);
  const [ap] = await sql`
    select id, fecha, periodo from asientos
    where empresa_id = ${emp.id} and origen = 'apertura' and status <> 'anulado' limit 1`;
  if (!ap) fail(`no hay apertura activa para ${ruc}`);

  // guard: no aplicaciones activas posteriores
  const [{ cnt }] = await sql`
    select count(*)::int cnt from aplicacion_documento a
    join documento_pendiente dp on dp.id = a.documento_pendiente_id
    where dp.asiento_origen_id = ${ap.id} and a.estado = 'activa'`;
  if (cnt > 0) fail(`no se puede revertir: hay ${cnt} aplicaciones (pagos) sobre documentos de esta apertura`);

  // guard: periodo abierto
  const [cerrado] = await sql`
    select 1 from periodos_contables
    where proyecto_id is null and estado <> 'abierto'
      and ${ap.fecha}::date between fecha_inicio and fecha_fin limit 1`;
  if (cerrado) fail(`periodo de la apertura (${ap.fecha}) esta CERRADO`);

  await sql.begin(async (tx) => {
    await tx`delete from aplicacion_documento where documento_pendiente_id in (select id from documento_pendiente where asiento_origen_id = ${ap.id})`;
    const del = await tx`delete from documento_pendiente where asiento_origen_id = ${ap.id}`;
    await tx`delete from asientos_lineas where asiento_id = ${ap.id}`;
    await tx`delete from asientos where id = ${ap.id}`;
    await tx`insert into audit_log (action, entity_type, entity_id, changes)
             values ('apertura_reversion', 'asiento', ${ap.id}, ${tx.json({ empresa: ruc, docs_borrados: del.count })})`;
  });
  console.log(`  ✓ ROLLBACK · apertura de ${ruc} revertida (asiento ${ap.id})`);
}

// ── main ──────────────────────────────────────────────────────
(async () => {
  try {
    if (MODE === 'rollback') {
      if (!ROLLBACK_RUC) fail('--rollback requiere <empresa_ruc>');
      await rollback(ROLLBACK_RUC);
      return;
    }
    if (!FILE) fail('--file <xlsx> requerido');
    const m = readModel(FILE);
    const [emp] = await sql`select id from empresa where ruc = ${m.empresaRuc}`;
    if (!emp) fail(`empresa ruc ${m.empresaRuc} no existe`);
    const hash = contentHash(m, emp.id);

    // idempotencia (§7): apertura previa? mismo hash = NO-OP; hash distinto = ERROR (rollback primero).
    const [prevAp] = await sql`
      select id, hash from asientos
      where empresa_id = ${emp.id} and origen = 'apertura' and status <> 'anulado' limit 1`;
    if (prevAp) {
      if (prevAp.hash === hash) {
        console.log(`\n  ↺ NO-OP · apertura ya cargada con hash identico (asiento ${prevAp.id}). Nada que hacer.\n`);
        return;
      }
      fail(`ya existe apertura para ${m.empresaRuc} con hash DISTINTO (asiento ${prevAp.id}). Corre --rollback ${m.empresaRuc} antes de recargar.`);
    }

    const v = await validate(m);
    report(m, v, hash);
    if (v.errors.length) {
      console.error('  ✗ VALIDACION FALLIDA:');
      v.errors.forEach((e) => console.error(`    - ${e}`));
      process.exit(1);
    }
    console.log('  ✓ Validacion OK (checklist §9 completo)');
    if (MODE === 'commit') await commit(m, v, hash);
    else console.log('  (dry-run · no se escribio nada)');
  } catch (e: any) {
    console.error('\n  ✗ ERROR:', e?.message ?? e, '\n');
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
