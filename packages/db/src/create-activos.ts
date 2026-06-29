import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS activos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo varchar(20) NOT NULL UNIQUE,
    nombre varchar(255) NOT NULL,
    categoria varchar(40) NOT NULL,
    marca varchar(80),
    serie varchar(120),
    fecha_adquisicion date NOT NULL,
    valor_adquisicion numeric(14,2) NOT NULL,
    pct_depreciacion_anual numeric(5,2) NOT NULL DEFAULT '10.00',
    estado varchar(20) NOT NULL DEFAULT 'operativo',
    proyecto_id uuid REFERENCES proyectos(id) ON DELETE SET NULL,
    ubicacion varchar(160),
    responsable varchar(120),
    notas text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  );
`);
await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS activo_movimientos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    activo_id uuid NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
    fecha date NOT NULL,
    desde varchar(200),
    hacia varchar(200) NOT NULL,
    proyecto_id uuid REFERENCES proyectos(id) ON DELETE SET NULL,
    responsable varchar(120),
    notas text,
    created_at timestamp NOT NULL DEFAULT now()
  );
`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS activos_proyecto_idx ON activos (proyecto_id);`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS activos_categoria_idx ON activos (categoria);`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS actmov_activo_idx ON activo_movimientos (activo_id);`);
console.log('✅ activos + activo_movimientos listas');
await sql.end();
process.exit(0);
