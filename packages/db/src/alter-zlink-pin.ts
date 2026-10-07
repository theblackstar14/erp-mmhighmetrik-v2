// El employee_code que manda el lector Zlink NO siempre es el DNI: hay fotochecks de 6
// dígitos (707445 = ACOSTA PAYANO, cuyo num_doc es 70320583). Matchear solo por num_doc
// dejaba esas marcaciones sin empleado para siempre. Con esta columna el PIN se declara
// una vez en la ficha y pisa al num_doc. Null = el PIN es el DNI (caso normal).
//
//   node <tsx> packages/db/src/alter-zlink-pin.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

const stmts = [
  `ALTER TABLE empleados ADD COLUMN IF NOT EXISTS zlink_pin varchar(30);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS empleados_zlink_pin_unique ON empleados (zlink_pin);`,
];
for (const s of stmts) {
  await sql.unsafe(s);
  console.log('✓', s.slice(0, 70).replace(/\s+/g, ' '));
}
const [col] = await sql`
  select data_type, character_maximum_length from information_schema.columns
   where table_name = 'empleados' and column_name = 'zlink_pin'`;
console.log(col ? `✅ empleados.zlink_pin ${col.data_type}(${col.character_maximum_length})` : '✗ la columna no quedó');
await sql.end();
process.exit(col ? 0 : 1);
