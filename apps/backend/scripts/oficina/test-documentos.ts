/**
 * Task 7 · Test documento_adjunto helper + endpoints (DB-only, no live NAS).
 * Run:
 *   $env:DATABASE_URL='postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test'
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/oficina/test-documentos.ts
 * Prints 'documentos VERDE' on success. exit 9 is cosmetic on Windows.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import planillaOficinaRoutes from '../../src/routes/planillaOficina.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { buildNasPath } from '../../src/lib/documentoAdjunto.js';
import { env } from '../../src/env.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin user (must exist in DB)

// ─── Temp IDs for cleanup ─────────────────────────────────────
let tempMesId: string | null = null;
let tempDetalleId: string | null = null;
let tempDocId: string | null = null;

(async () => {
  let failed = false;

  // ── Bootstrap in-process express (same pattern as other oficina tests) ──
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/oficina', planillaOficinaRoutes);

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}`;

  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();

  const get = (path: string) =>
    fetch(base + path, { headers: { cookie } });

  try {
    console.log('════ documentos · Task 7 ════');

    // ── 0. Unit test: buildNasPath ──
    console.log('  0. unit test buildNasPath');
    const builtPath = buildNasPath({ subPath: '2026-07/99999999', nombreArchivo: 'comprobante.pdf' });
    const nasRoot = env.NAS_ROOT_ADMIN.replace(/\/$/, '');
    assert.ok(
      builtPath.startsWith(nasRoot),
      `nasPath must start with NAS_ROOT_ADMIN="${nasRoot}", got: ${builtPath}`,
    );
    assert.ok(
      builtPath.includes('/Planilla/2026-07/99999999/comprobante.pdf'),
      `nasPath must contain /Planilla/2026-07/99999999/comprobante.pdf, got: ${builtPath}`,
    );
    console.log(`  ✓ 0. buildNasPath → ${builtPath}`);

    // ── 1. Insert temp planilla_oficina_mes ──
    console.log('  1. create temp planilla_oficina_mes (mes=2026-07-TEST)');
    // Use a unique mes to avoid conflict with other test runs
    const MES = '2026-07';

    // Check if mes already exists (other tests may have created it)
    const [existingMes] = await db
      .select()
      .from(schema.planillaOficinaMes)
      .where(and(eq(schema.planillaOficinaMes.empresaId, 1), eq(schema.planillaOficinaMes.mes, MES)))
      .limit(1);

    let mesRow: typeof schema.planillaOficinaMes.$inferSelect;
    if (existingMes) {
      mesRow = existingMes;
      // Don't own this mes, so don't delete it at cleanup
      tempMesId = null;
      console.log(`  ✓ 1. reused existing planilla_oficina_mes id=${mesRow.id} mes=${mesRow.mes}`);
    } else {
      [mesRow] = await db
        .insert(schema.planillaOficinaMes)
        .values({ empresaId: 1, mes: MES, estado: 'borrador', createdBy: USER })
        .returning();
      tempMesId = mesRow.id;
      console.log(`  ✓ 1. created planilla_oficina_mes id=${mesRow.id} mes=${mesRow.mes}`);
    }

    // ── 2. Insert temp planilla_oficina_detalle ──
    // We need a valid empleado; use a fake one. Insert directly to avoid emp FK issues.
    // Actually planilla_oficina_detalle.empleado_id is a FK to empleados — so insert a minimal temp empleado first.
    const [tempEmp] = await db
      .insert(schema.empleados)
      .values({
        nombre: 'TEST DOC ADJ',
        numDoc: '99999999',
        tipoPlanilla: 'admin',
        activo: true,
      })
      .returning();
    console.log(`  2. created temp empleado id=${tempEmp.id}`);

    const [detRow] = await db
      .insert(schema.planillaOficinaDetalle)
      .values({
        planillaMesId: mesRow.id,
        empleadoId: tempEmp.id,
        dni: '99999999',
      })
      .returning();
    tempDetalleId = detRow.id;
    console.log(`  ✓ 2. created planilla_oficina_detalle id=${detRow.id} dni=${detRow.dni}`);

    // ── 3. GET /docs → {boleta:false, comprobante:false} ──
    console.log('  3. GET /planilla-detalle/:id/docs → expect both false');
    const r3 = await get(`/api/oficina/planilla-detalle/${detRow.id}/docs`);
    assert.equal(r3.status, 200, `GET /docs status ${r3.status}`);
    const j3 = await r3.json() as { boleta: boolean; comprobante: boolean };
    assert.equal(j3.boleta, false, `boleta should be false, got ${j3.boleta}`);
    assert.equal(j3.comprobante, false, `comprobante should be false, got ${j3.comprobante}`);
    console.log(`  ✓ 3. docs → boleta=${j3.boleta} comprobante=${j3.comprobante}`);

    // ── 4. Insert documento_adjunto directly (skip NAS) ──
    console.log('  4. insert documento_adjunto row directly (comprobante_pago)');
    const [docRow] = await db
      .insert(schema.documentoAdjunto)
      .values({
        entidadTipo: 'planilla_oficina_detalle',
        entidadId: detRow.id,
        docTipo: 'comprobante_pago',
        nasPath: '/x/y.pdf',
        nombreArchivo: 'y.pdf',
        fecha: '2026-07-31',
      })
      .returning();
    tempDocId = docRow.id;
    console.log(`  ✓ 4. inserted doc id=${docRow.id} nasPath=${docRow.nasPath}`);

    // ── 5. GET /docs again → {boleta:false, comprobante:true} ──
    console.log('  5. GET /planilla-detalle/:id/docs → expect comprobante=true');
    const r5 = await get(`/api/oficina/planilla-detalle/${detRow.id}/docs`);
    assert.equal(r5.status, 200, `GET /docs status ${r5.status}`);
    const j5 = await r5.json() as { boleta: boolean; comprobante: boolean };
    assert.equal(j5.boleta, false, `boleta should be false, got ${j5.boleta}`);
    assert.equal(j5.comprobante, true, `comprobante should be true, got ${j5.comprobante}`);
    console.log(`  ✓ 5. docs → boleta=${j5.boleta} comprobante=${j5.comprobante}`);

    console.log('\ndocumentos VERDE');
  } catch (e) {
    failed = true;
    console.error('\n✗ TEST FAILED:', (e as Error).message);
    console.error((e as Error).stack);
  } finally {
    // ── Cleanup ──
    try {
      if (tempDocId) {
        await db.delete(schema.documentoAdjunto).where(eq(schema.documentoAdjunto.id, tempDocId));
      }
      if (tempDetalleId) {
        await db.delete(schema.planillaOficinaDetalle).where(eq(schema.planillaOficinaDetalle.id, tempDetalleId));
      }
      if (tempMesId) {
        await db.delete(schema.planillaOficinaMes).where(eq(schema.planillaOficinaMes.id, tempMesId));
      }
      // Delete temp empleado by numDoc
      await db.delete(schema.empleados).where(eq(schema.empleados.numDoc, '99999999'));
      await lucia.invalidateSession(session.id);
    } catch (ce) {
      console.error('cleanup error:', (ce as Error).message);
    }
    server.close();
    process.exit(failed ? 1 : 9);
  }
})();
