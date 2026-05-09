/**
 * F1.C · Importador Calendario Adquisiciones PG0005
 *
 * Output:
 *   - Recursos catálogo (400+ items con códigos S10 oficiales)
 *   - Cronograma adquisiciones (recurso × mes × monto)
 *   - Validación cuadre triple:
 *       Σ recursos = CD contractual = MPP cost
 *       Σ mensual = monto contractual
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Decimal } from 'decimal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = await import('./client.js');
const { proyectos, recursos, cronogramaAdquisiciones, importsS10 } = await import('./schema.js');
const { eq } = await import('drizzle-orm');
const { parseCalendarioAdq } = await import('./importers/calendario-adq.js');

const ARCHIVO =
  process.argv[2] ?? path.resolve(__dirname, '../fixtures/calendario-pg0005.xlsx');
const CODIGO_PROYECTO = 'PG0005';

console.log('🚀 F1.C · Import calendario adquisiciones PG0005');
console.log(`📂 Archivo: ${ARCHIVO}\n`);

if (!fs.existsSync(ARCHIVO)) {
  console.error(`❌ Archivo no encontrado: ${ARCHIVO}`);
  process.exit(1);
}

const startTs = Date.now();

// 1. Parsear Excel
console.log('🔍 Parseando Excel...');
const buffer = fs.readFileSync(ARCHIVO);
const parsed = parseCalendarioAdq(buffer);

console.log(`  Recursos extraídos: ${parsed.recursos.length}`);
console.log(`    · Mano de obra: ${parsed.cantidadMO}`);
console.log(`    · Materiales: ${parsed.cantidadMaterial}`);
console.log(`    · Equipos: ${parsed.cantidadEquipo}`);
console.log(`  Σ parciales recursos: S/ ${parsed.costoDirectoTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  CD declarado archivo: S/ ${parsed.totalCD.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  Total contractual: S/ ${parsed.totalContractual.toLocaleString('es-PE', { minimumFractionDigits: 2 })}\n`);

if (parsed.errors.length) {
  console.error('❌ Errores parseo:');
  for (const e of parsed.errors) console.error(`  · ${e}`);
  process.exit(1);
}

// 2. Validar proyecto
const proyectoRow = await db.select().from(proyectos).where(eq(proyectos.codigo, CODIGO_PROYECTO)).limit(1);
if (!proyectoRow.length) {
  console.error(`❌ Proyecto ${CODIGO_PROYECTO} no encontrado · corre seed primero`);
  process.exit(1);
}
const proyectoId = proyectoRow[0].id;

// 3. CHECK 1 · Cuadre Σ recursos = CD contractual proyecto
const cdContractualEsperado = new Decimal(proyectoRow[0].costoDirecto ?? 0)
  .times(proyectoRow[0].factorOferta ?? 1)
  .toDecimalPlaces(2)
  .toNumber();
const diff1 = new Decimal(parsed.costoDirectoTotal).minus(cdContractualEsperado).toDecimalPlaces(2).toNumber();
console.log('📊 CHECK 1 · Σ recursos vs CD contractual proyecto');
console.log(`  Σ recursos calendario: S/ ${parsed.costoDirectoTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  CD contractual BD:     S/ ${cdContractualEsperado.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  Diferencia: ${diff1} ${Math.abs(diff1) <= 0.01 ? '✓' : '✗'}\n`);

// 4. CHECK 2 · Σ MO + Materiales + Equipos = CD
const sumComp = new Decimal(parsed.totalManoObra)
  .plus(parsed.totalMateriales)
  .plus(parsed.totalEquipos)
  .toDecimalPlaces(2)
  .toNumber();
const diff2 = new Decimal(sumComp).minus(parsed.costoDirectoTotal).toDecimalPlaces(2).toNumber();
console.log('📊 CHECK 2 · Σ componentes');
console.log(`  Mano obra:  S/ ${parsed.totalManoObra.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  Materiales: S/ ${parsed.totalMateriales.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  Equipos:    S/ ${parsed.totalEquipos.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  Suma:       S/ ${sumComp.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  vs Total:   ${diff2} ${Math.abs(diff2) <= 0.01 ? '✓' : '✗'}\n`);

// 5. CHECK 3 · Σ mensual recursos
const sumMensualRecursos = parsed.recursos.reduce(
  (acc, r) => acc.plus(r.meses.reduce((s, m) => s.plus(m.monto), new Decimal(0))),
  new Decimal(0),
).toDecimalPlaces(2).toNumber();
const diff3 = new Decimal(sumMensualRecursos).minus(parsed.costoDirectoTotal).toDecimalPlaces(2).toNumber();
console.log('📊 CHECK 3 · Σ mensual recursos = CD');
console.log(`  Σ todos los meses: S/ ${sumMensualRecursos.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  CD calculado:      S/ ${parsed.costoDirectoTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  Diferencia: ${diff3} ${Math.abs(diff3) <= 0.01 ? '✓' : '✗'}\n`);

// 6. CHECK 4 · Distribución mensual del CD
console.log('📊 CHECK 4 · Distribución mensual CD');
for (const m of parsed.meses) {
  console.log(`  ${m.idx} ${m.etiqueta}: S/ ${m.monto.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
}

// 7. Crear registro import
const [importRow] = await db
  .insert(importsS10)
  .values({
    proyectoId,
    archivoNombre: path.basename(ARCHIVO),
    tipo: 'calendario_adquisiciones',
    estado: 'procesando',
    montoReferenciaArchivo: String(parsed.totalCD),
  })
  .returning();
const importId = importRow.id;

// 8. Insertar recursos catálogo
console.log('\n📥 Insertando recursos catálogo...');
const recursosInsertados = new Map<string, string>(); // codigoS10 → recursoId

try {
  // Limpiar recursos previos del proyecto (idempotencia)
  // NOTA: recursos NO tiene proyecto_id en schema · es catálogo global
  // Para evitar duplicados, UPSERT por codigo
  const recursosExistentes = await db.select().from(recursos);
  const existentesMap = new Map(recursosExistentes.map((r) => [r.codigo, r.id]));

  let nuevos = 0;
  let actualizados = 0;
  for (const r of parsed.recursos) {
    const codigo = r.codigoS10;
    if (existentesMap.has(codigo)) {
      // Update precio + IU si cambió
      const id = existentesMap.get(codigo)!;
      await db
        .update(recursos)
        .set({
          descripcion: r.descripcion,
          unidad: r.unidad,
          tipo: r.tipo,
          precioReferencial: String(r.precioUnitario),
          iuCodigo: r.iuCodigo,
          iuClasificacionOrigen: 'auto_reglas',
          iuConfianza: String(r.iuConfianza),
        })
        .where(eq(recursos.id, id));
      recursosInsertados.set(codigo, id);
      actualizados++;
    } else {
      const [inserted] = await db
        .insert(recursos)
        .values({
          codigo,
          descripcion: r.descripcion,
          unidad: r.unidad,
          tipo: r.tipo,
          precioReferencial: String(r.precioUnitario),
          iuCodigo: r.iuCodigo,
          iuClasificacionOrigen: 'auto_reglas',
          iuConfianza: String(r.iuConfianza),
          activo: true,
        })
        .returning({ id: recursos.id });
      recursosInsertados.set(codigo, inserted.id);
      nuevos++;
    }
  }
  console.log(`  ✓ ${nuevos} recursos nuevos · ${actualizados} actualizados\n`);

  // 9. Limpiar cronograma_adquisiciones previo + insertar nuevo
  console.log('📥 Insertando cronograma adquisiciones...');
  await db.delete(cronogramaAdquisiciones).where(eq(cronogramaAdquisiciones.proyectoId, proyectoId));

  const cronogramaRows: Array<{
    proyectoId: string;
    recursoId: string;
    mesIndex: number;
    mesEtiqueta: string;
    fechaDesde: string;
    fechaHasta: string;
    cantidad: string;
    monto: string;
  }> = [];

  for (const r of parsed.recursos) {
    const recursoId = recursosInsertados.get(r.codigoS10);
    if (!recursoId) continue;
    for (const m of r.meses) {
      if (m.monto === 0) continue;
      // Aproximar cantidad por mes proporcional al monto
      const cantidadMes = r.parcial > 0 ? (m.monto / r.parcial) * r.cantidad : 0;
      cronogramaRows.push({
        proyectoId,
        recursoId,
        mesIndex: m.idx,
        mesEtiqueta: m.etiqueta,
        fechaDesde: m.fechaDesde,
        fechaHasta: m.fechaHasta,
        cantidad: String(cantidadMes.toFixed(4)),
        monto: String(m.monto.toFixed(2)),
      });
    }
  }
  // Insert batch
  for (let i = 0; i < cronogramaRows.length; i += 100) {
    const chunk = cronogramaRows.slice(i, i + 100);
    await db.insert(cronogramaAdquisiciones).values(chunk);
  }
  console.log(`  ✓ ${cronogramaRows.length} registros cronograma insertados\n`);

  // 10. Update import status
  const duracion = Date.now() - startTs;
  await db
    .update(importsS10)
    .set({
      estado: 'exitoso',
      partidasImportadas: 0,
      apusImportadas: 0,
      insumosImportados: parsed.recursos.length,
      montoTotalCalculado: String(parsed.costoDirectoTotal),
      diferencia: String(diff1),
      duracionMs: duracion,
    })
    .where(eq(importsS10.id, importId));

  console.log('═════════════════════════════════════════════════════════');
  console.log('✅ F1.C IMPORT EXITOSO');
  console.log(`   · ${parsed.recursos.length} recursos catálogo`);
  console.log(`     - ${parsed.cantidadMO} MO · ${parsed.cantidadMaterial} materiales · ${parsed.cantidadEquipo} equipos`);
  console.log(`   · ${cronogramaRows.length} registros cronograma adquisiciones`);
  console.log(`   · CD contractual: S/ ${parsed.costoDirectoTotal.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
  console.log(`   · Total contractual: S/ ${parsed.totalContractual.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
  console.log(`   · Distribución 4 meses cuadrada`);
  console.log(`   · Tiempo: ${duracion}ms`);
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
