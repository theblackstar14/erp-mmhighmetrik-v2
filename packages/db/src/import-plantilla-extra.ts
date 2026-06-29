/**
 * Importador EXTRA · PLANTILLA MM xlsx → cuentas_bancarias + movimientos (Flujo Cuentas) + empleados (Planilla).
 * MERGE-safe: idempotente por código, ON CONFLICT DO NOTHING · NO borra nada (conserva CEMENTERIO + valos + lo existente).
 * Complementa import-plantilla.ts (que hace proveedores/clientes/compras/inventario).
 *
 * Uso:
 *   npx tsx src/import-plantilla-extra.ts            # dry-run
 *   npx tsx src/import-plantilla-extra.ts --commit   # inserta
 *   npx tsx src/import-plantilla-extra.ts --file "ruta.xlsx" --commit
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

const wb = XLSX.read(readFileSync(XLSX_PATH), { cellDates: true });
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
const fecha = (s: string): string | null => {
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s.trim());
  if (m) { const [, mm, dd, yy] = m; const y = Number(yy) < 100 ? 2000 + Number(yy) : Number(yy); return `${y}-${String(Number(mm)).padStart(2, '0')}-${String(Number(dd)).padStart(2, '0')}`; }
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

async function main() {
  console.log(`\n📂 ${XLSX_PATH}`);
  console.log(COMMIT ? '🟢 COMMIT · escribirá (merge, no borra)\n' : '🔵 DRY-RUN · no escribe\n');

  const cuentas = rows('CuentasBancarias', 0);
  const flujo = rows('Fact de Flujo Cuentas', 1);
  const plaObr = rows('Fact de Planilla Obreros', 1);
  const plaAdm = rows('Fact de Planilla Adm', 1);

  // mapas DB actuales
  const cuentaMap = new Map((await sql`SELECT id, codigo FROM cuentas_bancarias`).map((r) => [r.codigo as string, r.id as string]));
  const proyMap = new Map((await sql`SELECT id, codigo FROM proyectos`).map((r) => [r.codigo as string, r.id as string]));
  const cliMap = new Map((await sql`SELECT id, ruc FROM clientes WHERE ruc IS NOT NULL`).map((r) => [r.ruc as string, r.id as string]));
  const movExist = new Set((await sql`SELECT codigo FROM movimientos WHERE codigo IS NOT NULL`).map((r) => r.codigo as string));
  const empExist = new Set((await sql`SELECT num_doc FROM empleados WHERE num_doc IS NOT NULL`).map((r) => r.num_doc as string));

  const cuentasNuevas = cuentas.filter((c) => c.codcuentacomercial && !cuentaMap.has(c.codcuentacomercial.trim()));
  const flujoValido = flujo.filter((m) => m.codmovimiento && fecha(m.fecmovimiento) && num(m.mtototal) !== 0);
  const movNuevos = flujoValido.filter((m) => !movExist.has(m.codmovimiento));
  // resumen flujo por cuenta + por mes (para ver "lleno")
  const porCuenta: Record<string, number> = {};
  const porMes: Record<string, number> = {};
  for (const m of movNuevos) { porCuenta[m.codcuentacomercial] = (porCuenta[m.codcuentacomercial] ?? 0) + 1; const ym = (fecha(m.fecmovimiento) ?? '').slice(0, 7); porMes[ym] = (porMes[ym] ?? 0) + 1; }

  const empAdm = plaAdm.filter((e) => (e.coddocidentificacion || e.docidentificacion) && (e.nbrempleado || '').trim());
  const empObr = plaObr.filter((e) => (e.coddocidentificacion || '').trim());
  const dni = (e: Record<string, string>) => String(e.coddocidentificacion || e.docidentificacion || '').replace(/\D/g, '');
  const empAdmNuevos = empAdm.filter((e) => !empExist.has(dni(e)));
  const empObrNuevos = empObr.filter((e) => { const d = dni(e); return d && !empExist.has(d); });

  console.log('═══ DRY-RUN ═══');
  console.log(`Cuentas xlsx: ${cuentas.length} · nuevas: ${cuentasNuevas.length} (${cuentasNuevas.map((c) => c.codcuentacomercial).join(', ') || '—'})`);
  console.log(`Flujo Cuentas xlsx: ${flujo.length} · válidos: ${flujoValido.length} · NUEVOS a insertar: ${movNuevos.length} · ya en DB: ${flujoValido.length - movNuevos.length}`);
  console.log(`  por cuenta:`, Object.entries(porCuenta).map(([k, v]) => `${k}=${v}`).join(' · '));
  console.log(`  por mes:`, Object.entries(porMes).sort().map(([k, v]) => `${k}=${v}`).join(' · '));
  console.log(`Empleados ADM: ${empAdm.length} · nuevos: ${empAdmNuevos.length}`);
  console.log(`Empleados OBREROS: ${empObr.length} · nuevos: ${empObrNuevos.length}`);

  if (!COMMIT) { console.log('\n🔵 DRY-RUN · nada escrito. Para insertar: --commit'); await sql.end(); process.exit(0); }

  console.log('\n🟢 COMMIT...');
  // 1· Cuentas
  for (const c of cuentasNuevas) {
    await sql`INSERT INTO cuentas_bancarias (codigo, banco, moneda, descripcion) VALUES (${c.codcuentacomercial.trim()}, ${c.desbanco || null}, ${c.desmoneda || 'PEN'}, ${c.desdescripcion || null}) ON CONFLICT (codigo) DO NOTHING`;
  }
  const cuentaMap2 = new Map((await sql`SELECT id, codigo FROM cuentas_bancarias`).map((r) => [r.codigo as string, r.id as string]));
  console.log(`  ✓ cuentas: ${cuentasNuevas.length}`);

  // 2· Movimientos (batch de 500)
  const proyId = (cod: string) => (cod && cod !== 'OF0001' ? proyMap.get(cod.trim()) ?? null : null);
  const movRows = movNuevos.map((m) => ({
    codigo: m.codmovimiento,
    fecha: fecha(m.fecmovimiento)!,
    proyecto_id: proyId(m.codproyecto),
    tipo_movimiento: (m.tipmovimiento || (num(m.mtototal) < 0 ? 'Egreso' : 'Ingreso')).slice(0, 10),
    fuente_pago: m.desfuentepago || null,
    cuenta_id: cuentaMap2.get((m.codcuentacomercial || '').trim()) ?? null,
    fuente_movimiento: m.desfuenteingreso || null,
    cliente_id: cliMap.get(ruc11(m.codcliente)) ?? null,
    cliente_nombre: m.descliente || null,
    tipo_comprobante: m.tipcomprobante || null,
    serie: m.desseriecomprobante || null,
    numero: m.numcomprobante || null,
    moneda: m.desmoneda || 'PEN',
    monto: Math.abs(num(m.mtototal)).toFixed(2),
    descripcion: m.desdescripcionmov || m.desdescripcion || null,
    num_operacion: m.Columna1 || null,
  }));
  let mN = 0;
  for (let i = 0; i < movRows.length; i += 500) {
    const chunk = movRows.slice(i, i + 500);
    await sql`INSERT INTO movimientos ${sql(chunk, 'codigo', 'fecha', 'proyecto_id', 'tipo_movimiento', 'fuente_pago', 'cuenta_id', 'fuente_movimiento', 'cliente_id', 'cliente_nombre', 'tipo_comprobante', 'serie', 'numero', 'moneda', 'monto', 'descripcion', 'num_operacion')}`;
    mN += chunk.length;
  }
  console.log(`  ✓ movimientos: ${mN}`);

  // 3· Empleados (Adm + Obreros)
  let eN = 0;
  for (const e of empAdmNuevos) {
    await sql`INSERT INTO empleados (nombre, tipo_doc, num_doc, sistema_pension, fecha_ingreso, categoria, tipo_planilla, proyecto_id)
      VALUES (${(e.nbrempleado || '').toUpperCase()}, 'DNI', ${dni(e)}, ${e.nbrsistemapension || null}, ${fecha(e.fecingreso)}, ${e.tipcategoriaempleado || 'Empleado'}, 'admin', null)
      ON CONFLICT DO NOTHING`;
    eN++;
  }
  for (const e of empObrNuevos) {
    const nombre = (e.nbrempleado || `OBRERO DNI ${dni(e)}`).toUpperCase();
    await sql`INSERT INTO empleados (nombre, tipo_doc, num_doc, sistema_pension, fecha_nacimiento, fecha_ingreso, categoria, banco, num_cuenta, tipo_planilla, proyecto_id)
      VALUES (${nombre}, 'DNI', ${dni(e)}, ${e.dessistemapensionario || null}, ${fecha(e.fecnaciminetoempleado)}, ${fecha(e.fecingreso)}, ${e.tipcategoriaempleado || 'Operario'}, ${e.desbancodestino || null}, ${e.numctabancodestino || null}, 'obrero', null)
      ON CONFLICT DO NOTHING`;
    eN++;
  }
  console.log(`  ✓ empleados: ${eN}`);
  console.log('\n✅ IMPORT EXTRA COMPLETO');
  await sql.end();
  process.exit(0);
}
main().catch((e) => { console.error('❌', e); process.exit(1); });
