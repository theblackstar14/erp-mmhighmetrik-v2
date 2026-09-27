/**
 * F1.2 · Test del motor: anticipos de cliente (in-process, router real).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-anticipos.ts
 * Diseño validado contra la estructura de la factura electrónica SUNAT (campo "Anticipos" resta
 * la base ANTES del IGV · factura real E001-11 Doratta como referencia estructural):
 *   D adelanto pagado → 1212 total / 122 base + 40111 IGV
 *   E devengo de valo con amortización → debe 122 cancela el anticipo · ingreso 7041 bruto · IGV neto
 *   F amortización + retención conviven (122 + 12122) y el asiento cuadra
 * Limpia lo que crea. Requiere DATABASE_URL=erp_mmh_test. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, eq, inArray } from 'drizzle-orm';

const PERIODO = '2024-11'; // pre-cutover y sin data real · aislado del resto
const FECHA = '2024-11-15';
const OBRA = '4bac3de9-6930-4b69-8e0c-a4e3502955b0'; // PG0001
const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin
const valoIds: string[] = [];
const adelantoIds: string[] = [];

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/contabilidad', contabilidadRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const generar = async () => {
    const r = await fetch(`http://localhost:${port}/api/contabilidad/generar`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ periodo: PERIODO }),
    });
    return { status: r.status, body: await r.json() };
  };
  const lineasDe = async (origen: string, origenId: string) => {
    const [a] = await db.select().from(schema.asientos).where(and(eq(schema.asientos.origen, origen), eq(schema.asientos.origenId, origenId))).limit(1);
    if (!a) return null;
    return { asiento: a, lineas: await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, a.id)) };
  };
  const cuadra = (ls: { debe: string; haber: string }[]) => {
    const d = ls.reduce((s, l) => s + Number(l.debe), 0);
    const h = ls.reduce((s, l) => s + Number(l.haber), 0);
    return Math.abs(d - h) < 0.01;
  };

  try {
    console.log('════ F1.2 · anticipos de cliente (122) ════');

    // D · adelanto pagado (monto CON IGV 11,800) → factura de anticipo
    const [ad] = await db.insert(schema.adelantos).values({
      proyectoId: OBRA, tipo: 'adelanto_directo' as any, monto: '11800', estado: 'pagado' as any, fechaPago: FECHA,
    }).returning();
    adelantoIds.push(ad!.id);
    let g = await generar();
    assert.equal(g.status, 200, `D generar ok (${JSON.stringify(g.body.detalle?.errores ?? g.body)})`);
    assert.equal(g.body.detalle.adelantos, 1, 'D: contador adelantos=1');
    const ld = await lineasDe('adelanto', ad!.id);
    assert.ok(ld, 'D: asiento de anticipo existe');
    assert.equal(Number(ld!.lineas.find((l) => l.cuenta === '1212')!.debe), 11800, 'D: 1212 debe = total');
    assert.equal(Number(ld!.lineas.find((l) => l.cuenta === '122')!.haber), 10000, 'D: 122 haber = base');
    assert.equal(Number(ld!.lineas.find((l) => l.cuenta === '40111')!.haber), 1800, 'D: 40111 haber = IGV');
    assert.ok(cuadra(ld!.lineas as any), 'D: cuadra');
    console.log('  ✓ D anticipo facturado: 1212=11,800 / 122=10,000 + IGV 1,800');

    // E · valo bruta 10,000 que amortiza 2,000 → factura neta: base 8,000 · IGV 1,440 · total 9,440
    const [vE] = await db.insert(schema.valorizaciones).values({
      proyectoId: OBRA, numero: 9101, fechaDesde: '2024-11-01', fechaHasta: '2024-11-14', fechaEmision: FECHA,
      mesPeriodo: PERIODO, pctAvance: '10', status: 'aprobada' as any,
      montoCd: '10000', montoIgv: '1440', montoTotal: '9440', montoTotalConIgv: '9440',
      montoAmortizaciones: '2000',
    } as any).returning();
    valoIds.push(vE!.id);
    g = await generar();
    assert.equal(g.status, 200, `E generar ok (${JSON.stringify(g.body.detalle?.errores ?? g.body)})`);
    const le = await lineasDe('valorizacion', vE!.id);
    assert.ok(le, 'E: asiento devengo existe');
    assert.equal(Number(le!.lineas.find((l) => l.cuenta === '1212')!.debe), 9440, 'E: 1212 = total factura (neto)');
    assert.equal(Number(le!.lineas.find((l) => l.cuenta === '122')!.debe), 2000, 'E: 122 debe = amortización');
    assert.equal(Number(le!.lineas.find((l) => l.cuenta === '7041')!.haber), 10000, 'E: ingreso 7041 = bruto');
    assert.equal(Number(le!.lineas.find((l) => l.cuenta === '40111')!.haber), 1440, 'E: IGV = 0.18 × base neta');
    assert.ok(cuadra(le!.lineas as any), 'E: cuadra (11,440 = 11,440)');
    console.log('  ✓ E amortización en devengo: 1212=9,440 + 122=2,000 / 7041=10,000 + IGV 1,440');

    // F · amortización 2,000 + retención 944 conviven
    const [vF] = await db.insert(schema.valorizaciones).values({
      proyectoId: OBRA, numero: 9102, fechaDesde: '2024-11-01', fechaHasta: '2024-11-14', fechaEmision: FECHA,
      mesPeriodo: PERIODO, pctAvance: '10', status: 'aprobada' as any,
      montoCd: '10000', montoIgv: '1440', montoTotal: '9440', montoTotalConIgv: '9440',
      montoAmortizaciones: '2000', montoRetencion: '944',
    } as any).returning();
    valoIds.push(vF!.id);
    g = await generar();
    assert.equal(g.status, 200, 'F generar ok');
    const lf = await lineasDe('valorizacion', vF!.id);
    assert.equal(Number(lf!.lineas.find((l) => l.cuenta === '1212')!.debe), 8496, 'F: 1212 = 9,440 − 944');
    assert.equal(Number(lf!.lineas.find((l) => l.cuenta === '12122')!.debe), 944, 'F: 12122 = retención');
    assert.equal(Number(lf!.lineas.find((l) => l.cuenta === '122')!.debe), 2000, 'F: 122 = amortización');
    assert.ok(cuadra(lf!.lineas as any), 'F: cuadra');
    console.log('  ✓ F amortización + retención: 8,496 + 944 + 2,000 / 10,000 + 1,440 · cuadrado');

    console.log('\n  ✅ F1.2 anticipos VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    const origenIds = [...valoIds, ...adelantoIds];
    if (origenIds.length) await db.delete(schema.asientos).where(and(inArray(schema.asientos.origenId, origenIds), inArray(schema.asientos.origen, ['valorizacion', 'cobro_valo', 'adelanto'])));
    if (valoIds.length) await db.delete(schema.valorizaciones).where(inArray(schema.valorizaciones.id, valoIds));
    if (adelantoIds.length) await db.delete(schema.adelantos).where(inArray(schema.adelantos.id, adelantoIds));
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
