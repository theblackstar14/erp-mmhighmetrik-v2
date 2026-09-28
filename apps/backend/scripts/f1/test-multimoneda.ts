/**
 * F3.6 · Test multimoneda (in-process, routers reales · sin red: el fetch SUNAT no se prueba).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-multimoneda.ts
 * Seed TC manual (3.80 emisión · 3.72 y 3.70 pagos) → A compra USD devenga en PEN al TC del doc ·
 * B pago USD a menor TC → ganancia 776 · C venta USD devenga en PEN · D cobro USD a menor TC →
 * pérdida 675. Aplicaciones llevan el TC snapshot del documento. Post-cutover (2026-08).
 * Limpia lo que crea (TC seed incluido). DATABASE_URL=erp_mmh_test. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import finanzasRoutes from '../../src/routes/finanzas.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import catalogosRoutes from '../../src/routes/catalogos.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, eq, inArray } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const PERIODO = '2026-08';
const RUC = '20512349876';
const TC_FECHAS = ['2026-08-05', '2026-08-20', '2026-08-25'];
const gastoIds: string[] = [];
const ventaIds: string[] = [];
const movIds: string[] = [];

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api', finanzasRoutes);
  app.use('/api/contabilidad', contabilidadRoutes);
  app.use('/api/catalogos', catalogosRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://localhost:${port}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const lineasDe = async (origen: string, origenId: string) => {
    const [a] = await db.select().from(schema.asientos).where(and(eq(schema.asientos.origen, origen), eq(schema.asientos.origenId, origenId)));
    if (!a) return null;
    return { asiento: a, lineas: await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, a.id)) };
  };
  const linea = (ls: any[], cuenta: string) => ls.find((l) => l.cuenta === cuenta);
  const [bcp] = await db.select({ id: schema.cuentasBancarias.id }).from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, '194-9927833-0-39'));

  try {
    console.log('════ F3.6 · multimoneda ════');

    // Seed TC manual (venta: 3.80 · 3.72 · 3.70)
    const tcPut = await call('PUT', '/catalogos/tipo-cambio', { filas: [
      { fecha: '2026-08-05', moneda: 'USD', compra: 3.75, venta: 3.80 },
      { fecha: '2026-08-20', moneda: 'USD', compra: 3.68, venta: 3.72 },
      { fecha: '2026-08-25', moneda: 'USD', compra: 3.66, venta: 3.70 },
    ] });
    assert.equal(tcPut.status, 200, `seed TC (${JSON.stringify(tcPut.body).slice(0, 150)})`);
    const tcGet = await call('GET', '/catalogos/tipo-cambio?fecha=2026-08-20&moneda=USD');
    assert.equal(tcGet.body.venta, 3.72, 'GET tipo-cambio devuelve el TC del día');

    // A · compra USD 118 (el backend busca TC 3.80 solo) → CxP en USD con TC snapshot
    const A = await call('POST', '/gastos', { fecha: '2026-08-05', tipoGasto: 'Gasto Administrativo', proveedorRuc: RUC, proveedorRazon: 'MULTIMONEDA TEST SAC', tipoComprobante: 'Factura', serie: 'F00X', numero: '101', moneda: 'USD', subtotal: 100, igv: 18, total: 118, destino: 'corporativo' });
    assert.equal(A.status, 200, `A compra USD (${JSON.stringify(A.body).slice(0, 200)})`);
    gastoIds.push(A.body.gasto.id);
    assert.equal(Number(A.body.documento.tipoCambio), 3.8, 'A: CxP con TC snapshot 3.80');
    assert.equal(Number(A.body.documento.montoPen), 448.4, 'A: montoPen 448.40');

    // B · pago USD 118 al TC 3.72 aplicado a la factura
    const B = await call('POST', '/movimientos', { fecha: '2026-08-20', tipoMovimiento: 'Egreso', cuentaId: bcp!.id, moneda: 'USD', tipoCambio: 3.72, monto: 118, subtotal: 118, igv: 0, clienteNombre: 'MULTIMONEDA TEST SAC', descripcion: 'Pago factura USD', aplicaciones: [{ documentoPendienteId: A.body.documento.id, monto: 118 }] });
    assert.equal(B.status, 200, `B pago USD (${JSON.stringify(B.body).slice(0, 200)})`);
    movIds.push(B.body.movimiento.id);
    assert.equal(B.body.aplicadas, 1, 'B: aplicado al doc');

    // C · venta USD 118 al TC 3.80
    const C = await call('POST', '/ventas', { clienteRuc: '20100070970', clienteRazon: 'CLIENTE USD SAC', serie: 'E00X', numero: '501', fechaEmision: '2026-08-06', moneda: 'USD', tipoCambio: 3.8, base: 100, igv: 18, total: 118 });
    assert.equal(C.status, 200, `C venta USD (${JSON.stringify(C.body).slice(0, 200)})`);
    ventaIds.push(C.body.venta.id);

    // D · cobro USD 118 al TC 3.70 aplicado a la venta
    const D = await call('POST', '/movimientos', { fecha: '2026-08-25', tipoMovimiento: 'Ingreso', cuentaId: bcp!.id, moneda: 'USD', tipoCambio: 3.70, monto: 118, subtotal: 118, igv: 0, clienteNombre: 'CLIENTE USD SAC', descripcion: 'Cobro venta USD', aplicaciones: [{ documentoPendienteId: C.body.documento.id, monto: 118 }] });
    assert.equal(D.status, 200, `D cobro USD (${JSON.stringify(D.body).slice(0, 200)})`);
    movIds.push(D.body.movimiento.id);

    // motor · una pasada
    const gen = await call('POST', '/contabilidad/generar', { periodo: PERIODO });
    assert.equal(gen.status, 200, 'generar ok');

    const rA = await lineasDe('gasto', A.body.gasto.id);
    assert.ok(rA, 'A: asiento devengo existe');
    assert.equal(rA!.asiento.moneda, 'USD', 'A: header moneda USD');
    assert.equal(Number(linea(rA!.lineas, '40111')?.debe), 68.4, 'A: IGV en PEN 68.40 (18×3.80)');
    assert.equal(Number(linea(rA!.lineas, '4212')?.haber), 448.4, 'A: CxP en PEN 448.40');
    console.log(`  ✓ A devengo compra USD en PEN: gasto 380 + IGV 68.40 / 4212 448.40 (TC 3.80)`);

    const rB = await lineasDe('movimiento', movIds[0]!);
    assert.ok(rB, 'B: asiento pago existe');
    assert.equal(Number(linea(rB!.lineas, '4212')?.debe), 448.4, 'B: cancela la CxP a su TC (448.40)');
    assert.equal(Number(linea(rB!.lineas, '776')?.haber), 9.44, 'B: ganancia 776 = 9.44 (118×0.08)');
    console.log(`  ✓ B pago USD TC 3.72: 4212 448.40 / banco 438.96 + 776 9.44 (${rB!.asiento.correlativo})`);

    const rC = await lineasDe('venta', ventaIds[0]!);
    assert.equal(Number(linea(rC!.lineas, '1212')?.debe), 448.4, 'C: CxC en PEN 448.40');
    console.log('  ✓ C devengo venta USD en PEN: 1212 448.40 / 7041 380 + IGV 68.40');

    const rD = await lineasDe('movimiento', movIds[1]!);
    assert.equal(Number(linea(rD!.lineas, '1212')?.haber), 448.4, 'D: cancela la CxC a su TC');
    assert.equal(Number(linea(rD!.lineas, '675')?.debe), 11.8, 'D: pérdida 675 = 11.80 (118×0.10)');
    console.log(`  ✓ D cobro USD TC 3.70: banco 436.60 + 675 11.80 / 1212 448.40 (${rD!.asiento.correlativo})`);

    console.log('\n  ✅ F3.6 multimoneda VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    if (movIds.length) {
      await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, 'movimiento'), inArray(schema.asientos.origenId, movIds)));
      await db.delete(schema.aplicacionDocumento).where(and(eq(schema.aplicacionDocumento.origenTipo, 'movimiento'), inArray(schema.aplicacionDocumento.origenId, movIds)));
      await db.delete(schema.movimientos).where(inArray(schema.movimientos.id, movIds));
    }
    for (const [tipo, ids] of [['gasto', gastoIds], ['venta', ventaIds]] as const) {
      if (!ids.length) continue;
      await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, tipo), inArray(schema.asientos.origenId, ids)));
      const docs = await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente)
        .where(and(eq(schema.documentoPendiente.docOrigenTipo, tipo), inArray(schema.documentoPendiente.docOrigenId, ids)));
      if (docs.length) await db.delete(schema.aplicacionDocumento).where(inArray(schema.aplicacionDocumento.documentoPendienteId, docs.map((d) => d.id)));
      await db.delete(schema.documentoPendiente).where(and(eq(schema.documentoPendiente.docOrigenTipo, tipo), inArray(schema.documentoPendiente.docOrigenId, ids)));
    }
    if (gastoIds.length) {
      await db.delete(schema.gastoLineas).where(inArray(schema.gastoLineas.gastoId, gastoIds));
      await db.delete(schema.gastos).where(inArray(schema.gastos.id, gastoIds));
    }
    if (ventaIds.length) await db.delete(schema.ventas).where(inArray(schema.ventas.id, ventaIds));
    await db.delete(schema.tipoCambio).where(and(eq(schema.tipoCambio.moneda, 'USD'), inArray(schema.tipoCambio.fecha, TC_FECHAS)));
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
