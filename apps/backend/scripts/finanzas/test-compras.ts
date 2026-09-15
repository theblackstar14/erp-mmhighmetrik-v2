/**
 * Fase 1 · compra completa por HTTP (router real): líneas, documento, detracción, USD, retención, NC, borrado.
 * Usa fechas 2099 y RUC de prueba; limpia todo lo que crea.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-compras.ts
 */
import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
import assert from 'node:assert/strict';
import express from 'express';
import { db, schema } from '@erp/db';
import { inArray, or } from 'drizzle-orm';
import { authMiddleware } from '../../src/middleware/auth.js';
import { lucia } from '../../src/auth.js';
import finanzasRoutes from '../../src/routes/finanzas.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const RUC = '20999999993';
const creados: string[] = [];
const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api', finanzasRoutes);
const server = app.listen(0);
const base = `http://localhost:${(server.address() as { port: number }).port}`;
const session = await lucia.createSession(USER, {});
const headers = { cookie: lucia.createSessionCookie(session.id).serialize(), 'content-type': 'application/json' };
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as any };
};
const compra = async (extra: Record<string, unknown>) => {
  const r = await call('POST', '/api/gastos', { fecha: '2099-01-10', destino: 'corporativo', tipoGasto: 'Compra Materiales', proveedorRuc: RUC, proveedorRazon: 'PROVEEDOR FASE1', tipoComprobante: 'Factura', serie: 'F999', moneda: 'PEN', subtotal: 1000, igv: 180, total: 1180, ...extra });
  if (r.json.gasto?.id) creados.push(r.json.gasto.id);
  return r;
};

try {
  // A · compra simple → CxP abierta, vencimiento guardado (bug L869: no se pierde si queda pendiente)
  const A = await compra({ numero: '1', fechaVencimiento: '2099-02-10' });
  assert.equal(A.status, 200, JSON.stringify(A.json));
  assert.deepEqual([A.json.documento.tipo, A.json.documento.saldoPendiente, A.json.documento.fechaVenc, A.json.gasto.fechaVencimiento], ['cxp', '1180.00', '2099-02-10', '2099-02-10']);
  const detA = await call('GET', `/api/gastos/${A.json.gasto.id}/detalle`);
  assert.deepEqual([detA.json.lineas.length, detA.json.documento.estado, detA.json.aplicaciones.length], [0, 'abierto', 0]);
  const lista = await call('GET', '/api/gastos');
  const filaA = lista.json.gastos.find((g: any) => g.id === A.json.gasto.id);
  assert.deepEqual([filaA.saldoPendiente, filaA.estadoPago], [1180, 'pendiente'], 'GET /gastos trae saldo');
  console.log('  ✓ A simple');

  // B · líneas: totales derivados en servidor + inventario por línea
  const B = await compra({ numero: '2', subtotal: 0, igv: 0, total: 0, lineas: [
    { descripcion: 'Amoladora Bosch', unidad: 'UND', cantidad: 10, valorUnitario: 45, aInventario: true, cuentaContable: '6032' },
    { descripcion: 'Flete', cantidad: 1, valorUnitario: 100, afectacionIgv: '20' },
  ] });
  assert.equal(B.status, 200, JSON.stringify(B.json));
  assert.deepEqual([B.json.gasto.subtotal, B.json.gasto.igv, B.json.gasto.exonerado, B.json.gasto.total], ['450.00', '81.00', '100.00', '631.00']);
  const detB = await call('GET', `/api/gastos/${B.json.gasto.id}/detalle`);
  assert.deepEqual(detB.json.lineas.map((l: any) => [l.numero, l.valorVenta, l.igv, l.aInventario]), [[1, '450.00', '81.00', true], [2, '100.00', '0.00', false]]);
  const inv = await db.select().from(schema.inventarioItems).where(inArray(schema.inventarioItems.gastoId, [B.json.gasto.id]));
  assert.deepEqual(inv.map((i) => [Number(i.cantidad), Number(i.valorUnitario), i.estado]), [[10, 45, 'Por completar']], 'un item por linea a inventario con cantidad real');
  console.log('  ✓ B lineas');

  // C · USD: sin TC cargado → 400; con TC → monto PEN
  const C1 = await compra({ numero: '3', moneda: 'USD', subtotal: 100, igv: 18, total: 118 });
  assert.equal(C1.status, 400);
  assert.match(C1.json.error, /tipo de cambio/i);
  const C2 = await compra({ numero: '3', moneda: 'USD', tipoCambio: 3.75, subtotal: 100, igv: 18, total: 118 });
  assert.deepEqual([C2.status, C2.json.gasto.tipoCambio, C2.json.documento.montoPen], [200, '3.7500', '442.50']);
  console.log('  ✓ C USD');

  // D · detraccion 030: aplica sobre S/ 1,180 (47) · no aplica bajo el minimo
  const D1 = await compra({ numero: '4', detraccion: { codigo: '030', montoDeclarado: 47 } });
  assert.deepEqual([D1.status, D1.json.detraccion.monto, D1.json.detraccion.montoDeclarado, D1.json.detraccion.estado], [200, '47.00', '47.00', 'pendiente']);
  const D2 = await compra({ numero: '5', subtotal: 400, igv: 72, total: 472, detraccion: { codigo: '030' } });
  assert.deepEqual([D2.status, D2.json.detraccion.monto, D2.json.detraccion.estado], [200, '0.00', 'no_aplica']);
  assert.equal((await compra({ numero: '6', detraccion: { codigo: '006' } })).status, 400, 'codigo no vigente');
  console.log('  ✓ D detraccion');

  // E · retencion: IGV 3% requiere agente de retencion · 4ta si
  assert.equal((await compra({ numero: '7', retencion: { tipo: 'igv3', monto: 35.4 } })).status, 400);
  const E = await compra({ numero: '8', tipoComprobante: 'Recibo por Honorarios', subtotal: 1500, igv: 0, total: 1500, retencion: { tipo: 'renta4ta', monto: 120 } });
  assert.deepEqual([E.status, E.json.gasto.retencion, E.json.gasto.retencionTipo], [200, '120.00', 'renta4ta']);
  console.log('  ✓ E retencion');

  // F · nota de credito reduce la factura referida; validaciones
  const F = await compra({ numero: '10' });
  const NC = await compra({ numero: '11', serie: 'FC99', tipoComprobante: 'Nota de Crédito', subtotal: 152.54, igv: 27.46, total: 180, docModifica: { serie: 'F999', numero: '10' }, motivoNota: '07' });
  assert.equal(NC.status, 200, JSON.stringify(NC.json));
  assert.equal(NC.json.documento, null, 'la NC no crea CxP propia');
  const detF = await call('GET', `/api/gastos/${F.json.gasto.id}/detalle`);
  assert.deepEqual([detF.json.documento.saldoPendiente, detF.json.documento.estado, detF.json.aplicaciones[0].origenTipo], ['1000.00', 'parcial', 'nota']);
  assert.equal((await compra({ numero: '12', tipoComprobante: 'Nota de Crédito', total: 10 })).status, 400, 'NC sin factura referida');
  assert.equal((await compra({ numero: '13', tipoComprobante: 'Nota de Crédito', total: 10, docModifica: { serie: 'F999', numero: '999' } })).status, 404, 'NC a factura inexistente');
  console.log('  ✓ F nota de credito');

  // G · factura duplicada del mismo proveedor
  assert.equal((await compra({ numero: '1' })).status, 409);
  console.log('  ✓ G duplicado');

  // I · borrado: con NC aplicada la factura no se borra; borrando la NC primero, si
  assert.equal((await call('DELETE', `/api/gastos/${F.json.gasto.id}`)).status, 409, 'factura con aplicacion activa');
  assert.equal((await call('DELETE', `/api/gastos/${NC.json.gasto.id}`)).status, 200);
  const detF2 = await call('GET', `/api/gastos/${F.json.gasto.id}/detalle`);
  assert.equal(detF2.json.documento.saldoPendiente, '1180.00', 'borrar la NC recompone el saldo');
  assert.equal((await call('DELETE', `/api/gastos/${F.json.gasto.id}`)).status, 200);
  const quedan = await db.select().from(schema.documentoPendiente).where(inArray(schema.documentoPendiente.docOrigenId, [F.json.gasto.id]));
  assert.equal(quedan.length, 0, 'borrar la compra borra su CxP');
  console.log('  ✓ I borrado');

  // J · PUT protegida: si la compra tiene CxP, editar sus datos de documento se rechaza (D13)
  const J1 = await call('PUT', `/api/gastos/${A.json.gasto.id}`, { total: 1200 });
  assert.equal(J1.status, 409, JSON.stringify(J1.json));
  assert.match(J1.json.error, /cuenta por pagar/i);
  const J2 = await call('PUT', `/api/gastos/${A.json.gasto.id}`, { observaciones: 'nota de prueba' });
  assert.equal(J2.status, 200, JSON.stringify(J2.json));
  console.log('  ✓ J PUT protegida');

  console.log('compras VERDE');
} finally {
  if (creados.length) {
    const docs = await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente).where(inArray(schema.documentoPendiente.docOrigenId, creados));
    const docIds = docs.map((d) => d.id);
    await db.delete(schema.aplicacionDocumento).where(or(inArray(schema.aplicacionDocumento.origenId, creados), docIds.length ? inArray(schema.aplicacionDocumento.documentoPendienteId, docIds) : undefined));
    if (docIds.length) await db.delete(schema.documentoPendiente).where(inArray(schema.documentoPendiente.id, docIds));
    await db.delete(schema.detraccionDocumento).where(inArray(schema.detraccionDocumento.docOrigenId, creados));
    await db.delete(schema.inventarioItems).where(inArray(schema.inventarioItems.gastoId, creados));
    await db.delete(schema.gastos).where(inArray(schema.gastos.id, creados));
  }
  await lucia.invalidateSession(session.id);
  server.close();
}
process.exit(0);
