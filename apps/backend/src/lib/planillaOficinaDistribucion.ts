// F2 · nucleo PURO del reparto del costo de planilla oficina entre obras.
// Sin DB, sin Express: se testea solo (scripts/oficina/test-distribucion.ts).

export type ReglaDistribucion = { empleadoId: string | null; obraId: string; pct: number };
export type Slice = { obraId: string | null; pct: number };
export type Porcion = { obraId: string | null; monto: number };

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resuelve los slices de un empleado (spec §4.1):
 *   1· hay filas con empleado_id = empleado → se usan SOLO esas
 *   2· si no, filas globales (empleado_id null)
 *   3· si no hay ninguna → 100% oficina (obraId null)
 * El resto hasta 100 va a oficina, siempre al FINAL (orden determinista para `repartir`).
 * Las reglas deben venir ya filtradas por empresa: esta funcion no sabe de empresas.
 */
export function resolverDistribucion(empleadoId: string, reglas: ReglaDistribucion[]): Slice[] {
  const propias = reglas.filter((r) => r.empleadoId === empleadoId);
  const base = propias.length > 0 ? propias : reglas.filter((r) => r.empleadoId === null);

  const slices: Slice[] = base
    .map((r) => ({ obraId: r.obraId, pct: Number(r.pct) }))
    .sort((a, b) => String(a.obraId).localeCompare(String(b.obraId)));

  const suma = round2(slices.reduce((s, x) => s + x.pct, 0));
  const resto = round2(100 - suma);
  if (resto > 0) slices.push({ obraId: null, pct: resto });

  return slices;
}

/**
 * Reparte `total` entre `slices` sin descuadre: cada porcion es round2(total*pct/100)
 * y la ULTIMA absorbe la diferencia, de modo que Σ porciones = total al centimo.
 */
export function repartir(total: number, slices: Slice[]): Porcion[] {
  if (slices.length === 0) return [{ obraId: null, monto: round2(total) }];

  const out: Porcion[] = slices.map((s) => ({ obraId: s.obraId, monto: round2((total * s.pct) / 100) }));
  const suma = round2(out.reduce((s, x) => s + x.monto, 0));
  const last = out[out.length - 1]!;
  last.monto = round2(last.monto + (total - suma));
  return out;
}
