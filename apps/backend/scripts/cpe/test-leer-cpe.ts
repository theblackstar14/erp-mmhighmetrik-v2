/**
 * Lector CPE · 20 XML públicos aceptados/rechazados + 24 de Greenter rechazados + 6 reales MMH (si están).
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/cpe/test-leer-cpe.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CpeError, leerCpe, type CpeLeido } from '../../src/lib/cpe/leerCpe.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const leer = (rel: string) => leerCpe(fs.readFileSync(path.join(DIR, rel)));
const FFFD = String.fromCharCode(65533);

type E = Partial<{ tipo: string; tipoOperacion: string; formaPago: string; cuotas: number; lineas: number; total: number; detraccion: [string, number, number]; percepcion: string; retencion: boolean; anticipos: number; totalAnticipos: number; modifica: [string, string] }>;
function verificar(nombre: string, r: CpeLeido, e: E) {
  const m = (campo: string) => `${nombre} · ${campo}`;
  if (e.tipo) assert.equal(r.tipo, e.tipo, m('tipo'));
  if (e.tipoOperacion) assert.equal(r.tipoOperacion, e.tipoOperacion, m('tipoOperacion'));
  if (e.formaPago) assert.equal(r.formaPago, e.formaPago, m('formaPago'));
  if (e.cuotas !== undefined) assert.equal(r.cuotas.length, e.cuotas, m('cuotas'));
  if (e.lineas !== undefined) assert.equal(r.lineas.length, e.lineas, m('lineas'));
  if (e.total !== undefined) assert.equal(r.totales.total, e.total, m('total'));
  if (e.detraccion) assert.deepEqual([r.detraccion?.codigo, r.detraccion?.porcentaje, r.detraccion?.monto], e.detraccion, m('detraccion'));
  else assert.equal(r.detraccion, null, m('sin detraccion'));
  if (e.percepcion) assert.equal(r.percepcion?.codigo, e.percepcion, m('percepcion'));
  if (e.retencion) assert.ok(r.retencion && r.retencion.monto > 0, m('retencion'));
  if (e.anticipos !== undefined) assert.equal(r.anticipos.length, e.anticipos, m('anticipos'));
  if (e.totalAnticipos !== undefined) assert.equal(r.totales.anticipos, e.totalAnticipos, m('totales.anticipos'));
  if (e.modifica) assert.deepEqual([r.modifica?.serieNumero, r.modifica?.motivo], e.modifica, m('modifica'));
  assert.match(r.hash, /^[0-9a-f]{64}$/, m('hash'));
  assert.ok(!JSON.stringify(r).includes(FFFD), m('sin caracteres rotos'));
}

// ── GasperSoft (UBL 2.1) aceptados ──
const GS: Record<string, E> = {
  '01-F001-1': { tipo: '01', tipoOperacion: '0101', formaPago: 'Credito', cuotas: 1, lineas: 1, total: 118 },
  '01-F001-2': { tipo: '01', formaPago: 'Contado', lineas: 1, total: 0 },
  '01-F001-3': { tipoOperacion: '1001', detraccion: ['022', 12, 123], formaPago: 'Contado', total: 1180 },
  '01-F001-4': { lineas: 5, total: 423225 },
  '01-F001-5': { tipoOperacion: '2001', percepcion: '51', lineas: 3, total: 71354.99 },
  '01-F001-6': { anticipos: 2, totalAnticipos: 236, total: 944 },
  '01-F001-7': { anticipos: 2, totalAnticipos: 1180, total: 0 },
  '01-F001-8': { retencion: true, total: 1180 },
  '01-F001-9': { tipoOperacion: '2001', percepcion: '52', total: 1180 },
  '01-F001-10': { formaPago: 'Credito', cuotas: 1, total: 118 },
  '01-F001-11': { formaPago: 'Contado', total: 118 },
  '03-B001-1': { tipo: '03', lineas: 3, total: 1660.6 },
  '03-B001-2': { tipo: '03', lineas: 2, total: 11.5 },
  '03-B001-3': { tipo: '03', lineas: 2, total: 10.5 },
  '03-B001-4': { tipo: '03', lineas: 1, total: 0 },
  '07-F001-1': { tipo: '07', modifica: ['F001-1', '13'], cuotas: 2, lineas: 1, total: 0 },
};
for (const [f, e] of Object.entries(GS)) {
  const r = leer(`publicos/gaspersoft/20606433094-${f}.xml`);
  assert.equal(r.emisor.ruc, '20606433094', `${f} emisor`);
  verificar(f, r, e);
}
console.log(`  ✓ ${Object.keys(GS).length} GasperSoft aceptados`);

// ── rechazos: guías, retención/percepción (UBL 2.0), todo Greenter (UBL 2.0, RHE, guía) ──
const rechazos = ['09-T001-1', '20-R001-1', '20-R001-2', '31-V001-1'].map((f) => `publicos/gaspersoft/20606433094-${f}.xml`);
for (const sub of ['invoice', 'note', 'perception', 'retention', 'rrhh', 'clavesol', 'guias']) {
  for (const f of fs.readdirSync(path.join(DIR, 'publicos/greenter', sub))) rechazos.push(`publicos/greenter/${sub}/${f}`);
}
for (const rel of rechazos) {
  assert.throws(() => leer(rel), (e) => e instanceof CpeError, `${rel} debe rechazarse con CpeError`);
}
assert.throws(() => leerCpe(Buffer.from('<Invoice><sin cerrar>')), (e) => e instanceof CpeError && e.code === 'XML_INVALIDO', 'XML roto');
console.log(`  ✓ ${rechazos.length} rechazados + XML roto`);

// ── reales MMH (solo si están en la máquina) ──
const mmh = path.join(DIR, 'mmh');
if (fs.existsSync(mmh)) {
  const r69 = leer('mmh/FACTURAE001-6920610639764.XML');
  verificar('E001-69', r69, { tipo: '01', tipoOperacion: '1001', detraccion: ['019', 10, 3761], formaPago: 'Credito', cuotas: 1, lineas: 7, total: 37611.44 });
  assert.deepEqual([r69.serie, r69.numero, r69.fechaEmision, r69.emisor.ruc, r69.cliente.numero], ['E001', '69', '2025-06-16', '20610639764', '20608496859']);
  assert.deepEqual([r69.detraccion?.cuentaBn, r69.cuotas[0], r69.totales.igv, r69.totales.valorVenta], ['00003354431', { monto: 33850.44, vence: '2025-07-04' }, 5737.34, 31874.1]);
  assert.match(r69.emisor.razonSocial ?? '', /HIGH METRIK/);

  const r70 = leer('mmh/FACTURAE001-7020610639764.XML');
  verificar('E001-70', r70, { tipoOperacion: '0101', formaPago: 'Contado', lineas: 1, total: 1000 });
  assert.deepEqual([r70.cliente.numero, r70.fechaEmision, r70.totales.igv, r70.lineas[0].afectacionIgv], ['20610780572', '2025-07-30', 0, '20']);

  const r72 = leer('mmh/FACTURAE001-7220610639764.XML');
  verificar('E001-72', r72, { tipoOperacion: '1001', detraccion: ['030', 4, 1560], formaPago: 'Credito', cuotas: 1, lineas: 1, total: 39000 });
  assert.deepEqual([r72.ordenCompra, r72.detraccion?.cuentaBn, r72.cuotas[0], r72.cliente.numero, r72.totales.igv], ['OS2500333', '00003354431', { monto: 37440, vence: '2025-09-25' }, '20376082114', 5949.15]);

  const nc = leer('mmh/NOTA_CREDITOE001-1720610639764.XML');
  verificar('NC E001-17', nc, { tipo: '07', modifica: ['E001-52', '01'], cuotas: 1, lineas: 1, total: 107886.86 });
  assert.deepEqual([nc.serie, nc.numero, nc.fechaEmision, nc.cliente.numero, nc.modifica?.tipo, nc.totales.igv], ['E001', '17', '2025-03-28', '20131380951', '01', 16457.32]);

  const bcp = leer('mmh/20100047218-01-FN01-40548491.xml');
  verificar('BCP FN01', bcp, { tipo: '01', tipoOperacion: '2103', formaPago: 'Contado', lineas: 4, total: 90.86 });
  assert.deepEqual([bcp.serie, bcp.numero, bcp.emisor.ruc, bcp.cliente.numero, bcp.fechaEmision, bcp.fechaVencimiento, bcp.totales.igv], ['FN01', '40548491', '20100047218', '20610639764', '2025-12-17', '2025-12-13', 0]);

  const ajena = leer('mmh/FACTURAE001-172020613703340.xml');
  verificar('E001-1720', ajena, { tipoOperacion: '0101', formaPago: 'Credito', cuotas: 1, lineas: 4, total: 18698.52 });
  assert.deepEqual([ajena.emisor.ruc, ajena.cliente.numero, ajena.fechaVencimiento, ajena.totales.igv, ajena.totales.valorVenta], ['20613703340', '20609286360', '2025-12-03', 2852.32, 15846.2]);
  console.log('  ✓ 6 reales MMH');
} else console.log('  ⏭  fixtures/mmh no existe (maquina sin datos del cliente)');

console.log('leer-cpe VERDE');
process.exit(0);
