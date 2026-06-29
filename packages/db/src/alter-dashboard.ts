import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

const stmts = [
  `ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS responsable_user_id uuid REFERENCES users(id) ON DELETE SET NULL;`,
  `CREATE TABLE IF NOT EXISTS notificaciones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clave varchar(140) NOT NULL UNIQUE,
    tipo varchar(40) NOT NULL,
    severidad varchar(10) NOT NULL DEFAULT 'media',
    titulo varchar(200) NOT NULL,
    detalle text,
    proyecto_id uuid REFERENCES proyectos(id) ON DELETE CASCADE,
    proyecto_codigo varchar(50),
    accion_url varchar(300),
    leido_en timestamp,
    created_at timestamp NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS notif_leido_idx ON notificaciones (leido_en);`,
];
for (const s of stmts) {
  await sql.unsafe(s);
  console.log('✓', s.slice(0, 60).replace(/\s+/g, ' '));
}
console.log('✅ dashboard schema listo (responsable_user_id + notificaciones)');
await sql.end();
process.exit(0);
