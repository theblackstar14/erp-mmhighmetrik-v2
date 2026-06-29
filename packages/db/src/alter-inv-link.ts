import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });
for (const s of [
  `ALTER TABLE inventario_items ADD COLUMN IF NOT EXISTS gasto_id uuid REFERENCES gastos(id) ON DELETE SET NULL;`,
  `ALTER TABLE inventario_items ADD COLUMN IF NOT EXISTS activo_id uuid REFERENCES activos(id) ON DELETE SET NULL;`,
  `CREATE INDEX IF NOT EXISTS inv_gasto_idx ON inventario_items (gasto_id);`,
]) { await sql.unsafe(s); console.log('✓', s.slice(0, 55)); }
console.log('✅ inventario_items link listo');
await sql.end(); process.exit(0);
