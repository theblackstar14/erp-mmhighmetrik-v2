import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS presupuesto_oficina (
    mes varchar(7) PRIMARY KEY,
    monto numeric(14,2) NOT NULL DEFAULT '0',
    updated_at timestamp NOT NULL DEFAULT now()
  );
`);
console.log('✅ presupuesto_oficina lista');
await sql.end();
process.exit(0);
