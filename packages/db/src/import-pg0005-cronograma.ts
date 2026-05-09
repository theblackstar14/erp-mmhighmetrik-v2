/**
 * F1.B · Importador cronograma MPP PG0005
 *
 * NO destructivo · solo UPDATE fechas + duración + cost MPP en partidas existentes.
 * Match por NOMBRE normalizado · fallback código convertido.
 * Verifica cuadre cost MPP ≈ presupuesto contractual.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Decimal } from 'decimal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = await import('./client.js');
const { proyectos, partidas, importsS10 } = await import('./schema.js');
const { eq, and } = await import('drizzle-orm');
const { parseMppJson, normalizeName, convertirOutlineMppACodigo } = await import(
  './importers/cronograma-mpp.js'
);

const ARCHIVO_JSON = process.argv[2] ?? path.resolve(__dirname, '../fixtures/cronograma-pg0005.json');
const CODIGO_PROYECTO = 'PG0005';

console.log('🚀 F1.B · Import cronograma MPP PG0005');
console.log(`📂 Archivo JSON: ${ARCHIVO_JSON}\n`);

if (!fs.existsSync(ARCHIVO_JSON)) {
  console.error(`❌ Archivo no encontrado: ${ARCHIVO_JSON}`);
  process.exit(1);
}

const startTs = Date.now();

// 1. Parsear JSON
console.log('🔍 Parseando JSON MPP...');
const buffer = fs.readFileSync(ARCHIVO_JSON, 'utf-8');
const parsed = parseMppJson(buffer);

console.log(`  Total tasks MPP: ${parsed.totalTasks}`);
console.log(`  Tasks relevantes (con outline ≥ 3 niveles): ${parsed.tasksRelevantes}`);
console.log(`  CD contractual root: S/ ${parsed.totalCost.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  Fecha inicio: ${parsed.startDate?.toISOString().slice(0, 10) ?? 'n/a'}`);
console.log(`  Fecha fin: ${parsed.finishDate?.toISOString().slice(0, 10) ?? 'n/a'}`);
console.log(`  Duración: ${parsed.durationDays} días\n`);

if (parsed.errors.length) {
  console.error('❌ Errores parseo:');
  for (const e of parsed.errors) console.error(`  · ${e}`);
  process.exit(1);
}

// 2. Validar proyecto + partidas existentes
const proyecto = await db.select().from(proyectos).where(eq(proyectos.codigo, CODIGO_PROYECTO)).limit(1);
if (!proyecto.length) {
  console.error(`❌ Proyecto ${CODIGO_PROYECTO} no encontrado`);
  process.exit(1);
}
const proyectoId = proyecto[0].id;

const partidasBD = await db.select().from(partidas).where(eq(partidas.proyectoId, proyectoId));
console.log(`📊 Partidas en BD (de F1.A): ${partidasBD.length}`);
if (partidasBD.length === 0) {
  console.error('❌ No hay partidas · corre F1.A primero (db:import-pg0005-presupuesto)');
  process.exit(1);
}

// 3. CHECK 1 · Cuadre cost MPP vs presupuesto contractual BD
const sumaContractualBD = partidasBD
  .filter((p) => !p.isSummary)
  .reduce((acc, p) => acc.plus(p.presupuestoContractual ?? 0), new Decimal(0))
  .toDecimalPlaces(2)
  .toNumber();

console.log(`\n📊 CHECK 1 · Cuadre cost MPP vs presupuesto contractual BD:`);
console.log(`  CD contractual MPP root:    S/ ${parsed.totalCost.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  Σ presup contractual BD:    S/ ${sumaContractualBD.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
const diff1 = new Decimal(parsed.totalCost).minus(sumaContractualBD).toDecimalPlaces(2).toNumber();
console.log(`  Diferencia: ${diff1} ${Math.abs(diff1) <= 100 ? '✓ (precisión factor)' : '✗'}\n`);

// 4. Insertar HITOS del MPP que no existan en S10 (Inicio Obra, Fin Obra)
const hitosMpp = parsed.tasks.filter((t) => t.isMilestone);
console.log(`\n🏁 Hitos MPP detectados: ${hitosMpp.length}`);
for (const h of hitosMpp) {
  if (!h.codigoExcel) continue;
  const existe = partidasBD.find((p) => p.codigo === h.codigoExcel);
  if (existe) continue;
  console.log(`  + Insertando hito: ${h.codigoExcel} · ${h.nombre}`);
  await db.insert(partidas).values({
    proyectoId,
    codigo: h.codigoExcel,
    parentCodigo: null,
    nivel: 1,
    nombre: h.nombre,
    unidad: null,
    cantidad: null,
    presupuesto: '0',
    presupuestoContractual: '0',
    isSummary: false,
    isMilestone: true,
    isCritical: h.isCritical,
    fechaInicio: h.fechaInicio?.toISOString().slice(0, 10) ?? null,
    fechaFin: h.fechaFin?.toISOString().slice(0, 10) ?? null,
    duracionDias: 0,
    orden: h.outlineMpp.includes('.1.1') ? -1 : 9999, // Inicio antes, Fin después
  });
}

// Re-cargar partidas BD post-insert hitos
const partidasBDActualizado = await db.select().from(partidas).where(eq(partidas.proyectoId, proyectoId));
console.log(`📊 Partidas BD post-hitos: ${partidasBDActualizado.length}\n`);

// 5. Build maps para match eficiente
// IMPORTANTE: nombres duplicados (ej "ACERO DE REFUERZO") usar Map<name, partida[]>
const partidasByName = new Map<string, typeof partidasBDActualizado[number][]>();
const partidasByCodigo = new Map<string, typeof partidasBDActualizado[number]>();
const partidasByMppUniqueId = new Map<number, typeof partidasBDActualizado[number]>();
for (const p of partidasBDActualizado) {
  const key = normalizeName(p.nombre);
  const arr = partidasByName.get(key);
  if (arr) arr.push(p);
  else partidasByName.set(key, [p]);
  partidasByCodigo.set(p.codigo, p);
}

// Map MPP unique_id → partida (necesario para resolver predecesores)
for (const task of parsed.tasks) {
  let partidaMatch: typeof partidasBDActualizado[number] | undefined;
  if (task.codigoExcel) partidaMatch = partidasByCodigo.get(task.codigoExcel);
  if (!partidaMatch) {
    const cands = partidasByName.get(task.nombreNormalizado);
    if (cands?.length === 1) partidaMatch = cands[0];
  }
  if (partidaMatch) partidasByMppUniqueId.set(task.uniqueId, partidaMatch);
}

// 5. Crear registro import
const [importRow] = await db
  .insert(importsS10)
  .values({
    proyectoId,
    archivoNombre: path.basename(ARCHIVO_JSON),
    tipo: 'mpp_cronograma',
    estado: 'procesando',
    montoReferenciaArchivo: String(parsed.totalCost),
  })
  .returning();
const importId = importRow.id;

// 6. UPDATE partidas con fechas + duración + cost MPP
console.log('📥 Updating partidas con datos cronograma MPP...');
let matched = 0;
let matchedByName = 0;
let matchedByCodigo = 0;
let notMatched = 0;
const noMatchWarnings: string[] = [];
let costMppCuadrante = 0;
let costMppDescuadrado = 0;

try {
  for (const task of parsed.tasks) {
    // Match estrategia robusta:
    //  1) Por código convertido (más confiable · MPP outline → Excel código)
    //  2) Por nombre si único en BD (no hay duplicados)
    //  3) Por nombre si task.codigoExcel puede desambiguar duplicado
    let partida: typeof partidasBD[number] | undefined;
    let matchType: 'codigo' | 'name_unico' | 'name_disambig' | null = null;

    // 1. Por código convertido
    if (task.codigoExcel) {
      partida = partidasByCodigo.get(task.codigoExcel);
      if (partida) {
        matchType = 'codigo';
        matchedByCodigo++;
      }
    }

    // 2. Por nombre · solo si NO hay duplicados de ese nombre
    if (!partida) {
      const candidatos = partidasByName.get(task.nombreNormalizado);
      if (candidatos && candidatos.length === 1) {
        partida = candidatos[0];
        matchType = 'name_unico';
        matchedByName++;
      } else if (candidatos && candidatos.length > 1 && task.codigoExcel) {
        // 3. Desambiguación por código convertido (parent)
        const parent = task.codigoExcel.includes('.')
          ? task.codigoExcel.substring(0, task.codigoExcel.lastIndexOf('.'))
          : null;
        partida = candidatos.find((c) => c.parentCodigo === parent);
        if (partida) {
          matchType = 'name_disambig';
          matchedByName++;
        }
      }
    }

    if (!partida) {
      notMatched++;
      if (noMatchWarnings.length < 10) {
        noMatchWarnings.push(
          `outline=${task.outlineMpp} → cod_excel=${task.codigoExcel ?? 'n/a'} · "${task.nombre.slice(0, 50)}"`,
        );
      }
      continue;
    }

    matched++;

    // CHECK · cost MPP ≈ presupuesto contractual partida (±1 PEN)
    if (!partida.isSummary && partida.presupuestoContractual) {
      const presBD = new Decimal(partida.presupuestoContractual);
      const costMpp = new Decimal(task.cost);
      if (presBD.minus(costMpp).abs().lte(1)) costMppCuadrante++;
      else costMppDescuadrado++;
    }

    // Resolver predecesores · MPP unique_ids → códigos partidas BD
    const predCodigos = task.predecessorIds
      .map((uid) => partidasByMppUniqueId.get(uid)?.codigo)
      .filter((c): c is string => !!c);

    // UPDATE solo campos del cronograma · NO sobrescribir metrado/PU
    await db
      .update(partidas)
      .set({
        fechaInicio: task.fechaInicio?.toISOString().slice(0, 10) ?? null,
        fechaFin: task.fechaFin?.toISOString().slice(0, 10) ?? null,
        duracionDias: task.duracionDias > 0 ? task.duracionDias : null,
        isMilestone: task.isMilestone,
        isCritical: task.isCritical,
        predecessors: predCodigos,
      })
      .where(and(eq(partidas.proyectoId, proyectoId), eq(partidas.id, partida.id)));
  }

  console.log(`  Matched total: ${matched}/${parsed.tasksRelevantes}`);
  console.log(`    · Por nombre: ${matchedByName}`);
  console.log(`    · Por código: ${matchedByCodigo}`);
  console.log(`  No matched: ${notMatched}`);
  if (noMatchWarnings.length) {
    console.log(`  Sample no matched:`);
    for (const w of noMatchWarnings) console.log(`    · ${w}`);
  }

  // 7. CHECK 2 · cost MPP por partida vs presupuesto contractual
  console.log(`\n📊 CHECK 2 · cost MPP partida ≈ presupuesto contractual:`);
  console.log(`  Cuadrantes (±1 PEN): ${costMppCuadrante}`);
  console.log(`  Descuadrados: ${costMppDescuadrado}`);
  const cuadreOk = costMppCuadrante > costMppDescuadrado * 5; // 80%+ deben cuadrar
  console.log(`  ${cuadreOk ? '✓' : '✗'} ratio cuadre`);

  // 8. UPDATE proyecto fechas
  await db
    .update(proyectos)
    .set({
      fechaInicio: parsed.startDate?.toISOString().slice(0, 10) ?? null,
      fechaFin: parsed.finishDate?.toISOString().slice(0, 10) ?? null,
      ganttFile: path.basename(ARCHIVO_JSON),
    })
    .where(eq(proyectos.id, proyectoId));
  console.log(`  ✓ Proyecto actualizado con fechas inicio/fin`);

  // 9. Update import status
  const duracion = Date.now() - startTs;
  await db
    .update(importsS10)
    .set({
      estado: 'exitoso',
      partidasImportadas: matched,
      montoTotalCalculado: String(parsed.totalCost),
      diferencia: String(diff1),
      duracionMs: duracion,
      warningsLog: noMatchWarnings,
    })
    .where(eq(importsS10.id, importId));

  console.log('\n═════════════════════════════════════════════════════════');
  console.log('✅ F1.B IMPORT EXITOSO');
  console.log(`   · ${matched} partidas actualizadas con cronograma`);
  console.log(`   · CD MPP: S/ ${parsed.totalCost.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
  console.log(`   · Período: ${parsed.startDate?.toISOString().slice(0, 10)} → ${parsed.finishDate?.toISOString().slice(0, 10)}`);
  console.log(`   · Duración: ${parsed.durationDays} días`);
  console.log(`   · Tiempo ejecución: ${duracion}ms`);
  console.log('═════════════════════════════════════════════════════════');
} catch (err) {
  await db
    .update(importsS10)
    .set({ estado: 'fallido', errorsLog: [String(err)] })
    .where(eq(importsS10.id, importId));
  console.error('\n❌ ERROR · rollback aplicado');
  console.error(err);
  process.exit(1);
}

process.exit(0);
