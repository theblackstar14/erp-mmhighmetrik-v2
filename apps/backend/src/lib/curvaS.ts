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
  // Métrica financiero-inversión (base = monto de inversión, NO obra-CD).
  // PV = plan distribucionInversion · EV = montoInversionAcumulado de valorizaciones
  // (bloque totales del Excel: CD+mobiliario+ET+supervisión ejecutado).
  inversion?: {
    BAC: number; // monto de inversión total
    plan: number[]; // PV inversión mensual
    planAcum: number[]; // PV inversión acumulado
    ev: number[]; // EV inversión mensual (real ejecutado)
    evAcum: number[]; // EV inversión acumulado
    PV: number; // PV inversión acumulado al hoy
    EV: number; // EV inversión acumulado al hoy
    pctPlanHoy: number; // PV/BAC × 100
    pctRealHoy: number; // EV/BAC × 100
    spi: number; // EV/PV (cronograma inversión)
    evIngestado: boolean; // true = hay avance real de inversión en valorizaciones
  };
};

export type InversionPlan = {
  bac: number; // montoReferencial · monto de inversión total
  distribucion: Array<{ ym: string; monto: number }>; // plan mensual inversión
};

/**
 * Computa Curva S del proyecto
 *   PV  · distribución lineal de presupuesto contractual sobre fechas cronograma
 *   EV  · valorizaciones (montoCd c/reajuste) o avances físico × presupuesto
 *   AC  · costos reales (placeholder = EV hasta tener tracking compras+planillas)
 *
 * Fuente prioridad: valorizaciones > avances > plan-only
 */
// Subsets mínimos que computeCurvaS realmente lee · permiten `select({...})` narrow en los
// callers (menos memoria). El compilador fuerza la sincronía: agregar un campo aquí → el caller
// con select narrow rompe el build hasta incluirlo. Filas completas (Partida/Avance/…) calzan igual.
type PartidaCS = Pick<Partida, 'id' | 'codigo' | 'parentCodigo' | 'fechaInicio' | 'fechaFin' | 'presupuestoContractual' | 'presupuesto' | 'distribucionMensual'>;
type AvanceCS = Pick<Avance, 'partidaId' | 'fecha' | 'avancePct' | 'realCost'>;
type ValorizacionCS = Pick<Valorizacion, 'fechaDesde' | 'fechaHasta' | 'montoCd' | 'montoReajuste' | 'montoInversionPeriodo' | 'mesPeriodo' | 'montoInversionAcumulado'>;

export function computeCurvaS(
  partidas: PartidaCS[],
  latestAvances: AvanceCS[],
  valorizaciones: ValorizacionCS[] = [],
  valorizacionesPartidas: ValorizacionPartida[] = [],
  today: Date = new Date(),
  inversionPlan: InversionPlan | null = null,
  // Subtotal contratado (incluye GG+UT). Las partidas son CD puro; la valorización (montoCd) YA
  // trae GG+UT. Si se pasa, el avance-obra se mide contra esta base (= % oficial del informe).
  bacObraContractual: number | null = null,
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

  // Plan · prioriza distribución mensual exacta del cronograma valorizado · fallback lineal
  const plan = buckets.map(() => 0);
  // Index ym → bucket idx · 'YYYY-MM' (year+month con month 1-12)
  const bucketByYm = new Map<string, number>();
  buckets.forEach((b, idx) => {
    bucketByYm.set(`${b.year}-${String(b.month + 1).padStart(2, '0')}`, idx);
  });

  for (const p of leaves) {
    const distrib = ((p as { distribucionMensual?: Array<{ ym: string; monto: number }> | null })
      .distribucionMensual ?? []) as Array<{ ym: string; monto: number }>;
    if (distrib.length > 0) {
      // Distribución exacta · cronograma valorizado del expediente
      for (const d of distrib) {
        const idx = bucketByYm.get(d.ym);
        if (idx != null) plan[idx]! += d.monto;
      }
    } else {
      // Fallback lineal · partidas sin distribución (legacy o cargadas manualmente)
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
  }
  // Re-base del plan al subtotal contratado (CD+GG+UT). Las partidas suman solo CD; como la
  // valorización (EV=montoCd) ya incluye GG+UT, se escala el plan a la misma base para comparar
  // manzanas con manzanas. El % de plan no cambia (num y den escalan igual) y la curva llega a 100%.
  const planTotalCd = plan.reduce((s, v) => s + v, 0);
  if (bacObraContractual && bacObraContractual > 0 && planTotalCd > 0) {
    const factorContrato = bacObraContractual / planTotalCd;
    for (let k = 0; k < plan.length; k++) plan[k]! *= factorContrato;
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
    const avancesPorPartida = new Map<string, AvanceCS[]>();
    for (const a of latestAvances) {
      if (!avancesPorPartida.has(a.partidaId)) avancesPorPartida.set(a.partidaId, []);
      avancesPorPartida.get(a.partidaId)!.push(a);
    }
    const leafById = new Map(leaves.map((p) => [p.id, p]));
    for (const [pid, avs] of avancesPorPartida) {
      const partida = leafById.get(pid);
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
  const BAC =
    bacObraContractual && bacObraContractual > 0
      ? bacObraContractual
      : leaves.reduce((s, p) => s + (Number(p.presupuestoContractual ?? 0) || Number(p.presupuesto ?? 0)), 0);
  const SPI = PV > 0 ? EV / PV : 0;
  const CPI = AC > 0 ? EV / AC : 0;
  const SV = EV - PV;
  const CV = EV - AC;
  const EAC = AC > 0 && EV > 0 ? BAC * (AC / EV) : BAC;
  const pctCompletado = BAC > 0 ? (EV / BAC) * 100 : 0;

  // ─── Métrica financiero-inversión (plan-only por ahora) ────────────
  let inversion: CurvaSResult['inversion'];
  if (inversionPlan && inversionPlan.distribucion.length > 0) {
    const planInv = buckets.map(() => 0);
    for (const d of inversionPlan.distribucion) {
      const idx = bucketByYm.get(d.ym);
      if (idx != null) planInv[idx]! += d.monto;
    }
    const planInvAcum: number[] = [];
    {
      let acc = 0;
      planInv.forEach((v) => {
        acc += v;
        planInvAcum.push(acc);
      });
    }
    const bacInv = inversionPlan.bac > 0 ? inversionPlan.bac : planInvAcum[planInvAcum.length - 1] ?? 0;
    const pvInv = idxCorte >= 0 ? planInvAcum[idxCorte]! : 0;

    // EV inversión real · montoInversionPeriodo de valorizaciones, bucketeado por mesPeriodo
    const evInv = buckets.map(() => 0);
    let hayEvInv = false;
    for (const v of valorizaciones) {
      const periodo = Number(v.montoInversionPeriodo ?? 0);
      if (!periodo) continue;
      const ym = v.mesPeriodo ?? (v.fechaHasta ? String(v.fechaHasta).slice(0, 7) : null);
      const idx = ym ? bucketByYm.get(ym) : undefined;
      if (idx != null) {
        evInv[idx]! += periodo;
        hayEvInv = true;
      }
    }
    const evInvAcum: number[] = [];
    {
      let acc = 0;
      evInv.forEach((vv) => {
        acc += vv;
        evInvAcum.push(acc);
      });
    }
    // Si una valorización trae acumulado directo, úsalo como ancla del último bucket con avance
    if (hayEvInv) {
      const lastAcum = valorizaciones
        .filter((v) => Number(v.montoInversionAcumulado ?? 0) > 0)
        .map((v) => ({
          ym: v.mesPeriodo ?? (v.fechaHasta ? String(v.fechaHasta).slice(0, 7) : ''),
          acum: Number(v.montoInversionAcumulado),
        }))
        .filter((x) => bucketByYm.get(x.ym) != null)
        .sort((a, b) => bucketByYm.get(a.ym)! - bucketByYm.get(b.ym)!)
        .pop();
      if (lastAcum) {
        const idx = bucketByYm.get(lastAcum.ym)!;
        // re-ancla acumulado a partir del idx (corrige drift de de-cumulación)
        for (let k = idx; k < evInvAcum.length; k++) evInvAcum[k] = lastAcum.acum;
      }
    }
    const evInvHoy = idxCorte >= 0 ? evInvAcum[idxCorte]! : 0;

    inversion = {
      BAC: bacInv,
      plan: planInv,
      planAcum: planInvAcum,
      ev: evInv,
      evAcum: evInvAcum,
      PV: pvInv,
      EV: evInvHoy,
      pctPlanHoy: bacInv > 0 ? (pvInv / bacInv) * 100 : 0,
      pctRealHoy: bacInv > 0 ? (evInvHoy / bacInv) * 100 : 0,
      spi: pvInv > 0 ? evInvHoy / pvInv : 0,
      evIngestado: hayEvInv,
    };
  }

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
    inversion,
  };
}
