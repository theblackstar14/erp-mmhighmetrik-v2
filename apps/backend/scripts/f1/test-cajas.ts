/**
 * F3.2 · Test de cajas y rendiciones (in-process, routers reales).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-cajas.ts
 * Ciclo completo: A abrir caja (entrega 1,000 del BCP, transferencia con N° op) →
 * B gasto rendido pagado desde la caja (300) → C saldos derivados (entregado/rendido/saldo) →
 * D cierre exige devolución si hay saldo → E cierre con devolución (700 al BCP) deja saldo 0,
 * caja cerrada y cuenta desactivada → F el motor asienta la entrega como 1413/banco.
 * Limpia lo que crea. Requiere DATABASE_URL=erp_mmh_test. Exit 0 = verde.
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
const OBRA = '4bac3de9-6930-4b69-8e0c-a4e3502955b0'; // PG0001
// Post-cutover (2025-01-01): los movimientos asientan vía motor; pre-cutover los ignora (legacy).
const PERIODO = '2026-06';
const FECHA = '2026-06-10';
let cajaId = '';
let cuentaCajaId = '';
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
  const [bcp] = await db.select({ id: schema.cuentasBancarias.id }).from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, '194-9927833-0-39'));

  try {
    console.log('════ F3.2 · cajas y rendiciones ════');

    // A · abrir caja con entrega de 1,000
    const A = await call('POST', '/cajas', { proyectoId: OBRA, encargado: 'Andrea García (test)', monto: 1000, cuentaOrigenId: bcp!.id, numOperacion: 'TEST-5404001', fecha: FECHA });
    assert.equal(A.status, 200, `A abre (${JSON.stringify(A.body).slice(0, 200)})`);
    cajaId = A.body.caja.id; cuentaCajaId = A.body.cuenta.id;
    assert.match(A.body.caja.codigo, /^CAJA-2026-\d{3}$/, 'A: correlativo CAJA-YYYY-NNN');
    assert.equal(A.body.cuenta.cuentaContable, '1413', 'A: cuenta caja → 1413 Entregas a rendir');
    console.log(`  ✓ A caja ${A.body.caja.codigo} abierta · entrega 1,000 op TEST-5404001`);

    // B · gasto rendido pagado desde la caja (gasto + movimiento egreso en la cuenta caja)
    const g = await call('POST', '/gastos', { fecha: FECHA, proyectoId: OBRA, tipoGasto: 'Movilidad', proveedorRazon: 'RENDICION TEST', subtotal: 300, igv: 0, total: 300, destino: 'proyecto' });
    assert.equal(g.status, 200, 'B crea gasto');
    gastoIds.push(g.body.gasto.id);
    const m = await call('POST', '/movimientos', { fecha: FECHA, tipoMovimiento: 'Egreso', proyectoId: OBRA, cuentaId: cuentaCajaId, monto: 300, subtotal: 300, igv: 0, descripcion: 'Movilidad rendida', gastoId: g.body.gasto.id, numOperacion: 'REND-01' });
    assert.equal(m.status, 200, `B paga desde caja (${JSON.stringify(m.body).slice(0, 150)})`);
    console.log('  ✓ B gasto de 300 rendido desde la caja (CxP aplicada automática)');

    // C · saldos derivados
    const C = await call('GET', '/cajas');
    const c = C.body.cajas.find((x: any) => x.id === cajaId);
    assert.equal(c.entregado, 1000, 'C: entregado 1,000');
    assert.equal(c.rendido, 300, 'C: rendido 300');
    assert.equal(c.saldo, 700, 'C: saldo 700');
    console.log('  ✓ C saldos: entregado 1,000 · rendido 300 · saldo 700');

    // D · cerrar sin devolución → rechazo
    const D = await call('POST', `/cajas/${cajaId}/cerrar`, { fecha: FECHA });
    assert.equal(D.status, 400, 'D: cierre sin devolución rechazado');
    console.log('  ✓ D no se cierra con saldo vivo sin devolución');

    // E · cerrar con devolución de 700 al BCP
    const E = await call('POST', `/cajas/${cajaId}/cerrar`, { fecha: FECHA, devolucion: { cuentaDestinoId: bcp!.id, numOperacion: 'TEST-5404099' } });
    assert.equal(E.status, 200, `E cierra (${JSON.stringify(E.body).slice(0, 150)})`);
    assert.equal(E.body.saldoDevuelto, 700, 'E: devuelve 700');
    const C2 = await call('GET', '/cajas');
    const c2 = C2.body.cajas.find((x: any) => x.id === cajaId);
    assert.equal(c2.estado, 'cerrada', 'E: cerrada');
    assert.equal(c2.saldo, 0, 'E: saldo 0');
    const [cta] = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.id, cuentaCajaId));
    assert.equal(cta!.activo, false, 'E: cuenta caja desactivada');
    console.log('  ✓ E cierre: devolución 700 · caja cerrada · cuenta inactiva');

    // F · el motor asienta la entrega (transfer → debe 1413 / haber banco)
    const g2 = await call('POST', '/contabilidad/generar', { periodo: PERIODO });
    assert.equal(g2.status, 200, 'F generar ok');
    const movsCaja = await db.select({ id: schema.movimientos.id }).from(schema.movimientos).where(eq(schema.movimientos.cuentaId, cuentaCajaId));
    const asientos = await db.select().from(schema.asientos).where(and(eq(schema.asientos.origen, 'movimiento'), inArray(schema.asientos.origenId, movsCaja.map((x) => x.id))));
    assert.ok(asientos.length >= 1, 'F: asiento de la entrega existe');
    const ls = await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, asientos[0]!.id));
    assert.ok(ls.some((l) => l.cuenta === '1413'), 'F: línea 1413 (entregas a rendir)');
    console.log('  ✓ F motor: entrega asentada con 1413');

    console.log('\n  ✅ F3.2 cajas VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    // limpieza (orden: asientos → aplicaciones/docs → movimientos → gasto → caja → cuenta)
    if (cuentaCajaId) {
      const movs = await db.select({ id: schema.movimientos.id, transferenciaId: schema.movimientos.transferenciaId })
        .from(schema.movimientos).where(eq(schema.movimientos.cuentaId, cuentaCajaId));
      const transferIds = [...new Set(movs.map((m) => m.transferenciaId).filter(Boolean))] as string[];
      const espejo = transferIds.length ? await db.select({ id: schema.movimientos.id }).from(schema.movimientos).where(inArray(schema.movimientos.transferenciaId, transferIds)) : [];
      const movIds = [...new Set([...movs.map((m) => m.id), ...espejo.map((m) => m.id)])];
      if (movIds.length) {
        await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, 'movimiento'), inArray(schema.asientos.origenId, movIds)));
        await db.delete(schema.aplicacionDocumento).where(and(eq(schema.aplicacionDocumento.origenTipo, 'movimiento'), inArray(schema.aplicacionDocumento.origenId, movIds)));
        await db.delete(schema.movimientos).where(inArray(schema.movimientos.id, movIds));
      }
    }
    if (gastoIds.length) {
      await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, 'gasto'), inArray(schema.asientos.origenId, gastoIds)));
      const docs = await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente)
        .where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), inArray(schema.documentoPendiente.docOrigenId, gastoIds)));
      if (docs.length) await db.delete(schema.aplicacionDocumento).where(inArray(schema.aplicacionDocumento.documentoPendienteId, docs.map((d) => d.id)));
      await db.delete(schema.documentoPendiente).where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), inArray(schema.documentoPendiente.docOrigenId, gastoIds)));
      await db.delete(schema.gastoLineas).where(inArray(schema.gastoLineas.gastoId, gastoIds));
      await db.delete(schema.gastos).where(inArray(schema.gastos.id, gastoIds));
    }
    if (cajaId) await db.delete(schema.cajas).where(eq(schema.cajas.id, cajaId));
    if (cuentaCajaId) await db.delete(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.id, cuentaCajaId));
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
