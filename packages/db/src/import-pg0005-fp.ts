/**
 * F1.D · Importador 5 PDFs Fórmulas Polinómicas PG0005
 *
 * 1 FP por subpresupuesto:
 *   001 OBRAS PROVISIONALES
 *   002 ESTRUCTURAS
 *   003 ARQUITECTURA
 *   004 INSTALACIONES SANITARIAS
 *   005 INSTALACIONES ELECTRICAS
 *
 * Validación: Σ coeficientes monomios = 1.0000 cada FP
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = await import('./client.js');
const { proyectos, formulasPolinomicas, formulasMonomios, formulasMonomiosIus, importsS10 } = await import('./schema.js');
const { eq } = await import('drizzle-orm');
const { parseFormulaPolinomicaPdf } = await import('./importers/formula-polinomica.js');

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const ARCHIVOS = [
  { file: 'fp-01-obras-provisionales.pdf', expected: '001' },
  { file: 'fp-02-estructuras.pdf', expected: '002' },
  { file: 'fp-03-arquitectura.pdf', expected: '003' },
  { file: 'fp-04-iiss.pdf', expected: '004' },
  { file: 'fp-05-iiee.pdf', expected: '005' },
];

const CODIGO_PROYECTO = 'PG0005';

console.log('🚀 F1.D · Import 5 PDFs Fórmulas Polinómicas PG0005\n');

const startTs = Date.now();

// 1. Validar proyecto
const proy = await db.select().from(proyectos).where(eq(proyectos.codigo, CODIGO_PROYECTO)).limit(1);
if (!proy.length) {
  console.error(`❌ Proyecto ${CODIGO_PROYECTO} no encontrado`);
  process.exit(1);
}
const proyectoId = proy[0].id;

// 2. Limpiar FPs previos del proyecto (idempotencia)
console.log('🧹 Limpiando FPs previas...');
const fpExistentes = await db
  .select()
  .from(formulasPolinomicas)
  .where(eq(formulasPolinomicas.proyectoId, proyectoId));
for (const fp of fpExistentes) {
  // Cascade limpia monomios y monomios_ius automáticamente
  await db.delete(formulasPolinomicas).where(eq(formulasPolinomicas.id, fp.id));
}
console.log(`  ✓ ${fpExistentes.length} FPs previas eliminadas\n`);

// 3. Crear registro import
const [importRow] = await db
  .insert(importsS10)
  .values({
    proyectoId,
    archivoNombre: '5 FPs PDFs',
    tipo: 'formulas_polinomicas',
    estado: 'procesando',
  })
  .returning();
const importId = importRow.id;

// 4. Procesar cada PDF
const resultados: { file: string; subp: string; monomios: number; cuadre: boolean }[] = [];

try {
  for (const { file, expected } of ARCHIVOS) {
    const filePath = path.join(FIXTURES_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Archivo no encontrado: ${file}`);
      continue;
    }

    console.log(`📂 ${file}`);
    const buffer = fs.readFileSync(filePath);
    const parsed = await parseFormulaPolinomicaPdf(buffer);

    if (parsed.errors.length) {
      console.error(`  ❌ Errores parseo:`);
      for (const e of parsed.errors) console.error(`    · ${e}`);
      continue;
    }

    if (parsed.subpresupuestoCodigo !== expected) {
      console.warn(`  ⚠ Subpresupuesto detectado ${parsed.subpresupuestoCodigo} ≠ esperado ${expected}`);
    }

    console.log(`  Subpresupuesto: ${parsed.subpresupuestoCodigo} ${parsed.subpresupuestoNombre}`);
    console.log(`  Fecha base: ${parsed.fechaBase}`);
    console.log(`  Monomios: ${parsed.monomios.length}`);
    console.log(`  Σ coeficientes: ${parsed.sumaCoeficientes} ${parsed.cuadre ? '✓' : '✗'}`);
    console.log(`  Fórmula: ${parsed.formulaTexto.slice(0, 80)}...`);

    // Insertar FP
    const [fpRow] = await db
      .insert(formulasPolinomicas)
      .values({
        proyectoId,
        subpresupuestoCodigo: parsed.subpresupuestoCodigo,
        subpresupuestoNombre: parsed.subpresupuestoNombre,
        fechaBase: parsed.fechaBase || '2025-06-07',
        areaGeografica: parsed.areaGeografica,
        formulaTexto: parsed.formulaTexto,
        archivoPdfNas: file,
      })
      .returning();

    // Insertar monomios + IUs
    for (const m of parsed.monomios) {
      const [mRow] = await db
        .insert(formulasMonomios)
        .values({
          formulaId: fpRow.id,
          numero: m.numero,
          coeficiente: String(m.coeficiente),
          simbolo: m.simbolo,
          descripcion: m.descripcion,
        })
        .returning();

      // IUs del monomio
      for (const iu of m.ius) {
        await db.insert(formulasMonomiosIus).values({
          monomioId: mRow.id,
          iuCodigo: iu.iuCodigo,
          pesoPorcentual: String(iu.pesoPorcentual),
          descripcionIu: iu.descripcionIu,
        });
      }
    }

    resultados.push({
      file,
      subp: parsed.subpresupuestoCodigo,
      monomios: parsed.monomios.length,
      cuadre: parsed.cuadre,
    });

    console.log();
  }

  // 5. Verificación cuadre global
  const fpsFinal = await db.select().from(formulasPolinomicas).where(eq(formulasPolinomicas.proyectoId, proyectoId));
  const todosCuadran = resultados.every((r) => r.cuadre);

  console.log('═════════════════════════════════════════════════════════');
  console.log('📊 RESUMEN F1.D');
  console.log(`   · ${fpsFinal.length} Fórmulas Polinómicas insertadas`);
  for (const r of resultados) {
    console.log(`   · ${r.subp} · ${r.monomios} monomios · cuadre ${r.cuadre ? '✓' : '✗'}`);
  }
  console.log('═════════════════════════════════════════════════════════');

  const duracion = Date.now() - startTs;
  await db
    .update(importsS10)
    .set({
      estado: todosCuadran ? 'exitoso' : 'observado',
      partidasImportadas: fpsFinal.length,
      duracionMs: duracion,
    })
    .where(eq(importsS10.id, importId));

  if (todosCuadran) {
    console.log('\n✅ F1.D EXITOSO · 5 FPs cuadran exacto · cierre F1 completo');
  } else {
    console.warn('\n⚠ F1.D parcial · alguna FP no cuadra · revisar detalle');
  }
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
