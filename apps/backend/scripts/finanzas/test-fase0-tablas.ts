/**
 * Fase 0 · las 3 tablas existen con sus columnas.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-fase0-tablas.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const sql = postgres(
  process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh',
  { max: 1 },
);

const esperado: Record<string, string[]> = {
  catalogo_sunat: ['catalogo', 'codigo', 'descripcion', 'extra'],
  detraccion_tasa: ['codigo', 'descripcion', 'anexo', 'porcentaje', 'monto_minimo', 'vigencia_desde', 'vigencia_hasta', 'observacion'],
  tipo_cambio: ['fecha', 'moneda', 'compra', 'venta', 'fuente', 'updated_at'],
};

for (const [tabla, cols] of Object.entries(esperado)) {
  const rows = await sql`select column_name from information_schema.columns where table_name = ${tabla}`;
  const reales = rows.map((r: { column_name: string }) => r.column_name);
  for (const c of cols) assert.ok(reales.includes(c), `${tabla}.${c} existe`);
  console.log(`  ✓ ${tabla}`);
}
console.log('fase0-tablas VERDE');
process.exit(0);
