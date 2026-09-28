/**
 * F3.4 · Test de provisiones 48 (in-process, routers reales).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-provisiones.ts
 * Flujo Kelly: A pago sin factura (egreso cuenta contra 4811) → B motor asienta 4811/banco
 * con contraparte → C GET /provisiones la lista abierta → D llega la factura (compra normal,
 * CxP viva) → E extorno: asiento 4212/4811 + CxP saldada con el pago ORIGINAL →
 * F re-extorno rechazado (409) y la provisión queda 'extornada'.
 * Post-cutover (2026-07). Limpia lo que crea. Requiere DATABASE_URL=erp_mmh_test. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import finanzasRoutes from '../../src/routes/finanzas.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, eq, inArray } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const PERIODO = '2026-07';
const FECHA_PAGO = '2026-07-05';
const FECHA_FACTURA = '2026-07-22';
const TERCERO = 'CONTAFEL TEST SAC';
let movId = '';
let gastoId = '';

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api', finanzasRoutes);
  app.use('/api/contabilidad', contabilidadRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://localhost:${port}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const [bcp] = await db.select({ id: schema.cuentasBancarias.id }).from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, '194-9927833-0-39'));

  try {
    console.log('════ F3.4 · provisiones 48 ════');

    // A · pago sin factura: egreso con cuenta contra manual 4811
    const A = await call('POST', '/movimientos', {
      fecha: FECHA_PAGO, tipoMovimiento: 'Egreso', cuentaId: bcp!.id, monto: 1800, subtotal: 1800, igv: 0,
      clienteNombre: TERCERO, descripcion: 'Honorarios estudio contable sin factura (test)',
      numOperacion: 'TEST-PROV-01', cuentaContable: '4811', cuentaContableOrigen: 'USUARIO',
    });
    assert.equal(A.status, 200, `A paga (${JSON.stringify(A.body).slice(0, 200)})`);
    movId = A.body.movimiento.id;
    console.log('  ✓ A pago 1,800 sin factura registrado (cuenta contra 4811)');

    // B · el motor asienta Debe 4811 / Haber banco, con contraparte en el header
    const B = await call('POST', '/contabilidad/generar', { periodo: PERIODO });
    assert.equal(B.status, 200, 'B generar ok');
    const [asMov] = await db.select().from(schema.asientos).where(and(eq(schema.asientos.origen, 'movimiento'), eq(schema.asientos.origenId, movId)));
    assert.ok(asMov, 'B: asiento del movimiento existe');
    assert.equal(asMov!.contraparteRazon, TERCERO, 'B: contraparte en el header (auxiliar por tercero)');
    const lsB = await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, asMov!.id));
    assert.ok(lsB.some((l) => l.cuenta === '4811' && Number(l.debe) === 1800), 'B: Debe 4811 = 1,800');
    console.log(`  ✓ B motor: ${asMov!.correlativo} · Debe 4811 / Haber banco · contraparte ${TERCERO}`);

    // C · aparece como provisión abierta
    const C = await call('GET', '/contabilidad/provisiones');
    const pC = C.body.provisiones.find((p: any) => p.movimientoId === movId);
    assert.ok(pC, 'C: provisión listada');
    assert.equal(pC.estado, 'abierta', 'C: abierta');
    assert.equal(pC.monto, 1800, 'C: monto 1,800');
    assert.equal(pC.asentada, true, 'C: chip asentada');
    console.log('  ✓ C provisión abierta en la bandeja (1,800 · espera factura)');

    // D · llega la factura: compra normal → CxP viva de 1,800
    const D = await call('POST', '/gastos', {
      fecha: FECHA_FACTURA, tipoGasto: 'Gasto Administrativo', proveedorRuc: '20512345678', proveedorRazon: TERCERO,
      tipoComprobante: 'Factura', serie: 'E001', numero: '901', subtotal: 1525.42, igv: 274.58, total: 1800, destino: 'corporativo',
    });
    assert.equal(D.status, 200, `D compra (${JSON.stringify(D.body).slice(0, 200)})`);
    gastoId = D.body.gasto.id;
    assert.ok(D.body.documento, 'D: CxP creada');
    assert.equal(Number(D.body.documento.saldoPendiente), 1800, 'D: saldo CxP 1,800');
    console.log('  ✓ D factura E001-901 registrada · CxP 1,800 viva');

    // E · extorno: Debe 4212 / Haber 4811 + la CxP queda pagada con el pago original
    const E = await call('POST', `/contabilidad/provisiones/${movId}/extornar`, { gastoId });
    assert.equal(E.status, 200, `E extorna (${JSON.stringify(E.body).slice(0, 200)})`);
    assert.equal(E.body.aplicado, 1800, 'E: aplica 1,800');
    const lsE = await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, E.body.asiento.id));
    assert.ok(lsE.some((l) => l.cuenta === '4212' && Number(l.debe) === 1800), 'E: Debe 4212');
    assert.ok(lsE.some((l) => l.cuenta === '4811' && Number(l.haber) === 1800), 'E: Haber 4811');
    const [doc] = await db.select().from(schema.documentoPendiente).where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), eq(schema.documentoPendiente.docOrigenId, gastoId)));
    assert.equal(Number(doc!.saldoPendiente), 0, 'E: CxP saldada');
    assert.equal(doc!.estado, 'cancelado', 'E: CxP cancelada');
    console.log(`  ✓ E extorno ${E.body.asiento.correlativo}: 4212/4811 · CxP saldada sin pago nuevo`);

    // F · idempotencia: re-extornar → 409; la bandeja la muestra extornada
    const F = await call('POST', `/contabilidad/provisiones/${movId}/extornar`, { gastoId });
    assert.equal(F.status, 409, 'F: re-extorno rechazado');
    const F2 = await call('GET', '/contabilidad/provisiones');
    const pF = F2.body.provisiones.find((p: any) => p.movimientoId === movId);
    assert.equal(pF.estado, 'extornada', 'F: estado extornada');
    assert.equal(pF.extorno.asiento, E.body.asiento.correlativo, 'F: referencia al asiento de extorno');
    console.log('  ✓ F re-extorno 409 · provisión marcada extornada');

    console.log('\n  ✅ F3.4 provisiones VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    // limpieza (orden: asientos → aplicaciones/doc → gasto → movimiento)
    if (movId) {
      await db.delete(schema.asientos).where(and(inArray(schema.asientos.origen, ['movimiento', 'extorno_provision']), eq(schema.asientos.origenId, movId)));
      await db.delete(schema.aplicacionDocumento).where(and(eq(schema.aplicacionDocumento.origenTipo, 'movimiento'), eq(schema.aplicacionDocumento.origenId, movId)));
    }
    if (gastoId) {
      await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, 'gasto'), eq(schema.asientos.origenId, gastoId)));
      const docs = await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente)
        .where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), eq(schema.documentoPendiente.docOrigenId, gastoId)));
      if (docs.length) await db.delete(schema.aplicacionDocumento).where(inArray(schema.aplicacionDocumento.documentoPendienteId, docs.map((d) => d.id)));
      await db.delete(schema.documentoPendiente).where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), eq(schema.documentoPendiente.docOrigenId, gastoId)));
      await db.delete(schema.gastoLineas).where(eq(schema.gastoLineas.gastoId, gastoId));
      await db.delete(schema.gastos).where(eq(schema.gastos.id, gastoId));
    }
    if (movId) await db.delete(schema.movimientos).where(eq(schema.movimientos.id, movId));
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
