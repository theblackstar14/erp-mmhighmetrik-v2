/**
 * Reemplaza 5 FPs PG0005 (1 por subp) por 1 FP global con monomios
 * reales del Excel valorización:
 *   K = 0.173*(Jr/Jo) + 0.201*(Ar/Ao) + 0.132*(Cr/Co) + 0.369*(DMr/DMo) + 0.125*(GGUr/GGUo)
 *
 * Monomios:
 *   1 J  · MO inc leyes sociales · IU 47 · 17.3%
 *   2 AG · Artefacto iluminación exterior · IU 11 · 20.1%
 *   3 C  · Cables NYY · IU 19 · 13.2%
 *   4 DM · Dólar+inflación USA + Maquinaria importada (compuesto) · IU 30 (87.263%) + IU 49 (12.737%) · 36.9%
 *   5 GGU · Índice general precios consumidor · IU 39 · 12.5%
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = await import('./client.js');
const {
  proyectos,
  formulasPolinomicas,
  formulasMonomios,
  formulasMonomiosIus,
  indicesUnificados,
} = await import('./schema.js');
const { eq, sql } = await import('drizzle-orm');

const proy = await db.select().from(proyectos).where(eq(proyectos.codigo, 'PG0005')).limit(1);
if (!proy.length) {
  console.error('PG0005 no encontrado');
  process.exit(1);
}
const proyectoId = proy[0]!.id;

// 1. Agregar IUs faltantes al catálogo
const IUS_REQUERIDOS = [
  { codigo: '11', descripcion: 'ARTEFACTO DE ILUMINACION EXTERIOR', categoria: 'Materiales · Eléctricos' },
  { codigo: '19', descripcion: 'CABLES TIPO NKY-NYY', categoria: 'Materiales · Eléctricos' },
  { codigo: '49', descripcion: 'MAQUINARIA Y EQUIPO IMPORTADO', categoria: 'Equipos' },
];
for (const iu of IUS_REQUERIDOS) {
  await db.execute(sql`
    INSERT INTO indices_unificados (codigo, descripcion, categoria)
    VALUES (${iu.codigo}, ${iu.descripcion}, ${iu.categoria})
    ON CONFLICT (codigo) DO UPDATE SET
      descripcion = EXCLUDED.descripcion,
      categoria = EXCLUDED.categoria
  `);
}
console.log(`✓ ${IUS_REQUERIDOS.length} IUs catálogo sincronizados`);

// 2. Borrar FPs previas (cascade limpia monomios + IUs)
const fpsPrev = await db.select().from(formulasPolinomicas).where(eq(formulasPolinomicas.proyectoId, proyectoId));
for (const fp of fpsPrev) {
  await db.delete(formulasPolinomicas).where(eq(formulasPolinomicas.id, fp.id));
}
console.log(`✓ ${fpsPrev.length} FPs previas eliminadas`);

// 3. Insertar 1 FP global
const [fpRow] = await db
  .insert(formulasPolinomicas)
  .values({
    proyectoId,
    subpresupuestoCodigo: 'GLOBAL',
    subpresupuestoNombre: 'OBRA GLOBAL',
    fechaBase: '2025-06-07', // contractual jun-2025
    areaGeografica: 'LIMA-SURCO',
    formulaTexto: 'K = 0.173*(Jr/Jo) + 0.201*(Ar/Ao) + 0.132*(Cr/Co) + 0.369*(DMr/DMo) + 0.125*(GGUr/GGUo)',
    archivoPdfNas: 'valorizaciones (no PDF FP)',
  })
  .returning();
console.log(`✓ FP global insertada · id=${fpRow!.id}`);

// 4. Monomios + IUs
const MONOMIOS = [
  { numero: 1, simbolo: 'J', descripcion: 'MANO DE OBRA INC LEYES SOCIALES', coef: 0.173, ius: [{ codigo: '47', peso: 100 }] },
  { numero: 2, simbolo: 'AG', descripcion: 'ARTEFACTO ILUMINACION EXTERIOR', coef: 0.201, ius: [{ codigo: '11', peso: 100 }] },
  { numero: 3, simbolo: 'C', descripcion: 'CABLES TIPO NKY-NYY', coef: 0.132, ius: [{ codigo: '19', peso: 100 }] },
  {
    numero: 4,
    simbolo: 'DM',
    descripcion: 'DOLAR + INFLACION USA / MAQUINARIA IMPORTADA',
    coef: 0.369,
    ius: [
      { codigo: '30', peso: 87.263, descripcion: 'DOLAR + INFLACION USA' },
      { codigo: '49', peso: 12.737, descripcion: 'MAQUINARIA Y EQUIPO IMPORTADO' },
    ],
  },
  { numero: 5, simbolo: 'GGU', descripcion: 'INDICE GENERAL DE PRECIOS AL CONSUMIDOR', coef: 0.125, ius: [{ codigo: '39', peso: 100 }] },
];

let totalIus = 0;
for (const m of MONOMIOS) {
  const [mRow] = await db
    .insert(formulasMonomios)
    .values({
      formulaId: fpRow!.id,
      numero: m.numero,
      coeficiente: String(m.coef),
      simbolo: m.simbolo,
      descripcion: m.descripcion,
    })
    .returning();
  for (const iu of m.ius) {
    await db.insert(formulasMonomiosIus).values({
      monomioId: mRow!.id,
      iuCodigo: iu.codigo,
      pesoPorcentual: String(iu.peso),
      descripcionIu: (iu as { descripcion?: string }).descripcion ?? m.descripcion,
    });
    totalIus++;
  }
}
console.log(`✓ 5 monomios + ${totalIus} IUs vinculados`);

// 5. Validar Σ coef = 1
const sumaCoef = MONOMIOS.reduce((s, m) => s + m.coef, 0);
console.log(`\nΣ coeficientes = ${sumaCoef.toFixed(3)} ${Math.abs(sumaCoef - 1) <= 0.001 ? '✓' : '✗'}`);

console.log('\n✅ FP global PG0005 reemplazada');
process.exit(0);
