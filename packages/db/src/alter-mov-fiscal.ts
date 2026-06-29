import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

const stmts = [
  `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS subtipo varchar(60);`,
  `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS subtotal decimal(14,2) DEFAULT 0;`,
  `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS igv decimal(14,2) DEFAULT 0;`,
  `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS detraccion decimal(14,2) DEFAULT 0;`,
  `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS retencion decimal(14,2) DEFAULT 0;`,
  `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS cuenta_destino_id uuid;`,
  `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS transferencia_id uuid;`,
  `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS fecha_vencimiento date;`,
  `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS estado varchar(20);`,
];
for (const s of stmts) {
  await sql.unsafe(s);
  console.log('✓', s.slice(0, 64).replace(/\s+/g, ' '));
}
console.log('✅ movimientos · desglose fiscal + transferencias listo');
await sql.end();
process.exit(0);
