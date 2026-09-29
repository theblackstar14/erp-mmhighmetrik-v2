import assert from 'node:assert/strict';
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';
import { getYtd, upsertLedgerMes } from '../../src/lib/renta5taYtd.js';

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;

// empleado real de prueba
const [emp] = await db.select({ id: schema.empleados.id }).from(schema.empleados).limit(1);
const empId = emp!.id;

// planilla_oficina_mes: usar existente o crear uno throwaway
let createdMes = false;
let [mes] = await db.select({ id: schema.planillaOficinaMes.id }).from(schema.planillaOficinaMes).limit(1);
if (!mes) {
  const [inserted] = await db.insert(schema.planillaOficinaMes).values({
    empresaId: '00000000-0000-0000-0000-000000000001',
    mes: '2099-01',
    estado: 'borrador',
  }).returning({ id: schema.planillaOficinaMes.id });
  mes = inserted;
  createdMes = true;
}
const mesId = mes!.id;

// 1. Sin baseline ni ledger → 0/0 (no error)
await db.delete(schema.renta5taMes).where(eq(schema.renta5taMes.empleadoId, empId));
await db.delete(schema.renta5taBaseline).where(eq(schema.renta5taBaseline.empleadoId, empId));
let y = await getYtd(empId, 2026, 7);
assert.ok(near(y.acumuladoPercibido, 0) && near(y.retencionesPrevias, 0), 'sin datos → 0/0');

// 2. Con baseline (ene-jun importado)
await db.insert(schema.renta5taBaseline).values({ empleadoId: empId, anio: 2026, acumuladoImportado: '30000', retencionesImportadas: '500' });
y = await getYtd(empId, 2026, 7);
assert.ok(near(y.acumuladoPercibido, 30000) && near(y.retencionesPrevias, 500), 'baseline');

// 3. Upsert mes 6 → suma al YTD de julio; recerrar (2x) NO duplica
await upsertLedgerMes({ empleadoId: empId, planillaMesId: mesId, anio: 2026, mesNumero: 6, remunComputable: 5000, retencion: 100 });
await upsertLedgerMes({ empleadoId: empId, planillaMesId: mesId, anio: 2026, mesNumero: 6, remunComputable: 5000, retencion: 100 });
y = await getYtd(empId, 2026, 7);
assert.ok(near(y.acumuladoPercibido, 35000) && near(y.retencionesPrevias, 600), `idempotente ${y.acumuladoPercibido}/${y.retencionesPrevias}`);

// 4. Corrección del mes 6 (mismo planilla_mes_id) → recalcula, no acumula
await upsertLedgerMes({ empleadoId: empId, planillaMesId: mesId, anio: 2026, mesNumero: 6, remunComputable: 4000, retencion: 80 });
y = await getYtd(empId, 2026, 7);
assert.ok(near(y.acumuladoPercibido, 34000) && near(y.retencionesPrevias, 580), `correccion ${y.acumuladoPercibido}`);

// limpieza
await db.delete(schema.renta5taMes).where(eq(schema.renta5taMes.empleadoId, empId));
await db.delete(schema.renta5taBaseline).where(eq(schema.renta5taBaseline.empleadoId, empId));
if (createdMes) {
  await db.delete(schema.planillaOficinaMes).where(eq(schema.planillaOficinaMes.id, mesId));
}
console.log('renta5ta-ytd VERDE'); process.exit(0);
