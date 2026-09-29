// Motor puro de planilla de oficina (regimen general). Sin DB. Snapshot de tasas afuera.
export type ComisionTipo = 'flujo' | 'mixta' | 'saldo';
export type AfpTasa2 = { pctAporte: number; pctSeguro: number; pctComisionFlujo: number; pctComisionMixta: number };
export type TasasOficina = { rmv: number; uit: number; topeRma: number; pctEssalud: number; pctOnp: number; pctAfpAporte: number; pctAsigFamiliar: number; afp?: AfpTasa2 };
export type DetalleInput = { sueldoMensual: number; sistemaPension: 'AFP'|'ONP'; afpComisionTipo?: ComisionTipo; asignacionFamiliar?: boolean; modalidadFormativa?: boolean; cantHe25?: number; cantHe35?: number; dominical?: number; feriado?: number; gratificacion?: number; vacaciones?: number; comisiones?: number; bonificacion?: number; imptoRenta5ta?: number; retencionJudicial?: number; adelantoCuota?: number; otrosDescuentos?: number; diasTrab?: number; diasMes?: number };
export type ResultadoOficina = {
  bases: { remuneracionAfecta: number; baseAfp: number; baseOnp: number; baseEssalud: number; baseRenta5ta: number };
  descuentos: { afpAporte: number; afpSeguro: number; afpComision: number; onp: number; renta5ta: number; retencionJudicial: number; adelanto: number; otros: number };
  aportesEmpleador: { essalud: number };
  ingresos: { remuneracion: number; gratificacionInafecta: number; bonificacionExtraordinaria: number };
  totales: { bruto: number; descuentos: number; neto: number; costoEmpleador: number };
  // compat plano para el mapeo a detalle (mismos nombres que hoy):
  sueldoBase: number; valorHora: number; montoHe25: number; montoHe35: number; totalHe: number; asigFamiliar: number;
  totalBruto: number; onp: number; afpAporte: number; afpSeguro: number; afpComision: number;
  imptoRenta5ta: number; totalDescuento: number; essalud: number; netoPago: number; costoTotal: number;
  diasTrab: number; horasTrab: number;
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export function calcularDetalleOficina(i: DetalleInput, t: TasasOficina): ResultadoOficina {
  const n = (x?: number) => Number(x ?? 0);
  const diasMes = i.diasMes && i.diasMes > 0 ? i.diasMes : 30;
  const diasTrab = i.diasTrab != null ? Math.min(Math.max(n(i.diasTrab), 0), diasMes) : diasMes;
  const factor = diasTrab / diasMes;
  const sueldoBase = r2(i.sueldoMensual * factor);
  const vhRaw = diasMes > 0 ? (i.sueldoMensual * factor) / (diasMes * 8) : 0;
  const montoHe25 = r2(n(i.cantHe25) * vhRaw * 1.25);
  const montoHe35 = r2(n(i.cantHe35) * vhRaw * 1.35);
  const totalHe = r2(montoHe25 + montoHe35);
  const asigFamiliar = i.asignacionFamiliar ? r2(t.rmv * t.pctAsigFamiliar * factor) : 0;

  // Bases independientes — la gratificación NO grava
  const remuneracionAfecta = r2(sueldoBase + totalHe + n(i.dominical) + n(i.feriado) + asigFamiliar + n(i.vacaciones) + n(i.comisiones) + n(i.bonificacion));
  const gratificacionInafecta = r2(n(i.gratificacion));
  const bonificacionExtraordinaria = r2(gratificacionInafecta * 0.09);
  const baseAfp = remuneracionAfecta;
  const baseOnp = remuneracionAfecta;
  const baseEssalud = Math.max(remuneracionAfecta, remuneracionAfecta > 0 ? t.rmv : 0);
  const baseRenta5ta = r2(remuneracionAfecta + gratificacionInafecta + bonificacionExtraordinaria);

  let onp = 0, afpAporte = 0, afpSeguro = 0, afpComision = 0, essalud = 0;
  if (!i.modalidadFormativa) {
    if (i.sistemaPension === 'ONP') {
      onp = r2(baseOnp * t.pctOnp);
    } else {
      afpAporte = r2(baseAfp * t.pctAfpAporte);
      afpSeguro = r2(Math.min(baseAfp, t.topeRma) * (t.afp?.pctSeguro ?? 0));
      const pc = i.afpComisionTipo === 'flujo' ? (t.afp?.pctComisionFlujo ?? 0)
               : i.afpComisionTipo === 'mixta' ? (t.afp?.pctComisionMixta ?? 0) : 0;
      afpComision = r2(baseAfp * pc);
    }
    essalud = r2(baseEssalud * t.pctEssalud);
  }

  const renta = n(i.imptoRenta5ta), judicial = n(i.retencionJudicial), adel = n(i.adelantoCuota), otros = n(i.otrosDescuentos);
  const totalDescuento = r2(onp + afpAporte + afpSeguro + afpComision + renta + judicial + adel + otros);
  const bruto = r2(remuneracionAfecta + gratificacionInafecta + bonificacionExtraordinaria);
  const neto = r2(bruto - totalDescuento);
  const costo = r2(bruto + essalud);

  return {
    bases: { remuneracionAfecta, baseAfp, baseOnp, baseEssalud, baseRenta5ta },
    descuentos: { afpAporte, afpSeguro, afpComision, onp, renta5ta: renta, retencionJudicial: judicial, adelanto: adel, otros },
    aportesEmpleador: { essalud },
    ingresos: { remuneracion: remuneracionAfecta, gratificacionInafecta, bonificacionExtraordinaria },
    totales: { bruto, descuentos: totalDescuento, neto, costoEmpleador: costo },
    // compat plano
    sueldoBase, valorHora: r4(vhRaw), montoHe25, montoHe35, totalHe, asigFamiliar,
    totalBruto: bruto, onp, afpAporte, afpSeguro, afpComision,
    imptoRenta5ta: renta, totalDescuento, essalud, netoPago: neto, costoTotal: costo,
    diasTrab, horasTrab: diasTrab * 8,
  };
}
