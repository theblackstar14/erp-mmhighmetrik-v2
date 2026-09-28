/**
 * F3.7 · Test OC → compra (3-way match, in-process).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-oc-compra.ts
 * Seed OC aprobada con 2 líneas (directo a DB) → A compra con ordenCompraId + líneas de la OC:
 * totales recalculados desde las líneas, gasto_lineas creadas, CxP viva y la OC queda ligada
 * (gasto_id) → B el link no se pisa con una segunda compra. Limpia lo que crea. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import finanzasRoutes from '../../src/routes/finanzas.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, eq, inArray } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const gastoIds: string[] = [];
let ocId = '';

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api', finanzasRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://localhost:${port}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };

  try {
    console.log('════ F3.7 · OC → compra (3-way) ════');

    // seed · OC aprobada con 2 líneas (300 + 200 = 500 + IGV 90 = 590)
    const [prov] = await db.select({ id: schema.proveedores.id, ruc: schema.proveedores.ruc, razon: schema.proveedores.razonSocial }).from(schema.proveedores).limit(1);
    assert.ok(prov, 'seed: hay proveedor en la DB');
    const [oc] = await db.insert(schema.ordenesCompra).values({
      numero: 'OC-TEST-9001', correlativo: 9001, anio: 2026, proveedorId: prov!.id,
      fechaEmision: '2026-07-15', moneda: 'PEN', concepto: 'BIEN', incluyeIgv: false,
      subtotalSinIgv: '500.00', igv: '90.00', total: '590.00', estado: 'aprobada',
    }).returning();
    ocId = oc!.id;
    await db.insert(schema.ocLineas).values([
      { ordenCompraId: ocId, numero: 1, descripcion: 'Cemento tipo I (test)', unidad: 'BOL', cantidad: '10', precioUnitario: '30', subtotal: '300.00' },
      { ordenCompraId: ocId, numero: 2, descripcion: 'Arena gruesa (test)', unidad: 'M3', cantidad: '4', precioUnitario: '50', subtotal: '200.00' },
    ]);

    // A · compra ligada a la OC con sus líneas (lo que arma el frontend al elegirla)
    const A = await call('POST', '/gastos', {
      fecha: '2026-07-18', tipoGasto: 'Compra Materiales', proveedorRuc: prov!.ruc, proveedorRazon: prov!.razon,
      tipoComprobante: 'Factura', serie: 'FOC1', numero: '701', destino: 'corporativo',
      subtotal: 0, igv: 0, total: 0, // el backend recalcula desde las líneas
      ordenCompraId: ocId,
      lineas: [
        { descripcion: 'Cemento tipo I (test)', unidad: 'BOL', cantidad: 10, valorUnitario: 30, afectacionIgv: '10' },
        { descripcion: 'Arena gruesa (test)', unidad: 'M3', cantidad: 4, valorUnitario: 50, afectacionIgv: '10' },
      ],
    });
    assert.equal(A.status, 200, `A compra (${JSON.stringify(A.body).slice(0, 200)})`);
    gastoIds.push(A.body.gasto.id);
    assert.equal(A.body.gasto.ordenCompraId, ocId, 'A: gasto ligado a la OC');
    assert.equal(Number(A.body.gasto.total), 590, 'A: total recalculado desde líneas (590)');
    assert.equal(Number(A.body.documento.saldoPendiente), 590, 'A: CxP 590 viva');
    const gl = await db.select().from(schema.gastoLineas).where(eq(schema.gastoLineas.gastoId, A.body.gasto.id));
    assert.equal(gl.length, 2, 'A: 2 líneas de compra');
    const [oc2] = await db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.id, ocId));
    assert.equal(oc2!.gastoId, A.body.gasto.id, 'A: OC.gastoId ligado (deja de ofrecerse)');
    console.log('  ✓ A compra desde OC: 2 líneas · total 590 desde líneas · OC ligada');

    // B · otra compra apuntando a la MISMA OC no pisa el link
    const B = await call('POST', '/gastos', {
      fecha: '2026-07-19', tipoGasto: 'Compra Materiales', proveedorRuc: prov!.ruc, proveedorRazon: prov!.razon,
      tipoComprobante: 'Factura', serie: 'FOC1', numero: '702', destino: 'corporativo',
      subtotal: 100, igv: 18, total: 118, ordenCompraId: ocId,
    });
    assert.equal(B.status, 200, 'B segunda compra ok');
    gastoIds.push(B.body.gasto.id);
    const [oc3] = await db.select().from(schema.ordenesCompra).where(eq(schema.ordenesCompra.id, ocId));
    assert.equal(oc3!.gastoId, A.body.gasto.id, 'B: el link de la OC no se pisa');
    console.log('  ✓ B el gasto_id de la OC no se sobreescribe');

    console.log('\n  ✅ F3.7 OC → compra VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    if (gastoIds.length) {
      await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, 'gasto'), inArray(schema.asientos.origenId, gastoIds)));
      const docs = await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente)
        .where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), inArray(schema.documentoPendiente.docOrigenId, gastoIds)));
      if (docs.length) await db.delete(schema.aplicacionDocumento).where(inArray(schema.aplicacionDocumento.documentoPendienteId, docs.map((d) => d.id)));
      await db.delete(schema.documentoPendiente).where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), inArray(schema.documentoPendiente.docOrigenId, gastoIds)));
      await db.delete(schema.gastoLineas).where(inArray(schema.gastoLineas.gastoId, gastoIds));
      await db.delete(schema.gastos).where(inArray(schema.gastos.id, gastoIds));
    }
    if (ocId) await db.delete(schema.ordenesCompra).where(eq(schema.ordenesCompra.id, ocId)); // oc_lineas cascade
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
