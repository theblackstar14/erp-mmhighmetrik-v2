/**
 * F1.1 · Test del motor: retención de garantía segregada en 12122 (in-process, router real).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-retencion-garantia.ts
 * Cubre: A devengo con retención → 1212 (total−ret) + 12122 (ret) · B cobro fallback neto de retención ·
 *        C valo sin retención → sin línea 12122 (no rompe lo existente). Limpia lo que crea.
 * Requiere DATABASE_URL=erp_mmh_test. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, eq, inArray } from 'drizzle-orm';

// Pre-cutover (config MOVIMIENTOS_104X_CUTOVER=2025-01-01 en erp_mmh_test): el cobro legacy solo
// posee fechas < cutover. Post-cutover el cobro lo asienta el movimiento (monto real cobrado → ya neto).
const PERIODO = '2024-12';
const FECHA = '2024-12-15';
const OBRA = '4bac3de9-6930-4b69-8e0c-a4e3502955b0'; // PG0001
const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin
const valoIds: string[] = [];

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/contabilidad', contabilidadRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const generar = async () => {
    const r = await fetch(`http://localhost:${port}/api/contabilidad/generar`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ periodo: PERIODO }),
    });
    return { status: r.status, body: await r.json() };
  };
  async function crearValo(extra: Record<string, unknown>) {
    const [v] = await db.insert(schema.valorizaciones).values({
      proyectoId: OBRA, numero: 9000 + valoIds.length, fechaDesde: '2024-12-01', fechaHasta: '2024-12-14',
      fechaEmision: FECHA, mesPeriodo: PERIODO, pctAvance: '10',
      montoCd: '10000', montoIgv: '1800', montoTotal: '11800', montoTotalConIgv: '11800',
      status: 'aprobada' as any, ...extra,
    } as any).returning();
    valoIds.push(v!.id);
    return v!;
  }
  const lineasDe = async (origen: string, origenId: string) => {
    const [a] = await db.select().from(schema.asientos).where(and(eq(schema.asientos.origen, origen), eq(schema.asientos.origenId, origenId))).limit(1);
    if (!a) return null;
    return { asiento: a, lineas: await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, a.id)) };
  };

  try {
    console.log('════ F1.1 · retención de garantía → 12122 ════');

    // A · devengo con retención 10% → split 1212/12122
    const A = await crearValo({ montoRetencion: '1180' });
    let g = await generar();
    assert.equal(g.status, 200, `generar ok (${JSON.stringify(g.body.detalle?.errores ?? g.body)})`);
    const la = await lineasDe('valorizacion', A.id);
    assert.ok(la, 'A: asiento de devengo existe');
    const l1212 = la!.lineas.find((l) => l.cuenta === '1212');
    const l12122 = la!.lineas.find((l) => l.cuenta === '12122');
    assert.ok(l1212 && l12122, 'A: existen líneas 1212 y 12122');
    assert.equal(Number(l1212!.debe), 10620, 'A: 1212 = total − retención (11800−1180)');
    assert.equal(Number(l12122!.debe), 1180, 'A: 12122 = retención');
    const debeA = la!.lineas.reduce((s, l) => s + Number(l.debe), 0);
    const haberA = la!.lineas.reduce((s, l) => s + Number(l.haber), 0);
    assert.ok(Math.abs(debeA - haberA) < 0.01, 'A: asiento cuadra');
    console.log('  ✓ A devengo: 1212=10,620 + 12122=1,180 · cuadrado');

    // B · cobro sin totalContratista → acredita 1212 neto de retención (no sobre-cancela)
    await db.update(schema.valorizaciones).set({ status: 'cobrada' as any }).where(eq(schema.valorizaciones.id, A.id));
    g = await generar();
    assert.equal(g.status, 200, 'B generar ok');
    const lb = await lineasDe('cobro_valo', A.id);
    assert.ok(lb, 'B: asiento de cobro existe');
    const cobro1212 = lb!.lineas.find((l) => l.cuenta === '1212');
    assert.ok(cobro1212, 'B: cobro acredita 1212');
    assert.equal(Number(cobro1212!.haber), 10620, 'B: cobro = 11800 − 1180 (neto de retención)');
    const saldo12122 = 1180; // queda vivo hasta liberación manual (cuenta 12122 en el movimiento)
    console.log(`  ✓ B cobro fallback neto: 1212 se cancela exacta · garantía viva en 12122 = ${saldo12122}`);

    // C · valo sin retención → no aparece línea 12122 (regresión)
    const C = await crearValo({});
    g = await generar();
    assert.equal(g.status, 200, 'C generar ok');
    const lc = await lineasDe('valorizacion', C.id);
    assert.ok(lc, 'C: asiento existe');
    assert.ok(!lc!.lineas.some((l) => l.cuenta === '12122'), 'C: sin retención no hay línea 12122');
    assert.equal(Number(lc!.lineas.find((l) => l.cuenta === '1212')!.debe), 11800, 'C: 1212 lleva el total');
    console.log('  ✓ C sin retención: comportamiento previo intacto');

    console.log('\n  ✅ F1.1 retención de garantía VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    // limpieza: asientos generados por las valos de prueba + las valos
    if (valoIds.length) {
      await db.delete(schema.asientos).where(and(inArray(schema.asientos.origenId, valoIds), inArray(schema.asientos.origen, ['valorizacion', 'cobro_valo'])));
      await db.delete(schema.valorizaciones).where(inArray(schema.valorizaciones.id, valoIds));
    }
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
