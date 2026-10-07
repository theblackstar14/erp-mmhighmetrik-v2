/**
 * Backfill de marcaciones del lector Zlink desde una fecha dada.
 *
 * El sync normal mira 30 días atrás en frío; si el lector estuvo meses sin sincronizar,
 * eso devuelve 0 y parece una falla. Esto fuerza la ventana. Idempotente: dedupe por zlink_id.
 *
 * Desde apps/backend:
 *   node <tsx> scripts/oficina/backfill-asistencia.ts 2022-01-01
 */
import '../../src/env.js'; // carga el .env de la raíz: zlinkAsistencia lee ZLINK_* de process.env
import { syncAsistencia, getEstadoZlink } from '../../src/lib/zlinkAsistencia.js';

const desde = process.argv[2];
if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
  console.error('uso: backfill-asistencia.ts YYYY-MM-DD');
  process.exit(1);
}

const estado = await getEstadoZlink();
console.log('· estado zlink:', { configurado: estado.configurado, lectores: estado.lectores, baseUrl: estado.baseUrl });
if (!estado.configurado) { console.error('✗ falta ZLINK_USER / ZLINK_PASS en el .env de la raíz'); process.exit(1); }
if (estado.lectores === 0) { console.error('✗ falta ZLINK_DEVICE_IDS en el .env de la raíz'); process.exit(1); }

console.log(`· sincronizando desde ${desde}…`);
const r = await syncAsistencia(new Date(desde + 'T00:00:00'));
console.log(`✅ traidas ${r.traidas} · nuevas ${r.nuevas} · sin empleado ${r.sinMatch} · rango ${r.desde} → ${r.hasta}`);
process.exit(0);
