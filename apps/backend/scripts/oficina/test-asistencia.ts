// Self-check del pipeline de asistencia Zlink: dedupe por zlink_id + match por numDoc.
// Corre contra la DB de .env (erp_mmh_test). Limpia lo que inserta. No toca la nube.
import { db, schema } from '@erp/db';
import { eq, inArray } from 'drizzle-orm';
import { persistir, type ZlinkTxn } from '../../src/lib/zlinkAsistencia.js';

const assert = (cond: boolean, msg: string) => { if (!cond) { console.error('✗', msg); process.exit(1); } console.log('✓', msg); };

const ZIDS = ['__test_z1', '__test_z2', '__test_z3'];

async function main() {
  // Empleado real con numDoc para probar el match
  const [emp] = await db.select({ id: schema.empleados.id, numDoc: schema.empleados.numDoc })
    .from(schema.empleados).where(eq(schema.empleados.tipoPlanilla, 'admin')).limit(1);
  const codeConMatch = emp?.numDoc ?? '__nomatch__';

  const txns: ZlinkTxn[] = [
    { id: '__test_z1', employee_code: codeConMatch, first_name: 'TEST UNO', punch_time: '2026-06-11 08:00:00', terminal_sn: 'JUS-TEST', terminal_alias: 'ASISTENCIA' },
    { id: '__test_z2', employee_code: codeConMatch, first_name: 'TEST UNO', punch_time: '2026-06-11 17:00:00', terminal_sn: 'JUS-TEST', terminal_alias: 'ASISTENCIA' },
    { id: '__test_z3', employee_code: '99999999', first_name: 'DESCONOCIDO', punch_time: '2026-06-11 08:05:00', terminal_sn: 'JUS-TEST', terminal_alias: 'ASISTENCIA' },
  ];

  // 1ra corrida: 3 nuevas, 1 sin match (o 3 si no había empleado con numDoc)
  const r1 = await persistir(txns, '2026-06-01', '2026-06-30');
  assert(r1.nuevas === 3, `primera corrida inserta 3 (fue ${r1.nuevas})`);
  const esperadosSinMatch = emp?.numDoc ? 1 : 3;
  assert(r1.sinMatch === esperadosSinMatch, `sinMatch = ${esperadosSinMatch} (fue ${r1.sinMatch})`);

  // 2da corrida idéntica: idempotente, 0 nuevas
  const r2 = await persistir(txns, '2026-06-01', '2026-06-30');
  assert(r2.nuevas === 0, `segunda corrida dedupe a 0 (fue ${r2.nuevas})`);

  // El match escribió empleado_id cuando había numDoc
  if (emp?.numDoc) {
    const [m] = await db.select().from(schema.asistenciaMarcacion).where(eq(schema.asistenciaMarcacion.zlinkId, '__test_z1'));
    assert(m?.empleadoId === emp.id, 'marcación con code=numDoc quedó vinculada al empleado');
  }

  // limpieza
  await db.delete(schema.asistenciaMarcacion).where(inArray(schema.asistenciaMarcacion.zlinkId, ZIDS));
  console.log('\n✅ pipeline asistencia OK (dedupe + match + idempotencia)');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
