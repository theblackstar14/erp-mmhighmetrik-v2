/**
 * Readiness v2 · TAXONOMÍA read-only de conciliación (FASE observabilidad).
 * Fuente ÚNICA compartida por: GET /conciliacion/taxonomia, computeReadinessV2, watchdog-v2.
 * NO persiste estado · NO gobierna GO · NO toca ownership/cutover/shadow/readiness-v1.
 * Determinística + reproducible (snapshot.hash). Guardas anti-gaming con TOPES DUROS en código.
 */
import { db, schema } from '@erp/db';
import { and, gte, isNotNull, lte, ne } from 'drizzle-orm';
import { createHash } from 'node:crypto';

// ── TOPES DUROS (config NUNCA los puede exceder · anti-gaming) ──
const CAP_MATERIAL_PCT = 0.02; // material efectivo ≤ 2% del flujo bruto del periodo
const COB_PISO_MIN = 80;       // piso de cobertura confirmada nunca < 80%
const RUIDO_TECHO_MAX = 10;    // techo de ruido nunca > 10%

export type ClaseConciliacion = 'ruido' | 'conciliable' | 'critico' | 'critico_acumulado' | 'transferencia_interna';
const RUIDO_PAT = /ITF|COM\.|COM |MANTENIM|ENVIO\.EST|\bPOS\b/i;

const round0 = (n: number) => Math.round(n);
const round1 = (n: number) => Math.round(n * 10) / 10;
function rangoPeriodo(periodo: string) {
  const [a, m] = periodo.split('-').map(Number) as [number, number];
  const fin = new Date(a, m, 0).getDate();
  return { desde: `${periodo}-01`, hasta: `${periodo}-${String(fin).padStart(2, '0')}` };
}

export async function construirTaxonomia(periodo: string) {
  const { desde, hasta } = rangoPeriodo(periodo);

  // config con TOPES DUROS aplicados (un valor gameado se clampa, no se confía)
  const cfgRows = await db.select().from(schema.configuracionContable);
  const cfg = new Map(cfgRows.map((r) => [r.clave, r.valor]));
  const num = (k: string, d: number) => { const v = Number(cfg.get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  const materialCfg = num('READINESS_UMBRAL_MATERIAL', 5000);
  const cobMin = num('READINESS_COB_MIN', 95);
  const cobPiso = Math.max(num('READINESS_COB_PISO', 80), COB_PISO_MIN);   // piso ≥ 80 SIEMPRE
  const ruidoTecho = Math.min(num('READINESS_RUIDO_TECHO_PCT', 5), RUIDO_TECHO_MAX); // techo ≤ 10 SIEMPRE
  const agingDias = num('READINESS_AGING_DIAS', 30);

  const lineas = await db.select().from(schema.extractoLineas)
    .where(and(gte(schema.extractoLineas.fecha, desde), lte(schema.extractoLineas.fecha, hasta)));
  const totalMonto = lineas.reduce((s, l) => s + Math.abs(Number(l.monto)), 0);

  // material EFECTIVO con cap duro: nunca > 2% del flujo (cierra el ataque "subir umbral vacía críticos")
  const materialCap = totalMonto > 0 ? CAP_MATERIAL_PCT * totalMonto : materialCfg;
  const material = Math.min(materialCfg, materialCap);
  const umbralEnRango = totalMonto === 0 || materialCfg <= materialCap;

  // "pata espejo PROBADA": el movimiento conciliado/sugerido es una transferencia interna real (transferenciaId)
  const movsTransfer = await db.select({ id: schema.movimientos.id }).from(schema.movimientos)
    .where(and(isNotNull(schema.movimientos.transferenciaId), ne(schema.movimientos.anulado, true)));
  const transferMovIds = new Set(movsTransfer.map((m) => m.id));

  const hoy = Date.now();
  type LC = { id: string; fecha: string; monto: number; desc: string; conciliado: boolean; sugerido: boolean; clase: ClaseConciliacion; razon: string; aging: number };
  const cl: LC[] = lineas.map((l) => {
    const monto = Number(l.monto); const abs = Math.abs(monto); const desc = String(l.descripcion ?? '');
    const conciliado = l.estado === 'conciliado';
    const sugerido = l.movimientoId != null;
    const esRuido = RUIDO_PAT.test(desc);
    const internaProbada = l.movimientoId != null && transferMovIds.has(l.movimientoId); // SOLO con pata probada
    const aging = Math.floor((hoy - new Date(`${l.fecha}T00:00:00`).getTime()) / 86400000);
    let clase: ClaseConciliacion, razon: string;
    if (conciliado) { clase = 'conciliable'; razon = 'conciliado (humano)'; }
    else if (internaProbada) { clase = 'transferencia_interna'; razon = 'pata espejo probada (mov transferenciaId)'; }
    else if (abs >= material && !esRuido) { clase = 'critico'; razon = `material ≥ ${round0(material)}`; }
    else if (esRuido && abs < material) { clase = 'ruido'; razon = 'patron ruido + inmaterial'; }
    else if (abs >= material) { clase = 'critico'; razon = 'desconocido material → critico (sesgo seguro)'; } // default ≥material
    else { clase = 'conciliable'; razon = 'resto (<material)'; }
    return { id: l.id, fecha: l.fecha, monto, desc, conciliado, sugerido, clase, razon, aging };
  });

  // critico_acumulado (anti-structuring): grupos NO-conciliados, NO-ruido, individuales <material, Σ ≥ material
  const grupos = new Map<string, LC[]>();
  for (const c of cl) {
    if (c.conciliado || c.clase === 'ruido' || c.clase === 'transferencia_interna' || Math.abs(c.monto) >= material) continue;
    const key = (c.monto < 0 ? '-' : '+') + c.desc.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10);
    const g = grupos.get(key) ?? []; g.push(c); grupos.set(key, g);
  }
  for (const g of grupos.values()) {
    const suma = g.reduce((s, c) => s + Math.abs(c.monto), 0);
    if (suma >= material && g.length >= 2) g.forEach((c) => { c.clase = 'critico_acumulado'; c.razon = `structuring: grupo S/${round0(suma)} ≥ ${round0(material)}`; });
  }

  // métricas por MONTO (relevante = todo menos ruido)
  const rel = (c: LC) => c.clase !== 'ruido';
  const sum = (arr: LC[]) => arr.reduce((s, c) => s + Math.abs(c.monto), 0);
  const criticos = cl.filter((c) => c.clase === 'critico' || c.clase === 'critico_acumulado');
  const montoRelevante = sum(cl.filter(rel));
  const montoConfirmado = sum(cl.filter((c) => c.conciliado && rel(c)));   // SOLO conciliado humano
  const montoSugerido = sum(cl.filter((c) => c.sugerido && rel(c)));       // informativo (NUNCA para GO)
  const ruidoMonto = sum(cl.filter((c) => c.clase === 'ruido'));
  const cobConfirmada = montoRelevante > 0 ? 100 * montoConfirmado / montoRelevante : 100;
  const cobSugerida = montoRelevante > 0 ? 100 * montoSugerido / montoRelevante : 100;
  const agingCriticoMax = criticos.length ? Math.max(...criticos.map((c) => c.aging)) : 0;
  const ruidoPct = totalMonto ? 100 * ruidoMonto / totalMonto : 0;

  const taxonomia = {
    total: { lineas: lineas.length, monto: round0(totalMonto) },
    ruido: { lineas: cl.filter((c) => c.clase === 'ruido').length, monto: round0(ruidoMonto), pctFlujo: round1(ruidoPct) },
    conciliable: { lineas: cl.filter((c) => c.clase === 'conciliable').length, monto: round0(sum(cl.filter((c) => c.clase === 'conciliable'))) },
    critico: { lineas: criticos.length, monto: round0(sum(criticos)) },
    transferenciaInterna: { lineas: cl.filter((c) => c.clase === 'transferencia_interna').length, monto: round0(sum(cl.filter((c) => c.clase === 'transferencia_interna'))) },
    cobertura: { confirmadaPct: round1(cobConfirmada), sugeridaPct: round1(cobSugerida), brechaPct: round1(cobSugerida - cobConfirmada), montoRelevante: round0(montoRelevante) },
    agingCriticoMaxDias: agingCriticoMax,
    montoSinClasificar: 0, // por construcción toda línea cae en exactamente una clase
  };
  const umbrales = { material: round0(material), materialCfg, cobMin, cobPiso, ruidoTecho, agingDias, capMaterialPct: CAP_MATERIAL_PCT * 100 };
  const guardas = {
    ruidoDentroTecho: ruidoPct <= ruidoTecho,
    umbralMaterialDentroRango: umbralEnRango,
    montoSinClasificarCero: true,
    coberturaUsaSoloConfirmado: true, // H1: la sugerida JAMÁS cuenta para GO
  };
  const hash = createHash('sha256').update(JSON.stringify({ periodo, umbrales, taxonomia, criticos: criticos.map((c) => c.id).sort() })).digest('hex');

  return {
    periodo, taxonomia, umbrales, guardas,
    criticosIds: criticos.map((c) => ({ id: c.id, fecha: c.fecha, monto: c.monto, clase: c.clase, aging: c.aging, desc: c.desc.slice(0, 50) })),
    derivados: { cobConfirmada: round1(cobConfirmada), agingCriticoMax, criticos: criticos.length, ruidoPct: round1(ruidoPct) },
    snapshot: { hash, capturadoEn: new Date().toISOString() },
  };
}
