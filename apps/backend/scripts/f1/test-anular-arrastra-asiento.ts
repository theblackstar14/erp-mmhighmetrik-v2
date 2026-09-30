/**
 * Anular un movimiento tiene que matar su asiento: si queda 'registrado', diario, mayor y 104x
 * siguen sumando un movimiento muerto (bug encontrado sembrando los casos de uso).
 *   node <repo>/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs scripts/f1/test-anular-arrastra-asiento.ts
 * Deja el movimiento de prueba anulado (marcador SEEDCHK-*) y su asiento anulado: no suma a nada.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import express from 'express';
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../../src/middleware/auth.js';
import finanzasRoutes from '../../src/routes/finanzas.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';

(async () => {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api', finanzasRoutes);
  app.use('/api/contabilidad', contabilidadRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://localhost:${port}/api${path}`, {
      method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const estadoAsiento = async (movId: string) => {
    const r: any = await db.execute(sql.raw(`select status from asientos where origen_id = '${movId}'`));
    return (r.rows ?? r).map((x: any) => x.status);
  };

  const ctaRes: any = await db.execute(sql.raw(`select id from cuentas_bancarias where codigo = '194-9927833-0-39'`));
  const [cta] = (ctaRes.rows ?? ctaRes) as any[];
  const numOp = `SEEDCHK-${Date.now().toString(36).toUpperCase()}`;

  const mov = await call('POST', '/movimientos', {
    fecha: '2026-09-25', tipoMovimiento: 'Egreso', cuentaId: cta.id, monto: 118, subtotal: 100, igv: 18,
    clienteNombre: 'PRUEBA ANULACION', descripcion: 'check: anular arrastra el asiento',
    numOperacion: numOp, cuentaContable: '6329', cuentaContableOrigen: 'USUARIO',
  });
  assert.equal(mov.status, 200, `alta del movimiento: ${JSON.stringify(mov.body).slice(0, 200)}`);
  const movId = mov.body.movimiento.id as string;

  await call('POST', '/contabilidad/generar', { periodo: '2026-09' });
  assert.deepEqual(await estadoAsiento(movId), ['registrado'], 'el movimiento debía tener asiento registrado antes de anular');

  const anul = await call('POST', `/movimientos/${movId}/anular`, { motivo: 'check automático' });
  assert.equal(anul.status, 200, `anular: ${JSON.stringify(anul.body).slice(0, 200)}`);
  assert.equal(anul.body.asientosAnulados, 1, 'la anulación debía reportar 1 asiento anulado');
  assert.deepEqual(await estadoAsiento(movId), ['anulado'], 'el asiento quedó vivo colgando de un movimiento anulado');

  console.log(`✅ anular movimiento arrastra su asiento (${numOp})`);
  server.close();
  process.exit(0);
})();
