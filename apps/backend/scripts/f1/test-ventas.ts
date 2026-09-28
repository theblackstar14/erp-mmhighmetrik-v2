/**
 * F3.1 · Test del registro de ventas standalone (in-process, routers reales).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-ventas.ts
 * Cubre: A alta con detracción + retención 3% + crédito/cuotas → CxC abierta + detracción pendiente ·
 * B duplicado serie/número → 409 · C /generar → asiento 1212/7041+40111 cuadrado ·
 * D NC aplica contra la factura (saldo CxC baja) y asienta invertido ·
 * E el 14.1 del período incluye la venta con serie/número reales (adiós placeholder).
 * Período 2024-10 (aislado). Limpia lo que crea. Exit 0 = verde.
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
const PERIODO = '2024-10';
const ventaIds: string[] = [];

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
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`http://localhost:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };

  try {
    console.log('════ F3.1 · ventas standalone ════');

    // A · factura con detracción 030 + retención 3% + crédito 1 cuota
    const A = await post('/api/ventas', {
      clienteRuc: '20297832761', clienteRazon: 'CONSTRUCTORA Y CONSULTORA TENORIO SAC',
      tipoCpe: '01', serie: 'F900', numero: '100', fechaEmision: '2024-10-10', fechaVencimiento: '2024-11-09',
      base: 10000, igv: 1800, total: 11800, origenTipo: 'contrato', numContrato: 'CT-2024-001',
      formaPago: 'Credito', cuotas: [{ monto: 11446, vence: '2024-11-09' }],
      retencionIgv: 354, comprobanteRetencion: 'R001-0099',
      detraccion: { codigo: '030' },
      cuentaContable: '7041', cuentaContableOrigen: 'USUARIO',
    });
    assert.equal(A.status, 200, `A crea (${JSON.stringify(A.body).slice(0, 200)})`);
    ventaIds.push(A.body.venta.id);
    assert.equal(A.body.documento.tipo, 'cxc', 'A: CxC creada');
    assert.equal(Number(A.body.documento.saldoPendiente), 11800, 'A: saldo = total');
    assert.equal(A.body.detraccion.estado, 'pendiente', 'A: detracción pendiente');
    assert.equal(Number(A.body.detraccion.monto), 472, 'A: detracción 4% de 11800 = 472');
    console.log('  ✓ A alta: CxC 11,800 abierta · detracción 030 = 472 · retención 3% = 354 registrada');

    // B · duplicado
    const B = await post('/api/ventas', { clienteRuc: '20297832761', tipoCpe: '01', serie: 'F900', numero: '100', fechaEmision: '2024-10-11', base: 1, igv: 0, total: 1 });
    assert.equal(B.status, 409, `B duplicado → 409 (${B.status})`);
    console.log('  ✓ B duplicado serie/número rechazado');

    // C · motor: asiento de devengo
    const g = await post('/api/contabilidad/generar', { periodo: PERIODO });
    assert.equal(g.status, 200, 'C generar ok');
    assert.equal(g.body.detalle.ventas, 1, `C: 1 venta asentada (${JSON.stringify(g.body.detalle)})`);
    const [as] = await db.select().from(schema.asientos).where(and(eq(schema.asientos.origen, 'venta'), eq(schema.asientos.origenId, A.body.venta.id)));
    assert.ok(as, 'C: asiento existe');
    const ls = await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, as!.id));
    assert.equal(Number(ls.find((l) => l.cuenta === '1212')!.debe), 11800, 'C: 1212 debe total');
    assert.equal(Number(ls.find((l) => l.cuenta === '7041')!.haber), 10000, 'C: 7041 haber base');
    assert.equal(Number(ls.find((l) => l.cuenta === '40111')!.haber), 1800, 'C: IGV débito');
    console.log('  ✓ C devengo: 1212=11,800 / 7041=10,000 + 40111=1,800');

    // D · NC de venta por 2,360 → aplica contra F900-100 y asienta invertido
    const D = await post('/api/ventas', {
      clienteRuc: '20297832761', clienteRazon: 'CONSTRUCTORA Y CONSULTORA TENORIO SAC',
      tipoCpe: '07', serie: 'FC90', numero: '10', fechaEmision: '2024-10-20',
      base: 2000, igv: 360, total: 2360, motivoNota: '01',
      docModifica: { serie: 'F900', numero: '100' },
    });
    assert.equal(D.status, 200, `D crea NC (${JSON.stringify(D.body).slice(0, 200)})`);
    ventaIds.push(D.body.venta.id);
    assert.equal(Number(D.body.documento.saldoPendiente), 9440, 'D: saldo CxC 11,800 − 2,360 = 9,440');
    const g2 = await post('/api/contabilidad/generar', { periodo: PERIODO });
    assert.equal(g2.body.detalle.ventas, 1, 'D: NC asentada');
    const [asNc] = await db.select().from(schema.asientos).where(and(eq(schema.asientos.origen, 'venta'), eq(schema.asientos.origenId, D.body.venta.id)));
    const lsNc = await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, asNc!.id));
    assert.equal(Number(lsNc.find((l) => l.cuenta === '7041')!.debe), 2000, 'D: NC revierte ingreso (7041 debe)');
    assert.equal(Number(lsNc.find((l) => l.cuenta === '1212')!.haber), 2360, 'D: NC acredita 1212');
    console.log('  ✓ D NC: saldo CxC 9,440 · asiento invertido cuadrado');

    // E · 14.1 con serie/número reales
    const rp = await fetch(`http://localhost:${port}/api/contabilidad/ple?periodo=${PERIODO}&libro=14.1`, { headers: { cookie } });
    const txt = await rp.text();
    assert.ok(txt.includes('F900') && txt.includes('100'), 'E: 14.1 contiene F900-100');
    assert.ok(txt.includes('FC90'), 'E: 14.1 contiene la NC FC90');
    console.log('  ✓ E el 14.1 lleva los comprobantes reales (placeholder muerto)');

    console.log('\n  ✅ F3.1 ventas VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    if (ventaIds.length) {
      await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, 'venta'), inArray(schema.asientos.origenId, ventaIds)));
      await db.delete(schema.detraccionDocumento).where(and(eq(schema.detraccionDocumento.docOrigenTipo, 'venta'), inArray(schema.detraccionDocumento.docOrigenId, ventaIds)));
      const docs = await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente)
        .where(and(eq(schema.documentoPendiente.docOrigenTipo, 'venta'), inArray(schema.documentoPendiente.docOrigenId, ventaIds)));
      if (docs.length) await db.delete(schema.aplicacionDocumento).where(inArray(schema.aplicacionDocumento.documentoPendienteId, docs.map((d) => d.id)));
      await db.delete(schema.documentoPendiente).where(and(eq(schema.documentoPendiente.docOrigenTipo, 'venta'), inArray(schema.documentoPendiente.docOrigenId, ventaIds)));
      await db.delete(schema.ventas).where(inArray(schema.ventas.id, ventaIds));
    }
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
