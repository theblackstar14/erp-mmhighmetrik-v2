import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

const stmts = [
  // empleados · flags CC + obra + sctr
  `ALTER TABLE empleados ADD COLUMN IF NOT EXISTS bonif_altura boolean DEFAULT false;`,
  `ALTER TABLE empleados ADD COLUMN IF NOT EXISTS bonif_agua boolean DEFAULT false;`,
  `ALTER TABLE empleados ADD COLUMN IF NOT EXISTS proyecto_id uuid REFERENCES proyectos(id) ON DELETE SET NULL;`,
  `ALTER TABLE empleados ADD COLUMN IF NOT EXISTS sctr_vigencia date;`,
  // planilla_detalle · montos nuevos
  `ALTER TABLE planilla_detalle ADD COLUMN IF NOT EXISTS monto_bonif_altura decimal(12,2) DEFAULT 0;`,
  `ALTER TABLE planilla_detalle ADD COLUMN IF NOT EXISTS monto_bonif_agua decimal(12,2) DEFAULT 0;`,
  `ALTER TABLE planilla_detalle ADD COLUMN IF NOT EXISTS monto_sctr_salud decimal(12,2) DEFAULT 0;`,
  `ALTER TABLE planilla_detalle ADD COLUMN IF NOT EXISTS monto_sctr_pension decimal(12,2) DEFAULT 0;`,
  `ALTER TABLE planilla_detalle ADD COLUMN IF NOT EXISTS monto_sencico decimal(12,2) DEFAULT 0;`,
  `ALTER TABLE planilla_detalle ADD COLUMN IF NOT EXISTS monto_costo_total decimal(12,2) DEFAULT 0;`,
  // config_planilla singleton
  `CREATE TABLE IF NOT EXISTS config_planilla (
     id varchar(12) PRIMARY KEY DEFAULT 'singleton',
     uit decimal(10,2) NOT NULL DEFAULT 5350,
     pct_essalud decimal(6,4) NOT NULL DEFAULT 0.09,
     pct_onp decimal(6,4) NOT NULL DEFAULT 0.13,
     pct_sencico decimal(6,4) NOT NULL DEFAULT 0.002,
     pct_conafovicer decimal(6,4) NOT NULL DEFAULT 0.02,
     pct_sctr_salud decimal(6,4) NOT NULL DEFAULT 0.0155,
     pct_sctr_pension decimal(6,4) NOT NULL DEFAULT 0.0174,
     pct_bonif_altura decimal(6,4) NOT NULL DEFAULT 0.07,
     pct_bonif_agua decimal(6,4) NOT NULL DEFAULT 0.20,
     asign_escolar_jornales decimal(6,2) NOT NULL DEFAULT 30
   );`,
  `INSERT INTO config_planilla (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;`,
  // asistencia diaria (tareo)
  `CREATE TABLE IF NOT EXISTS asistencia (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     empleado_id uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
     semana_id uuid REFERENCES planilla_semanas(id) ON DELETE SET NULL,
     proyecto_id uuid REFERENCES proyectos(id) ON DELETE SET NULL,
     fecha date NOT NULL,
     tipo varchar(15) NOT NULL DEFAULT 'normal'
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS asist_emp_fecha_uq ON asistencia (empleado_id, fecha);`,
  `CREATE INDEX IF NOT EXISTS asist_semana_idx ON asistencia (semana_id);`,
];

for (const s of stmts) {
  await sql.unsafe(s);
  console.log('✓', s.slice(0, 64).replace(/\s+/g, ' '));
}

// Seed paramPlanilla (CAPECO 2025-2026) si faltan categorías · BUC operario 32% · oficial/peón 30%
const cats = [
  { categoria: 'Operario', jornal_base: 89.0, pct_buc: 0.32, movilidad: 14.4 },
  { categoria: 'Oficial', jornal_base: 71.0, pct_buc: 0.3, movilidad: 14.4 },
  { categoria: 'Peón', jornal_base: 63.0, pct_buc: 0.3, movilidad: 14.4 },
  { categoria: 'Capataz', jornal_base: 95.0, pct_buc: 0.32, movilidad: 14.4 },
];
for (const c of cats) {
  await sql`INSERT INTO param_planilla (categoria, jornal_base, pct_buc, movilidad)
            VALUES (${c.categoria}, ${c.jornal_base}, ${c.pct_buc}, ${c.movilidad})
            ON CONFLICT (categoria) DO NOTHING`;
}
// Seed afpTasas (prima/comisión referenciales · editables) si faltan
const afps = [
  { afp: 'AFP Habitat', pct_aporte: 0.1, pct_comision: 0.0147, pct_seguro: 0.0174 },
  { afp: 'AFP Integra', pct_aporte: 0.1, pct_comision: 0.0155, pct_seguro: 0.0174 },
  { afp: 'AFP Prima', pct_aporte: 0.1, pct_comision: 0.016, pct_seguro: 0.0174 },
  { afp: 'AFP Profuturo', pct_aporte: 0.1, pct_comision: 0.0169, pct_seguro: 0.0174 },
];
for (const a of afps) {
  await sql`INSERT INTO afp_tasas (afp, pct_aporte, pct_comision, pct_seguro)
            VALUES (${a.afp}, ${a.pct_aporte}, ${a.pct_comision}, ${a.pct_seguro})
            ON CONFLICT (afp) DO NOTHING`;
}

console.log('✅ planilla CC · config + asistencia + seed CAPECO listo');
await sql.end();
process.exit(0);
