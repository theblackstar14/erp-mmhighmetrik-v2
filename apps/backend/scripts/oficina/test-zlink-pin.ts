// Self-check del PIN del lector: el employee_code que manda Zlink NO siempre es el DNI
// (hay fotochecks de 6 dígitos), así que empleados.zlink_pin lo declara explícito y gana
// sobre num_doc. Esto prueba el índice de match y la adopción de marcaciones huérfanas.
// Corre contra la DB de .env (erp_mmh_test). Limpia lo que inserta.
import { db, schema } from '@erp/db';
import { eq, inArray } from 'drizzle-orm';
import { indexarEmpleados, revincularPin, persistir, type ZlinkTxn } from '../../src/lib/zlinkAsistencia.js';

const assert = (cond: boolean, msg: string) => { if (!cond) { console.error('✗', msg); process.exit(1); } console.log('✓', msg); };

const ZIDS = ['__pin_z1', '__pin_z2'];
const PIN = '__pin_707445';

async function main() {
  // ── índice de match (puro, sin DB) ──
  const idx = indexarEmpleados([
    { id: 'A', numDoc: '70320583', zlinkPin: '707445' },
    { id: 'B', numDoc: '46710141', zlinkPin: null },
    { id: 'C', numDoc: '707445', zlinkPin: null }, // homónimo: el PIN de A no se lo roba
  ]);
  assert(idx.get('707445') === 'A', 'el PIN declarado gana sobre un num_doc igual de otro empleado');
  assert(idx.get('70320583') === 'A', 'el num_doc del empleado con PIN sigue matcheando');
  assert(idx.get('46710141') === 'B', 'sin PIN cae a num_doc');

  // ── adopción de marcaciones huérfanas ──
  const [emp] = await db.select({ id: schema.empleados.id }).from(schema.empleados).limit(1);
  if (!emp) { console.error('✗ no hay empleados en la DB'); process.exit(1); }

  const txns: ZlinkTxn[] = ZIDS.map((id, i) => ({
    id, employee_code: PIN, first_name: 'PIN HUERFANO',
    punch_time: `2026-06-1${i + 1} 08:00:00`, terminal_sn: 'JUS-TEST', terminal_alias: 'ASISTENCIA',
  }));
  const r = await persistir(txns, '2026-06-01', '2026-06-30');
  assert(r.nuevas === 2 && r.sinMatch === 2, `las 2 marcaciones entran sin empleado (nuevas ${r.nuevas}, sinMatch ${r.sinMatch})`);

  const adoptadas = await revincularPin(PIN, emp.id);
  assert(adoptadas === 2, `revincularPin adopta las 2 huérfanas (fue ${adoptadas})`);
  const [m] = await db.select().from(schema.asistenciaMarcacion).where(eq(schema.asistenciaMarcacion.zlinkId, '__pin_z1'));
  assert(m?.empleadoId === emp.id, 'la marcación quedó con el empleado');

  // Idempotente: ya no hay huérfanas de ese PIN, no re-asigna nada.
  assert((await revincularPin(PIN, emp.id)) === 0, 'segunda corrida no adopta nada (solo toca empleado_id null)');

  await db.delete(schema.asistenciaMarcacion).where(inArray(schema.asistenciaMarcacion.zlinkId, ZIDS));
  console.log('\n✅ PIN del lector OK (precedencia + adopción + idempotencia)');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
