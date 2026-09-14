/**
 * WS1 v2 · smoke del motor en valo + planilla (regenera 2025-10 con el código nuevo).
 * Verifica Σ=Σ, línea de costo 62x (planilla) y línea de ingreso 70x (valo), + grouping por cuenta.
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/ws1/test-ws1-valo-planilla.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, eq, inArray } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const PER = '2025-10';

async function asientosDe(origen: string) {
  return db.select().from(schema.asientos).where(and(eq(schema.asientos.periodo, PER), eq(schema.asientos.origen, origen), eq(schema.asientos.status, 'registrado')));
}
async function lineasDe(asientoId: string) {
  return db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, asientoId));
}
const s2 = (a: any[]) => ({ debe: a.reduce((s, l) => s + Number(l.debe), 0), haber: a.reduce((s, l) => s + Number(l.haber), 0) });

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json()); app.use(authMiddleware); app.use('/api/contabilidad', contabilidadRoutes);
  const server = app.listen(0);
  const base = `http://localhost:${(server.address() as any).port}`;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  // guardar cuenta_contable original de los detalles para restaurar
  let semanaId = ''; const originales: { id: string; cta: string | null }[] = [];
  try {
    console.log('════ WS1 v2 · motor valo + planilla ════');

    // planilla: partir el costo en 2 cuentas (621 default + 631) para probar el grouping
    const [pAs] = await asientosDe('planilla');
    assert.ok(pAs, 'existe asiento planilla 2025-10');
    semanaId = pAs.origenId!; // origenId del asiento planilla = semanaId
    const detalles = await db.select().from(schema.planillaDetalle).where(eq(schema.planillaDetalle.semanaId, semanaId));
    assert.ok(detalles.length >= 1, 'semana tiene detalles');
    for (const d of detalles) originales.push({ id: d.id, cta: d.cuentaContable });
    // mitad a 631 (clasificable, existe), resto default (621)
    const mitad = Math.ceil(detalles.length / 2);
    for (let i = 0; i < detalles.length; i++) {
      const cta = i < mitad ? '621' : '631';
      await db.update(schema.planillaDetalle).set({ cuentaContable: cta, cuentaContableOrigen: 'USUARIO' }).where(eq(schema.planillaDetalle.id, detalles[i]!.id));
    }
    const multi = detalles.length >= 2; // solo si hay ≥2 obreros habrá 2 cuentas

    // borrar asientos planilla+valo de 2025-10 y regenerar
    const viejos = [...await asientosDe('planilla'), ...await asientosDe('valorizacion')];
    if (viejos.length) await db.delete(schema.asientos).where(inArray(schema.asientos.id, viejos.map((a) => a.id)));
    const r = await fetch(base + '/api/contabilidad/generar', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ periodo: PER }) });
    const body = await r.json();
    assert.equal(r.status, 200, 'generar 200');
    assert.equal((body.detalle?.errores ?? []).length, 0, `sin errores · ${JSON.stringify(body.detalle?.errores)}`);

    // planilla regenerada: Σ=Σ + líneas de costo agrupadas por cuenta
    const [pNew] = await asientosDe('planilla');
    assert.ok(pNew, 'planilla regenerada');
    const pl = await lineasDe(pNew.id);
    const { debe, haber } = s2(pl);
    assert.ok(Math.abs(debe - haber) < 0.02, `planilla Σ=Σ (${debe} vs ${haber})`);
    const costoLineas = pl.filter((l) => l.cuentaContable === '621' || l.cuentaContable === '631');
    assert.ok(costoLineas.every((l) => l.cuentaOrigen === 'USUARIO'), 'costo origen USUARIO');
    if (multi) assert.equal(new Set(costoLineas.map((l) => l.cuentaContable)).size, 2, 'costo agrupado en 2 cuentas (621 + 631)');
    console.log(`  ✓ planilla Σ=Σ · ${costoLineas.length} línea(s) costo · cuentas=${[...new Set(costoLineas.map((l) => l.cuentaContable))].join(',')}`);

    // valo regenerada: Σ=Σ + línea de ingreso 7041 (default), clase null
    const [vNew] = await asientosDe('valorizacion');
    if (vNew) {
      const vl = await lineasDe(vNew.id);
      const { debe: vd, haber: vh } = s2(vl);
      assert.ok(Math.abs(vd - vh) < 0.02, `valo Σ=Σ (${vd} vs ${vh})`);
      const ing = vl.find((l) => l.cuenta === '7041');
      assert.ok(ing, 'valo tiene línea de ingreso 7041');
      assert.equal(ing!.claseDerivada, null, '7041 no clasificable → clase null');
      console.log(`  ✓ valo Σ=Σ · ingreso 7041 · clase=${ing!.claseDerivada}`);
    }

    console.log('\n  ✅ WS1 v2 valo+planilla VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    // restaurar cuenta_contable original de los detalles + regenerar para dejar el estado como estaba
    for (const o of originales) await db.update(schema.planillaDetalle).set({ cuentaContable: o.cta, cuentaContableOrigen: o.cta ? 'AUTOMATICO' : null }).where(eq(schema.planillaDetalle.id, o.id)).catch(() => {});
    try {
      const viejos = [...await asientosDe('planilla'), ...await asientosDe('valorizacion')];
      if (viejos.length) await db.delete(schema.asientos).where(inArray(schema.asientos.id, viejos.map((a) => a.id)));
      await fetch(base + '/api/contabilidad/generar', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ periodo: PER }) });
    } catch {}
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})();
