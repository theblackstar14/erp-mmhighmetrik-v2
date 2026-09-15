// Detracción SPOT · base = total con IGV en PEN · monto redondeado al entero más cercano · aplica si base > mínimo del código.
// SUNAT no valida que el monto declarado cuadre con el % (E001-87 salió aceptada con 10,634 en vez de 10,364): lo validamos aquí.

export type TasaDetraccion = { codigo: string; porcentaje: number; montoMinimo: number };
export type DetraccionCalculada = { aplica: boolean; codigo: string; porcentaje: number; basePen: number; monto: number; motivo: string | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcularDetraccion(p: { total: number; moneda: string; tipoCambio?: number | null; tasa: TasaDetraccion }): DetraccionCalculada {
  if (p.moneda !== 'PEN' && !p.tipoCambio) throw new Error(`Falta tipo de cambio para calcular la detracción en ${p.moneda}`);
  const basePen = r2(p.moneda === 'PEN' ? p.total : p.total * (p.tipoCambio as number));
  const base = { codigo: p.tasa.codigo, porcentaje: p.tasa.porcentaje, basePen };
  if (!(basePen > p.tasa.montoMinimo)) {
    return { ...base, aplica: false, monto: 0, motivo: `El total S/ ${basePen.toFixed(2)} no supera el mínimo S/ ${p.tasa.montoMinimo.toFixed(2)} del código ${p.tasa.codigo}` };
  }
  // enteros para evitar error de coma flotante: céntimos × puntos básicos / 1e6 = soles
  const soles = (Math.round(basePen * 100) * Math.round(p.tasa.porcentaje * 100)) / 1_000_000;
  return { ...base, aplica: true, monto: Math.round(soles), motivo: null };
}

export function compararDetraccion(calculada: DetraccionCalculada, declarada: { monto: number } | null) {
  const diferencia = r2((declarada?.monto ?? 0) - calculada.monto);
  return { diferencia, coincide: diferencia === 0 };
}
