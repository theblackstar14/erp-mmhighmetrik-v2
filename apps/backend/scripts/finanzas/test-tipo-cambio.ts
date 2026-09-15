/**
 * Fase 0 · elegir tipo de cambio vigente (puro).
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-tipo-cambio.ts
 */
import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
import assert from 'node:assert/strict';
import { elegirTipoCambio, type FilaTc } from '../../src/lib/tipoCambio.js';

const filas: FilaTc[] = [
  { fecha: '2026-01-08', moneda: 'USD', compra: 3.36, venta: 3.366 },
  { fecha: '2026-01-09', moneda: 'USD', compra: 3.361, venta: 3.368 },
  { fecha: '2026-01-12', moneda: 'USD', compra: 3.371, venta: 3.379 },
  { fecha: '2026-01-10', moneda: 'EUR', compra: 3.9, venta: 4.1 },
];

assert.deepEqual(elegirTipoCambio(filas, '2026-01-09', 'USD'), { ...filas[1], diasAtras: 0 }, 'dia exacto');
assert.deepEqual(elegirTipoCambio(filas, '2026-01-11', 'USD'), { ...filas[1], diasAtras: 2 }, 'domingo usa el viernes');
assert.equal(elegirTipoCambio(filas, '2026-01-10', 'USD')?.venta, 3.368, 'no mezcla monedas (el EUR del 10 no cuenta)');
assert.equal(elegirTipoCambio(filas, '2026-01-07', 'USD'), null, 'no hay TC anterior');
assert.equal(elegirTipoCambio(filas, '2026-01-23', 'USD'), null, '11 dias atras es demasiado viejo');
assert.equal(elegirTipoCambio(filas, '2026-01-22', 'USD')?.diasAtras, 10, '10 dias atras todavia vale');
assert.deepEqual(elegirTipoCambio([], '2026-01-09', 'PEN'), { fecha: '2026-01-09', moneda: 'PEN', compra: 1, venta: 1, diasAtras: 0 }, 'PEN = 1');

console.log('tipo-cambio VERDE');
process.exit(0);
