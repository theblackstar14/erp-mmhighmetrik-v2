/**
 * Detracción · base total con IGV · entero más cercano · siempre PEN · aplica si total > mínimo.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-detraccion-calc.ts
 */
import assert from 'node:assert/strict';
import { calcularDetraccion, compararDetraccion } from '../../src/lib/detraccionCalc.js';

const T030 = { codigo: '030', porcentaje: 4, montoMinimo: 700 };
const T027 = { codigo: '027', porcentaje: 4, montoMinimo: 400 };
const T019 = { codigo: '019', porcentaje: 10, montoMinimo: 700 };
const T037 = { codigo: '037', porcentaje: 12, montoMinimo: 700 };
const monto = (total: number, tasa: typeof T030, moneda = 'PEN', tipoCambio?: number) => calcularDetraccion({ total, moneda, tipoCambio, tasa }).monto;

assert.equal(monto(250000, T030), 10000, 'E001-85');
const e87 = calcularDetraccion({ total: 259097.5, moneda: 'PEN', tasa: T030 });
assert.equal(e87.monto, 10364, 'E001-87 calculado');
assert.deepEqual(compararDetraccion(e87, { monto: 10634 }), { diferencia: 270, coincide: false }, 'E001-87: la factura declaro 10634');
assert.deepEqual(compararDetraccion(calcularDetraccion({ total: 39000, moneda: 'PEN', tasa: T030 }), { monto: 1560 }), { diferencia: 0, coincide: true }, 'E001-72 coincide');

assert.equal(monto(4543, T027), 182, '181.72 sube a 182');
assert.equal(monto(2973.6, T019), 297, '297.36 baja a 297');
assert.equal(monto(885, T019), 89, '88.50 sube a 89');
assert.equal(monto(645, T027), 26, '027 bajo 700 pero sobre 400 aplica');

const bajo = calcularDetraccion({ total: 700, moneda: 'PEN', tasa: T037 });
assert.deepEqual([bajo.aplica, bajo.monto], [false, 0], '700 exacto no supera el minimo');
assert.match(bajo.motivo ?? '', /no supera el m.nimo/i);
assert.deepEqual(compararDetraccion(bajo, null), { diferencia: 0, coincide: true }, 'no aplica y no se declaro');

const usd = calcularDetraccion({ total: 1000, moneda: 'USD', tipoCambio: 3.389, tasa: T037 });
assert.deepEqual([usd.basePen, usd.monto], [3389, 407], 'USD: base en soles, monto en soles');
assert.throws(() => calcularDetraccion({ total: 1000, moneda: 'USD', tasa: T037 }), /tipo de cambio/i, 'USD sin TC');

console.log('detraccion-calc VERDE');
process.exit(0);
