/**
 * F2 · Crear inversión-padre CUI 2355883 (OxI · 4 colegios Cajamarca)
 *       + vincular proyectos-colegio EXISTENTES (NO destructivo · solo UPDATE).
 *
 * Idempotente: upsert inversión por CUI · link por código de proyecto.
 * NO borra ni recrea PG00101 (San Martín) ni PG0102 (Pezantes).
 *
 *   pnpm --filter @erp/db exec tsx src/link-inversion-2355883.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = await import('./client.js');
const { inversiones, proyectos } = await import('./schema.js');
const { eq } = await import('drizzle-orm');

const CUI = '2355883';
const NOMBRE =
  'MEJORAMIENTO DE LOS SERVICIOS EDUCATIVOS DE 4 IIEE - CAJAMARCA (CUI 2355883)';

// colegios que YA existen como proyectos · solo vínculo estructural.
// ggUtModo se detecta en F3 (ingesta) · aquí se deja el default 'separado'.
const VINCULOS = [
  { codigo: 'PG0102', codigoIe: '16647' }, // Humberto Pezantes
  { codigo: 'PG00101', codigoIe: '16874' }, // San Martín de Porras
];

console.log('🚀 F2 · Inversión 2355883 + vínculos no destructivos\n');

// 1 · Upsert inversión por CUI
let [inv] = await db.select().from(inversiones).where(eq(inversiones.cui, CUI)).limit(1);
if (inv) {
  console.log(`  ~ Inversión ya existe · id=${inv.id}`);
} else {
  [inv] = await db
    .insert(inversiones)
    .values({ cui: CUI, nombre: NOMBRE, modalidad: 'oxi', pendienteContrato: true })
    .returning();
  console.log(`  ✓ Inversión creada · id=${inv.id} · cui=${CUI}`);
}

// 2 · Vincular proyectos-colegio existentes (UPDATE puro)
for (const v of VINCULOS) {
  const [p] = await db.select().from(proyectos).where(eq(proyectos.codigo, v.codigo)).limit(1);
  if (!p) {
    console.log(`  ⚠ ${v.codigo} NO existe · skip (crear luego con sus docs)`);
    continue;
  }
  const [upd] = await db
    .update(proyectos)
    .set({
      inversionId: inv.id,
      cui: CUI,
      codigoIe: v.codigoIe,
      updatedAt: new Date(),
    })
    .where(eq(proyectos.id, p.id))
    .returning({ codigo: proyectos.codigo, nombre: proyectos.nombre, inversionId: proyectos.inversionId });
  console.log(`  ✓ ${upd.codigo} → inversión ${CUI} · IE ${v.codigoIe} · "${upd.nombre?.slice(0, 40)}"`);
}

// 3 · Estado final
const vinculados = await db.select({ codigo: proyectos.codigo, codigoIe: proyectos.codigoIe }).from(proyectos).where(eq(proyectos.inversionId, inv.id));
console.log(`\n✅ Inversión ${CUI} · ${vinculados.length} colegios vinculados:`, vinculados.map((x) => `${x.codigo}(IE${x.codigoIe})`).join(', '));
console.log('   Faltan 2 colegios (San Juan Bosco IE16462, Miraflores IE16910) → crear con sus docs.');

process.exit(0);
