/**
 * F2 planilla oficina · aceptación (spec §8).
 *   cd apps/backend && ./node_modules/.bin/tsx scripts/oficina/test-planilla-f2.ts
 * Requiere DATABASE_URL=erp_mmh_test. Imprime 'planilla-f2 VERDE' en éxito.
 * En Windows el exit code 9 es cosmético (libuv): éxito = VERDE impreso.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { db, schema } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { authMiddleware } from '../../src/middleware/auth.js';
import planillaOficinaRoutes from '../../src/routes/planillaOficina.js';
import { lucia } from '../../src/auth.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin
const MES = '2026-07'; // periodo abierto

(async () => {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/oficina', planillaOficinaRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://localhost:${port}`;

  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const get = (p: string) => fetch(base + p, { headers: { cookie } });
  const send = (m: string, p: string, body?: unknown) =>
    fetch(base + p, {
      method: m,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body ?? {}),
    });

  // ── Fixtures: dos obras ──
  const obras = await db
    .select({ id: schema.proyectos.id, codigo: schema.proyectos.codigo })
    .from(schema.proyectos)
    .limit(2);
  assert.ok(obras.length === 2, 'se requieren 2 proyectos en erp_mmh_test');
  const [obraA, obraB] = obras as [(typeof obras)[0], (typeof obras)[0]];

  // La planilla del mes debe existir y estar calculada.
  const planilla = await get(`/api/oficina/planilla?mes=${MES}`).then((x) => x.json());
  assert.ok(planilla.mes?.id, `no hay planilla ${MES}; córrela con test-planilla-julio17 primero`);
  const mesId = planilla.mes.id as string;
  const empresaIdMes = planilla.mes.empresaId as number;

  // ── Caso 4 · asiento cuadra y la clase se deriva GG_OBRA / GG_CORP ──
  // 60% obraA / 40% oficina en modo global.
  let r = await send('PUT', '/api/oficina/planilla/distribucion', {
    empleadoId: null,
    filas: [{ obraId: obraA.id, pct: 60 }],
  });
  assert.equal(r.status, 200, await r.text());

  const prev = await get(`/api/oficina/planilla/${mesId}/asiento-preview`).then((x) => x.json());
  const sumDebe = prev.lineas.reduce((s: number, l: any) => s + Number(l.debe), 0);
  const sumHaber = prev.lineas.reduce((s: number, l: any) => s + Number(l.haber), 0);
  assert.equal(Math.round(sumDebe * 100), Math.round(sumHaber * 100), 'asiento no cuadra');
  assert.equal(prev.cuadra, true);

  const conObra = prev.lineas.filter((l: any) => l.obraId);
  assert.ok(conObra.length > 0, 'no hay líneas de costo con obra');
  for (const l of conObra) assert.equal(l.clase, 'GG_OBRA', `${l.cuenta} con obra debería ser GG_OBRA`);
  for (const l of prev.lineas.filter((l: any) => !l.obraId && Number(l.debe) > 0 && l.cuenta.startsWith('6'))) {
    assert.equal(l.clase, 'GG_CORP', `${l.cuenta} sin obra debería ser GG_CORP`);
  }

  // ── Caso 5 · pasivos y banco SIN dimensión obra ──
  const PASIVOS = ['4031', '407', '4032', '40173', '469', '411'];
  for (const l of prev.lineas) {
    if (PASIVOS.includes(l.cuenta) || l.cuenta.startsWith('104')) {
      assert.equal(l.obraId, null, `${l.cuenta} no debe llevar obra`);
    }
  }

  // ── Caso 6 · mapa editable: cambiar afp_por_pagar mueve SOLO esa línea ──
  if (prev.lineas.some((l: any) => l.cuenta === '407')) {
    const otras = prev.lineas.filter((l: any) => l.cuenta !== '407').map((l: any) => `${l.cuenta}|${l.debe}|${l.haber}`);
    r = await send('PUT', '/api/oficina/planilla/concepto-cuenta/afp_por_pagar', { cuenta: '469' });
    assert.equal(r.status, 200, await r.text());
    const prev2 = await get(`/api/oficina/planilla/${mesId}/asiento-preview`).then((x) => x.json());
    assert.equal(prev2.lineas.some((l: any) => l.cuenta === '407'), false, '407 debería haber desaparecido');
    // las líneas de costo no se movieron
    for (const clave of otras.filter((k: string) => k.startsWith('6'))) {
      assert.ok(
        prev2.lineas.some((l: any) => `${l.cuenta}|${l.debe}|${l.haber}` === clave),
        `la línea ${clave} cambió y no debía`,
      );
    }
    await send('PUT', '/api/oficina/planilla/concepto-cuenta/afp_por_pagar', { cuenta: '407' }); // restaurar
  }

  // ── Review Focus · fuga entre empresas ──
  const empresas = await db.select({ id: schema.empresas.id }).from(schema.empresas);
  const ajena = empresas.find((e) => e.id !== empresaIdMes);
  if (ajena) {
    await db.insert(schema.planillaOficinaDistribucion)
      .values({ empresaId: ajena.id, empleadoId: null, obraId: obraB.id, pct: '100' })
      .onConflictDoNothing();
    const prev3 = await get(`/api/oficina/planilla/${mesId}/asiento-preview`).then((x) => x.json());
    assert.equal(
      prev3.lineas.some((l: any) => l.obraId === obraB.id),
      false,
      'una regla de otra empresa se filtró al reparto',
    );
    await db.delete(schema.planillaOficinaDistribucion).where(and(
      eq(schema.planillaOficinaDistribucion.empresaId, ajena.id),
      eq(schema.planillaOficinaDistribucion.obraId, obraB.id),
    ));
  } else {
    console.log('AVISO: solo hay una empresa en la DB; el caso de fuga entre empresas no se ejerció');
  }

  // ── Caso 1 · resolución por scope, vista desde el endpoint ──
  const detEmp = await db
    .select({ id: schema.planillaOficinaDetalle.empleadoId })
    .from(schema.planillaOficinaDetalle)
    .where(eq(schema.planillaOficinaDetalle.planillaMesId, mesId))
    .limit(1);
  const empId = detEmp[0]!.id;

  r = await send('PUT', '/api/oficina/planilla/distribucion', {
    empleadoId: empId,
    filas: [{ obraId: obraB.id, pct: 100 }],
  });
  assert.equal(r.status, 200, await r.text());

  const dist = await get('/api/oficina/planilla/distribucion').then((x) => x.json());
  assert.equal(dist.global.length, 1);
  assert.equal(dist.global[0].obraId, obraA.id);
  assert.ok(dist.global[0].obraCodigo, 'falta obraCodigo en el global');
  const mio = dist.porEmpleado.find((p: any) => p.empleadoId === empId);
  assert.ok(mio, 'el empleado con reglas propias no aparece en porEmpleado');
  assert.equal(mio.filas.length, 1);
  assert.equal(mio.filas[0].obraId, obraB.id);
  assert.ok(mio.empleadoNombre, 'falta empleadoNombre');

  // ── Casos 2/3 · el empleado con regla propia manda; el resto hereda el global y deja resto en oficina ──
  const prevMix = await get(`/api/oficina/planilla/${mesId}/asiento-preview`).then((x) => x.json());
  assert.ok(prevMix.lineas.some((l: any) => l.obraId === obraB.id), 'falta la obra del empleado propio');
  assert.ok(prevMix.lineas.some((l: any) => l.obraId === obraA.id), 'falta la obra del global');
  assert.ok(
    prevMix.lineas.some((l: any) => !l.obraId && Number(l.debe) > 0 && l.cuenta.startsWith('6')),
    'el 40% restante debería quedar en oficina (obraId null)',
  );

  // ── Caso 11 · validaciones ──
  const casos: Array<[unknown, string]> = [
    [{ empleadoId: null, filas: [{ obraId: obraA.id, pct: 60 }, { obraId: obraB.id, pct: 50 }] }, 'Σ > 100'],
    [{ empleadoId: null, filas: [{ obraId: obraA.id, pct: 0 }] }, 'pct = 0'],
    [{ empleadoId: null, filas: [{ obraId: obraA.id, pct: -5 }] }, 'pct negativo'],
    [{ empleadoId: null, filas: [{ obraId: obraA.id, pct: 'abc' }] }, 'pct no numérico'],
    [{ empleadoId: null, filas: [{ obraId: obraA.id }] }, 'pct ausente'],
    [{ empleadoId: null, filas: [{ obraId: '00000000-0000-0000-0000-000000000000', pct: 10 }] }, 'obra inexistente'],
    [{ empleadoId: null, filas: [{ obraId: obraA.id, pct: 10 }, { obraId: obraA.id, pct: 20 }] }, 'obra repetida'],
    [{ empleadoId: null }, 'filas ausente'],
  ];
  for (const [body, que] of casos) {
    const bad = await send('PUT', '/api/oficina/planilla/distribucion', body);
    assert.equal(bad.status, 400, `${que} debería dar 400, dio ${bad.status}`);
  }

  // concepto fuera del conjunto cerrado / cuenta inexistente → 400
  assert.equal((await send('PUT', '/api/oficina/planilla/concepto-cuenta/inventado', { cuenta: '6211' })).status, 400);
  assert.equal((await send('PUT', '/api/oficina/planilla/concepto-cuenta/sueldos', { cuenta: '999999' })).status, 400);
  assert.equal((await send('PUT', '/api/oficina/planilla/concepto-cuenta/sueldos', {})).status, 400);

  // el global sigue intacto tras los rechazos: el PUT reemplaza el scope entero o nada
  const distTras = await get('/api/oficina/planilla/distribucion').then((x) => x.json());
  assert.equal(distTras.global.length, 1);
  assert.equal(Number(distTras.global[0].pct), 60);

  // mapa de conceptos: los 8, todos con cuenta y label
  const mapaRes = await get('/api/oficina/planilla/concepto-cuenta').then((x) => x.json());
  assert.equal(mapaRes.conceptos.length, 8);
  for (const c of mapaRes.conceptos) assert.ok(c.cuenta && c.label, `concepto ${c.concepto} incompleto`);

  // limpiar las reglas del empleado para no ensuciar corridas siguientes
  await send('PUT', '/api/oficina/planilla/distribucion', { empleadoId: empId, filas: [] });

  server.close();
  console.log('planilla-f2 VERDE');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
