import type { Avance, Partida, Valorizacion, ValorizacionPartida } from '@erp/db';

export type Bucket = {
  key: string; // 'YYYY-MM'
  idx: number;
  year: number;
  month: number; // 0-11
  start: Date;
  finish: Date;
};

export type CurvaSResult = {
  buckets: Bucket[];
  plan: number[]; // PV mensual
  planAcum: number[]; // PV acumulado
  real: number[]; // AC mensual
  realAcum: number[]; // AC acumulado
  earned: number[]; // EV mensual
  earnedAcum: number[]; // EV acumulado
  hoyIdx: number; // bucket actual
  fuente: 'avances' | 'valorizaciones' | 'mixed' | 'plan-only';
  evm: {
    BAC: number;
    PV: number; // Plan acumulado al hoy
    AC: number; // Real acumulado al hoy
    EV: number; // Earned acumulado al hoy
    SPI: number; // EV/PV
    CPI: number; // EV/AC
    SV: number; // EV-PV
    CV: number; // EV-AC
    EAC: number; // BAC × AC/EV
    pctCompletado: number; // EV/BAC
  };
};

/**
 * Computa Curva S del proyecto
 *   PV  · distribución lineal de presupuesto contractual sobre fechas cronograma
 *   EV  · valorizaciones (montoCd c/reajuste) o avances físico × presupuesto
 *   AC  · costos reales (placeholder = EV hasta tener tracking compras+planillas)
 *
 * Fuente prioridad: valorizaciones > avances > plan-only
 */
export function computeCurvaS(
  partidas: Partida[],
  latestAvances: Avance[],
  valorizaciones: Valorizacion[] = [],
  valorizacionesPartidas: ValorizacionPartida[] = [],
  today: Date = new Date(),
): CurvaSResult | null {
  // Solo hojas con fechas + presupuesto contractual > 0 (fallback referencial)
  const parents = new Set(partidas.map((p) => p.parentCodigo).filter(Boolean) as string[]);
  const leaves = partidas.filter((p) => {
    if (parents.has(p.codigo)) return false;
    if (!p.fechaInicio || !p.fechaFin) return false;
    const presup = Number(p.presupuestoContractual ?? 0) || Number(p.presupuesto ?? 0);
    return presup > 0;
  });
  if (leaves.length === 0) return null;

  // Range global · partidas (cronograma) + valorizaciones (ejecución real)
  let minDate = new Date(leaves[0]!.fechaInicio!);
  let maxDate = new Date(leaves[0]!.fechaFin!);
  for (const p of leaves) {
    const s = new Date(p.fechaInicio!);
    const f = new Date(p.fechaFin!);
    if (s < minDate) minDate = s;
    if (f > maxDate) maxDate = f;
  }
  // Expandir con valorizaciones (pueden caer fuera del plan)
  for (const v of valorizaciones) {
    const s = new Date(v.fechaDesde);
    const f = new Date(v.fechaHasta);
    if (s < minDate) minDate = s;
    if (f > maxDate) maxDate = f;
  }

  // Buckets mensuales
  const buckets: Bucket[] = [];
  const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const endCursor = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
  let i = 1;
  while (cursor <= endCursor) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    buckets.push({
      key: `${y}-${String(m + 1).padStart(2, '0')}`,
      idx: i++,
      year: y,
      month: m,
      start: new Date(y, m, 1),
      finish: new Date(y, m + 1, 0, 23, 59, 59),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // Plan · distribución lineal sobre presupuestoContractual (fallback presupuesto)
  const plan = buckets.map(() => 0);
  for (const p of leaves) {
    const s = new Date(p.fechaInicio!);
    const f = new Date(p.fechaFin!);
    const presup = Number(p.presupuestoContractual ?? 0) || Number(p.presupuesto ?? 0);
    const dias = Math.max(1, Math.round((f.getTime() - s.getTime()) / 86_400_000) + 1);
    const costoPorDia = presup / dias;
    buckets.forEach((b, idx) => {
      const bs = b.start > s ? b.start : s;
      const bf = b.finish < f ? b.finish : f;
      if (bs <= bf) {
        const d = Math.round((bf.getTime() - bs.getTime()) / 86_400_000) + 1;
        plan[idx]! += d * costoPorDia;
      }
    });
  }
  const planAcum: number[] = [];
  {
    let acc = 0;
    plan.forEach((v) => {
      acc += v;
      planAcum.push(acc);
    });
  }

  // EV / AC · prioridad valorizaciones
  const earned = buckets.map(() => 0);
  const real = buckets.map(() => 0);
  let fuente: CurvaSResult['fuente'] = 'plan-only';

  if (valorizaciones.length > 0) {
    fuente = 'valorizaciones';
    // EV: por valorización · sumar montoCd bruto (sin reajuste · presupuesto contractual ganado)
    for (const v of valorizaciones) {
      const fecha = new Date(v.fechaHasta);
      const bucketIdx = buckets.findIndex((b) => fecha >= b.start && fecha <= b.finish);
      if (bucketIdx < 0) continue;
      const cdConReaj = Number(v.montoCd);
      const reajuste = Number(v.montoReajuste ?? 0);
      const cdBruto = cdConReaj - reajuste;
      // EV: lo "ganado" físicamente = sin reajuste (para comparar con plan en moneda Io)
      earned[bucketIdx]! += cdBruto;
      // AC: lo cobrado/costo equivalente = con reajuste (en moneda Ir)
      real[bucketIdx]! += cdConReaj;
    }
  } else if (latestAvances.length > 0) {
    fuente = 'avances';
    // Fallback: usar avances histórico (legacy)
    const avancesPorPartida = new Map<string, Avance[]>();
    for (const a of latestAvances) {
      if (!avancesPorPartida.has(a.partidaId)) avancesPorPartida.set(a.partidaId, []);
      avancesPorPartida.get(a.partidaId)!.push(a);
    }
    for (const [pid, avs] of avancesPorPartida) {
      const partida = leaves.find((p) => p.id === pid);
      if (!partida) continue;
      const budget = Number(partida.presupuestoContractual ?? 0) || Number(partida.presupuesto ?? 0);
      const sorted = avs.sort((x, y) => new Date(x.fecha).getTime() - new Date(y.fecha).getTime());
      let prevPct = 0;
      let prevAcum = 0;
      for (const av of sorted) {
        const fecha = new Date(av.fecha);
        const bucketIdx = buckets.findIndex((b) => fecha >= b.start && fecha <= b.finish);
        if (bucketIdx >= 0) {
          const currPct = Number(av.avancePct);
          earned[bucketIdx]! += (budget * (currPct - prevPct)) / 100;
          prevPct = currPct;
          const currAcum = Number(av.realCost);
          real[bucketIdx]! += currAcum - prevAcum;
          prevAcum = currAcum;
        }
      }
    }
  }

  void valorizacionesPartidas; // no usado por ahora · disponible para drilldown

  const earnedAcum: number[] = [];
  const realAcum: number[] = [];
  {
    let acc = 0;
    earned.forEach((v) => {
      acc += v;
      earnedAcum.push(acc);
    });
  }
  {
    let acc = 0;
    real.forEach((v) => {
      acc += v;
      realAcum.push(acc);
    });
  }

  // EVM al hoy
  const hoyIdx = buckets.findIndex((b) => today >= b.start && today <= b.finish);
  const idxCorte = hoyIdx >= 0 ? hoyIdx : today < buckets[0]!.start ? -1 : buckets.length - 1;
  const PV = idxCorte >= 0 ? planAcum[idxCorte]! : 0;
  const AC = idxCorte >= 0 ? realAcum[idxCorte]! : 0;
  const EV = idxCorte >= 0 ? earnedAcum[idxCorte]! : 0;
  const BAC = leaves.reduce((s, p) => s + (Number(p.presupuestoContractual ?? 0) || Number(p.presupuesto ?? 0)), 0);
  const SPI = PV > 0 ? EV / PV : 0;
  const CPI = AC > 0 ? EV / AC : 0;
  const SV = EV - PV;
  const CV = EV - AC;
  const EAC = AC > 0 && EV > 0 ? BAC * (AC / EV) : BAC;
  const pctCompletado = BAC > 0 ? (EV / BAC) * 100 : 0;

  return {
    buckets,
    plan,
    planAcum,
    real,
    realAcum,
    earned,
    earnedAcum,
    hoyIdx: idxCorte,
    fuente,
    evm: { BAC, PV, AC, EV, SPI, CPI, SV, CV, EAC, pctCompletado },
  };
}
