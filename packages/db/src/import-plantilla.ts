/**
 * Importador histórico · PLANTILLA MM xlsx → proveedores, clientes, compras (gastos), inventario.
 * DRY-RUN por defecto (parsea + reporta, NO escribe). Pasa --commit para insertar.
 * Opción B: inventario liga a su compra por comprobante (ruc|serie|num) · costo vive en el gasto.
 *
 * Uso:
 *   npx tsx src/import-plantilla.ts                 # dry-run
 *   npx tsx src/import-plantilla.ts --commit        # inserta
 *   npx tsx src/import-plantilla.ts --file "ruta.xlsx"
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const COMMIT = process.argv.includes('--commit');
const fileArg = process.argv.indexOf('--file');
const XLSX_PATH = fileArg >= 0 ? process.argv[fileArg + 1]! : 'C:/Users/gabri/Downloads/PLANTILLA MM 30 03.xlsx';

const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

// ── helpers de parseo ──
const wb = XLSX.read(readFileSync(XLSX_PATH), { cellDates: true });
// headerRow: maestros (Proveedores/Clientes/Proyectos) = 0 · "Fact de *" = 1 (humana fila0, código fila1)
const rows = (sheet: string, headerRow = 0): Record<string, string>[] => {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`Hoja no encontrada: ${sheet}`);
  const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
  const keys = (aoa[headerRow] ?? []).map((k) => String(k).trim());
  const out: Record<string, string>[] = [];
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    if (r.every((c) => String(c).trim() === '')) continue;
    const o: Record<string, string> = {};
    keys.forEach((k, j) => { if (k) o[k] = String(r[j] ?? '').trim(); });
    out.push(o);
  }
  return out;
};
const ruc11 = (s: string) => String(s ?? '').replace(/\D/g, '').slice(0, 11);
const num = (s: string) => { const n = Number(String(s ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
// fecha xlsx (m/d/yy o Date) → YYYY-MM-DD
const fecha = (s: string): string | null => {
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s.trim());
  if (m) {
    const [, mm, dd, yy] = m;
    const y = Number(yy) < 100 ? 2000 + Number(yy) : Number(yy);
    return `${y}-${String(Number(mm)).padStart(2, '0')}-${String(Number(dd)).padStart(2, '0')}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const compKey = (rucS: string, serie: string, numc: string) => `${ruc11(rucS)}|${serie.trim().toUpperCase()}|${numc.trim()}`;

async function main() {
  console.log(`\n📂 ${XLSX_PATH}`);
  console.log(COMMIT ? '🟢 MODO COMMIT · escribirá en DB\n' : '🔵 DRY-RUN · no escribe nada\n');

  const provs = rows('Proveedores', 0);
  const clis = rows('Clientes', 0);
  const compras = rows('Fact de Compras', 1);
  const inv = rows('Fact de Inventario', 1);

  // estado actual DB
  const dbProvRucs = new Set((await sql`SELECT ruc FROM proveedores WHERE ruc IS NOT NULL`).map((r) => r.ruc as string));
  const dbCliRucs = new Set((await sql`SELECT ruc FROM clientes WHERE ruc IS NOT NULL`).map((r) => r.ruc as string));
  const dbProyCods = new Set((await sql`SELECT codigo FROM proyectos`).map((r) => r.codigo as string));

  // ── Proveedores ──
  const provNuevos = provs.filter((p) => { const r = ruc11(p.codproveedor); return r.length === 11 && !dbProvRucs.has(r); });
  // ── Clientes ──
  const cliNuevos = clis.filter((c) => { const r = ruc11(c.codcliente); return r.length === 11 && !dbCliRucs.has(r); });

  // ── Proyectos referenciados ──
  const codsRef = new Set<string>();
  for (const c of compras) if (c.codproyecto) codsRef.add(c.codproyecto.trim());
  for (const it of inv) if (it.codproyecto) codsRef.add(it.codproyecto.trim());
  const proyFaltan = [...codsRef].filter((c) => c && c !== 'OF0001' && !dbProyCods.has(c));

  // ── Compras → gastos ──
  const comprasValidas = compras.filter((c) => num(c.mtototal) > 0 || num(c.mtosubtotal) > 0 || num(c.mtoexonerado) > 0);
  const totalCompras = comprasValidas.reduce((s, c) => s + num(c.mtototal), 0);

  // índice comprobante → compra (para link inventario)
  const idxComp = new Map<string, Record<string, string>>();
  for (const c of compras) {
    if (c.numcomprobante) idxComp.set(compKey(c.codproveedor, c.desseriecomprobante, c.numcomprobante), c);
  }

  // ── Inventario → inventario_items + match ──
  let invMatched = 0, invUnmatched = 0;
  const valuacion = new Map<string, { gastoTotal: number; invTotal: number }>(); // por comprobante
  for (const it of inv) {
    const k = compKey(it.codproveedor, it.desseriecomprobante, it.numcomprobante);
    const compra = it.numcomprobante ? idxComp.get(k) : undefined;
    if (compra) {
      invMatched++;
      const e = valuacion.get(k) ?? { gastoTotal: num(compra.mtototal), invTotal: 0 };
      e.invTotal += num(it.mtovalorunitario); // mtovalorunitario = TOTAL de línea (confirmado)
      valuacion.set(k, e);
    } else {
      invUnmatched++;
    }
  }
  const totalInv = inv.reduce((s, it) => s + num(it.mtovalorunitario), 0);

  // diferencias de valuación (factura vs inventariable)
  let conDif = 0, sumDif = 0;
  for (const { gastoTotal, invTotal } of valuacion.values()) {
    const d = gastoTotal - invTotal;
    if (Math.abs(d) > 0.5) { conDif++; sumDif += d; }
  }

  // categorías inventario (activos candidatos)
  const catInv: Record<string, number> = {};
  for (const it of inv) { const c = it.tipcategoria || 'Sin cat'; catInv[c] = (catInv[c] ?? 0) + 1; }

  // OUTLIERS · filas con valor sospechoso (> S/100K en consumible = casi seguro error de tipeo en el Excel)
  const OUTLIER = 100_000;
  const outliers = inv
    .map((it) => ({ cod: it.coditem, val: num(it.mtovalorunitario), cant: num(it.numitem), desc: (it.desdescripcionitem || '').slice(0, 40) }))
    .filter((x) => x.val > OUTLIER)
    .sort((a, b) => b.val - a.val);
  const totalInvLimpio = totalInv - outliers.reduce((s, o) => s + o.val, 0);

  // ── REPORTE ──
  console.log('═══ DRY-RUN · resumen ═══');
  console.log(`Proveedores xlsx: ${provs.length} · nuevos a insertar: ${provNuevos.length} · ya en DB: ${provs.length - provNuevos.length}`);
  console.log(`Clientes xlsx:    ${clis.length} · nuevos: ${cliNuevos.length}`);
  console.log(`\nProyectos referenciados en compras/inv: ${codsRef.size}`);
  console.log(`  ⚠ NO existen en DB (→ gasto sin obra / null): ${proyFaltan.length ? proyFaltan.join(', ') : 'ninguno'}`);
  console.log(`  (OF0001 = oficina → proyectoId null)`);
  console.log(`\nCompras (gastos): ${comprasValidas.length} filas · Σ total S/ ${totalCompras.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
  console.log(`Inventario:       ${inv.length} filas · Σ valor S/ ${totalInv.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
  console.log(`  categorías: ${Object.entries(catInv).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  console.log(`\nLink inventario↔compra por comprobante:`);
  console.log(`  ✓ matched:   ${invMatched} (${Math.round(invMatched / inv.length * 100)}%)`);
  console.log(`  ✗ sin compra: ${invUnmatched} (→ gastoId null · flag "sin compra ligada")`);
  console.log(`\n⚠ OUTLIERS · ${outliers.length} filas con valor > S/100K (probable error de tipeo en el Excel):`);
  outliers.forEach((o) => console.log(`    ${o.cod} · S/ ${o.val.toLocaleString('es-PE')} · cant ${o.cant} · ${o.desc}`));
  console.log(`  Σ inventario SIN outliers: S/ ${totalInvLimpio.toLocaleString('es-PE', { minimumFractionDigits: 2 })} (vs ${totalInv.toLocaleString('es-PE', { minimumFractionDigits: 0 })} con basura)`);
  console.log(`\nValuación (comprobantes con dif factura vs inventariable): ${conDif} · Σ dif S/ ${sumDif.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
  console.log(`  (dif normal: flete, servicios, ítems no inventariables · NUNCA se fuerza)`);

  if (!COMMIT) {
    console.log('\n🔵 DRY-RUN · nada escrito. Revisá. Para insertar: --commit');
    await sql.end();
    process.exit(0);
  }

  // ═══ COMMIT ═══
  console.log('\n🟢 COMMIT · insertando...');
  const outlierCods = new Set(outliers.map((o) => o.cod));

  // 1· Proyectos faltantes (crea desde hoja Proyectos · OF0001 = oficina → null)
  const proySheet = rows('Proyectos', 0);
  for (const cod of proyFaltan) {
    const p = proySheet.find((x) => x.codproyecto === cod);
    await sql`INSERT INTO proyectos (codigo, nombre) VALUES (${cod}, ${p?.desproyecto ?? cod}) ON CONFLICT (codigo) DO NOTHING`;
  }
  const proyMap = new Map((await sql`SELECT id, codigo FROM proyectos`).map((r) => [r.codigo as string, r.id as string]));
  const proyId = (cod: string) => (cod && cod !== 'OF0001' ? proyMap.get(cod.trim()) ?? null : null);
  console.log(`  ✓ proyectos creados: ${proyFaltan.length}`);

  // 2· Proveedores nuevos
  let pN = 0;
  for (const p of provNuevos) {
    const r = ruc11(p.codproveedor);
    await sql`INSERT INTO proveedores (ruc, razon_social, categoria, domicilio, distrito, contacto, telefono, email)
      VALUES (${r}, ${(p.desproveedor || r).toUpperCase()}, ${p.tipcategoria || null}, ${p.desdireccion || null}, ${p.desdistrito || null}, ${p.despersonacontacto || null}, ${p.destelefonocontacto || null}, ${p.desemail || null})
      ON CONFLICT (ruc) DO NOTHING`;
    pN++;
  }
  const provMap = new Map((await sql`SELECT id, ruc FROM proveedores WHERE ruc IS NOT NULL`).map((r) => [r.ruc as string, r.id as string]));
  console.log(`  ✓ proveedores: ${pN}`);

  // 3· Clientes nuevos
  let cN = 0;
  for (const c of cliNuevos) {
    await sql`INSERT INTO clientes (ruc, razon_social) VALUES (${ruc11(c.codcliente)}, ${(c.descliente || c.codcliente).toUpperCase()}) ON CONFLICT (ruc) DO NOTHING`;
    cN++;
  }
  console.log(`  ✓ clientes: ${cN}`);

  // 4· Compras → gastos (idempotente por codigo) · construye compKey→gastoId
  const gastoExist = new Set((await sql`SELECT codigo FROM gastos WHERE codigo IS NOT NULL`).map((r) => r.codigo as string));
  const keyToGasto = new Map<string, string>();
  let gN = 0;
  for (const c of comprasValidas) {
    if (c.codregistro && gastoExist.has(c.codregistro)) continue;
    const f = fecha(c.fecgestion);
    if (!f) continue;
    const rid = provMap.get(ruc11(c.codproveedor)) ?? null;
    const [g] = await sql`INSERT INTO gastos
      (codigo, proyecto_id, fecha, tipo_registro, tipo_igv, proveedor_id, proveedor_ruc, proveedor_razon, tipo_comprobante, serie, numero, moneda, forma_pago, fuente_pago, descripcion_item, subtotal, igv, exonerado, total, tipo_gasto, observaciones)
      VALUES (${c.codregistro || null}, ${proyId(c.codproyecto)}, ${f}, ${c.tipregistrocompra || null}, ${c.codordencompra || null}, ${rid}, ${ruc11(c.codproveedor) || null}, ${c.desproveedor || null}, ${c.tipcomprobante || null}, ${c.desseriecomprobante || null}, ${c.numcomprobante || null}, ${c.desmoneda || 'PEN'}, ${c.desformapago || null}, ${c.desfuentepago || null}, ${c.desitemdescripcion || null}, ${num(c.mtosubtotal).toFixed(2)}, ${num(c.mtoigv).toFixed(2)}, ${num(c.mtoexonerado).toFixed(2)}, ${num(c.mtototal).toFixed(2)}, ${c.tipgasto || null}, ${c.desobservaciones || null})
      RETURNING id`;
    if (c.numcomprobante) keyToGasto.set(compKey(c.codproveedor, c.desseriecomprobante, c.numcomprobante), g!.id as string);
    gN++;
  }
  console.log(`  ✓ gastos: ${gN}`);

  // 5· Inventario → inventario_items (excluye outliers · valorUnitario = total/cant · liga gastoId)
  const invExist = new Set((await sql`SELECT codigo FROM inventario_items WHERE codigo IS NOT NULL`).map((r) => r.codigo as string));
  let iN = 0, iSkipOut = 0;
  for (const it of inv) {
    if (outlierCods.has(it.coditem)) { iSkipOut++; continue; }
    if (it.coditem && invExist.has(it.coditem)) continue;
    const f = fecha(it.fecmovimiento);
    if (!f) continue;
    const cant = num(it.numitem) || 1;
    const totalLinea = num(it.mtovalorunitario);
    const unit = totalLinea / cant; // mtovalorunitario = TOTAL de línea → dividir
    const k = compKey(it.codproveedor, it.desseriecomprobante, it.numcomprobante);
    await sql`INSERT INTO inventario_items
      (codigo, fecha, proyecto_id, proveedor_ruc, proveedor_razon, tipo_comprobante, serie, numero, cantidad, descripcion_item, valor_unitario, categoria, estado, responsable, observacion, gasto_id)
      VALUES (${it.coditem || null}, ${f}, ${proyId(it.codproyecto)}, ${ruc11(it.codproveedor) || null}, ${it.desproveedor || null}, ${it.tipcomprobante || null}, ${it.desseriecomprobante || null}, ${it.numcomprobante || null}, ${cant.toFixed(4)}, ${it.desdescripcionitem || null}, ${unit.toFixed(4)}, ${it.tipcategoria || null}, ${it.desestado || 'Disponible'}, ${it.nbrresponsable || null}, ${it.desobservacion || null}, ${(it.numcomprobante && keyToGasto.get(k)) || null})`;
    iN++;
  }
  console.log(`  ✓ inventario: ${iN} (outliers excluidos: ${iSkipOut})`);
  console.log('\n✅ IMPORT COMPLETO');
  await sql.end();
  process.exit(0);
}
main().catch((e) => { console.error('❌', e); process.exit(1); });
