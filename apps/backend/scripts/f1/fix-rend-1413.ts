/**
 * F1.3 · Asigna cuenta contable 1413 (Entregas a rendir cuenta) a las cajas REND-* desactivadas
 * y regenera 2025-10 para que sus 2 movimientos (S/5,000, Daniel Montero) entren al libro.
 * Luego corre watchdog + smoke + readiness de los períodos con data. Idempotente.
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/fix-rend-1413.ts
 */
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, isNull, like, sql } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin

(async () => {
  // 1 · mapear REND-* sin cuenta contable → 1413 (solo las desactivadas · REND-KELY activa ya tiene 10451)
  const upd = await db.update(schema.cuentasBancarias)
    .set({ cuentaContable: '1413' })
    .where(and(like(schema.cuentasBancarias.codigo, 'REND-%'), isNull(schema.cuentasBancarias.cuentaContable)))
    .returning({ codigo: schema.cuentasBancarias.codigo });
  console.log(`REND-* mapeadas a 1413: ${upd.length}`, upd.map((u) => u.codigo).join(', '));

  // 2 · regenerar 2025-10 + validación de períodos clave
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

  const gen = await call('POST', '/generar', { periodo: '2025-10' });
  console.log('generar 2025-10:', gen.status, JSON.stringify(gen.body.detalle ?? gen.body));

  // 3 · gap check: movimientos sin asiento
  const gap = await db.execute(sql`
    SELECT to_char(m.fecha,'YYYY-MM') p, COUNT(*) n, SUM(m.monto) monto
    FROM movimientos m
    LEFT JOIN asientos a ON a.origen='movimiento' AND a.origen_id::text = m.id::text AND a.status != 'anulado'
    WHERE a.id IS NULL AND NOT m.anulado AND NOT (m.transferencia_id IS NOT NULL AND m.tipo_movimiento != 'Egreso')
    GROUP BY 1 ORDER BY 1`);
  console.log('movimientos SIN asiento tras fix:', (gap as any).rows ?? gap);

  // 4 · validación por período
  for (const p of ['2025-10', '2025-12', '2026-01']) {
    const w = await call('GET', `/watchdog?periodo=${p}`);
    console.log(`watchdog ${p}:`, w.body.estadoGlobal, '· razones:', (w.body.razones ?? []).join(' | ') || 'ninguna');
  }
  const smoke = await call('GET', '/smoke?periodo=2026-01');
  console.log('smoke 2026-01:', JSON.stringify(smoke.body.resumen ?? smoke.body).slice(0, 300));
  const ready = await call('GET', '/cutover-readiness?periodo=2026-01');
  console.log('readiness 2026-01:', ready.body.resultado, '· hard:', JSON.stringify((ready.body.criterios ?? []).filter((c: any) => c.tipo === 'hard').map((c: any) => `${c.id}:${c.ok}`)));

  await lucia.invalidateSession(session.id).catch(() => {});
  server.close();
  process.exit(0);
})();
