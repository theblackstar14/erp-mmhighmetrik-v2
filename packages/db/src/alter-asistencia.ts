import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

const stmts = [
  `CREATE TABLE IF NOT EXISTS asistencia_marcacion (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     zlink_id varchar(40) NOT NULL,
     employee_code varchar(40) NOT NULL,
     empleado_id uuid REFERENCES empleados(id) ON DELETE SET NULL,
     nombre varchar(200),
     punch_time timestamp NOT NULL,
     device_sn varchar(60),
     terminal_alias varchar(80),
     raw jsonb,
     created_at timestamp NOT NULL DEFAULT now()
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS asist_marc_zlink_uq ON asistencia_marcacion (zlink_id);`,
  `CREATE INDEX IF NOT EXISTS asist_marc_emp_idx ON asistencia_marcacion (empleado_id);`,
  `CREATE INDEX IF NOT EXISTS asist_marc_punch_idx ON asistencia_marcacion (punch_time);`,
  `CREATE TABLE IF NOT EXISTS zlink_config (
     id varchar(12) PRIMARY KEY DEFAULT 'singleton',
     base_url varchar(200) NOT NULL DEFAULT 'https://zlink.minervaiot.com',
     company_id varchar(60),
     access_token text,
     refresh_token text,
     token_expiry timestamp,
     last_sync_at timestamp,
     last_sync_msg varchar(300)
   );`,
  `INSERT INTO zlink_config (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;`,
];
for (const s of stmts) {
  await sql.unsafe(s);
  console.log('✓', s.slice(0, 60).replace(/\s+/g, ' '));
}
console.log('✅ asistencia biométrica · zlink listo');
await sql.end();
process.exit(0);
