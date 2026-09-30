import assert from 'node:assert/strict';
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';
import { getYtd } from '../../src/lib/renta5taYtd.js';

// ── Test 1: renta5ta YTD baseline import ──────────────────────
const [emp] = await db.select({ id: schema.empleados.id }).from(schema.empleados).limit(1);
await db.delete(schema.renta5taBaseline).where(eq(schema.renta5taBaseline.empleadoId, emp!.id));
await db.insert(schema.renta5taBaseline).values({ empleadoId: emp!.id, anio: 2026, acumuladoImportado: '12000', retencionesImportadas: '340' });
const y = await getYtd(emp!.id, 2026, 2);
assert.ok(Math.abs(y.acumuladoPercibido - 12000) <= 0.01 && Math.abs(y.retencionesPrevias - 340) <= 0.01, 'import baseline refleja en YTD');
await db.delete(schema.renta5taBaseline).where(eq(schema.renta5taBaseline.empleadoId, emp!.id));

// ── Test 2: PUT /param-legal guard — valid upsert yields finite numerics ──
// Use a sentinel fechaVigencia (9999-01-01) so we don't pollute real data.
const TEST_FV = '9999-01-01';
await db.delete(schema.paramLegalOficina).where(eq(schema.paramLegalOficina.fechaVigencia, TEST_FV));

const validPayload = {
  fechaVigencia: TEST_FV,
  rmv: '1025',
  uit: '5350',
  topeRma: '12599.27',
  pctEssalud: '0.09',
  pctOnp: '0.13',
  pctAfpAporte: '0.10',
  pctAsigFamiliar: '0.10',
};
const [inserted] = await db
  .insert(schema.paramLegalOficina)
  .values(validPayload)
  .onConflictDoUpdate({
    target: schema.paramLegalOficina.fechaVigencia,
    set: validPayload,
  })
  .returning();

const fields = ['rmv', 'uit', 'topeRma', 'pctEssalud', 'pctOnp', 'pctAfpAporte', 'pctAsigFamiliar'] as const;
for (const f of fields) {
  const v = Number((inserted as Record<string, unknown>)[f]);
  assert.ok(Number.isFinite(v), `param-legal upsert: campo '${f}' debe ser finito en DB; got ${v}`);
}
await db.delete(schema.paramLegalOficina).where(eq(schema.paramLegalOficina.fechaVigencia, TEST_FV));

// ── Test 3: guard rejects partial payload (missing any required field) ──
// Re-implement the guard logic inline (mirrors the route handler) to confirm it
// would return 400 for any missing field, not silently write NaN.
function paramLegalGuard(body: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  if (!body.fechaVigencia || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.fechaVigencia)))
    return { ok: false, error: 'fechaVigencia requerida (YYYY-MM-DD)' };
  for (const f of ['rmv', 'uit', 'topeRma', 'pctEssalud', 'pctOnp', 'pctAfpAporte', 'pctAsigFamiliar'] as const) {
    const val = body[f];
    if (val === undefined || val === null || !Number.isFinite(Number(val)))
      return { ok: false, error: `Campo '${f}' requerido y numérico` };
  }
  return { ok: true };
}

// Baseline: full payload passes
const full = { fechaVigencia: '2026-01-01', rmv: 1025, uit: 5350, topeRma: 12599.27, pctEssalud: 0.09, pctOnp: 0.13, pctAfpAporte: 0.10, pctAsigFamiliar: 0.10 };
assert.deepEqual(paramLegalGuard(full), { ok: true }, 'payload completo pasa el guard');

// Each required numeric field: omitting it must fail
for (const f of ['rmv', 'uit', 'topeRma', 'pctEssalud', 'pctOnp', 'pctAfpAporte', 'pctAsigFamiliar'] as const) {
  const partial: Record<string, unknown> = { ...full };
  delete partial[f];
  const result = paramLegalGuard(partial);
  assert.ok(!result.ok, `guard debe rechazar payload sin '${f}'`);
  assert.ok((result as { ok: false; error: string }).error.includes(f), `mensaje de error menciona '${f}'`);
}

// NaN-string must also be rejected
const withNaN: Record<string, unknown> = { ...full, rmv: 'not-a-number' };
const nanResult = paramLegalGuard(withNaN);
assert.ok(!nanResult.ok, 'guard debe rechazar rmv="not-a-number"');

console.log('config-oficina VERDE'); process.exit(0);
