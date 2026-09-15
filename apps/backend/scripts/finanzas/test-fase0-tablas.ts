/**
 * Fase 0 · las 3 tablas existen con sus columnas.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-fase0-tablas.ts
 */
import assert from 'node:assert/strict';

// Load env first to set DATABASE_URL before @erp/db is imported
await import('../../src/env.js');

const { db, schema } = await import('@erp/db');
const { sql } = await import('drizzle-orm');

const esperado: Record<string, string[]> = {
  catalogo_sunat: ['catalogo', 'codigo', 'descripcion', 'extra'],
  detraccion_tasa: ['codigo', 'descripcion', 'anexo', 'porcentaje', 'monto_minimo', 'vigencia_desde', 'vigencia_hasta', 'observacion'],
  tipo_cambio: ['fecha', 'moneda', 'compra', 'venta', 'fuente', 'updated_at'],
};

for (const [tabla, cols] of Object.entries(esperado)) {
  const rows = (await db.execute(sql`select column_name from information_schema.columns where table_name = ${tabla}`)) as unknown as { column_name: string }[];
  const reales = rows.map((r) => r.column_name);
  for (const c of cols) assert.ok(reales.includes(c), `${tabla}.${c} existe`);
  console.log(`  ✓ ${tabla}`);
}

// Verificar exports ORM
try {
  await db.select().from(schema.catalogoSunat).limit(1);
  console.log('  ✓ orm catalogoSunat');
} catch (e) {
  throw new Error(`orm catalogoSunat: ${(e as Error).message}`);
}

try {
  await db.select().from(schema.detraccionTasa).limit(1);
  console.log('  ✓ orm detraccionTasa');
} catch (e) {
  throw new Error(`orm detraccionTasa: ${(e as Error).message}`);
}

try {
  await db.select().from(schema.tipoCambio).limit(1);
  console.log('  ✓ orm tipoCambio');
} catch (e) {
  throw new Error(`orm tipoCambio: ${(e as Error).message}`);
}

console.log('fase0-tablas VERDE');
process.exit(0);
