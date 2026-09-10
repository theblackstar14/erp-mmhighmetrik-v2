import assert from 'node:assert/strict';
import { calcularDetalleOficina } from '../../src/lib/planillaOficinaCalc.js';

const tasas = { pctEssalud: 0.09, pctOnp: 0.13, pctAfpAporte: 0.10, rmv: 1025, horasMesBase: 240, topeSeguroAfp: 12599.27, afp: { pctSeguro: 0.0137, pctComision: 0 } };

// Levano: sueldo 6000, AFP, Renta5ta input 95 -> neto 5222.80 (boleta real)
const levano = calcularDetalleOficina({ sueldoMensual: 6000, sistemaPension: 'AFP', imptoRenta5ta: 95 }, tasas);
assert.equal(levano.totalBruto, 6000);
assert.equal(levano.essalud, 540);            // 9%
assert.equal(levano.afpAporte, 600);          // 10%
assert.ok(Math.abs(levano.afpSeguro - 82.20) < 0.02, `levano seguro ${levano.afpSeguro}`);
assert.ok(Math.abs(levano.netoPago - 5222.80) < 0.02, `levano neto ${levano.netoPago}`);

// Garcia: sueldo 12850, AFP (seguro capped at tope), Renta5ta 1120 -> neto 10272.39 (boleta real)
const garcia = calcularDetalleOficina({ sueldoMensual: 12850, sistemaPension: 'AFP', imptoRenta5ta: 1120 }, tasas);
assert.equal(garcia.afpAporte, 1285);
assert.ok(Math.abs(garcia.afpSeguro - 172.61) < 0.02, `garcia seguro ${garcia.afpSeguro}`);
assert.ok(Math.abs(garcia.netoPago - 10272.39) < 0.02, `garcia neto ${garcia.netoPago}`);

// ONP path 13%
const onp = calcularDetalleOficina({ sueldoMensual: 5000, sistemaPension: 'ONP' }, tasas);
assert.equal(onp.onp, 650);
assert.equal(onp.afpAporte, 0);

// asignacion familiar = 10% RMV
const af = calcularDetalleOficina({ sueldoMensual: 3000, sistemaPension: 'ONP', asignacionFamiliar: true }, tasas);
assert.equal(af.asigFamiliar, 102.50);
assert.equal(af.totalBruto, 3102.50);

console.log('calc VERDE'); process.exit(0);
