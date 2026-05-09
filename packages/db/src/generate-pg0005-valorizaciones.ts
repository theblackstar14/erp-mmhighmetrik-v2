/**
 * F2.D · Genera valorizaciones SINTÉTICAS PG0005
 *
 * Sin datos reales de valorizaciones · simula avance lineal mensual
 * desde julio 2025 hasta abril 2026 (11 valorizaciones)
 *
 * Por cada valorización:
 *   - Cabecera valorizaciones (periodo, montos, K)
 *   - valorizaciones_partidas (metrado periodo proporcional)
 *   - valorizaciones_reajustes (1 por FP, con K factor calculado)
 *
 * REEMPLAZAR con importer S10 cuando user provea Excel mensuales reales
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = await import('./client.js');
const {
  proyectos,
  partidas,
  formulasPolinomicas,
  valorizaciones,
  valorizacionesPartidas,
  valorizacionesReajustes,
} = await import('./schema.js');
const { eq, and, isNotNull } = await import('drizzle-orm');
const { calcKFactor } = await import('./importers/calc-k-factor.js');

// Períodos valorización: 1 por mes desde junio 2025 (post fecha_base)
const PERIODOS = [
  { num: 1, desde: '2025-07-01', hasta: '2025-07-31', mesIr: '2025-07' },
  { num: 2, desde: '2025-08-01', hasta: '2025-08-31', mesIr: '2025-08' },
  { num: 3, desde: '2025-09-01', hasta: '2025-09-30', mesIr: '2025-09' },
  { num: 4, desde: '2025-10-01', hasta: '2025-10-31', mesIr: '2025-10' },
  { num: 5, desde: '2025-11-01', hasta: '2025-11-30', mesIr: '2025-11' },
  { num: 6, desde: '2025-12-01', hasta: '2025-12-31', mesIr: '2025-12' },
  { num: 7, desde: '2026-01-01', hasta: '2026-01-31', mesIr: '2026-01' },
  { num: 8, desde: '2026-02-01', hasta: '2026-02-28', mesIr: '2026-02' },
  { num: 9, desde: '2026-03-01', hasta: '2026-03-31', mesIr: '2026-03' },
  { num: 10, desde: '2026-04-01', hasta: '2026-04-30', mesIr: '2026-04' },
];

// Avance acumulado al final de cada periodo (curva S simple)
const AVANCE_ACUM = [0.06, 0.14, 0.24, 0.36, 0.48, 0.59, 0.69, 0.78, 0.85, 0.91];

const PCT_IGV = 18;

console.log('🚀 F2.D · Genera valorizaciones SINTÉTICAS PG0005\n');

const proy = await db.select().from(proyectos).where(eq(proyectos.codigo, 'PG0005')).limit(1);
if (!proy.length) {
  console.error('❌ proyecto PG0005 no encontrado');
  process.exit(1);
}
const proyectoId = proy[0].id;

// Limpiar valorizaciones previas
console.log('🧹 Limpiando valorizaciones previas...');
const valsPrev = await db.select().from(valorizaciones).where(eq(valorizaciones.proyectoId, proyectoId));
for (const v of valsPrev) {
  await db.delete(valorizaciones).where(eq(valorizaciones.id, v.id));
}
console.log(`  ✓ ${valsPrev.length} valorizaciones previas eliminadas\n`);

// Get FPs
const fps = await db
  .select()
  .from(formulasPolinomicas)
  .where(eq(formulasPolinomicas.proyectoId, proyectoId));
const fpsMap = new Map(fps.map((f) => [f.subpresupuestoCodigo, f]));

// Get partidas hoja con presupuesto contractual > 0
const todasPartidas = await db
  .select()
  .from(partidas)
  .where(
    and(
      eq(partidas.proyectoId, proyectoId),
      eq(partidas.isSummary, false),
      isNotNull(partidas.precioUnitarioContractual),
    ),
  );

console.log(`📊 ${todasPartidas.length} partidas hoja con PU contractual\n`);

// Anotar subpresupuesto desde codigo
const partidasConSubp = todasPartidas
  .map((p) => ({
    ...p,
    subp: p.codigo.split('.')[0]?.padStart(3, '0') ?? '000',
  }))
  .filter((p) => fpsMap.has(p.subp));

console.log(`   · ${partidasConSubp.length} partidas mapeadas a algún subp\n`);

const cdContractualTotal = Number(proy[0].costoDirecto ?? 0);
console.log(`   · CD contractual total: S/ ${cdContractualTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

let avancePrevAcum = 0;

for (let i = 0; i < PERIODOS.length; i++) {
  const periodo = PERIODOS[i];
  const avanceAcum = AVANCE_ACUM[i];
  const avancePeriodo = avanceAcum - avancePrevAcum;

  console.log(`📅 Valorización N°${periodo.num} · ${periodo.mesIr} · avance acum ${(avanceAcum * 100).toFixed(1)}%`);

  // Insertar cabecera placeholder · K se calcula después
  const [valRow] = await db
    .insert(valorizaciones)
    .values({
      proyectoId,
      numero: periodo.num,
      fechaDesde: periodo.desde,
      fechaHasta: periodo.hasta,
      fechaEmision: periodo.hasta,
      montoCd: '0',
      montoIgv: '0',
      montoTotal: '0',
      pctAvance: (avanceAcum * 100).toFixed(2),
      factorReajusteK: '1',
      montoReajuste: '0',
      status: 'aprobada',
      observaciones: 'SINTÉTICA · placeholder F2.D',
    })
    .returning();

  let montoCdPeriodo = 0;

  // Insert valorizaciones_partidas: cada partida × avance lineal
  for (const p of partidasConSubp) {
    const metradoContractual = Number(p.cantidad ?? 0);
    const pu = Number(p.precioUnitarioContractual ?? 0);
    if (!metradoContractual || !pu) continue;

    const metradoAcum = metradoContractual * avanceAcum;
    const metradoPrev = metradoContractual * avancePrevAcum;
    const metradoPer = metradoAcum - metradoPrev;
    const montoPer = metradoPer * pu;
    const montoAcum = metradoAcum * pu;
    const pctAvancePartida = avanceAcum * 100;

    if (metradoPer < 0.0001) continue; // skip noise

    await db.insert(valorizacionesPartidas).values({
      valorizacionId: valRow.id,
      partidaId: p.id,
      subpresupuestoCodigo: p.subp,
      metradoContractual: metradoContractual.toFixed(4),
      metradoAnterior: metradoPrev.toFixed(4),
      metradoPeriodo: metradoPer.toFixed(4),
      metradoAcumulado: metradoAcum.toFixed(4),
      precioUnitario: pu.toFixed(2),
      montoPeriodo: montoPer.toFixed(2),
      montoAcumulado: montoAcum.toFixed(2),
      pctAvance: pctAvancePartida.toFixed(2),
    });

    montoCdPeriodo += montoPer;
  }

  // Calc K por FP + insert reajustes
  let montoReajusteTotal = 0;
  let kPromedio = 0;
  let pesoSum = 0;

  for (const fp of fps) {
    const k = await calcKFactor(fp.id, periodo.mesIr);

    // Σ monto valorizaciones_partidas × subp
    const valpartSubp = await db
      .select()
      .from(valorizacionesPartidas)
      .where(
        and(
          eq(valorizacionesPartidas.valorizacionId, valRow.id),
          eq(valorizacionesPartidas.subpresupuestoCodigo, fp.subpresupuestoCodigo),
        ),
      );
    const montoSubp = valpartSubp.reduce((s, v) => s + Number(v.montoPeriodo), 0);
    const reajusteSubp = montoSubp * (k.k - 1);
    montoReajusteTotal += reajusteSubp;

    if (montoSubp > 0) {
      kPromedio += k.k * montoSubp;
      pesoSum += montoSubp;
    }

    await db.insert(valorizacionesReajustes).values({
      valorizacionId: valRow.id,
      formulaId: fp.id,
      subpresupuestoCodigo: fp.subpresupuestoCodigo,
      anioMesIndice: periodo.mesIr,
      kCalculado: k.k.toFixed(6),
      montoSubpresupuesto: montoSubp.toFixed(2),
      montoReajuste: reajusteSubp.toFixed(2),
      detalleK: k.detalle.map((d) => ({
        monomio: d.monomio,
        simbolo: d.simbolo,
        coef: d.coef,
        ir: d.ir,
        io: d.io,
        relacion: d.relacion,
      })),
    });
  }

  const kAvg = pesoSum > 0 ? kPromedio / pesoSum : 1;
  const cdConReajuste = montoCdPeriodo + montoReajusteTotal;
  const igv = cdConReajuste * (PCT_IGV / 100);
  const total = cdConReajuste + igv;

  // Update cabecera
  await db
    .update(valorizaciones)
    .set({
      montoCd: cdConReajuste.toFixed(2),
      montoIgv: igv.toFixed(2),
      montoTotal: total.toFixed(2),
      factorReajusteK: kAvg.toFixed(6),
      montoReajuste: montoReajusteTotal.toFixed(2),
    })
    .where(eq(valorizaciones.id, valRow.id));

  console.log(
    `   · CD bruto: S/ ${montoCdPeriodo.toFixed(2)} · K avg: ${kAvg.toFixed(5)} · Reajuste: S/ ${montoReajusteTotal.toFixed(2)} · Total: S/ ${total.toFixed(2)}`,
  );

  avancePrevAcum = avanceAcum;
}

console.log('\n═════════════════════════════════════════════════════════');

// Resumen
const valsFinal = await db.select().from(valorizaciones).where(eq(valorizaciones.proyectoId, proyectoId));
const sumCd = valsFinal.reduce((s, v) => s + Number(v.montoCd), 0);
const sumReajuste = valsFinal.reduce((s, v) => s + Number(v.montoReajuste ?? 0), 0);
const sumTotal = valsFinal.reduce((s, v) => s + Number(v.montoTotal), 0);

console.log(`📊 RESUMEN F2.D · ${valsFinal.length} valorizaciones generadas`);
console.log(`   · Σ CD valorizado: S/ ${sumCd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
console.log(`   · Σ Reajuste:      S/ ${sumReajuste.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
console.log(`   · Σ Total c/IGV:   S/ ${sumTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
console.log(`   · CD contractual:  S/ ${cdContractualTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
console.log(`   · % avance final:  ${(AVANCE_ACUM[AVANCE_ACUM.length - 1] * 100).toFixed(1)}%`);
console.log('═════════════════════════════════════════════════════════');
console.log('\n✅ F2.D exitoso · valorizaciones sintéticas insertadas');
console.log('⚠ DATOS PLACEHOLDER · reemplazar con importer S10 real\n');

process.exit(0);
