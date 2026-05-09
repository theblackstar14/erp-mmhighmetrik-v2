/**
 * F2.B · Importar IUs INEI mensuales · Lima
 *
 * Default: lee fixtures/ius-inei-placeholder.csv
 * Override: pasar ruta como arg
 *
 * Idempotente: ON CONFLICT (iu_codigo, area, anio_mes) DO UPDATE
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = await import('./client.js');
const { indicesMensuales, indicesUnificados } = await import('./schema.js');
const { sql } = await import('drizzle-orm');
const { parseIusIneiCsv } = await import('./importers/ius-inei.js');

const FIXTURE_DEFAULT = path.resolve(__dirname, '../fixtures/ius-inei-placeholder.csv');
const csvPath = process.argv[2] ?? FIXTURE_DEFAULT;

console.log('🚀 F2.B · Import IUs INEI mensuales\n');
console.log(`📂 ${csvPath}\n`);

const parsed = parseIusIneiCsv(csvPath);

if (parsed.errors.length) {
  console.error('❌ Errores parseo:');
  for (const e of parsed.errors) console.error(`  · ${e}`);
  process.exit(1);
}

if (parsed.warnings.length) {
  for (const w of parsed.warnings) console.warn(`⚠ ${w}`);
}

console.log(`📊 ${parsed.rows.length} filas IUs mensuales detectadas\n`);

// Validar IUs existen en catálogo
const codigosCatalogo = await db.select({ codigo: indicesUnificados.codigo }).from(indicesUnificados);
const setCatalogo = new Set(codigosCatalogo.map((r) => r.codigo));

const iusUnicos = [...new Set(parsed.rows.map((r) => r.iuCodigo))];
const iusFaltantes = iusUnicos.filter((iu) => !setCatalogo.has(iu));
if (iusFaltantes.length) {
  console.error(`❌ IUs no existen en catálogo: ${iusFaltantes.join(', ')}`);
  process.exit(1);
}

// Insertar/actualizar
let insertados = 0;
let actualizados = 0;
for (const r of parsed.rows) {
  const result = await db.execute(sql`
    INSERT INTO indices_mensuales (iu_codigo, area, anio_mes, valor, resolucion_jefatural, fecha_publicacion, cargado_por)
    VALUES (${r.iuCodigo}, ${r.area}, ${r.anioMes}, ${r.valor}, ${r.resolucionJefatural ?? null}, ${r.fechaPublicacion ?? null}, 'csv_placeholder')
    ON CONFLICT (iu_codigo, area, anio_mes) DO UPDATE SET
      valor = EXCLUDED.valor,
      resolucion_jefatural = EXCLUDED.resolucion_jefatural,
      fecha_publicacion = EXCLUDED.fecha_publicacion,
      cargado_at = NOW(),
      cargado_por = 'csv_placeholder'
    RETURNING (xmax = 0) AS insertado
  `);
  // @ts-expect-error postgres-js result shape
  const fue = result[0]?.insertado;
  if (fue) insertados++;
  else actualizados++;
}

console.log('═════════════════════════════════════════════════════════');
console.log(`📊 RESUMEN F2.B`);
console.log(`   · ${insertados} insertados nuevos`);
console.log(`   · ${actualizados} actualizados`);
console.log(`   · ${iusUnicos.length} IUs distintos`);
const meses = [...new Set(parsed.rows.map((r) => r.anioMes))].sort();
console.log(`   · ${meses.length} meses (${meses[0]} → ${meses[meses.length - 1]})`);
console.log('═════════════════════════════════════════════════════════');

console.log('\n✅ F2.B exitoso · IUs mensuales cargados');
console.log('⚠ DATOS PLACEHOLDER · reemplazar con publicaciones INEI reales\n');

process.exit(0);
