/**
 * Helpers del Dashboard Operativo · salud (semáforo CPI/SPI) y forecast determinístico.
 * Sin IA: el forecast extrapola el ritmo real de avance del portafolio vs el plan maestro.
 */

export type Salud = 'critico' | 'observacion' | 'saludable' | 'sin_datos';

// Semáforo por el PEOR de los índices disponibles · umbrales <0.90 / 0.90-0.97 / >=0.97
// Con costo incompleto el CPI viene null → clasifica por SPI solo (y viceversa).
export function clasificarSalud(cpi: number | null, spi: number | null): Salud {
  const idx = [cpi, spi].filter((x): x is number => x != null);
  if (idx.length === 0) return 'sin_datos';
  const peor = Math.min(...idx);
  if (peor < 0.9) return 'critico';
  if (peor < 0.97) return 'observacion';
  return 'saludable';
}

const pad = (n: number) => String(n).padStart(2, '0');

// Serie por proyecto · misma longitud keys/planAcum/earnedAcum (de computeCurvaS)
export type SerieProy = { keys: string[]; planAcum: number[]; earnedAcum: number[] };
export type ForecastPunto = { periodo: string; plan: number; proyectado: number };
export type Forecast = {
  puntos: ForecastPunto[];
  pctPlanHoy: number;
  pctRealHoy: number;
  probabilidadCierreQ2: number; // % cumplimiento proyectado al cierre Q2 del año en curso
};

// Valor acumulado de una serie en `key`: último bucket <= key (carry-forward), 0 antes de iniciar
function acumEn(keys: string[], acum: number[], key: string): number {
  let v = 0;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i]! <= key) v = acum[i]!;
    else break;
  }
  return v;
}

export function construirForecast(series: SerieProy[], today: Date = new Date()): Forecast | null {
  const conDatos = series.filter((s) => s.keys.length > 0);
  if (conDatos.length === 0) return null;

  // Timeline global de meses (carry-forward para sumar portafolio aun con rangos distintos)
  const allKeys = [...new Set(conDatos.flatMap((s) => s.keys))].sort();
  const planTot = allKeys.map((k) => conDatos.reduce((a, s) => a + acumEn(s.keys, s.planAcum, k), 0));
  const earnTot = allKeys.map((k) => conDatos.reduce((a, s) => a + acumEn(s.keys, s.earnedAcum, k), 0));
  const bac = planTot[planTot.length - 1] || 1; // plan acumulado final ≈ BAC del portafolio

  const planPct = planTot.map((v) => (v / bac) * 100);
  const realPct = earnTot.map((v) => (v / bac) * 100);

  const hoyKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  let hoyIdx = allKeys.findIndex((k) => k >= hoyKey);
  if (hoyIdx < 0) hoyIdx = allKeys.length - 1;

  // Proyección: real hasta hoy, luego extiende a la velocidad media de los últimos 3 meses
  const lo = Math.max(0, hoyIdx - 3);
  const vel = (realPct[hoyIdx]! - realPct[lo]!) / Math.max(1, hoyIdx - lo);
  const proy = realPct.slice();
  for (let i = hoyIdx + 1; i < allKeys.length; i++) {
    proy[i] = Math.min(100, proy[i - 1]! + Math.max(0, vel));
  }

  // Muestreo trimestral: último mes presente de cada trimestre
  const trimDe = (key: string) => {
    const [y, m] = key.split('-').map(Number) as [number, number];
    return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
  };
  const puntosMap = new Map<string, ForecastPunto>();
  allKeys.forEach((k, i) => {
    puntosMap.set(trimDe(k), { periodo: trimDe(k), plan: Math.round(planPct[i]!), proyectado: Math.round(proy[i]!) });
  });
  const puntos = [...puntosMap.values()];

  // Probabilidad cierre Q2 = cumplimiento proyectado/plan al último mes de Q2 del año en curso
  const finQ2 = `${today.getFullYear()}-06`;
  let q2Idx = allKeys.findIndex((k) => k >= finQ2);
  if (q2Idx < 0) q2Idx = allKeys.length - 1;
  const planQ2 = planPct[q2Idx]!;
  const proyQ2 = proy[q2Idx]!;
  const probabilidadCierreQ2 = planQ2 > 0 ? Math.max(0, Math.min(100, Math.round((proyQ2 / planQ2) * 100))) : 100;

  return {
    puntos,
    pctPlanHoy: Math.round(planPct[hoyIdx]! * 10) / 10,
    pctRealHoy: Math.round(realPct[hoyIdx]! * 10) / 10,
    probabilidadCierreQ2,
  };
}

// ── self-check (tsx lib/dashboard.ts) ──────────────────────
if (process.argv[1]?.replace(/\\/g, '/').endsWith('lib/dashboard.ts')) {
  const a = (c: boolean, m: string) => { if (!c) throw new Error('FAIL: ' + m); };
  a(clasificarSalud(1.0, 0.72) === 'critico', 'spi bajo → critico');
  a(clasificarSalud(0.98, 0.98) === 'saludable', '0.98 → saludable');
  a(clasificarSalud(0.95, 0.93) === 'observacion', '0.93 → observacion');
  a(clasificarSalud(null, 0.72) === 'critico', 'solo spi bajo → critico');
  a(clasificarSalud(null, null) === 'sin_datos', 'ambos null → sin_datos');
  // forecast: 2 proyectos, plan lineal, real por debajo → proyección y prob < 100
  const s: SerieProy[] = [
    { keys: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'], planAcum: [20, 40, 60, 80, 90, 100], earnedAcum: [15, 30, 45, 55, 60, 65] },
  ];
  const f = construirForecast(s, new Date('2026-04-15'));
  a(!!f, 'forecast no nulo');
  a(f!.puntos.length === 2, 'puntos Q1+Q2 2026=' + f!.puntos.length);
  a(f!.pctRealHoy < f!.pctPlanHoy, 'real(' + f!.pctRealHoy + ') < plan(' + f!.pctPlanHoy + ')');
  a(f!.probabilidadCierreQ2 < 100 && f!.probabilidadCierreQ2 > 0, 'prob Q2=' + f!.probabilidadCierreQ2);
  console.log('dashboard.ts self-check OK · prob Q2 =', f!.probabilidadCierreQ2 + '%', '· puntos', f!.puntos.map((p) => `${p.periodo}:${p.proyectado}/${p.plan}`).join(' '));
}
