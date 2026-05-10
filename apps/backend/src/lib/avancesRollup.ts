import type { Avance, Partida } from '@erp/db';

export type AvanceState = {
  avancePct: number;
  realCost: number;
  budget: number;
  source: 'direct' | 'rollup' | 'none';
  fecha?: string;
  nota?: string | null;
};

/**
 * Computa estado de avance por código de partida con roll-up jerárquico.
 *
 * Reglas:
 * - Hojas con avance directo: usa último entry
 * - Padres (con hijos): avancePct = Σ(child_pct × child_budget) / Σ(child_budget)
 *   realCost = Σ(child_realCost) acumulado
 * - Hojas sin avance: 0%
 */
export function computeAvancesRollup(
  partidas: Partida[],
  latestAvances: Avance[],
): Record<string, AvanceState> {
  // Map partidaId → último avance
  const avancePorPartidaId = new Map<string, Avance>();
  for (const a of latestAvances) {
    avancePorPartidaId.set(a.partidaId, a);
  }

  // Map childMap: codigo padre → array de codigos hijos
  const childMap = new Map<string, string[]>();
  const partidaPorCodigo = new Map<string, Partida>();
  for (const p of partidas) {
    partidaPorCodigo.set(p.codigo, p);
    if (p.parentCodigo) {
      if (!childMap.has(p.parentCodigo)) childMap.set(p.parentCodigo, []);
      childMap.get(p.parentCodigo)!.push(p.codigo);
    }
  }

  const result: Record<string, AvanceState> = {};

  function compute(codigo: string): AvanceState {
    if (result[codigo]) return result[codigo]!;
    const partida = partidaPorCodigo.get(codigo);
    if (!partida) {
      const empty = { avancePct: 0, realCost: 0, budget: 0, source: 'none' as const };
      result[codigo] = empty;
      return empty;
    }
    const budget = Number(partida.presupuestoContractual ?? 0) || Number(partida.presupuesto ?? 0);
    const children = childMap.get(codigo) ?? [];

    if (children.length === 0) {
      // Hoja
      const avance = avancePorPartidaId.get(partida.id);
      const r: AvanceState = avance
        ? {
            avancePct: Number(avance.avancePct),
            realCost: Number(avance.realCost),
            budget,
            source: 'direct',
            fecha: avance.fecha.toISOString(),
            nota: avance.nota,
          }
        : { avancePct: 0, realCost: 0, budget, source: 'none' };
      result[codigo] = r;
      return r;
    }

    // Padre · roll-up
    let totalBudget = 0;
    let weightedPct = 0;
    let totalReal = 0;
    for (const childCod of children) {
      const childResult = compute(childCod);
      totalBudget += childResult.budget;
      weightedPct += childResult.avancePct * childResult.budget;
      totalReal += childResult.realCost;
    }
    const r: AvanceState = {
      avancePct: totalBudget > 0 ? weightedPct / totalBudget : 0,
      realCost: totalReal,
      budget,
      source: 'rollup',
    };
    result[codigo] = r;
    return r;
  }

  for (const p of partidas) compute(p.codigo);
  return result;
}
