import assert from 'node:assert/strict';
import { calcularDetalleOficina, type TasasOficina, type DetalleInput } from '../../src/lib/planillaOficinaCalc.js';

const AFP = { pctAporte: 0.10, pctSeguro: 0.0137, pctComisionFlujo: 0.0169, pctComisionMixta: 0.0107 };
const T: TasasOficina = { rmv: 1130, uit: 5350, topeRma: 12599.27, pctEssalud: 0.09, pctOnp: 0.13, pctAfpAporte: 0.10, pctAsigFamiliar: 0.10, afp: AFP };
const near = (a: number, b: number, m = 0.01) => Math.abs(a - b) <= m;

// Fixture: 4 boletas reales de julio 2026 (subset representativo del Excel)
type Caso = { n: string; in: DetalleInput; bruto: number; afpAp: number; afpSeg: number; afpCom: number; onp: number; essalud: number; neto: number };
const casos: Caso[] = [
  // García: AFP saldo, seguro topeado, renta manual 1120
  { n: 'Garcia', in: { sueldoMensual: 12850, sistemaPension: 'AFP', afpComisionTipo: 'saldo', imptoRenta5ta: 1120 }, bruto: 12850, afpAp: 1285, afpSeg: 172.61, afpCom: 0, onp: 0, essalud: 1156.5, neto: 10272.39 },
  // Huerta: AFP flujo 1.69%, sueldo = RMV
  { n: 'Huerta', in: { sueldoMensual: 1130, sistemaPension: 'AFP', afpComisionTipo: 'flujo' }, bruto: 1130, afpAp: 113, afpSeg: 15.48, afpCom: 19.10, onp: 0, essalud: 101.70, neto: 982.42 },
  // Bautista: ONP 13%, renta manual 15
  { n: 'Bautista', in: { sueldoMensual: 5000, sistemaPension: 'ONP', imptoRenta5ta: 15 }, bruto: 5000, afpAp: 0, afpSeg: 0, afpCom: 0, onp: 650, essalud: 450, neto: 4335 },
  // Yangari: ONP, cese a 29 días (prorrateo), mes 31 días
  { n: 'Yangari', in: { sueldoMensual: 3100, sistemaPension: 'ONP', diasTrab: 29, diasMes: 31 }, bruto: 2900, afpAp: 0, afpSeg: 0, afpCom: 0, onp: 377, essalud: 261, neto: 2523 },
];

for (const c of casos) {
  const r = calcularDetalleOficina(c.in, T);
  assert.ok(near(r.totales.bruto, c.bruto), `${c.n} bruto ${r.totales.bruto}≠${c.bruto}`);
  assert.ok(near(r.descuentos.afpAporte, c.afpAp), `${c.n} afpAp ${r.descuentos.afpAporte}`);
  assert.ok(near(r.descuentos.afpSeguro, c.afpSeg), `${c.n} afpSeg ${r.descuentos.afpSeguro}`);
  assert.ok(near(r.descuentos.afpComision, c.afpCom), `${c.n} afpCom ${r.descuentos.afpComision}`);
  assert.ok(near(r.descuentos.onp, c.onp), `${c.n} onp ${r.descuentos.onp}`);
  assert.ok(near(r.aportesEmpleador.essalud, c.essalud), `${c.n} essalud ${r.aportesEmpleador.essalud}`);
  assert.ok(near(r.totales.neto, c.neto), `${c.n} neto ${r.totales.neto}`);
  // Reconciliación interna
  assert.ok(near(r.totales.bruto - r.totales.descuentos, r.totales.neto), `${c.n} bruto-dscto≠neto`);
  assert.ok(near(r.totales.bruto + r.aportesEmpleador.essalud, r.totales.costoEmpleador), `${c.n} costo`);
  assert.ok(near(r.descuentos.afpAporte + r.descuentos.afpSeguro + r.descuentos.afpComision + r.descuentos.onp + r.descuentos.renta5ta, r.totales.descuentos), `${c.n} suma dsctos`);
}

// Gratificación INAFECTA: bases no cambian, bonif extraordinaria 9%
const g = calcularDetalleOficina({ sueldoMensual: 5000, sistemaPension: 'AFP', afpComisionTipo: 'saldo', gratificacion: 5000 }, T);
assert.ok(near(g.bases.baseAfp, 5000), `grati grava AFP: ${g.bases.baseAfp}`);      // NO incluye la grati
assert.ok(near(g.bases.baseEssalud, 5000), `grati grava EsSalud: ${g.bases.baseEssalud}`);
assert.ok(near(g.ingresos.bonificacionExtraordinaria, 450), `bonif 9%: ${g.ingresos.bonificacionExtraordinaria}`);
assert.ok(near(g.descuentos.afpAporte, 500), `afp sobre afecta 5000: ${g.descuentos.afpAporte}`);
assert.ok(near(g.totales.bruto, 5000 + 5000 + 450), `bruto con grati+bonif: ${g.totales.bruto}`);

// Piso RMV en EsSalud: sueldo < RMV → base = RMV
const bajo = calcularDetalleOficina({ sueldoMensual: 800, sistemaPension: 'ONP', diasTrab: 20, diasMes: 30 }, T);
assert.ok(near(bajo.bases.baseEssalud, 1130), `piso RMV: ${bajo.bases.baseEssalud}`); // afecta 533.33 < RMV
assert.ok(near(bajo.aportesEmpleador.essalud, 101.70), `essalud piso: ${bajo.aportesEmpleador.essalud}`);

// Practicante en modalidad formativa: sin aportes
const prac = calcularDetalleOficina({ sueldoMensual: 1130, sistemaPension: 'AFP', modalidadFormativa: true }, T);
assert.equal(prac.descuentos.afpAporte, 0);
assert.equal(prac.aportesEmpleador.essalud, 0);

console.log('calc VERDE'); process.exit(0);
