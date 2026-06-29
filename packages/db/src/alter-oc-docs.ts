import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

const stmts = [
  `DO $$ BEGIN CREATE TYPE oc_estado_pago AS ENUM ('pendiente','pagada'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `ALTER TABLE ordenes_compra ALTER COLUMN proyecto_id DROP NOT NULL;`,
  `ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS cotizacion_nas_path varchar(500);`,
  `ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS comprobante_pago_nas_path varchar(500);`,
  `ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS estado_pago oc_estado_pago NOT NULL DEFAULT 'pendiente';`,
  `ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS pagado_en timestamp;`,
  `ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS pagado_por_email varchar(255);`,
  `ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS gasto_id uuid REFERENCES gastos(id) ON DELETE SET NULL;`,
];
for (const s of stmts) {
  await sql.unsafe(s);
  console.log('✓', s.slice(0, 60));
}
console.log('✅ OC docs/pago listo');
await sql.end();
process.exit(0);
