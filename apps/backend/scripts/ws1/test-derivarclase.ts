/**
 * WS1 · Unit test de derivarClase (núcleo puro + wrapper DB).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/ws1/test-derivarclase.ts
 * Riesgo cero de esquema: solo lee. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import { derivarClaseCore, derivarClase } from '../../src/lib/clasificacion.js';
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';

const OBRA = '00000000-0000-0000-0000-000000000001'; // uuid cualquiera (solo presencia importa)

(async () => {
  let failed = false;
  try {
    console.log('════ WS1 · derivarClase ════');

    // ── Núcleo PURO (sin DB) ──
    assert.equal(derivarClaseCore(false, OBRA, 'CD'), null, 'no clasificable → null (aunque tenga obra)');
    assert.equal(derivarClaseCore(false, null, null), null, 'no clasificable + sin obra → null');
    assert.equal(derivarClaseCore(true, OBRA, 'CD'), 'CD', 'clasificable + obra + mapa CD → CD');
    assert.equal(derivarClaseCore(true, OBRA, 'GG_OBRA'), 'GG_OBRA', 'clasificable + obra + mapa GG_OBRA → GG_OBRA');
    assert.equal(derivarClaseCore(true, OBRA, null), 'CD', 'clasificable + obra sin mapa → CD (default)');
    assert.equal(derivarClaseCore(true, null, 'CD'), 'GG_CORP', 'clasificable + SIN obra → GG_CORP (obra desambigua)');
    assert.equal(derivarClaseCore(true, undefined, undefined), 'GG_CORP', 'clasificable + obra undefined → GG_CORP');
    console.log('  ✓ núcleo puro: 7 casos');

    // ── Caso D/G (WS0): MISMA cuenta clasificable, obra vs corporativo ──
    // Elige una cuenta del mapa que SEA clasificable (la regla ignora las no-gasto como 333).
    const clasifRows = await db.select({ cuenta: schema.mapaCuentaClase.cuenta, clase: schema.mapaCuentaClase.claseObra })
      .from(schema.mapaCuentaClase)
      .innerJoin(schema.planContable, eq(schema.planContable.codigo, schema.mapaCuentaClase.cuenta))
      .where(eq(schema.planContable.clasificable, true));
    assert.ok(clasifRows.length > 0, 'debe haber cuentas clasificables en mapa_cuenta_clase');
    const ctaObra = clasifRows.find((r) => r.cuenta === '634') ?? clasifRows[0]; // 634 = ejemplo G de WS0
    const conObra = await derivarClase(ctaObra.cuenta, OBRA);
    const sinObra = await derivarClase(ctaObra.cuenta, null);
    assert.equal(conObra, ctaObra.clase, `${ctaObra.cuenta}+obra → ${ctaObra.clase}`);
    assert.equal(sinObra, 'GG_CORP', `${ctaObra.cuenta}+sin obra → GG_CORP (misma cuenta, obra_id desambigua)`);
    console.log(`  ✓ caso D/G: ${ctaObra.cuenta} → obra=${conObra} · corp=${sinObra}`);

    // ── Cuenta en mapa pero NO clasificable (ej. 333 existencias) → null (clasificable manda) ──
    const noClasif = await db.select({ cuenta: schema.mapaCuentaClase.cuenta })
      .from(schema.mapaCuentaClase)
      .innerJoin(schema.planContable, eq(schema.planContable.codigo, schema.mapaCuentaClase.cuenta))
      .where(eq(schema.planContable.clasificable, false)).limit(1);
    if (noClasif[0]) {
      assert.equal(await derivarClase(noClasif[0].cuenta, OBRA), null, `${noClasif[0].cuenta} en mapa pero no clasificable → null`);
      console.log(`  ✓ ${noClasif[0].cuenta} en mapa pero no clasificable → null (regla clasificable manda sobre el mapa)`);
    }

    // ── Cuenta de balance (no clasificable) → null ──
    const [bal] = await db.select({ codigo: schema.planContable.codigo }).from(schema.planContable).where(eq(schema.planContable.clasificable, false)).limit(1);
    if (bal) {
      const c = await derivarClase(bal.codigo, OBRA);
      assert.equal(c, null, `cuenta de balance ${bal.codigo} → null aunque tenga obra`);
      console.log(`  ✓ balance ${bal.codigo} → null`);
    }

    // ── Cuenta inexistente → THROW (spec §2) ──
    await assert.rejects(() => derivarClase('99999', OBRA), /no existe/, 'cuenta inexistente → error de dominio');
    console.log('  ✓ cuenta inexistente → THROW (error de dominio)');

    console.log('\n  ✅ derivarClase VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    await (db as any).$client?.end?.().catch(() => {});
    process.exit(failed ? 1 : 0);
  }
})();
