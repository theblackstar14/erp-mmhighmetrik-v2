import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

const stmts = [
  `CREATE TABLE IF NOT EXISTS rendiciones (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     codigo varchar(30),
     solicitante_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
     solicitante_nombre varchar(200),
     proyecto_id uuid REFERENCES proyectos(id) ON DELETE SET NULL,
     modo varchar(12) NOT NULL DEFAULT 'reembolso',
     tipo varchar(20) NOT NULL DEFAULT 'viatico',
     concepto text,
     fecha date NOT NULL,
     monto_anticipo decimal(12,2) NOT NULL DEFAULT 0,
     monto_rendido decimal(12,2) NOT NULL DEFAULT 0,
     estado varchar(12) NOT NULL DEFAULT 'borrador',
     cuenta_id uuid REFERENCES cuentas_bancarias(id) ON DELETE SET NULL,
     aprobado_por_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
     aprobado_en timestamp,
     motivo_rechazo text,
     gasto_id uuid REFERENCES gastos(id) ON DELETE SET NULL,
     created_at timestamp NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS rend_estado_idx ON rendiciones (estado);`,
  `CREATE INDEX IF NOT EXISTS rend_solicitante_idx ON rendiciones (solicitante_user_id);`,
  `CREATE TABLE IF NOT EXISTS rendicion_items (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     rendicion_id uuid NOT NULL REFERENCES rendiciones(id) ON DELETE CASCADE,
     tipo_comprobante varchar(12) NOT NULL DEFAULT 'boleta',
     serie varchar(20),
     numero varchar(40),
     ruc varchar(11),
     razon varchar(255),
     fecha date,
     categoria varchar(20),
     subtotal decimal(12,2) NOT NULL DEFAULT 0,
     igv decimal(12,2) NOT NULL DEFAULT 0,
     total decimal(12,2) NOT NULL DEFAULT 0,
     deducible boolean NOT NULL DEFAULT true,
     archivo varchar(300)
   );`,
  `CREATE INDEX IF NOT EXISTS rend_item_idx ON rendicion_items (rendicion_id);`,
  // Captura centralizada · el gasto pertenece a un empleado (no a un login)
  `ALTER TABLE rendiciones ADD COLUMN IF NOT EXISTS empleado_id uuid REFERENCES empleados(id) ON DELETE SET NULL;`,
  `CREATE INDEX IF NOT EXISTS rend_empleado_idx ON rendiciones (empleado_id);`,
];
for (const s of stmts) {
  await sql.unsafe(s);
  console.log('✓', s.slice(0, 60).replace(/\s+/g, ' '));
}
console.log('✅ rendiciones · oficina listo');
await sql.end();
process.exit(0);
