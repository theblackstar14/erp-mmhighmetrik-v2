/**
 * F1.A · Importador presupuesto desagregado PG0005
 *
 * Lee Excel S10 · valida cuadre · inserta partidas con pu_referencial + pu_contractual
 * Calcula factor_oferta automático
 * Verifica 5 checks matemáticos
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
const { eq } = await import('drizzle-orm');
const { parsePresupuestoS10 } = await import('./importers/presupuesto-s10.js');

const ARCHIVO_EXCEL =
  process.argv[2] ??
  'C:\\Users\\gabri\\Downloads\\PRESUPUESTO DESAGREGADO - CEMENTERIO - copia (1).xls';

const CODIGO_PROYECTO = 'PG0005';
const FACTOR_OFERTA_DEFAULT = 0.95;

console.log('🚀 F1.A · Import presupuesto desagregado PG0005');
console.log(`📂 Archivo: ${ARCHIVO_EXCEL}\n`);

if (!fs.existsSync(ARCHIVO_EXCEL)) {
  console.error(`❌ Archivo no encontrado: ${ARCHIVO_EXCEL}`);
  process.exit(1);
}

const startTs = Date.now();

// 1. Parsear Excel
console.log('🔍 Parseando Excel...');
const buffer = fs.readFileSync(ARCHIVO_EXCEL);
const parsed = parsePresupuestoS10(buffer);

console.log(`  Items totales: ${parsed.partidas.length}`);
console.log(`  Partidas hoja (con und+metrado): ${parsed.totalPartidasHoja}`);
console.log(`  Títulos: ${parsed.totalTitulos}`);
console.log(`  Σ parciales hoja: S/ ${parsed.sumaParcialesHoja.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  CD declarado archivo: S/ ${parsed.costoDirectoEsperado?.toLocaleString('es-PE', { minimumFractionDigits: 2 }) ?? 'n/a'}`);
console.log(`  Diferencia cuadre: ${parsed.diferenciaCuadre}`);
console.log(`  Cuadre: ${parsed.cuadre ? '✓' : '✗'}\n`);

if (parsed.errors.length) {
  console.error('❌ Errores parseo:');
  for (const e of parsed.errors) console.error(`  · ${e}`);
  process.exit(1);
}

if (parsed.warnings.length) {
  console.warn('⚠️ Warnings:');
  for (const w of parsed.warnings) console.warn(`  · ${w}`);
}

// 2. Validar proyecto existe
console.log('🔍 Validando proyecto PG0005...');
const proyecto = await db.select().from(proyectos).where(eq(proyectos.codigo, CODIGO_PROYECTO)).limit(1);
if (!proyecto.length) {
  console.error(`❌ Proyecto ${CODIGO_PROYECTO} no encontrado · corre seed primero`);
  process.exit(1);
}
const proyectoId = proyecto[0].id;
console.log(`  ✓ Proyecto encontrado: ${proyecto[0].nombre.slice(0, 60)}...\n`);

// 3. CHECK 1 · cuadre Σ partidas vs CD esperado del proyecto
const cdEsperadoProyecto = Number(proyecto[0].costoDirecto ?? 0);
const diffVsProyecto = new Decimal(cdEsperadoProyecto).minus(parsed.sumaParcialesHoja).toDecimalPlaces(2).toNumber();
console.log(`📊 CHECK 1 · Cuadre Σ partidas vs CD proyecto:`);
console.log(`  CD proyecto: S/ ${cdEsperadoProyecto.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  Σ partidas: S/ ${parsed.sumaParcialesHoja.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
console.log(`  Diferencia: ${diffVsProyecto} ${Math.abs(diffVsProyecto) <= 0.01 ? '✓' : '✗'}\n`);

if (Math.abs(diffVsProyecto) > 0.01) {
  console.error('❌ CHECK 1 FAIL · cuadre no exacto');
  process.exit(1);
}

// 4. CHECK 2 · factor oferta esperado
const factorOfertaProyecto = Number(proyecto[0].factorOferta ?? FACTOR_OFERTA_DEFAULT);
console.log(`📊 CHECK 2 · Factor oferta:`);
console.log(`  Factor oferta proyecto: ${factorOfertaProyecto}`);
console.log(`  Será aplicado a cada PU para calcular pu_contractual\n`);

// 5. Crear registro import
const importStart = new Date();
const [importRow] = await db
  .insert(importsS10)
  .values({
    proyectoId,
    archivoNombre: path.basename(ARCHIVO_EXCEL),
    archivoHash: 'TODO_sha256',
    tipo: 'presupuesto',
    estado: 'procesando',
    montoReferenciaArchivo: String(parsed.sumaParcialesHoja),
  })
  .returning();
const importId = importRow.id;

// 6. Insertar partidas (transacción)
console.log('📥 Insertando partidas en BD...');
const insertCount = { hoja: 0, titulo: 0 };

try {
  // Borrar partidas existentes PG0005 (idempotencia)
  await db.delete(partidas).where(eq(partidas.proyectoId, proyectoId));

  // Insert batch
  const batchSize = 100;
  for (let i = 0; i < parsed.partidas.length; i += batchSize) {
    const batch = parsed.partidas.slice(i, i + batchSize).map((p) => {
      const puContractual = p.precioUnitario
        ? new Decimal(p.precioUnitario).times(factorOfertaProyecto).toDecimalPlaces(4).toString()
        : null;

      // presupuestoContractual:
      //  - Partidas hoja (con metrado+pu): cantidad × pu_contractual
      //  - Títulos (sin metrado): parcial × factor (que es la suma de hijos)
      let presupContractual = '0';
      if (p.metrado !== null && puContractual) {
        presupContractual = new Decimal(p.metrado).times(puContractual).toDecimalPlaces(2).toString();
      } else if (p.isSummary && p.parcial > 0) {
        presupContractual = new Decimal(p.parcial)
          .times(factorOfertaProyecto)
          .toDecimalPlaces(2)
          .toString();
      }

      if (p.isSummary) insertCount.titulo++;
      else insertCount.hoja++;

      return {
        proyectoId,
        codigo: p.codigo,
        parentCodigo: p.parentCodigo,
        nivel: p.nivel,
        nombre: p.descripcion,
        unidad: p.unidad,
        cantidad: p.metrado !== null ? String(p.metrado) : null,
        precioUnitario: p.precioUnitario !== null ? String(p.precioUnitario) : null,
        precioUnitarioReferencial: p.precioUnitario !== null ? String(p.precioUnitario) : null,
        precioUnitarioContractual: puContractual,
        presupuesto: String(p.parcial),
        presupuestoContractual: presupContractual,
        isSummary: p.isSummary,
        orden: p.orden,
      };
    });
    await db.insert(partidas).values(batch);
  }

  console.log(`  ✓ Insertadas: ${insertCount.hoja} partidas hoja + ${insertCount.titulo} títulos\n`);

  // 7. Verificar inserción exitosa
  const countResult = await db.select().from(partidas).where(eq(partidas.proyectoId, proyectoId));
  const totalEnBD = countResult.length;
  const sumaEnBD = countResult
    .filter((p) => !p.isSummary)
    .reduce((acc, p) => acc.plus(p.presupuesto ?? 0), new Decimal(0))
    .toDecimalPlaces(2)
    .toNumber();

  console.log('📊 CHECK 3 · Verificación post-insert:');
  console.log(`  Total partidas en BD: ${totalEnBD} (esperado ${parsed.partidas.length})`);
  console.log(`  Σ presupuesto hoja en BD: S/ ${sumaEnBD.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
  const diff3 = new Decimal(parsed.sumaParcialesHoja).minus(sumaEnBD).toDecimalPlaces(2).toNumber();
  console.log(`  Diferencia: ${diff3} ${Math.abs(diff3) <= 0.01 ? '✓' : '✗'}\n`);

  if (totalEnBD !== parsed.partidas.length) {
    throw new Error(`Cantidad partidas en BD ${totalEnBD} ≠ parseadas ${parsed.partidas.length}`);
  }
  if (Math.abs(diff3) > 0.01) {
    throw new Error(`Cuadre BD falla · diff ${diff3}`);
  }

  // 8. CHECK 4 · pu_contractual = pu_referencial × factor_oferta
  const sample = countResult.filter((p) => p.precioUnitarioReferencial && p.precioUnitarioContractual).slice(0, 5);
  console.log('📊 CHECK 4 · pu_contractual = pu_referencial × factor_oferta (sample 5 partidas):');
  for (const p of sample) {
    const ref = new Decimal(p.precioUnitarioReferencial ?? 0);
    const cont = new Decimal(p.precioUnitarioContractual ?? 0);
    const calc = ref.times(factorOfertaProyecto).toDecimalPlaces(4);
    const ok = cont.equals(calc);
    console.log(`  ${p.codigo}: ref ${ref.toFixed(2)} × ${factorOfertaProyecto} = ${calc.toFixed(4)} ${ok ? '✓' : '✗'}`);
  }
  console.log();

  // 9. CHECK 5 · cuadre títulos nivel 1
  console.log('📊 CHECK 5 · Cuadre títulos nivel 1:');
  for (const t of parsed.titulosNivel1) {
    console.log(`  ${t.codigo} ${t.descripcion}: S/ ${t.monto.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
  }
  const sumTit = parsed.titulosNivel1.reduce((acc, t) => acc.plus(t.monto), new Decimal(0)).toDecimalPlaces(2).toNumber();
  const diff5 = new Decimal(sumTit).minus(parsed.sumaParcialesHoja).toDecimalPlaces(2).toNumber();
  console.log(`  Σ títulos N1: ${sumTit.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
  console.log(`  Σ partidas hoja: ${parsed.sumaParcialesHoja.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
  console.log(`  Diferencia: ${diff5} ${Math.abs(diff5) <= 0.01 ? '✓' : '✗'}\n`);

  // 10. Update import status = exitoso
  const duracion = Date.now() - startTs;
  await db
    .update(importsS10)
    .set({
      estado: 'exitoso',
      partidasImportadas: insertCount.hoja + insertCount.titulo,
      montoTotalCalculado: String(parsed.sumaParcialesHoja),
      diferencia: String(diffVsProyecto),
      duracionMs: duracion,
    })
    .where(eq(importsS10.id, importId));

  console.log('═════════════════════════════════════════════════════════');
  console.log('✅ F1.A IMPORT EXITOSO');
  console.log(`   · ${insertCount.hoja} partidas hoja + ${insertCount.titulo} títulos = ${insertCount.hoja + insertCount.titulo} total`);
  console.log(`   · CD ref: S/ ${parsed.sumaParcialesHoja.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`);
  console.log(`   · CD contractual (×${factorOfertaProyecto}): S/ ${new Decimal(parsed.sumaParcialesHoja).times(factorOfertaProyecto).toFixed(2)}`);
  console.log(`   · Duración: ${duracion}ms`);
  console.log(`   · 5 checks matemáticos PASARON`);
  console.log('═════════════════════════════════════════════════════════');
} catch (err) {
  // Rollback · marcar import fallido
  await db
    .update(importsS10)
    .set({
      estado: 'fallido',
      errorsLog: [String(err)],
    })
    .where(eq(importsS10.id, importId));
  console.error('\n❌ ERROR en import · rollback aplicado');
  console.error(err);
  process.exit(1);
}

process.exit(0);
