/**
 * Self-check del motor de planilla de oficina contra la planilla REAL de enero 2026
 * (PLL ADM 01_2026.xlsx), con los netos cruzados contra los archivos de pago BCP
 * HABERES20260203.txt y PROVEEDORES20260130.txt.
 *
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/oficina/check-calc-enero2026.ts
 *
 * No toca la DB. Enero 2026 = 31 dias => horas mes 248.
 */
import { calcularDetalleOficina, type TasasOficina } from '../../src/lib/planillaOficinaCalc.js';

const DIAS_MES = 31;

// tasas vigentes en enero-2026 segun el propio Excel (seguro 1.37%)
const base: Omit<TasasOficina, 'afp'> = {
  pctEssalud: 0.09, pctOnp: 0.13, pctAfpAporte: 0.10,
  rmv: 1025, horasMesBase: 240, topeSeguroAfp: 12786.4,
};
const AFP = {
  // Kelly dejo la comision en blanco en enero -> se compara con comision 0.
  sinComision: { pctSeguro: 0.0137, pctComision: 0 },
  profuturo: { pctSeguro: 0.0137, pctComision: 0.0169 },
};

type Caso = {
  quien: string;
  input: Parameters<typeof calcularDetalleOficina>[0];
  afp?: { pctSeguro: number; pctComision: number };
  esp: Partial<Record<'sueldoBase' | 'valorHora' | 'montoHe25' | 'montoHe35' | 'totalBruto' | 'onp' | 'afpAporte' | 'afpSeguro' | 'afpComision' | 'totalDescuento' | 'essalud' | 'netoPago' | 'costoTotal', number>>;
};

const CASOS: Caso[] = [
  {
    quien: 'GARCIA CALDERON MARIO (31d, AFP, renta 1220)',
    afp: AFP.sinComision,
    input: { sueldoMensual: 10000, sistemaPension: 'AFP', diasMes: DIAS_MES, diasTrab: 31, imptoRenta5ta: 1220 },
    esp: { sueldoBase: 10000, afpAporte: 1000, afpSeguro: 137, totalBruto: 10000, totalDescuento: 2357, essalud: 900, netoPago: 7643, costoTotal: 10900 },
  },
  {
    quien: 'ROJAS CESPEDES RENZO (15d de 31 -> prorrateo)',
    afp: AFP.sinComision,
    input: { sueldoMensual: 2000, sistemaPension: 'AFP', diasMes: DIAS_MES, diasTrab: 15 },
    esp: { sueldoBase: 967.74, totalBruto: 967.74, afpAporte: 96.77, afpSeguro: 13.26, totalDescuento: 110.03, essalud: 87.10, netoPago: 857.71 },
  },
  {
    quien: 'DELGADO VILLEGAS EDWIN (3d de 31 + 1 HE25)',
    afp: AFP.sinComision,
    input: { sueldoMensual: 4500, sistemaPension: 'AFP', diasMes: DIAS_MES, diasTrab: 3, cantHe25: 1 },
    esp: { sueldoBase: 435.48, valorHora: 1.756, montoHe25: 2.19, totalBruto: 437.67, afpAporte: 43.77, afpSeguro: 6.0, netoPago: 387.91 },
  },
  {
    quien: 'VASQUEZ MELODY (31d + 27 HE25 + 4 HE35 + dominical)',
    afp: AFP.sinComision,
    input: { sueldoMensual: 5000, sistemaPension: 'AFP', diasMes: DIAS_MES, diasTrab: 31, cantHe25: 27, cantHe35: 4, dominical: 645.16 },
    esp: { valorHora: 20.1613, montoHe25: 680.44, montoHe35: 108.87, totalBruto: 6434.47, afpAporte: 643.45, afpSeguro: 88.15, netoPago: 5702.87 },
  },
  {
    quien: 'CHUQUIYURI VICTOR (31d, ONP 13%)',
    input: { sueldoMensual: 1130, sistemaPension: 'ONP', diasMes: DIAS_MES, diasTrab: 31 },
    esp: { totalBruto: 1130, onp: 146.9, totalDescuento: 146.9, essalud: 101.7, netoPago: 983.1, costoTotal: 1231.7 },
  },
  {
    quien: 'GARCIA CALDERON ANDREA (practicante, 27d de 31)',
    input: { sueldoMensual: 1130, sistemaPension: 'ONP', diasMes: DIAS_MES, diasTrab: 27, esPracticante: true },
    esp: { sueldoBase: 984.19, totalBruto: 984.19, onp: 0, afpAporte: 0, totalDescuento: 0, essalud: 0, netoPago: 984.19, costoTotal: 984.19 },
  },
  {
    quien: 'HUERTA JOSEPH (31d, AFP Profuturo con comision 1.69%)',
    afp: AFP.profuturo,
    input: { sueldoMensual: 1130, sistemaPension: 'AFP', diasMes: DIAS_MES, diasTrab: 31 },
    esp: { afpAporte: 113, afpSeguro: 15.48, afpComision: 19.1, totalDescuento: 147.58, netoPago: 982.42 },
  },
];

// Excel no redondea los pasos intermedios; nosotros si, para que la boleta cuadre.
const TOL = 0.02;

let fallos = 0;
for (const c of CASOS) {
  const got = calcularDetalleOficina(c.input, { ...base, afp: c.afp }) as Record<string, number>;
  const malos: string[] = [];
  for (const [k, exp] of Object.entries(c.esp)) {
    const act = got[k];
    if (act == null || Math.abs(act - (exp as number)) > TOL) malos.push(`${k}: esperado ${exp}, obtenido ${act}`);
  }
  if (malos.length) {
    fallos++;
    console.log(`FAIL  ${c.quien}`);
    malos.forEach((m) => console.log(`        ${m}`));
  } else {
    console.log(`ok    ${c.quien}`);
  }
}

// Cuadre de la boleta: bruto - descuento == neto, exacto, en todos los casos.
for (const c of CASOS) {
  const g = calcularDetalleOficina(c.input, { ...base, afp: c.afp });
  const d = Math.round((g.totalBruto - g.totalDescuento - g.netoPago) * 100) / 100;
  if (d !== 0) { fallos++; console.log(`FAIL  cuadre boleta ${c.quien}: desfase ${d}`); }
}

console.log(fallos === 0 ? `\nTODO OK (${CASOS.length} casos, tolerancia ${TOL})` : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
