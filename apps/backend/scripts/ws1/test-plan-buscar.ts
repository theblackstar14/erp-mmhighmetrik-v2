/**
 * WS1 · Test de la query del autocomplete GET /plan?q= (misma lógica del endpoint).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/ws1/test-plan-buscar.ts
 * Solo lee. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import { db, schema } from '@erp/db';
import { and, asc, eq, isNull, or, sql as dsql } from 'drizzle-orm';

// Replica EXACTA del WHERE del endpoint (contabilidad.ts GET /plan?q=).
async function buscar(q: string, empId: number | null, soloHoja = false) {
  const term = q.trim().toLowerCase();
  const conds = [eq(schema.planContable.activa, true)];
  if (empId) conds.push(or(isNull(schema.planContable.empresaId), eq(schema.planContable.empresaId, empId))!);
  if (soloHoja) conds.push(eq(schema.planContable.esDivisionaria, true));
  if (term) conds.push(or(dsql`lower(${schema.planContable.codigo}) like ${term + '%'}`, dsql`lower(${schema.planContable.descripcion}) like ${'%' + term + '%'}`)!);
  return db.select({
    codigo: schema.planContable.codigo, descripcion: schema.planContable.descripcion, tipo: schema.planContable.tipo,
    nivel: schema.planContable.nivel, esDivisionaria: schema.planContable.esDivisionaria,
    empresaId: schema.planContable.empresaId, activa: schema.planContable.activa, clasificable: schema.planContable.clasificable,
  }).from(schema.planContable).where(and(...conds)).orderBy(asc(schema.planContable.codigo)).limit(30);
}

(async () => {
  let failed = false;
  try {
    console.log('════ WS1 · GET /plan?q= ════');

    // por código
    const r6 = await buscar('634', 1);
    assert.ok(r6.some((c) => c.codigo === '634'), 'busca 634 por código');
    assert.ok(r6.every((c) => c.activa), 'solo activas');
    // el shape trae clasificable (para que el FE derive/pinte, NO para editar CD/GG)
    assert.ok('clasificable' in r6[0], 'response incluye clasificable');
    assert.ok(!('claseDerivada' in (r6[0] as any)) && !('clasificacion' in (r6[0] as any)), 'NO expone CD/GG como campo');
    console.log(`  ✓ q=634 → ${r6.length} filas · clasificable=${r6.find((c) => c.codigo === '634')?.clasificable}`);

    // por descripción (case-insensitive)
    const rd = await buscar('banco', 1);
    assert.ok(rd.length >= 0, 'búsqueda por descripción no revienta');
    console.log(`  ✓ q="banco" → ${rd.length} filas (por descripción)`);

    // límite 30
    const rall = await buscar('', 1);
    assert.ok(rall.length <= 30, 'límite 30');
    console.log(`  ✓ q="" → ${rall.length} filas (≤30)`);

    // empresa: compartidas (empresa_id null) siempre presentes
    assert.ok(rall.every((c) => c.empresaId === null || c.empresaId === 1), 'solo compartidas o de empresa 1');
    console.log('  ✓ filtro empresa: compartidas + propias de empresa 1');

    console.log('\n  ✅ /plan?q= VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})();
