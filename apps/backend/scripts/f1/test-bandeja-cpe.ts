/**
 * F2.3 · Test de la Bandeja CPE (in-process, router real).
 *   node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/f1/test-bandeja-cpe.ts
 * Cubre: subida masiva (fixture MMH real → nuevo · empresa ajena → rechazado),
 * dedup por hash (re-subida → duplicado_xml), listado y descarte. Limpia lo que crea.
 * Requiere DATABASE_URL=erp_mmh_test. Exit 0 = verde.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import cpeRoutes from '../../src/routes/cpe.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { inArray } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const FIX = 'apps/backend/scripts/cpe/fixtures';
const creados: string[] = [];

(async () => {
  let failed = false;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/cpe', cpeRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();

  const subir = async (archivos: { nombre: string; buf: Buffer }[]) => {
    const fd = new FormData();
    for (const a of archivos) fd.append('files', new Blob([a.buf], { type: 'text/xml' }), a.nombre);
    const r = await fetch(`http://localhost:${port}/api/cpe/bandeja`, { method: 'POST', headers: { cookie }, body: fd });
    return { status: r.status, body: await r.json() };
  };
  const dePath = (p: string) => ({ nombre: p.split(/[\\/]/).pop()!, buf: fs.readFileSync(p) });
  // fixture real de Doratta re-dirigida a MM (cliente 20609286360 → 20610639764) = compra MM "nueva"
  const nuevaMm = { nombre: 'test-f23-nueva-mm.xml', buf: Buffer.from(fs.readFileSync(`${FIX}/mmh/FACTURAE001-172020613703340.xml`, 'utf-8').replaceAll('20609286360', '20610639764')) };

  try {
    console.log('════ F2.3 · Bandeja CPE ════');

    // A · fixture MMH nueva → borrador · fixture MMH YA registrada en gastos → ya_registrada · ajena → rechazado
    const A = await subir([
      nuevaMm,
      dePath(`${FIX}/mmh/20100047218-01-FN01-40548491.xml`),
      dePath(`${FIX}/publicos/greenter/invoice/gravada.xml`),
    ]);
    assert.equal(A.status, 200, `A sube (${JSON.stringify(A.body).slice(0, 200)})`);
    const rNueva = A.body.resultados.find((x: any) => x.archivo.includes('test-f23'));
    const rYa = A.body.resultados.find((x: any) => x.archivo.includes('FN01'));
    const rAjena = A.body.resultados.find((x: any) => x.archivo.includes('gravada'));
    assert.equal(rNueva.estado, 'nuevo', `A: factura MMH nueva entra como borrador (${JSON.stringify(rNueva)})`);
    assert.equal(rNueva.clasificacion, 'factura', 'A: clasificada factura');
    assert.equal(rYa.estado, 'ya_registrada', 'A: factura ya en el registro de compras se rechaza');
    assert.equal(rAjena.estado, 'rechazado', 'A: XML de otra empresa rechazado');
    console.log('  ✓ A subida: nueva → borrador · ya registrada → rechazo · ajena → rechazo');

    // B · re-subir el mismo XML → duplicado por hash
    const B = await subir([nuevaMm]);
    assert.equal(B.body.resultados[0].estado, 'duplicado_xml', 'B: mismo XML no entra dos veces');
    console.log('  ✓ B dedup por hash');

    // C · listado pendientes trae el borrador con payload completo
    const rl = await fetch(`http://localhost:${port}/api/cpe/bandeja?rol=compra`, { headers: { cookie } });
    const { borradores } = await rl.json();
    const bo = borradores.find((x: any) => `${x.serie}-${x.numero}` === rNueva.comprobante);
    assert.ok(bo, 'C: borrador en la bandeja');
    creados.push(bo.id);
    assert.ok(bo.payload?.totales?.total > 0, 'C: payload con totales');
    console.log(`  ✓ C listado: ${bo.serie}-${bo.numero} · ${bo.emisorRazon ?? bo.emisorRuc} · total ${bo.payload.totales.total}`);

    // D · descartar
    const rd = await fetch(`http://localhost:${port}/api/cpe/bandeja/${bo.id}/descartar`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ motivo: 'test F2.3' }),
    });
    assert.equal(rd.status, 200, 'D: descarta');
    const rl2 = await fetch(`http://localhost:${port}/api/cpe/bandeja?rol=compra`, { headers: { cookie } });
    const { borradores: b2 } = await rl2.json();
    assert.ok(!b2.some((x: any) => x.id === bo.id), 'D: ya no aparece en pendientes');
    console.log('  ✓ D descarte saca de la bandeja');

    console.log('\n  ✅ F2.3 Bandeja CPE VERDE\n');
  } catch (e: any) {
    failed = true;
    console.error('\n  ✗ FALLÓ:', e?.message ?? e, '\n');
  } finally {
    if (creados.length) await db.delete(schema.cpeBandeja).where(inArray(schema.cpeBandeja.id, creados));
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
