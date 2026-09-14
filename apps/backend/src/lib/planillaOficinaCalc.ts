// Motor puro de planilla de oficina (regimen general). Sin DB. Snapshot de tasas afuera.
export type TasasOficina = { pctEssalud: number; pctOnp: number; pctAfpAporte: number; rmv: number; horasMesBase: number; topeSeguroAfp: number; afp?: { pctSeguro: number; pctComision: number } };
export type DetalleInput = {
  sueldoMensual: number; sistemaPension: 'AFP' | 'ONP'; asignacionFamiliar?: boolean;
  cantHe25?: number; cantHe35?: number; dominical?: number; feriado?: number;
  gratificacion?: number; vacaciones?: number; comisiones?: number; bonificacion?: number;
  imptoRenta5ta?: number; retencionJudicial?: number; adelantoCuota?: number; otrosDescuentos?: number;
  diasTrab?: number; horasTrab?: number;
  /** Dias calendario del mes (28..31). Base del prorrateo y de las horas-mes. Default 30. */
  diasMes?: number;
  /** Modalidad formativa: sin pension ni EsSalud (costo = bruto). */
  esPracticante?: boolean;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export function calcularDetalleOficina(i: DetalleInput, t: TasasOficina) {
  const n = (x?: number) => Number(x ?? 0);

  // Prorrateo por dias efectivamente laborados (altas, ceses, faltas, licencias sin goce).
  const diasMes = i.diasMes && i.diasMes > 0 ? i.diasMes : 30;
  const diasTrab = i.diasTrab != null ? Math.min(Math.max(n(i.diasTrab), 0), diasMes) : diasMes;
  const factor = diasTrab / diasMes;
  const sueldoBase = r2(i.sueldoMensual * factor);

  // Valor hora = base prorrateada / (dias del mes * 8). Verificado vs Excel enero-2026
  // (Delgado 435.4839/248 = 1.7560; Vasquez 5000/248 = 20.1613).
  // Se usa sin redondear para las HE; el redondeo a 4 dec es solo de presentacion.
  const horasMes = diasMes * 8;
  const valorHoraRaw = horasMes > 0 ? (i.sueldoMensual * factor) / horasMes : 0;
  const valorHora = r4(valorHoraRaw);

  const montoHe25 = r2(n(i.cantHe25) * valorHoraRaw * 1.25);
  const montoHe35 = r2(n(i.cantHe35) * valorHoraRaw * 1.35);
  const totalHe = r2(montoHe25 + montoHe35);
  const asigFamiliar = i.asignacionFamiliar ? r2(t.rmv * 0.10 * factor) : 0;

  // Totales = suma de componentes ya redondeados, para que la boleta siempre cuadre.
  const totalBruto = r2(sueldoBase + totalHe + n(i.dominical) + n(i.feriado) + asigFamiliar + n(i.gratificacion) + n(i.vacaciones) + n(i.comisiones) + n(i.bonificacion));

  let onp = 0, afpAporte = 0, afpSeguro = 0, afpComision = 0;
  if (i.esPracticante) {
    // Modalidad formativa (D.L. 1401): sin aporte previsional ni EsSalud.
  } else if (i.sistemaPension === 'ONP') {
    onp = r2(totalBruto * t.pctOnp);
  } else {
    afpAporte = r2(totalBruto * t.pctAfpAporte);
    const base = Math.min(totalBruto, t.topeSeguroAfp);
    afpSeguro = r2(base * (t.afp?.pctSeguro ?? 0));
    afpComision = r2(totalBruto * (t.afp?.pctComision ?? 0));
  }

  const adelantoCuota = n(i.adelantoCuota), otros = n(i.otrosDescuentos), renta = n(i.imptoRenta5ta), judicial = n(i.retencionJudicial);
  const totalDescuento = r2(onp + afpAporte + afpSeguro + afpComision + renta + judicial + adelantoCuota + otros);
  const essalud = i.esPracticante ? 0 : r2(totalBruto * t.pctEssalud);
  const totalAporte = essalud;

  return {
    sueldoBase, diasTrab, horasTrab: diasTrab * 8, valorHora,
    montoHe25, montoHe35, totalHe, asigFamiliar, totalBruto,
    onp, afpAporte, afpSeguro, afpComision,
    imptoRenta5ta: renta, retencionJudicial: judicial, adelantoCuota, otrosDescuentos: otros, totalDescuento,
    essalud, essaludVida: 0, totalAporte,
    netoPago: r2(totalBruto - totalDescuento), costoTotal: r2(totalBruto + totalAporte),
  };
}
