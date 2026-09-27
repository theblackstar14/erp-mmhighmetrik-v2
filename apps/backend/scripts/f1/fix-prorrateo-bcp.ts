/**
 * F1.3 · Asigna el BCP principal (194-9927833-0-39 · 10411) como cuenta de origen a los 3
 * egresos-gasto de prorrateo del 2026-08-07 que quedaron con cuentaId NULL (confirmado por
 * el usuario) y regenera 2026-08. Idempotente.
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/fix-prorrateo-bcp.ts
 */
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { eq, inArray, sql } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin
const MOV_IDS = ['dece5551-4481-47ed-83aa-96585183822b', 'b2028cd6-2269-45f9-a107-94619ade48f9', '54e438d7-d61a-4cd6-9a45-8e4f0ffbee7f'];

(async () => {
  const [bcp] = await db.select({ id: schema.cuentasBancarias.id }).from(schema.cuentasBancarias)
    .where(eq(schema.cuentasBancarias.codigo, '194-9927833-0-39'));
  if (!bcp) throw new Error('BCP principal no encontrado');
  const upd = await db.update(schema.movimientos).set({ cuentaId: bcp.id })
    .where(inArray(schema.movimientos.id, MOV_IDS)).returning({ id: schema.movimientos.id, monto: schema.movimientos.monto });
  console.log(`movimientos asignados al BCP: ${upd.length}`, upd.map((u) => u.monto).join(' + '));

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/contabilidad', contabilidadRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://localhost:${port}/api/contabilidad${path}`, {
      method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };

  const gen = await call('POST', '/generar', { periodo: '2026-08' });
  console.log('generar 2026-08:', gen.status, JSON.stringify(gen.body.detalle ?? gen.body));

  const gap = await db.execute(sql`
    SELECT to_char(m.fecha,'YYYY-MM') p, COUNT(*) n, SUM(m.monto) monto
    FROM movimientos m
    LEFT JOIN asientos a ON a.origen='movimiento' AND a.origen_id::text = m.id::text AND a.status != 'anulado'
    WHERE a.id IS NULL AND NOT m.anulado AND NOT (m.transferencia_id IS NOT NULL AND m.tipo_movimiento != 'Egreso')
    GROUP BY 1 ORDER BY 1`);
  const rows = (gap as any).rows ?? gap;
  console.log('movimientos SIN asiento tras fix:', rows.length ? rows : 'NINGUNO · libro completo');

  const w = await call('GET', '/watchdog?periodo=2026-08');
  console.log('watchdog 2026-08:', w.body.estadoGlobal, '· razones:', (w.body.razones ?? []).join(' | ') || 'ninguna');

  await lucia.invalidateSession(session.id).catch(() => {});
  server.close();
  process.exit(0);
})();
