/**
 * Gate de F1: cargar 2065 cuentas nuevas no cambió el comportamiento de ninguna cuenta en uso.
 * Corre DESPUÉS de cargar-plan.ts. Solo lee.
 *   node <tsx> scripts/contasis/test-regresion-plan.ts
 */
import assert from 'node:assert/strict';
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';
import { derivarClase, cargarDerivarCtx } from '../../src/lib/clasificacion.js';

const q = async (s: string) => {
  const r: any = await db.execute(sql.raw(s));
  return (r.rows ?? r) as any[];
};

// ── 1 · el catálogo quedó como se esperaba ──
// 3879 = 1814 nuestras + 2065 nuevas (3392 de CONTASIS − 1327 compartidas). El export de Kelly
// trae 3396 filas pero 4 códigos repetidos, así que son 3392 únicas (ver ruling de Task 2).
const [tot] = await q(`select count(*)::int total, count(*) filter (where es_contasis)::int cont,
                              max(length(codigo))::int maxlen from plan_contable`);
assert.equal(tot.total, 3879, `plan_contable tiene ${tot.total}, esperaba 3879`);
assert.equal(tot.cont, 3392, `es_contasis en ${tot.cont}, esperaba 3392`);
assert.equal(tot.maxlen, 10, `maxlen ${tot.maxlen}, esperaba 10`);
console.log('  ✓ 3879 cuentas · 3392 CONTASIS · código hasta 10 chars');

// ── 2 · toda cuenta usada en un asiento sigue existiendo y activa (FK validada) ──
const huerfanas = await q(`
  select distinct l.cuenta_contable c
    from asientos_lineas l
   where l.cuenta_contable is not null
     and not exists (select 1 from plan_contable p where p.codigo = l.cuenta_contable and p.activa)`);
assert.equal(huerfanas.length, 0, `cuentas en uso que ya no resuelven: ${huerfanas.map((r) => r.c).join(', ')}`);
const [enUso] = await q(`select count(distinct cuenta_contable)::int n from asientos_lineas where cuenta_contable is not null`);
assert.equal(enUso.n, 39, `cuentas distintas en uso: ${enUso.n}, esperaba 39`);
console.log('  ✓ las 39 cuentas en uso resuelven contra el plan y están activas');

// ── 3 · ninguna cuenta NUEVA quedó usada en un asiento (el desvío del plan depende de esto) ──
// Una cuenta compartida también tiene es_contasis=true y SÍ puede estar en uso, así que
// filtrar por es_contasis no sirve. La vía directa: antes de F1 el código más largo del plan
// era de 5 chars, así que toda cuenta en uso tiene ≤5 y ninguna nueva puede haber entrado.
const largas = await q(`
  select distinct l.cuenta_contable c from asientos_lineas l
   where l.cuenta_contable is not null and length(l.cuenta_contable) > 5`);
assert.equal(largas.length, 0, `asientos usando divisionarias CONTASIS antes de F2: ${largas.map((r) => r.c).join(', ')}`);
console.log('  ✓ ningún asiento usa todavía una divisionaria CONTASIS (F2 no corrió)');

// ── 4 · derivarClase() da lo mismo que antes en las cuentas de siempre ──
// mapa_cuenta_clase NO se sembró en F1 (desvío documentado), así que las clases mapeadas
// siguen siendo las 14 de siempre y el default sigue siendo CD.
const [mapa] = await q(`select count(*)::int n from mapa_cuenta_clase`);
assert.equal(mapa.n, 14, `mapa_cuenta_clase tiene ${mapa.n} filas, esperaba 14 (F1 no lo siembra)`);

const OBRA = (await q(`select id from proyectos limit 1`))[0]?.id ?? null;
assert.ok(OBRA, 'no hay proyectos en la DB: el check de derivarClase necesita una obra');

// 631 (transporte) es clasificable y está mapeada; con obra da su clase del mapa, sin obra GG_CORP
const claseMapeada = (await q(`select clase_obra from mapa_cuenta_clase where cuenta = '631'`))[0]?.clase_obra ?? null;
assert.equal(claseMapeada, 'CD', `631 debía seguir mapeada a CD, está en ${claseMapeada}`);
assert.equal(await derivarClase('631', OBRA), claseMapeada, '631 con obra cambió de clase');
assert.equal(await derivarClase('631', null), 'GG_CORP', '631 sin obra debía ser GG_CORP');
// 4212 no es clasificable → null, con o sin obra
assert.equal(await derivarClase('4212', OBRA), null, '4212 no debía clasificar');
assert.equal(await derivarClase('4212', null), null, '4212 no debía clasificar');
// cuenta inexistente sigue tirando error de dominio (spec WS1 §2)
await assert.rejects(() => derivarClase('ZZZZZ', null), /no existe en el plan/, 'cuenta inexistente debía throw');
console.log('  ✓ derivarClase() sin cambios en las cuentas de siempre');

// ── 5 · el ctx del motor carga las 3879 sin romperse ──
const ctx = await cargarDerivarCtx();
assert.equal(ctx.clasificablePorCuenta.size, 3879, `ctx cargó ${ctx.clasificablePorCuenta.size}, esperaba 3879`);
assert.equal(ctx.claseObraPorCuenta.size, 14, `ctx mapa ${ctx.claseObraPorCuenta.size}, esperaba 14`);
console.log('  ✓ cargarDerivarCtx() carga el catálogo completo');

// ── 6 · Review Focus 5 · el selector de cuentas tiene limit 30 y ahora hay más familias ──
// contabilidad.ts:204 limita a 30. Con las divisionarias de CONTASIS, un prefijo frecuente
// devuelve 30 de muchas más y el usuario no ve la cuenta que busca, SIN aviso.
const [m627] = await q(`select count(*)::int n from plan_contable where codigo like '627%' and activa`);
console.log(`  · '627%' matchea ${m627.n} cuentas y GET /plan?q= devuelve 30`);
assert.ok(m627.n > 30, 'esperaba que 627 pase de 30 matches: si no, revisá que la carga corrió');
console.log('  ⚠ limit 30 del selector queda CORTO · anotado para F5 (UI), no se arregla acá');

// ── 7 · el destino automático quedó cargado (lo que F2 y el export van a leer) ──
const [d] = await q(`select count(*)::int n from plan_contable where destino_debe is not null and destino_haber is not null`);
assert.equal(d.n, 1368, `destino automático en ${d.n}, esperaba 1368`);
const [c6011020] = await q(`select destino_debe, destino_haber from plan_contable where codigo = '6011020'`);
assert.equal(c6011020.destino_debe, '20111');
assert.equal(c6011020.destino_haber, '6111020');
console.log('  ✓ 1368 destinos automáticos cargados · 6011020 → 20111/6111020');

console.log('✅ F1 sin regresiones');
