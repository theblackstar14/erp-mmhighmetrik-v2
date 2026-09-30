// Validación de reconciliación: los 17 empleados reales de julio 2026 contra el Excel.
// Prueba el motor puro con las tasas de julio (RMV 1130). Componentes AUTO (bruto, AFP,
// ONP, EsSalud) NO dependen de renta 5ta → deben cuadrar EXACTO. Renta 5ta es manual (híbrida).
import assert from 'node:assert/strict';
import { calcularDetalleOficina, type TasasOficina, type DetalleInput } from '../../src/lib/planillaOficinaCalc.js';

// Tasas AFP: aporte 10%, seguro 1.37%, comisión flujo por AFP (solo aplica si tipo='flujo').
const flujoDe = (afp: string) => ({ HABITAT: 0.0147, INTEGRA: 0.0155, PRIMA: 0.0160, PROFUTURO: 0.0169 }[afp] ?? 0);
const tasas = (afp: string): TasasOficina => ({
  rmv: 1130, uit: 5350, topeRma: 12599.27, pctEssalud: 0.09, pctOnp: 0.13, pctAfpAporte: 0.10, pctAsigFamiliar: 0.10,
  afp: { pctAporte: 0.10, pctSeguro: 0.0137, pctComisionFlujo: flujoDe(afp), pctComisionMixta: 0 },
});
const near = (a: number, b: number, m = 0.01) => Math.abs(a - b) <= m;

type Caso = {
  n: string; afp: string; in: DetalleInput;
  bruto: number; afpAp: number; afpSeg: number; afpCom: number; onp: number; essalud: number;
};
const D = (sueldo: number, sp: 'AFP' | 'ONP', tipo: 'flujo' | 'saldo' = 'saldo', dias = 31): DetalleInput =>
  ({ sueldoMensual: sueldo, sistemaPension: sp, afpComisionTipo: tipo, diasTrab: dias, diasMes: 31 });

// Los 17 empleados reales (hoja PLANILLA del Excel de julio 2026)
const casos: Caso[] = [
  { n: 'Garcia Calderon Mario', afp: 'PROFUTURO', in: D(12850, 'AFP'), bruto: 12850, afpAp: 1285, afpSeg: 172.61, afpCom: 0, onp: 0, essalud: 1156.50 },
  { n: 'Rivera Lozano Vivian',  afp: 'PROFUTURO', in: D(10000, 'AFP'), bruto: 10000, afpAp: 1000, afpSeg: 137.00, afpCom: 0, onp: 0, essalud: 900.00 },
  { n: 'Huerta Felix Joseph',   afp: 'PROFUTURO', in: D(1130, 'AFP', 'flujo'), bruto: 1130, afpAp: 113, afpSeg: 15.48, afpCom: 19.10, onp: 0, essalud: 101.70 },
  { n: 'Moreno Ramos Victor',   afp: 'INTEGRA',   in: D(5000, 'AFP'),  bruto: 5000, afpAp: 500, afpSeg: 68.50, afpCom: 0, onp: 0, essalud: 450.00 },
  { n: 'Challco Huaman Jon.',   afp: 'INTEGRA',   in: D(3500, 'AFP'),  bruto: 3500, afpAp: 350, afpSeg: 47.95, afpCom: 0, onp: 0, essalud: 315.00 },
  { n: 'Mendieta Guevara Kely', afp: 'PRIMA',     in: D(2200, 'AFP'),  bruto: 2200, afpAp: 220, afpSeg: 30.14, afpCom: 0, onp: 0, essalud: 198.00 },
  { n: 'Acosta Payano Renzo',   afp: 'HABITAT',   in: D(3000, 'AFP'),  bruto: 3000, afpAp: 300, afpSeg: 41.10, afpCom: 0, onp: 0, essalud: 270.00 },
  { n: 'Ramirez Flores Sheyla', afp: 'PROFUTURO', in: D(1130, 'AFP'),  bruto: 1130, afpAp: 113, afpSeg: 15.48, afpCom: 0, onp: 0, essalud: 101.70 }, // practicante EN planilla
  { n: 'Arias Sandoval Mike',   afp: 'INTEGRA',   in: D(5810, 'AFP'),  bruto: 5810, afpAp: 581, afpSeg: 79.60, afpCom: 0, onp: 0, essalud: 522.90 },
  { n: 'Bautista Carazas Elvis',afp: 'ONP',       in: D(5000, 'ONP'),  bruto: 5000, afpAp: 0, afpSeg: 0, afpCom: 0, onp: 650, essalud: 450.00 },
  { n: 'Cisneros Pianto Miguel',afp: 'INTEGRA',   in: D(4200, 'AFP'),  bruto: 4200, afpAp: 420, afpSeg: 57.54, afpCom: 0, onp: 0, essalud: 378.00 },
  { n: 'Cavero Beltran Sergio', afp: 'PROFUTURO', in: D(1130, 'AFP'),  bruto: 1130, afpAp: 113, afpSeg: 15.48, afpCom: 0, onp: 0, essalud: 101.70 },
  { n: 'Mijahuanca Rueda Eswar',afp: 'HABITAT',   in: D(3700, 'AFP'),  bruto: 3700, afpAp: 370, afpSeg: 50.69, afpCom: 0, onp: 0, essalud: 333.00 },
  { n: 'Levano Charalla Luis',  afp: 'PROFUTURO', in: D(6000, 'AFP'),  bruto: 6000, afpAp: 600, afpSeg: 82.20, afpCom: 0, onp: 0, essalud: 540.00 },
  { n: 'Garcia Calderon Andrea',afp: 'INTEGRA',   in: D(5000, 'AFP'),  bruto: 5000, afpAp: 500, afpSeg: 68.50, afpCom: 0, onp: 0, essalud: 450.00 },
  { n: 'Yangari Berrocal Ricky',afp: 'ONP',       in: D(3100, 'ONP', 'saldo', 29), bruto: 2900, afpAp: 0, afpSeg: 0, afpCom: 0, onp: 377, essalud: 261.00 }, // cese 29 días
  { n: 'Huaman Gago Luis',      afp: 'PROFUTURO', in: D(2800, 'AFP'),  bruto: 2800, afpAp: 280, afpSeg: 38.36, afpCom: 0, onp: 0, essalud: 252.00 },
];

let fallos = 0;
let totBruto = 0, totEssalud = 0;
for (const c of casos) {
  const r = calcularDetalleOficina(c.in, tasas(c.afp));
  const checks: [string, number, number][] = [
    ['bruto', r.totales.bruto, c.bruto],
    ['afpAporte', r.descuentos.afpAporte, c.afpAp],
    ['afpSeguro', r.descuentos.afpSeguro, c.afpSeg],
    ['afpComision', r.descuentos.afpComision, c.afpCom],
    ['onp', r.descuentos.onp, c.onp],
    ['essalud', r.aportesEmpleador.essalud, c.essalud],
  ];
  for (const [campo, got, exp] of checks) {
    if (!near(got, exp)) { console.error(`✗ ${c.n} · ${campo}: motor ${got} ≠ Excel ${exp}`); fallos++; }
  }
  // Reconciliación interna: bruto + essalud = costo; suma de descuentos AUTO
  assert.ok(near(r.totales.bruto + r.aportesEmpleador.essalud, r.totales.costoEmpleador), `${c.n} costo`);
  totBruto += r.totales.bruto; totEssalud += r.aportesEmpleador.essalud;
}

// Totales de la planilla (fila 26 del Excel): bruto 75,350.00 · EsSalud 6,781.50
assert.ok(near(totBruto, 75350, 0.02), `total bruto ${totBruto} ≠ 75350`);
assert.ok(near(totEssalud, 6781.50, 0.02), `total essalud ${totEssalud} ≠ 6781.50`);

if (fallos > 0) { console.error(`\n✗ ${fallos} discrepancias`); process.exit(1); }
console.log(`✓ 17/17 empleados cuadran · bruto total ${totBruto} · EsSalud total ${totEssalud}`);
console.log('julio17 VERDE'); process.exit(0);
