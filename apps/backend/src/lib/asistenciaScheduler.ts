// Cron interno · sincroniza asistencia del lector Zlink a las 09:30 y 10:00 (hora Perú).
// Proceso único, sin dependencias. Idempotente: si el minuto exacto se pierde, corre en el
// siguiente tick del día; si el server reinicia a media mañana, hace catch-up (el sync dedupe).
import { syncAsistencia, ZlinkError } from './zlinkAsistencia.js';

const HORARIOS = ['09:30', '10:00']; // hora Perú (UTC-5, sin DST)
const ultimaCorrida: Record<string, string> = {}; // horario -> 'YYYY-MM-DD' ya ejecutado

function limaHM(): { fecha: string; hm: string } {
  const lima = new Date(Date.now() - 5 * 3600_000); // UTC-5
  return { fecha: lima.toISOString().slice(0, 10), hm: lima.toISOString().slice(11, 16) };
}

async function tick() {
  const { fecha, hm } = limaHM();
  for (const h of HORARIOS) {
    if (hm >= h && ultimaCorrida[h] !== fecha) {
      ultimaCorrida[h] = fecha; // marca antes de correr para no solapar
      try {
        const r = await syncAsistencia();
        console.log(`[asistencia] cron ${fecha} ${h} · ${r.nuevas} nuevas de ${r.traidas}`);
      } catch (e) {
        const msg = e instanceof ZlinkError ? e.message : String(e);
        console.warn(`[asistencia] cron ${fecha} ${h} · sin sincronizar: ${msg}`);
      }
    }
  }
}

// ponytail: tick por minuto en el proceso. Si el backend escala a N instancias,
// mover a un cron externo o un lock en DB para no duplicar el disparo.
export function iniciarSchedulerAsistencia() {
  setInterval(() => { void tick(); }, 60_000);
}
