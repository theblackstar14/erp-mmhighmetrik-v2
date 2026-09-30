/**
 * F2 planilla oficina · distribución por obra + mapa concepto→cuenta + link movimiento.
 * Aditiva e idempotente. Correr:
 *   cd packages/db && ./node_modules/.bin/tsx src/alter-planilla-oficina-f2.ts
 */
import 'dotenv/config';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

const stmts = [
  // 0· precondición: la cuenta 6271 debe existir (sembrada por el PCGE)
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plan_contable WHERE codigo = '6271') THEN
    RAISE EXCEPTION 'alter-planilla-oficina-f2 requiere la cuenta 6271 en plan_contable (sembrar el PCGE antes de correr esta migracion)';
  END IF;
END $$;`,

  // 1· distribución del costo por obra (empleado_id null = regla global)
  `CREATE TABLE IF NOT EXISTS planilla_oficina_distribucion (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     empresa_id integer NOT NULL REFERENCES empresa(id),
     empleado_id uuid REFERENCES empleados(id) ON DELETE CASCADE,
     obra_id uuid NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
     pct numeric(5,2) NOT NULL,
     actualizado_en timestamp NOT NULL DEFAULT now()
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS pod_dist_scope_uq
     ON planilla_oficina_distribucion (empresa_id, empleado_id, obra_id) NULLS NOT DISTINCT;`,
  `CREATE INDEX IF NOT EXISTS pod_dist_empresa_idx ON planilla_oficina_distribucion (empresa_id);`,

  // 2· mapa concepto→cuenta (espejo de gasto_cuenta_map)
  `CREATE TABLE IF NOT EXISTS planilla_oficina_concepto_cuenta (
     concepto varchar(40) PRIMARY KEY,
     cuenta varchar(10) NOT NULL REFERENCES plan_contable(codigo),
     actualizado_en timestamp NOT NULL DEFAULT now()
   );`,

  // 3· link movimiento de tesorería ↔ planilla (idempotencia + skip en /generar)
  `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS planilla_oficina_mes_id uuid;`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint c
         JOIN pg_class r ON r.oid = c.conrelid
       WHERE c.conname = 'mov_planilla_oficina_mes_fk'
         AND r.relname = 'movimientos'
     ) THEN
       ALTER TABLE movimientos ADD CONSTRAINT mov_planilla_oficina_mes_fk
         FOREIGN KEY (planilla_oficina_mes_id) REFERENCES planilla_oficina_mes(id) ON DELETE SET NULL;
     END IF;
   END $$;`,
  `CREATE INDEX IF NOT EXISTS mov_planilla_oficina_idx ON movimientos (planilla_oficina_mes_id);`,

  // 4· divisionaria propia de oficina para EsSalud empleador (621/6271 de obreros NO se tocan)
  `INSERT INTO plan_contable (codigo, descripcion, tipo, parent_codigo, nivel, clasificable, es_divisionaria, activa)
   VALUES ('62711', 'EsSalud - personal administrativo', 'Gasto', '6271', 4, true, true, true)
   ON CONFLICT (codigo) DO NOTHING;`,

  // 5· clase de obra: el costo de oficina es gasto general, nunca costo directo
  `INSERT INTO mapa_cuenta_clase (cuenta, clase_obra) VALUES ('6211', 'GG_OBRA') ON CONFLICT (cuenta) DO NOTHING;`,
  `INSERT INTO mapa_cuenta_clase (cuenta, clase_obra) VALUES ('62711', 'GG_OBRA') ON CONFLICT (cuenta) DO NOTHING;`,

  // 6· semilla del conjunto cerrado de conceptos (no pisa lo que Kelly ya cambió)
  `INSERT INTO planilla_oficina_concepto_cuenta (concepto, cuenta) VALUES
     ('sueldos', '6211'),
     ('essalud_empleador', '62711'),
     ('essalud_por_pagar', '4031'),
     ('afp_por_pagar', '407'),
     ('onp_por_pagar', '4032'),
     ('renta5ta_por_pagar', '40173'),
     ('otros_por_pagar', '469'),
     ('neto_por_pagar', '411')
   ON CONFLICT (concepto) DO NOTHING;`,
];

for (const s of stmts) {
  await sql.unsafe(s);
  console.log('✓', s.slice(0, 70).replace(/\s+/g, ' '));
}
await sql.end();
console.log('alter-planilla-oficina-f2 VERDE');
