/**
 * Motor de planilla construcción civil (CAPECO · D.S. 011-79-TR).
 * Base afecto = jornadaBásica + dominical + BUC + compVac + horasExtra + escolaridad + bonifAltura + bonifAgua.
 * No afecto = CTS + gratificación + bonifExtra + movilidad.
 * Aportes empleador (no reducen neto, suman al costo) = EsSalud + SCTR salud/pensión + SENCICO.
 */
export type PlanillaParams = {
  jornal: number;
  pctBuc: number;
  pctDominical: number; // 0.1667
  pctCompVac: number; // 0.10
  pctCts: number; // 0.15
  pctGratif: number;
  pctHe60: number; // 0.20
  pctHe100: number; // 0.25
  movilidadDia: number;
};
// Tasas legales globales (editables en Configuración)
export type ConfigGlobal = {
  pctEsSalud: number; // 0.09
  pctOnp: number; // 0.13
  pctSencico: number; // 0.002
  pctConafovicer: number; // 0.02
  pctSctrSalud: number; // 0.0155
  pctSctrPension: number; // 0.0174
  pctBonifAltura: number; // 0.07
  pctBonifAgua: number; // 0.20
  asignEscolarJornales: number; // jornales/año/hijo
};
export type AfpTasa = { aporte: number; comision: number; seguro: number };
export type PlanillaInput = {
  dias: number;
  jornadaDominical: boolean;
  horasExtra60: number;
  horasExtra100: number;
  aplicaMovilidad: boolean;
  bonifAltura: boolean;
  bonifAgua: boolean;
  numHijos: number; // para asignación escolar automática
  escolaridad: number; // override manual · si >0 gana al automático
  esAfp: boolean; // true=AFP, false=SNP(ONP)
  afp: AfpTasa | null;
  // manuales
  renta5ta: number;
  adelanto: number;
  sindical: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcularPlanilla(p: PlanillaParams, cfg: ConfigGlobal, i: PlanillaInput) {
  const jornadaBasica = p.jornal * i.dias;
  // Jornada dominical CC = 1 jornal básico (descanso semanal remunerado) si completó la semana
  const dominical = i.jornadaDominical ? p.jornal : 0;
  const buc = p.pctBuc * jornadaBasica;
  const compVac = p.pctCompVac * jornadaBasica;
  const gratif = p.pctGratif * jornadaBasica;
  const bonifExtra = 0.09 * gratif; // Ley 30334 · bonif extraordinaria
  const cts = p.pctCts * jornadaBasica;
  const valorHora = p.jornal / 8;
  const he60 = i.horasExtra60 * valorHora * (1 + p.pctHe60);
  const he100 = i.horasExtra100 * valorHora * (1 + p.pctHe100);
  const montoHorasExtra = he60 + he100;
  const movilidad = i.aplicaMovilidad ? p.movilidadDia * i.dias : 0;
  const bonifAltura = i.bonifAltura ? cfg.pctBonifAltura * jornadaBasica : 0; // 7% del básico
  const bonifAgua = i.bonifAgua ? cfg.pctBonifAgua * jornadaBasica : 0; // 20% del básico
  // Asignación escolar = numHijos × jornales/año × jornal ÷ 52 (semanal). Override manual si se ingresa.
  const escolaridad = i.escolaridad > 0 ? i.escolaridad : (i.numHijos * cfg.asignEscolarJornales * p.jornal) / 52;

  const totalIngreso = jornadaBasica + dominical + buc + compVac + gratif + bonifExtra + cts + montoHorasExtra + movilidad + bonifAltura + bonifAgua + escolaridad;
  const afecto = jornadaBasica + dominical + buc + compVac + montoHorasExtra + bonifAltura + bonifAgua + escolaridad;

  // Descuentos del trabajador (sobre afecto)
  let afpAporte = 0, afpComision = 0, afpSeguro = 0, onp = 0;
  if (i.esAfp && i.afp) {
    afpAporte = i.afp.aporte * afecto;
    afpComision = i.afp.comision * afecto;
    afpSeguro = i.afp.seguro * afecto;
  } else {
    onp = cfg.pctOnp * afecto;
  }
  const conafovicer = cfg.pctConafovicer * jornadaBasica; // 2% del jornal básico
  const renta5ta = i.renta5ta || 0;
  const adelanto = i.adelanto || 0;
  const sindical = i.sindical || 0;
  const totalDescuentos = afpAporte + afpComision + afpSeguro + onp + conafovicer + renta5ta + adelanto + sindical;
  const netoPago = totalIngreso - totalDescuentos;

  // Aportes empleador (no afectan neto · suman al costo)
  const esSalud = cfg.pctEsSalud * afecto;
  const sctrSalud = cfg.pctSctrSalud * afecto;
  const sctrPension = cfg.pctSctrPension * afecto;
  const sencico = cfg.pctSencico * totalIngreso; // base = remuneración total
  const costoTotal = totalIngreso + esSalud + sctrSalud + sctrPension + sencico;

  return {
    montoJornada: r2(jornadaBasica),
    montoDominical: r2(dominical),
    montoBuc: r2(buc),
    montoCompVac: r2(compVac),
    montoGratif: r2(gratif),
    montoBonifExtra: r2(bonifExtra),
    montoCts: r2(cts),
    montoMovilidad: r2(movilidad),
    montoHorasExtra: r2(montoHorasExtra),
    montoBonifAltura: r2(bonifAltura),
    montoBonifAgua: r2(bonifAgua),
    montoEscolaridad: r2(escolaridad),
    totalIngreso: r2(totalIngreso),
    totalAfecto: r2(afecto),
    montoAfpAporte: r2(afpAporte),
    montoAfpComision: r2(afpComision),
    montoAfpSeguro: r2(afpSeguro),
    montoOnp: r2(onp),
    montoConafovicer: r2(conafovicer),
    montoRenta5ta: r2(renta5ta),
    montoAdelanto: r2(adelanto),
    montoSindical: r2(sindical),
    totalDescuentos: r2(totalDescuentos),
    netoPago: r2(netoPago),
    montoEsSalud: r2(esSalud),
    montoSctrSalud: r2(sctrSalud),
    montoSctrPension: r2(sctrPension),
    montoSencico: r2(sencico),
    montoCostoTotal: r2(costoTotal),
  };
}

// ponytail: self-check · corre con `tsx planillaCalc.ts`
if (process.argv[1]?.replace(/\\/g, '/').endsWith('lib/planillaCalc.ts')) {
  const p: PlanillaParams = { jornal: 89, pctBuc: 0.32, pctDominical: 0.1667, pctCompVac: 0.1, pctCts: 0.15, pctGratif: 0, pctHe60: 0.2, pctHe100: 0.25, movilidadDia: 14.4 };
  const cfg: ConfigGlobal = { pctEsSalud: 0.09, pctOnp: 0.13, pctSencico: 0.002, pctConafovicer: 0.02, pctSctrSalud: 0.0155, pctSctrPension: 0.0174, pctBonifAltura: 0.07, pctBonifAgua: 0.2, asignEscolarJornales: 30 };
  const r = calcularPlanilla(p, cfg, { dias: 6, jornadaDominical: true, horasExtra60: 0, horasExtra100: 0, aplicaMovilidad: true, bonifAltura: false, bonifAgua: false, numHijos: 0, escolaridad: 0, esAfp: false, afp: null, renta5ta: 0, adelanto: 0, sindical: 0 });
  const asserts = [
    ['jornada 6×89', r.montoJornada, 534],
    ['dominical=jornal', r.montoDominical, 89],
    ['onp 13% afecto', r.montoOnp, r2(0.13 * r.totalAfecto)],
    ['neto = ingreso - desc', r.netoPago, r2(r.totalIngreso - r.totalDescuentos)],
    ['costo > ingreso', r.montoCostoTotal > r.totalIngreso ? 1 : 0, 1],
  ] as const;
  let ok = true;
  for (const [name, got, want] of asserts) {
    if (Math.abs((got as number) - (want as number)) > 0.01) { console.error('✗', name, got, '≠', want); ok = false; }
  }
  console.log(ok ? '✅ planillaCalc self-check OK' : '❌ FALLÓ');
  process.exit(ok ? 0 : 1);
}
