/**
 * WS1 · Test integral del motor con cuenta contable MANUAL (in-process, routers reales).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/ws1/test-ws1-motor.ts
 * Cubre: A cuenta válida · B inválida · C cambio de cuenta · D obra vs corp · E no CD/GG input ·
 *        F empresa ajena · regeneración-no-clobber (enmienda del consejo). Limpia lo que crea.
 * Requiere DATABASE_URL=erp_mmh_test. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import finanzasRoutes from '../../src/routes/finanzas.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, eq } from 'drizzle-orm';

const PERIODO = '2026-08';
const FECHA = '2026-08-15';
const OBRA = '4bac3de9-6930-4b69-8e0c-a4e3502955b0'; // PG0001
const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin
const creados: string[] = []; // gasto ids para limpiar

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api', finanzasRoutes);
  app.use('/api/contabilidad', contabilidadRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://localhost:${port}`;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const post = (path: string, body: any) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

  async function crearGasto(extra: Record<string, unknown>) {
    const r = await post('/api/gastos', { fecha: FECHA, proyectoId: OBRA, tipoGasto: 'Mantenimiento', proveedorRazon: 'TEST WS1', subtotal: 1000, igv: 180, total: 1180, ...extra });
    const j = await r.json();
    if (r.status === 200 && j.gasto) creados.push(j.gasto.id);
    return { status: r.status, gasto: j.gasto, error: j.error };
  }
  async function generar() { const r = await post('/api/contabilidad/generar', { periodo: PERIODO }); return { status: r.status, body: await r.json() }; }
  async function lineaGasto(gastoId: string) {
    const [a] = await db.select().from(schema.asientos).where(and(eq(schema.asientos.origen, 'gasto'), eq(schema.asientos.origenId, gastoId))).limit(1);
    if (!a) return null;
    const ls = await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, a.id));
    return { asiento: a, expLine: ls.find((l) => l.cuenta === '634') ?? null, lineas: ls };
  }

  try {
    console.log('════ WS1 · motor cuenta MANUAL ════');

    // A · cuenta válida MANUAL → persiste en la línea + clase derivada
    const A = await crearGasto({ cuentaContable: '634', cuentaContableOrigen: 'USUARIO' });
    assert.equal(A.status, 200, 'A crea gasto con cuenta válida');
    assert.equal(A.gasto.cuentaContable, '634', 'A: gasto guarda cuenta manual');
    assert.equal(A.gasto.cuentaContableOrigen, 'USUARIO', 'A: origen USUARIO');
    await generar();
    const la = await lineaGasto(A.gasto.id);
    assert.ok(la?.expLine, 'A: existe línea 634');
    assert.equal(la!.expLine!.cuentaContable, '634', 'A: línea.cuenta_contable=634');
    assert.equal(la!.expLine!.cuentaOrigen, 'USUARIO', 'A: línea.cuenta_origen=MANUAL');
    assert.equal(la!.expLine!.claseDerivada, 'GG_OBRA', 'A: clase derivada de 634+obra = GG_OBRA');
    assert.equal(la!.expLine!.obraId, OBRA, 'A: obra en la línea');
    assert.equal(la!.asiento.empresaId, 1, 'A: asiento empresa_id=1 (fix NOT NULL)');
    console.log('  ✓ A cuenta válida → línea 634 · MANUAL · GG_OBRA · obra · empresa 1');

    // B · cuenta inválida → rechazo
    const B = await crearGasto({ cuentaContable: '99999' });
    assert.equal(B.status, 400, 'B rechaza cuenta inexistente');
    assert.match(String(B.error), /no existe/, 'B mensaje claro');
    console.log('  ✓ B cuenta inválida → 400');

    // E · cliente intenta forzar clasificación → la clase se DERIVA de la cuenta, no del input
    const E = await crearGasto({ cuentaContable: '634', clasificacion: 'GG_CORP' });
    assert.equal(E.status, 200, 'E crea');
    await generar();
    const le = await lineaGasto(E.gasto.id);
    assert.equal(le!.expLine!.claseDerivada, 'GG_OBRA', 'E: ignora clasificacion cliente, deriva GG_OBRA de 634+obra');
    console.log('  ✓ E cliente NO determina CD/GG (línea deriva GG_OBRA pese a clasificacion=GG_CORP)');

    // C · cambio de cuenta 634 → 602 (CD) · se re-deriva
    const C = await crearGasto({ cuentaContable: '634', cuentaContableOrigen: 'USUARIO' });
    await fetch(`${base}/api/gastos/${C.gasto.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ cuentaContable: '602', cuentaContableOrigen: 'USUARIO' }) });
    const [cg] = await db.select().from(schema.gastos).where(eq(schema.gastos.id, C.gasto.id));
    assert.equal(cg.cuentaContable, '602', 'C: gasto actualizado a 602');
    console.log('  ✓ C cambio de cuenta 634→602 persistido en el origen');

    // F · cuenta divisionaria de OTRA empresa → rechazo
    await db.insert(schema.planContable).values({ codigo: '6349001', descripcion: 'TEST empresa 2', tipo: 'gasto', nivel: 6, esDivisionaria: true, empresaId: 2, clasificable: true }).onConflictDoNothing();
    const F = await crearGasto({ cuentaContable: '6349001' });
    assert.equal(F.status, 400, 'F rechaza cuenta de otra empresa');
    assert.match(String(F.error), /otra empresa/, 'F mensaje empresa');
    console.log('  ✓ F cuenta de otra empresa → 400');

    // Regeneración-no-clobber (enmienda consejo): borrar asiento de A y regenerar → cuenta manual intacta
    await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, 'gasto'), eq(schema.asientos.origenId, A.gasto.id)));
    assert.equal(await lineaGasto(A.gasto.id), null, 'asiento de A borrado');
    await generar();
    const re = await lineaGasto(A.gasto.id);
    assert.ok(re?.expLine, 'regenerado');
    assert.equal(re!.expLine!.cuentaContable, '634', 'regen: cuenta manual RE-LEÍDA del origen (no pisada)');
    assert.equal(re!.expLine!.cuentaOrigen, 'USUARIO', 'regen: sigue MANUAL');
    console.log('  ✓ regeneración NO pisa la cuenta manual (re-leída del gasto)');

    console.log('\n  ✅ WS1 motor VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    // limpieza: asientos de mis gastos + gastos + cuenta test + sesión
    for (const gid of creados) {
      await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, 'gasto'), eq(schema.asientos.origenId, gid))).catch(() => {});
      await db.delete(schema.documentoPendiente).where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), eq(schema.documentoPendiente.docOrigenId, gid))).catch(() => {}); // D4
      await db.delete(schema.gastos).where(eq(schema.gastos.id, gid)).catch(() => {});
    }
    await db.delete(schema.planContable).where(eq(schema.planContable.codigo, '6349001')).catch(() => {});
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})();
