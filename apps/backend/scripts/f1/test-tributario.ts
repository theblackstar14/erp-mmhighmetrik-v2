/**
 * F3.5 · Test tributario fino (in-process, routers reales).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-tributario.ts
 * A boleta → IGV al costo (sin 40111) · B destino DNG → IGV al costo · C duplicado exacto 409,
 * prorrateo parcial pasa · D NC de compra → asiento INVERTIDO (4212 / gasto + 40111) ·
 * E periodo de anotación: la compra sale del 8.1 de emisión y entra al del periodoContable;
 * la boleta NO entra al 8.1. Limpia lo que crea. DATABASE_URL=erp_mmh_test. Exit 0 = verde.
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
const PERIODO_ANOTACION = '2026-09';
const RUC = '20698765432';
const gastoIds: string[] = [];

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
  const filas81 = async (periodo: string) => (await call('GET', `/contabilidad/ple/resumen?periodo=${periodo}`)).body.libros['8.1'].filas as number;
  const lineasDe = async (gastoId: string) => {
    const [a] = await db.select().from(schema.asientos).where(and(eq(schema.asientos.origen, 'gasto'), eq(schema.asientos.origenId, gastoId)));
    if (!a) return null;
    return { asiento: a, lineas: await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, a.id)) };
  };

  try {
    console.log('════ F3.5 · tributario fino ════');
    const base07 = await filas81(PERIODO);
    const base09 = await filas81(PERIODO_ANOTACION);

    // A · boleta: IGV al costo, sin línea 40111
    const A = await call('POST', '/gastos', { fecha: '2026-07-08', tipoGasto: 'Gasto Administrativo', proveedorRuc: RUC, proveedorRazon: 'TRIBUTARIO TEST SAC', tipoComprobante: 'Boleta', serie: 'B001', numero: '501', subtotal: 100, igv: 18, total: 118, destino: 'corporativo' });
    assert.equal(A.status, 200, `A boleta (${JSON.stringify(A.body).slice(0, 150)})`);
    gastoIds.push(A.body.gasto.id);

    // B · factura DNG: IGV al costo también
    const B = await call('POST', '/gastos', { fecha: '2026-07-09', tipoGasto: 'Gasto Administrativo', proveedorRuc: RUC, proveedorRazon: 'TRIBUTARIO TEST SAC', tipoComprobante: 'Factura', serie: 'F001', numero: '9001', subtotal: 200, igv: 36, total: 236, destino: 'corporativo', destinoCredito: 'DNG' });
    assert.equal(B.status, 200, `B DNG (${JSON.stringify(B.body).slice(0, 150)})`);
    gastoIds.push(B.body.gasto.id);

    // C · duplicado (mismo RUC+serie+número) → 409, aunque el total difiera (dedup a nivel CxP)
    const C1 = await call('POST', '/gastos', { fecha: '2026-07-09', tipoGasto: 'Gasto Administrativo', proveedorRuc: RUC, proveedorRazon: 'TRIBUTARIO TEST SAC', tipoComprobante: 'Factura', serie: 'F001', numero: '9001', subtotal: 200, igv: 36, total: 236, destino: 'corporativo' });
    assert.equal(C1.status, 409, 'C: duplicado exacto rechazado');
    const C2 = await call('POST', '/gastos', { fecha: '2026-07-09', tipoGasto: 'Gasto Administrativo', proveedorRuc: RUC, proveedorRazon: 'TRIBUTARIO TEST SAC', tipoComprobante: 'Factura', serie: 'F001', numero: '9001', subtotal: 50, igv: 9, total: 59, destino: 'corporativo' });
    assert.equal(C2.status, 409, 'C: duplicado con total distinto también rechazado');
    console.log('  ✓ C duplicado RUC+serie+número → 409 (con o sin mismo total)');

    // D · factura + NC de compra a mitad
    const D1 = await call('POST', '/gastos', { fecha: '2026-07-10', tipoGasto: 'Gasto Administrativo', proveedorRuc: RUC, proveedorRazon: 'TRIBUTARIO TEST SAC', tipoComprobante: 'Factura', serie: 'F001', numero: '9002', subtotal: 1000, igv: 180, total: 1180, destino: 'corporativo' });
    assert.equal(D1.status, 200, 'D factura base');
    gastoIds.push(D1.body.gasto.id);
    const D2 = await call('POST', '/gastos', { fecha: '2026-07-12', tipoGasto: 'Gasto Administrativo', proveedorRuc: RUC, proveedorRazon: 'TRIBUTARIO TEST SAC', tipoComprobante: 'Nota de Crédito', serie: 'N001', numero: '77', subtotal: 500, igv: 90, total: 590, destino: 'corporativo', docModifica: { serie: 'F001', numero: '9002' } });
    assert.equal(D2.status, 200, `D NC (${JSON.stringify(D2.body).slice(0, 150)})`);
    gastoIds.push(D2.body.gasto.id);
    const [docD] = await db.select().from(schema.documentoPendiente).where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), eq(schema.documentoPendiente.docOrigenId, D1.body.gasto.id)));
    assert.equal(Number(docD!.saldoPendiente), 590, 'D: NC bajó la CxP a 590');

    // E · periodo de anotación distinto al de emisión
    const E = await call('POST', '/gastos', { fecha: '2026-07-15', tipoGasto: 'Gasto Administrativo', proveedorRuc: RUC, proveedorRazon: 'TRIBUTARIO TEST SAC', tipoComprobante: 'Factura', serie: 'F001', numero: '9003', subtotal: 300, igv: 54, total: 354, destino: 'corporativo', periodoContable: PERIODO_ANOTACION });
    assert.equal(E.status, 200, 'E compra con periodoContable');
    gastoIds.push(E.body.gasto.id);

    // motor · una sola pasada del periodo
    const gen = await call('POST', '/contabilidad/generar', { periodo: PERIODO });
    assert.equal(gen.status, 200, 'generar ok');

    const rA = await lineasDe(A.body.gasto.id);
    assert.ok(rA, 'A: asiento boleta existe');
    assert.ok(!rA!.lineas.some((l) => l.cuenta === '40111'), 'A: boleta sin 40111');
    assert.ok(rA!.lineas.some((l) => Number(l.debe) === 118 && l.cuenta !== '4212'), 'A: gasto al costo 118 (100+18)');
    console.log('  ✓ A boleta: IGV al costo · sin crédito 40111');

    const rB = await lineasDe(B.body.gasto.id);
    assert.ok(!rB!.lineas.some((l) => l.cuenta === '40111'), 'B: DNG sin 40111');
    assert.ok(rB!.lineas.some((l) => Number(l.debe) === 236 && l.cuenta !== '4212'), 'B: gasto al costo 236');
    console.log('  ✓ B destino DNG: IGV al costo');

    const rD = await lineasDe(D2.body.gasto.id);
    assert.ok(rD, 'D: asiento NC existe');
    assert.ok(rD!.lineas.some((l) => l.cuenta === '4212' && Number(l.debe) === 590), 'D: NC debe 4212');
    assert.ok(rD!.lineas.some((l) => l.cuenta === '40111' && Number(l.haber) === 90), 'D: NC reversa 40111');
    assert.ok(rD!.lineas.some((l) => l.cuenta !== '4212' && l.cuenta !== '40111' && Number(l.haber) === 500), 'D: NC reversa gasto 500');
    console.log(`  ✓ D NC asiento INVERTIDO ${rD!.asiento.correlativo}: 4212 590 / gasto 500 + 40111 90 · CxP 590`);

    // 8.1 · emisión: entran F9001, F9002 y la NC (3) · boleta y la anotada en 09 NO
    const f07 = await filas81(PERIODO);
    const f09 = await filas81(PERIODO_ANOTACION);
    assert.equal(f07, base07 + 3, `8.1 ${PERIODO}: +3 (boleta y anotada-en-09 fuera) · ${base07}→${f07}`);
    assert.equal(f09, base09 + 1, `8.1 ${PERIODO_ANOTACION}: +1 (la anotada) · ${base09}→${f09}`);
    console.log(`  ✓ E 8.1: ${PERIODO} +3 (sin boleta ni anotada-en-otro-mes) · ${PERIODO_ANOTACION} +1`);

    console.log('\n  ✅ F3.5 tributario VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    if (gastoIds.length) {
      await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, 'gasto'), inArray(schema.asientos.origenId, gastoIds)));
      const docs = await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente)
        .where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), inArray(schema.documentoPendiente.docOrigenId, gastoIds)));
      if (docs.length) await db.delete(schema.aplicacionDocumento).where(inArray(schema.aplicacionDocumento.documentoPendienteId, docs.map((d) => d.id)));
      await db.delete(schema.aplicacionDocumento).where(and(eq(schema.aplicacionDocumento.origenTipo, 'nota'), inArray(schema.aplicacionDocumento.origenId, gastoIds)));
      await db.delete(schema.documentoPendiente).where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), inArray(schema.documentoPendiente.docOrigenId, gastoIds)));
      await db.delete(schema.gastoLineas).where(inArray(schema.gastoLineas.gastoId, gastoIds));
      await db.delete(schema.gastos).where(inArray(schema.gastos.id, gastoIds));
    }
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
