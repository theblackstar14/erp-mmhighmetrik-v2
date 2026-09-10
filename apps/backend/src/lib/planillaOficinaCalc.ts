// Motor puro de planilla de oficina (regimen general). Sin DB. Snapshot de tasas afuera.
export type TasasOficina = { pctEssalud: number; pctOnp: number; pctAfpAporte: number; rmv: number; horasMesBase: number; topeSeguroAfp: number; afp?: { pctSeguro: number; pctComision: number } };
export type DetalleInput = {
  sueldoMensual: number; sistemaPension: 'AFP' | 'ONP'; asignacionFamiliar?: boolean;
  cantHe25?: number; cantHe35?: number; dominical?: number; feriado?: number;
  gratificacion?: number; vacaciones?: number; comisiones?: number; bonificacion?: number;
  imptoRenta5ta?: number; retencionJudicial?: number; adelantoCuota?: number; otrosDescuentos?: number;
  diasTrab?: number; horasTrab?: number;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
export function calcularDetalleOficina(i: DetalleInput, t: TasasOficina) {
  const n = (x?: number) => Number(x ?? 0);
  const valorHora = r2(i.sueldoMensual / t.horasMesBase);
  const montoHe25 = r2(n(i.cantHe25) * valorHora * 1.25);
  const montoHe35 = r2(n(i.cantHe35) * valorHora * 1.35);
  const totalHe = r2(montoHe25 + montoHe35);
  const asigFamiliar = i.asignacionFamiliar ? r2(t.rmv * 0.10) : 0;
  const totalBruto = r2(i.sueldoMensual + totalHe + n(i.dominical) + n(i.feriado) + asigFamiliar + n(i.gratificacion) + n(i.vacaciones) + n(i.comisiones) + n(i.bonificacion));
  let onp = 0, afpAporte = 0, afpSeguro = 0, afpComision = 0;
  if (i.sistemaPension === 'ONP') onp = r2(totalBruto * t.pctOnp);
  else { afpAporte = r2(totalBruto * t.pctAfpAporte); const base = Math.min(totalBruto, t.topeSeguroAfp); afpSeguro = r2(base * (t.afp?.pctSeguro ?? 0)); afpComision = r2(totalBruto * (t.afp?.pctComision ?? 0)); }
  const adelantoCuota = n(i.adelantoCuota), otros = n(i.otrosDescuentos), renta = n(i.imptoRenta5ta), judicial = n(i.retencionJudicial);
  const totalDescuento = r2(onp + afpAporte + afpSeguro + afpComision + renta + judicial + adelantoCuota + otros);
  const essalud = r2(totalBruto * t.pctEssalud);
  const totalAporte = essalud;
  return { valorHora, montoHe25, montoHe35, totalHe, asigFamiliar, totalBruto, onp, afpAporte, afpSeguro, afpComision, imptoRenta5ta: renta, retencionJudicial: judicial, adelantoCuota, otrosDescuentos: otros, totalDescuento, essalud, essaludVida: 0, totalAporte, netoPago: r2(totalBruto - totalDescuento), costoTotal: r2(totalBruto + totalAporte) };
}
