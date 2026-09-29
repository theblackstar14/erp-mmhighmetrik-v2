import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

const stmts = [
  `ALTER TABLE empleados ADD COLUMN IF NOT EXISTS afp_comision_tipo varchar(8) NOT NULL DEFAULT 'saldo';`,
  `ALTER TABLE empleados ADD COLUMN IF NOT EXISTS modalidad_formativa boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE afp_tasas ADD COLUMN IF NOT EXISTS pct_comision_flujo decimal(6,4) NOT NULL DEFAULT 0;`,
  `ALTER TABLE afp_tasas ADD COLUMN IF NOT EXISTS pct_comision_mixta decimal(6,4) NOT NULL DEFAULT 0;`,
  `ALTER TABLE planilla_oficina_mes ADD COLUMN IF NOT EXISTS calculo_snapshot jsonb;`,
  `CREATE TABLE IF NOT EXISTS param_legal_oficina (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     fecha_vigencia date NOT NULL UNIQUE,
     rmv decimal(14,2) NOT NULL, uit decimal(14,2) NOT NULL, tope_rma decimal(14,2) NOT NULL,
     pct_essalud decimal(6,4) NOT NULL, pct_onp decimal(6,4) NOT NULL,
     pct_afp_aporte decimal(6,4) NOT NULL, pct_asig_familiar decimal(6,4) NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS renta5ta_baseline (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     empleado_id uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
     anio int NOT NULL,
     acumulado_importado decimal(14,2) NOT NULL DEFAULT 0,
     retenciones_importadas decimal(14,2) NOT NULL DEFAULT 0,
     importado_por uuid, importado_en timestamp DEFAULT now(),
     UNIQUE(empleado_id, anio)
   );`,
  `CREATE TABLE IF NOT EXISTS renta5ta_mes (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     empleado_id uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
     planilla_mes_id uuid NOT NULL REFERENCES planilla_oficina_mes(id) ON DELETE CASCADE,
     anio int NOT NULL, mes_numero int NOT NULL,
     remun_computable decimal(14,2) NOT NULL DEFAULT 0,
     retencion decimal(14,2) NOT NULL DEFAULT 0,
     UNIQUE(empleado_id, planilla_mes_id)
   );`,
  `CREATE INDEX IF NOT EXISTS r5m_emp_anio_idx ON renta5ta_mes (empleado_id, anio, mes_numero);`,
  // seed param_legal (idempotente por UNIQUE fecha_vigencia)
  `INSERT INTO param_legal_oficina (fecha_vigencia, rmv, uit, tope_rma, pct_essalud, pct_onp, pct_afp_aporte, pct_asig_familiar)
     VALUES ('2025-01-01', 1130, 5350, 12599.27, 0.09, 0.13, 0.10, 0.10)
     ON CONFLICT (fecha_vigencia) DO NOTHING;`,
  `INSERT INTO param_legal_oficina (fecha_vigencia, rmv, uit, tope_rma, pct_essalud, pct_onp, pct_afp_aporte, pct_asig_familiar)
     VALUES ('2026-10-01', 1300, 5350, 12599.27, 0.09, 0.13, 0.10, 0.10)
     ON CONFLICT (fecha_vigencia) DO NOTHING;`,
  // seed comisión flujo por AFP (mixta a completar por Kelly después)
  `UPDATE afp_tasas SET pct_comision_flujo = 0.0147 WHERE afp ILIKE '%habitat%';`,
  `UPDATE afp_tasas SET pct_comision_flujo = 0.0155 WHERE afp ILIKE '%integra%';`,
  `UPDATE afp_tasas SET pct_comision_flujo = 0.0160 WHERE afp ILIKE '%prima%';`,
  `UPDATE afp_tasas SET pct_comision_flujo = 0.0169 WHERE afp ILIKE '%profuturo%';`,
  `UPDATE afp_tasas SET pct_seguro = 0.0137 WHERE pct_seguro IS NULL OR pct_seguro = 0;`,
];
for (const s of stmts) { await sql.unsafe(s); console.log('✓', s.slice(0, 60).replace(/\s+/g, ' ')); }
console.log('✅ planilla oficina v2 listo');
await sql.end();
process.exit(0);
