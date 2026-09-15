/**
 * Fase 1 · sub-mayor: crear documento desde compra, aplicar/anular pagos, saldo derivado, tasa vigente.
 * Todo corre dentro de una transacción que se revierte al final (no deja residuos).
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-documentos-pendientes.ts
 */
import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@erp/db';
import { DocumentoError, aplicar, aplicarPagoAOrigen, anularAplicacionesDe, crearDocumentoDesdeGasto, esNotaCredito, refrescarDocumento } from '../../src/lib/documentosPendientes.js';
import { buscarTasaDetraccion } from '../../src/lib/detraccionTasa.js';

class Rollback extends Error {}
const RUC = '20999999991';

async function rechaza(p: Promise<unknown>, status: number, msg: string) {
  await assert.rejects(p, (e) => e instanceof DocumentoError && e.status === status, msg);
}

try {
  await db.transaction(async (tx) => {
    const nuevoGasto = async (extra: Partial<typeof schema.gastos.$inferInsert>) =>
      (await tx.insert(schema.gastos).values({ fecha: '2099-01-10', proveedorRuc: RUC, proveedorRazon: 'PROVEEDOR TEST', tipoComprobante: 'Factura', serie: 'F999', numero: '1', moneda: 'PEN', subtotal: '1000.00', igv: '180.00', total: '1180.00', ...extra }).returning())[0]!;

    // documento desde compra · idempotente · duplicado por RUC+serie+numero
    const g1 = await nuevoGasto({});
    const d1 = await crearDocumentoDesdeGasto(tx, g1);
    assert.deepEqual([d1?.tipo, d1?.cuentaControl, d1?.montoOriginal, d1?.saldoPendiente, d1?.estado, d1?.docOrigenTipo], ['cxp', '4212', '1180.00', '1180.00', 'abierto', 'gasto']);
    assert.equal((await crearDocumentoDesdeGasto(tx, g1))?.id, d1!.id, 'misma compra → mismo documento');
    const gDup = await nuevoGasto({});
    await rechaza(crearDocumentoDesdeGasto(tx, gDup), 409, 'misma factura de otro gasto → 409');
    const gOtroProv = await nuevoGasto({ proveedorRuc: '20999999992' });
    assert.ok(await crearDocumentoDesdeGasto(tx, gOtroProv), 'misma serie-numero de otro proveedor es valida');

    // pagos parciales, exceso, cancelacion, anulacion
    const pago1 = randomUUID(), pago2 = randomUUID();
    await aplicar(tx, { origenTipo: 'movimiento', origenId: pago1, fecha: '2099-01-15', aplicaciones: [{ documentoPendienteId: d1!.id, monto: 600 }], tipoEsperado: 'cxp', moneda: 'PEN' });
    let d = await refrescarDocumento(tx, d1!.id);
    assert.deepEqual([d.saldoPendiente, d.estado], ['580.00', 'parcial']);
    await rechaza(aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: d1!.id, monto: 700 }] }), 400, 'exceso de saldo → 400');
    await rechaza(aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: d1!.id, monto: 580 }], tipoEsperado: 'cxc' }), 400, 'tipo equivocado → 400');
    await rechaza(aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: d1!.id, monto: 580 }], moneda: 'USD' }), 400, 'moneda distinta → 400');
    await rechaza(aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: randomUUID(), monto: 1 }] }), 404, 'documento inexistente → 404');
    await rechaza(aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: d1!.id, monto: 0 }] }), 400, 'monto 0 → 400');
    await rechaza(aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: d1!.id, monto: -5 }] }), 400, 'monto negativo → 400');
    await aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: d1!.id, monto: 580 }] });
    d = await refrescarDocumento(tx, d1!.id);
    assert.deepEqual([d.saldoPendiente, d.estado], ['0.00', 'cancelado']);
    assert.equal(await anularAplicacionesDe(tx, 'movimiento', pago2), 1, 'anula 1 aplicacion');
    d = await refrescarDocumento(tx, d1!.id);
    assert.deepEqual([d.saldoPendiente, d.estado], ['580.00', 'parcial'], 'anular recompone el saldo');
    assert.equal(await anularAplicacionesDe(tx, 'movimiento', pago2), 0, 'segunda anulacion del mismo origen → no revienta, 0 filas');
    d = await refrescarDocumento(tx, d1!.id);
    assert.deepEqual([d.saldoPendiente, d.estado], ['580.00', 'parcial'], 'segunda anulacion no cambia el saldo');

    // pago legacy por origen: aplica hasta el saldo
    const pago3 = randomUUID();
    assert.equal(await aplicarPagoAOrigen(tx, { docOrigenTipo: 'gasto', docOrigenId: g1.id, movimientoId: pago3, monto: 900, fecha: '2099-01-20' }), d1!.id);
    d = await refrescarDocumento(tx, d1!.id);
    assert.deepEqual([d.saldoPendiente, d.estado], ['0.00', 'cancelado'], 'aplica solo el saldo (580)');
    assert.equal(await aplicarPagoAOrigen(tx, { docOrigenTipo: 'gasto', docOrigenId: g1.id, movimientoId: randomUUID(), monto: 10, fecha: '2099-01-21' }), null, 'sin saldo → no aplica');

    // exclusiones y moneda extranjera
    assert.equal(esNotaCredito('Nota de Crédito'), true);
    assert.equal(esNotaCredito('07'), true);
    assert.equal(esNotaCredito('Factura'), false);
    assert.equal(esNotaCredito('NOTA CREDITO'), true);
    assert.equal(esNotaCredito('Nota de Credito'), true);
    assert.equal(esNotaCredito('NOTA DE CRÉDITO'), true);
    assert.equal(esNotaCredito('N/C'), true);
    assert.equal(esNotaCredito('01'), false);
    assert.equal(await crearDocumentoDesdeGasto(tx, await nuevoGasto({ numero: '2', tipoComprobante: 'Nota de Crédito' })), null, 'NC no crea CxP');
    assert.equal(await crearDocumentoDesdeGasto(tx, await nuevoGasto({ numero: '3', tipoRegistro: 'Rendición' })), null, 'rendicion no crea CxP');
    assert.equal(await crearDocumentoDesdeGasto(tx, await nuevoGasto({ numero: '3b', subtotal: '0.00', igv: '0.00', total: '0.00' })), null, 'total 0 no crea CxP');
    await rechaza(crearDocumentoDesdeGasto(tx, await nuevoGasto({ numero: '4', moneda: 'USD' })), 400, 'USD sin TC → 400');
    const dUsd = await crearDocumentoDesdeGasto(tx, await nuevoGasto({ numero: '5', moneda: 'USD', tipoCambio: '3.7500', subtotal: '100.00', igv: '18.00', total: '118.00' }));
    assert.deepEqual([dUsd?.moneda, dUsd?.montoOriginal, dUsd?.montoPen, dUsd?.tipoCambio], ['USD', '118.00', '442.50', '3.7500']);

    // tasa vigente (datos de Fase 0)
    assert.deepEqual(await buscarTasaDetraccion('030', '2026-01-15'), { codigo: '030', porcentaje: 4, montoMinimo: 700 });
    assert.equal((await buscarTasaDetraccion('027', '2026-01-15'))?.montoMinimo, 400);
    assert.equal(await buscarTasaDetraccion('006', '2026-01-15'), null, '006 no vigente');
    assert.equal(await buscarTasaDetraccion('999', '2026-01-15'), null, 'codigo inexistente');

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) throw e;
}
console.log('documentos-pendientes VERDE');
process.exit(0);
