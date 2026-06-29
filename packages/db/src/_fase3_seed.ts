/**
 * FASE 3 · Seeder determinístico · Abril 2026 · derivado de archivos reales.
 * Reversible: DELETE movimientos WHERE codigo LIKE 'SIM-%' + DELETE extracto + reset OC/valo.
 * NO toca cutover (null) ni corre /generar (eso va aparte). Audita vía manifest.
 */
import fs from 'node:fs';
import { db, schema } from './client.js';
import { eq, inArray, sql } from 'drizzle-orm';

const PDF = 'C:/Users/gabri/Desktop/erp-mmhighmetrik-v2/_fase3_input/pdf_text.txt';
const MANIFEST = 'C:/Users/gabri/Desktop/erp-mmhighmetrik-v2/_backups/fase3_seed_manifest.json';

// IDs reales (verificados en DB)
const BCP = 'ccfc0e8f-0bf3-4386-be40-792c68482ab7';   // BCP PEN 10411
const SCO = '02cb1501-e5c3-457d-ab88-829b2675e38e';   // Scotiabank PEN 10441
const USD = 'aae5bd2d-5667-436a-b1a8-d51fbb03969a';   // BBVA USD 10422 (sintética marcada)
const PG3 = '2e808d09-80f8-4be8-9bae-0f2c7e80ab24';   // PG0003
const TENORIO = '25fafc2b-dff2-44b2-b2c2-bcda06bb732b';
const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const VALO = '952df8b9-d372-473f-95f5-8d62cc7c4375';
const OCS = ['5900c1a2-f4e9-4111-87b1-c40db9991e76','c5147455-121a-4eac-9930-70e097fa1d6a','a35b2c3a-7ed2-41be-969b-94a424c8f387','63ee3308-d861-4b3e-8693-87a3c163f41c','27fb3930-1f4f-4766-bb04-a069acf96631'];

// ── 1 · parse del extracto real (líneas de movimiento) ──
function parseExtracto(): { fecha: string; descripcion: string; referencia: string | null; monto: number }[] {
  const txt = fs.readFileSync(PDF, 'utf8');
  const out: { fecha: string; descripcion: string; referencia: string | null; monto: number }[] = [];
  const re = /^(\d{2})-(\d{2})\s+(.*?)\s+(\d{4})\s+([\d,]+\.\d{2})(-?)\s*$/;
  for (const raw of txt.split('\n')) {
    const m = raw.match(re);
    if (!m) continue;
    const [, dd, mm, desc, , amt, neg] = m;
    if (mm !== '04') continue; // solo abril
    const monto = Number(amt!.replace(/,/g, '')) * (neg === '-' ? -1 : 1);
    const numop = (desc!.match(/\b(\d{6})\b/) ?? [])[1] ?? null; // NUM OP 6 díg
    out.push({ fecha: `2026-04-${dd}`, descripcion: desc!.trim().replace(/\s+/g, ' ').slice(0, 250), referencia: numop, monto });
  }
  return out;
}

type Mov = {
  codigo: string; fecha: string; tipo: 'Ingreso' | 'Egreso'; monto: number; moneda: 'PEN' | 'USD';
  tc?: number; desc: string; numop?: string | null; cuenta?: string | null; proyecto?: string | null;
  clienteId?: string | null; clienteNombre?: string | null; ocId?: string | null; valoId?: string | null;
  transferId?: string | null; edge?: string;
};

async function main() {
  const lineas = parseExtracto();
  const byOp = new Map(lineas.filter((l) => l.referencia).map((l) => [l.referencia!, l]));
  const movs: Mov[] = [];
  let seq = 0;
  const cod = () => `SIM-04${String(++seq).padStart(3, '0')}`;
  // helper: crea mov que CALZA una línea real del extracto (auto-match)
  const matchLine = (op: string, tipo: 'Ingreso' | 'Egreso', extra: Partial<Mov> = {}) => {
    const l = byOp.get(op); if (!l) return;
    movs.push({ codigo: cod(), fecha: l.fecha, tipo, monto: Math.abs(l.monto), moneda: 'PEN', desc: l.descripcion, numop: op, cuenta: BCP, ...extra });
  };

  // A · COBROS cliente (DE CONSTRUCTORA · auto-match por numop+monto+fecha)
  matchLine('278254', 'Ingreso', { clienteId: TENORIO, clienteNombre: 'CONSTRUCTORA Y CONSULTORA TENORIO SAC', proyecto: PG3, desc: 'Cobro cliente Tenorio' });
  matchLine('276812', 'Ingreso', { clienteId: TENORIO, proyecto: PG3, desc: 'Cobro cliente Tenorio' });
  matchLine('279664', 'Ingreso', { clienteId: TENORIO, proyecto: PG3, desc: 'Cobro cliente Tenorio' });
  matchLine('240989', 'Ingreso', { clienteId: TENORIO, proyecto: PG3, desc: 'Cobro cliente Tenorio (16-04)' });

  // B · TRANSFERENCIAS entrantes Scotiabank→BCP (auto). 2 como par neto-0 (OF transfer), resto aporte.
  const t1 = byOp.get('103078'); // 20,000
  if (t1) {
    const tid = '11111111-1111-1111-1111-111111110001';
    movs.push({ codigo: cod(), fecha: t1.fecha, tipo: 'Egreso', monto: 20000, moneda: 'PEN', desc: 'Transfer salida Scotiabank', cuenta: SCO, transferId: tid });
    movs.push({ codigo: cod(), fecha: t1.fecha, tipo: 'Ingreso', monto: 20000, moneda: 'PEN', desc: 'Transfer entrada BCP', cuenta: BCP, numop: '103078', transferId: tid });
  }
  matchLine('092745', 'Ingreso', { desc: 'Aporte/Transfer Scotiabank 30k', proyecto: null }); // 30,000 (uno de varios → FP bait)

  // C · EDGE 6 · transferencia DUPLICADA (22-04 dos líneas 30,000 · solo 1 mov ERP → la otra queda sin par)
  matchLine('844979', 'Ingreso', { desc: 'Transfer 30k (dup bait 22-04)' });

  // D · PAGOS proveedor (A NNN / PROV TLC · auto). 5 ligados a OC (re-pago).
  const pagosOp = ['763807','763812','295831','053380','053397','246977','762483','297562'];
  pagosOp.forEach((op, i) => matchLine(op, 'Egreso', { proyecto: PG3, ocId: i < 5 ? OCS[i] : null, desc: i < 5 ? `Pago OC ${i + 1}` : 'Pago proveedor' }));

  // E · EDGE 3 · diferencia de CENTAVOS (mov 1 céntimo distinto de la línea real)
  const cdiff = byOp.get('267413'); // 1,900.00
  if (cdiff) movs.push({ codigo: cod(), fecha: cdiff.fecha, tipo: 'Egreso', monto: 1900.01, moneda: 'PEN', desc: 'Pago (dif centavos)', numop: '267413', cuenta: BCP, edge: 'centavos' });

  // F · EDGE 5 · DOBLE PAGO (2 movs mismo monto/fecha, 1 línea banco)
  const dbl = byOp.get('058402'); // 5,000.00
  if (dbl) {
    movs.push({ codigo: cod(), fecha: dbl.fecha, tipo: 'Egreso', monto: 5000, moneda: 'PEN', desc: 'Pago A (doble 1)', numop: '058402', cuenta: BCP, edge: 'doble_pago' });
    movs.push({ codigo: cod(), fecha: dbl.fecha, tipo: 'Egreso', monto: 5000, moneda: 'PEN', desc: 'Pago A (doble 2)', cuenta: BCP, edge: 'doble_pago' });
  }

  // G · EDGE 9 · FECHA distinta (mov 18-04, línea banco 21-04 >3d)
  movs.push({ codigo: cod(), fecha: '2026-04-18', tipo: 'Egreso', monto: 1500, moneda: 'PEN', desc: 'Pago (fecha distinta vs banco 21-04)', numop: '235076', cuenta: BCP, edge: 'fecha_distinta' });

  // H · EDGE 14 · SIN referencia (solo monto+fecha)
  movs.push({ codigo: cod(), fecha: '2026-04-09', tipo: 'Egreso', monto: 855, moneda: 'PEN', desc: 'Pago sin referencia', cuenta: BCP, edge: 'sin_ref' });

  // I · GASTOS admin (POS · existen en banco pero como pendiente; aquí 2 sí en ERP)
  matchLine('651252', 'Egreso', { desc: 'Gasto representación (POS)', proyecto: PG3 });

  // J · SUNAT impuestos (auto)
  matchLine('147554', 'Egreso', { desc: 'Pago SUNAT', proyecto: PG3 });

  // K · COBRO VALO (re-cobrar la valo facturada · 521k · EDGE 7 ERP-sin-banco: depósito a otra cuenta)
  movs.push({ codigo: cod(), fecha: '2026-04-15', tipo: 'Ingreso', monto: 521061.76, moneda: 'PEN', desc: 'Cobro Valorización 1 (PG0003)', cuenta: SCO, proyecto: PG3, valoId: VALO, clienteId: TENORIO, edge: 'erp_sin_banco' });

  // L · APORTE de socio (sin doc · ERP-sin-banco)
  movs.push({ codigo: cod(), fecha: '2026-04-02', tipo: 'Ingreso', monto: 50000, moneda: 'PEN', desc: 'Aporte de socio', cuenta: BCP, edge: 'aporte' });

  // M · USD sintético (EDGE 10 · marcado) — 2 movs + 1 transfer PEN↔USD neto 0
  movs.push({ codigo: cod(), fecha: '2026-04-10', tipo: 'Egreso', monto: 1000, moneda: 'USD', tc: 3.75, desc: '[SINTETICO] Pago proveedor USD', cuenta: USD, edge: 'usd' });
  movs.push({ codigo: cod(), fecha: '2026-04-20', tipo: 'Ingreso', monto: 2000, moneda: 'USD', tc: 3.78, desc: '[SINTETICO] Cobro USD', cuenta: USD, edge: 'usd' });
  const tidU = '11111111-1111-1111-1111-111111110002';
  movs.push({ codigo: cod(), fecha: '2026-04-12', tipo: 'Egreso', monto: 3700, moneda: 'PEN', desc: '[SINTETICO] Transfer PEN→USD salida', cuenta: BCP, transferId: tidU, edge: 'usd_transfer' });
  movs.push({ codigo: cod(), fecha: '2026-04-12', tipo: 'Ingreso', monto: 1000, moneda: 'USD', tc: 3.70, desc: '[SINTETICO] Transfer PEN→USD entrada', cuenta: USD, transferId: tidU, edge: 'usd_transfer' });

  // N · EDGE 15 · GAP de cuenta (mov sin cuentaId → movimientosSinCuenta en shadow)
  movs.push({ codigo: cod(), fecha: '2026-04-08', tipo: 'Egreso', monto: 608.03, moneda: 'PEN', desc: 'Pago sin cuenta asignada', numop: '543743', cuenta: null, edge: 'gap_cuenta' });

  // O · EDGE 11 · RETROACTIVO (fecha marzo dentro de la carga de abril)
  movs.push({ codigo: cod(), fecha: '2026-03-31', tipo: 'Egreso', monto: 300, moneda: 'PEN', desc: 'Gasto retroactivo (marzo)', cuenta: BCP, edge: 'retroactivo' });

  // ── inserciones ──
  const rows = movs.map((m) => {
    const tc = m.moneda === 'USD' ? (m.tc ?? 1) : 1;
    const montoBase = (m.monto * tc).toFixed(2);
    return {
      codigo: m.codigo, fecha: m.fecha, tipoMovimiento: m.tipo, monto: m.monto.toFixed(2), moneda: m.moneda,
      tipoCambio: tc.toFixed(4), montoBase, descripcion: m.desc, numOperacion: m.numop ?? null,
      cuentaId: m.cuenta ?? null, proyectoId: m.proyecto ?? null, clienteId: m.clienteId ?? null,
      clienteNombre: m.clienteNombre ?? null, ordenCompraId: m.ocId ?? null, valorizacionId: m.valoId ?? null,
      transferenciaId: m.transferId ?? null, userId: USER, fuentePago: 'Cuenta Corriente',
    };
  });
  await db.insert(schema.movimientos).values(rows as never);

  // extracto real (todas las líneas de abril)
  const [ext] = await db.insert(schema.extractosBancarios).values({
    cuentaId: BCP, banco: 'BCP', moneda: 'PEN', nombreArchivo: 'EECC_Abr2026_039.pdf', totalFilas: lineas.length, importadoPor: USER,
  }).returning();
  await db.insert(schema.extractoLineas).values(lineas.map((l) => ({
    extractoId: ext!.id, fecha: l.fecha, descripcion: l.descripcion, referencia: l.referencia,
    monto: l.monto.toFixed(2), moneda: 'PEN',
  })));

  // estado OC + valo (para que /generar asiente legacy)
  await db.update(schema.ordenesCompra).set({ estadoPago: 'pagada', pagadoEn: new Date('2026-04-15') } as never).where(inArray(schema.ordenesCompra.id, OCS));
  await db.update(schema.valorizaciones).set({ status: 'cobrada' } as never).where(eq(schema.valorizaciones.id, VALO));

  const manifest = {
    fase: 'F3-seed', fecha_seed: '2026-04', movimientos: rows.length, codigoPrefix: 'SIM-',
    extractoId: ext!.id, extractoLineas: lineas.length, ocsPagadas: OCS, valoCobrada: VALO,
    edgeCases: movs.filter((m) => m.edge).map((m) => ({ codigo: m.codigo, edge: m.edge, desc: m.desc })),
    rollback: ["DELETE FROM movimientos WHERE codigo LIKE 'SIM-%';", `DELETE FROM extractos_bancarios WHERE id='${ext!.id}';`, `UPDATE ordenes_compra SET estado_pago='pendiente', pagado_en=NULL WHERE id IN (${OCS.map((o) => `'${o}'`).join(',')});`, `UPDATE valorizaciones SET status='facturada' WHERE id='${VALO}';`],
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log('SEED OK · movimientos:', rows.length, '· extracto lineas:', lineas.length, '· edge cases:', manifest.edgeCases.length);
  console.log('manifest →', MANIFEST);
}
main().then(() => process.exit(0)).catch((e) => { console.error('SEED ERR', e); process.exit(1); });
