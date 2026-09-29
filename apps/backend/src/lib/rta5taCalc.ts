/**
 * Motor de cálculo de Renta de 5ta Categoría (SUNAT — Perú)
 * Método de proyección anual.
 * SIN dependencias de DB — función pura.
 */

export type Rta5taInput = {
  sueldoMensual: number;
  mesNumero: number; // 1..12 (el mes que se está calculando)
  acumuladoPercibidoAntes: number; // remuneraciones percibidas en meses anteriores del año
  retencionesPrevias: number; // Rta5ta ya retenida en meses anteriores del año
  uit: number; // e.g. 5350
  /** Mes de ingreso del trabajador al año (1..12). Default 1.
   * Afecta el filtro de gratificaciones: solo cuentan las gratis desde mesIngreso en adelante. */
  mesIngreso?: number;
  /** Cantidad de gratificaciones AÚN por percibir en el año (jul+dic).
   * Default: count of {7, 12} where month >= mesNumero && month >= mesIngreso. */
  gratificacionesPorPercibir?: number;
};

export type Rta5taResult = {
  retencionMes: number;
  impuestoAnual: number;
  proyeccionAnual: number;
  rentaNeta: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Calcula el impuesto progresivo sobre rentaNeta (en soles) usando la escala de 5ta categoría. */
function calcImpuestoAnual(rentaNeta: number, uit: number): number {
  if (rentaNeta <= 0) return 0;

  const brackets: Array<{ up: number; rate: number }> = [
    { up: 5 * uit, rate: 0.08 },
    { up: 20 * uit, rate: 0.14 },
    { up: 35 * uit, rate: 0.17 },
    { up: 45 * uit, rate: 0.20 },
    { up: Infinity, rate: 0.30 },
  ];

  let tax = 0;
  let remaining = rentaNeta;
  let prevTop = 0;

  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const sliceTop = bracket.up - prevTop;
    const taxable = Math.min(remaining, sliceTop);
    tax += taxable * bracket.rate;
    remaining -= taxable;
    prevTop = bracket.up;
  }

  return round2(tax);
}

export function calcularRta5ta(i: Rta5taInput): Rta5taResult {
  const { sueldoMensual, mesNumero, acumuladoPercibidoAntes, retencionesPrevias, uit } = i;

  // 1. Gratificaciones proporcionales por semestre (Ley 27735 + Ley 30334)
  const mesIngreso = Math.min(Math.max(i.mesIngreso ?? 1, 1), 12);

  /**
   * Meses trabajados dentro del semestre [ini..fin] considerando la fecha de ingreso.
   * Solo cuentan meses desde mesIngreso en adelante.
   */
  const mesesEnSemestre = (ini: number, fin: number): number =>
    Math.max(0, Math.min(fin, 12) - Math.max(ini, mesIngreso) + 1);

  // Gratificación de julio cubre el semestre ene–jun (meses 1..6); se paga en mes 7
  const fracGratiJul = 7 >= mesNumero ? Math.min(6, mesesEnSemestre(1, 6)) / 6 : 0;
  // Gratificación de diciembre cubre el semestre jul–dic (meses 7..12); se paga en mes 12
  const fracGratiDic = 12 >= mesNumero ? Math.min(6, mesesEnSemestre(7, 12)) / 6 : 0;
  const factorGrati = fracGratiJul + fracGratiDic; // expresado en "salarios"

  const gratiProyectada = round2(factorGrati * sueldoMensual);
  const bonifExtraProyectada = round2(factorGrati * 0.09 * sueldoMensual); // Ley 30334

  // 2. Proyección anual
  const mesesRestantes = 12 - mesNumero + 1; // incluye el mes actual
  const proyeccionAnual = round2(
    acumuladoPercibidoAntes +
      sueldoMensual * mesesRestantes +
      gratiProyectada +
      bonifExtraProyectada
  );

  // 3. Renta neta (deducción 7 UIT)
  const rentaNeta = round2(proyeccionAnual - 7 * uit);

  if (rentaNeta <= 0) {
    return {
      retencionMes: 0,
      impuestoAnual: 0,
      proyeccionAnual,
      rentaNeta,
    };
  }

  // 4. Impuesto anual progresivo
  const impuestoAnual = calcImpuestoAnual(rentaNeta, uit);

  // 5. Retención del mes según divisor SUNAT
  let retencionRaw: number;

  if (mesNumero >= 1 && mesNumero <= 3) {
    retencionRaw = impuestoAnual / 12;
  } else if (mesNumero === 4) {
    retencionRaw = (impuestoAnual - retencionesPrevias) / 9;
  } else if (mesNumero >= 5 && mesNumero <= 7) {
    retencionRaw = (impuestoAnual - retencionesPrevias) / 8;
  } else if (mesNumero === 8) {
    retencionRaw = (impuestoAnual - retencionesPrevias) / 5;
  } else if (mesNumero >= 9 && mesNumero <= 11) {
    retencionRaw = (impuestoAnual - retencionesPrevias) / 4;
  } else {
    // mes 12
    retencionRaw = impuestoAnual - retencionesPrevias;
  }

  const retencionMes = Math.max(0, round2(retencionRaw));

  return {
    retencionMes,
    impuestoAnual,
    proyeccionAnual,
    rentaNeta,
  };
}
