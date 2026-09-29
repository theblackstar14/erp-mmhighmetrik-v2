/**
 * F6 · Test de flujos de conciliación (in-process, sin Gemini: extracto sintético CSV).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-conciliacion-flujos.ts
 * A import CSV + clasificación de casos (itf/cargo_banco/abono/cargo) · B lote cargos del banco →
 * movimientos 6412/679 conciliados de frente · C registrar-desde-extracto: movimiento nuevo +
 * conciliar liga la línea · D re-import del mes: líneas con misma fecha+monto+N°op entran 'ignorado'.
 * Limpia lo que crea. DATABASE_URL=erp_mmh_test. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import conciliacionRoutes from '../../src/routes/conciliacion.js';
import finanzasRoutes from '../../src/routes/finanzas.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { eq, inArray } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const extractoIds: string[] = [];
const movIds: string[] = [];

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/conciliacion', conciliacionRoutes);
  app.use('/api', finanzasRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://localhost:${port}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const importCsv = async (csv: string, nombre: string, cuentaId: string) => {
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), nombre);
    fd.append('cuentaId', cuentaId);
    const r = await fetch(`http://localhost:${port}/api/conciliacion/importar`, { method: 'POST', headers: { cookie }, body: fd });
    return { status: r.status, body: await r.json() };
  };
  const [bcp] = await db.select({ id: schema.cuentasBancarias.id }).from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, '194-9927833-0-39'));

  try {
    console.log('════ F6 · flujos de conciliación ════');

    // A · import CSV sintético (2026-03: mes sin extractos) + clasificación de casos
    const csv1 = ['fecha,descripcion,referencia,monto',
      '2026-03-02,IMPUESTO ITF,,-2.25',
      '2026-03-03,COM.CCE PRO 000030,159340,-55.00',
      '2026-03-05,DE CLIENTE CONCIL TEST,777001,4500.00',
      '2026-03-06,TRANSF PROVEEDOR TEST,777002,-1200.00',
    ].join('\n');
    const A = await importCsv(csv1, 'flujos-test-1.csv', bcp!.id);
    assert.equal(A.status, 200, `A import (${JSON.stringify(A.body).slice(0, 200)})`);
    extractoIds.push(A.body.extracto.id);
    const L = await call('GET', `/conciliacion/${A.body.extracto.id}/lineas`);
    const porDesc = (s: string) => L.body.lineas.find((l: any) => l.descripcion.includes(s));
    assert.equal(porDesc('ITF').caso, 'itf', 'A: ITF clasificado');
    assert.equal(porDesc('ITF').cuentaSugerida, '6412', 'A: ITF → 6412');
    assert.equal(porDesc('COM.CCE').caso, 'cargo_banco', 'A: comisión → cargo_banco (679)');
    assert.equal(porDesc('DE CLIENTE').caso, 'abono', 'A: abono → entrada ingreso');
    assert.equal(porDesc('DE CLIENTE').entradaSugerida, 'ingreso', 'A: entrada sugerida ingreso');
    assert.equal(porDesc('PROVEEDOR').entradaSugerida, 'pago', 'A: cargo → entrada pago');
    console.log('  ✓ A import + casos: itf→6412 · comisión→679 · abono→ingreso · cargo→pago');

    // B · lote cargos del banco (ITF + COM) → movimientos con cuenta contra manual, conciliados
    const B = await call('POST', '/conciliacion/cargos-banco', { items: [
      { lineaId: porDesc('ITF').id }, { lineaId: porDesc('COM.CCE').id },
    ] });
    assert.equal(B.status, 200, `B lote (${JSON.stringify(B.body).slice(0, 200)})`);
    assert.equal(B.body.creados.length, 2, 'B: 2 movimientos creados');
    assert.equal(B.body.errores.length, 0, 'B: sin errores');
    movIds.push(...B.body.creados.map((c: any) => c.movimientoId));
    const movsB = await db.select().from(schema.movimientos).where(inArray(schema.movimientos.id, movIds));
    assert.ok(movsB.some((m) => m.cuentaContable === '6412' && Number(m.monto) === 2.25), 'B: ITF → mov 6412');
    assert.ok(movsB.some((m) => m.cuentaContable === '679' && Number(m.monto) === 55), 'B: COM → mov 679');
    const L2 = await call('GET', `/conciliacion/${A.body.extracto.id}/lineas`);
    assert.ok(L2.body.lineas.filter((l: any) => l.caso === 'itf' || l.caso === 'cargo_banco').every((l: any) => l.estado === 'conciliado' && l.movimientoId), 'B: líneas conciliadas de frente');
    console.log('  ✓ B lote: ITF 2.25→6412 · COM 55.00→679 · líneas conciliadas');

    // C · registrar desde extracto (lado backend): mov nuevo con el N° op de la línea + conciliar
    const abono = porDesc('DE CLIENTE');
    const C1 = await call('POST', '/movimientos', { fecha: abono.fecha, tipoMovimiento: 'Ingreso', cuentaId: bcp!.id, monto: 4500, subtotal: 4500, igv: 0, clienteNombre: 'CLIENTE CONCIL TEST', numOperacion: abono.referencia, descripcion: 'Cobro registrado desde extracto' });
    assert.equal(C1.status, 200, 'C: movimiento creado');
    movIds.push(C1.body.movimiento.id);
    const C2 = await call('POST', `/conciliacion/lineas/${abono.id}/conciliar`, { movimientoId: C1.body.movimiento.id });
    assert.equal(C2.status, 200, 'C: conciliar ok');
    assert.equal(C2.body.linea.estado, 'conciliado', 'C: línea conciliada');
    console.log('  ✓ C registrar desde extracto: mov con N° op 777001 + línea conciliada');

    // D · re-import del mes (PDF parcial → final): repetidas con N° op entran ignoradas
    const csv2 = ['fecha,descripcion,referencia,monto',
      '2026-03-03,COM.CCE PRO 000030,159340,-55.00',     // repetida (misma fecha+monto+ref)
      '2026-03-05,DE CLIENTE CONCIL TEST,777001,4500.00', // repetida
      '2026-03-28,LINEA NUEVA FIN DE MES,777099,-900.00', // nueva
    ].join('\n');
    const D = await importCsv(csv2, 'flujos-test-2.csv', bcp!.id);
    assert.equal(D.status, 200, `D re-import (${JSON.stringify(D.body).slice(0, 200)})`);
    extractoIds.push(D.body.extracto.id);
    assert.equal(D.body.duplicadasOtroExtracto, 2, 'D: 2 duplicadas detectadas');
    const L3 = await call('GET', `/conciliacion/${D.body.extracto.id}/lineas`);
    assert.equal(L3.body.lineas.filter((l: any) => l.estado === 'ignorado').length, 2, 'D: repetidas → ignorado');
    assert.equal(L3.body.lineas.filter((l: any) => l.estado === 'pendiente').length, 1, 'D: la nueva queda pendiente');
    console.log('  ✓ D re-import: 2 repetidas ignoradas · 1 nueva pendiente');

    console.log('\n  ✅ F6 flujos de conciliación VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    if (extractoIds.length) await db.delete(schema.extractosBancarios).where(inArray(schema.extractosBancarios.id, extractoIds)); // líneas en cascada
    if (movIds.length) await db.delete(schema.movimientos).where(inArray(schema.movimientos.id, movIds));
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
