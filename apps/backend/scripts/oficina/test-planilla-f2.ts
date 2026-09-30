/**
 * F2 planilla oficina · aceptación (spec §8).
 *   cd apps/backend && ./node_modules/.bin/tsx scripts/oficina/test-planilla-f2.ts
 * Requiere DATABASE_URL=erp_mmh_test. Imprime 'planilla-f2 VERDE' en éxito.
 * En Windows el exit code 9 es cosmético (libuv): éxito = VERDE impreso.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { db, schema } from '@erp/db';
import { and, eq, inArray } from 'drizzle-orm';
import { authMiddleware } from '../../src/middleware/auth.js';
import planillaOficinaRoutes from '../../src/routes/planillaOficina.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin
const MES = '2026-07'; // periodo abierto

(async () => {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/oficina', planillaOficinaRoutes);
  app.use('/api/contabilidad', contabilidadRoutes);
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
  // Si no existe, la creamos aquí para que el script sea independiente del orden de ejecución.
  let planilla = await get(`/api/oficina/planilla?mes=${MES}`).then((x) => x.json());
  if (!planilla.mes?.id) {
    const crea = await send('POST', '/api/oficina/planilla', { mes: MES });
    assert.equal(crea.status, 200, `no se pudo crear la planilla ${MES}: ${await crea.clone().text()}`);
    const creaBody = await crea.json() as { mes: any };
    assert.ok(creaBody.mes?.id, `POST /api/oficina/planilla no devolvió mes.id`);

    const calc = await send('POST', `/api/oficina/planilla/${creaBody.mes.id}/calcular`, {});
    assert.equal(calc.status, 200, `no se pudo calcular la planilla ${MES}: ${await calc.clone().text()}`);
    const calcBody = await calc.json() as { mes: any };
    assert.equal(calcBody.mes?.estado, 'calculada', `calcular no dejó la planilla en estado 'calculada'`);

    // Re-GET para que mesId y empresaIdMes vengan de la fila real
    planilla = await get(`/api/oficina/planilla?mes=${MES}`).then((x) => x.json());
    assert.ok(planilla.mes?.id, `planilla ${MES} no encontrada tras crear y calcular`);
  } else if (!['calculada'].includes(planilla.mes.estado)) {
    // Existe pero no está calculada (ej. estado='borrador') → calcular para que haya filas de detalle
    const calc = await send('POST', `/api/oficina/planilla/${planilla.mes.id}/calcular`, {});
    assert.equal(calc.status, 200, `no se pudo calcular la planilla ${MES}: ${await calc.clone().text()}`);
    planilla = await get(`/api/oficina/planilla?mes=${MES}`).then((x) => x.json());
    assert.equal(planilla.mes?.estado, 'calculada', `calcular no dejó la planilla en estado 'calculada'`);
  }
  const mesId = planilla.mes.id as string;
  const empresaIdMes = planilla.mes.empresaId as number;

  // Verificar que la planilla calculada tiene al menos 2 empleados en detalle
  const detalleCheck = await db
    .select({ id: schema.planillaOficinaDetalle.empleadoId })
    .from(schema.planillaOficinaDetalle)
    .where(eq(schema.planillaOficinaDetalle.planillaMesId, mesId));
  assert.ok(detalleCheck.length >= 2, `se requieren al menos 2 empleados en el detalle de la planilla ${MES}; hay ${detalleCheck.length}`);

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

  // ── Fixture: una cuenta bancaria PEN activa con 104x ──
  const cuentas = await db.select().from(schema.cuentasBancarias);
  const cbOk = cuentas.find((c) => c.activo && c.moneda === 'PEN' && !!c.cuentaContable);
  assert.ok(cbOk, 'se requiere una cuenta bancaria PEN activa con cuentaContable');

  // ── Caso 11 (resto) · cuenta bancaria invalida → 400 (Review Focus) ──
  const cbUsd = cuentas.find((c) => c.moneda !== 'PEN');
  if (cbUsd) {
    const bad = await get(`/api/oficina/planilla/${mesId}/asiento-preview?cuentaBancariaId=${cbUsd.id}`);
    assert.equal(bad.status, 400, 'cuenta en moneda distinta de PEN deberia dar 400');
  }
  const cbInactiva = cuentas.find((c) => !c.activo);
  if (cbInactiva) {
    const bad = await get(`/api/oficina/planilla/${mesId}/asiento-preview?cuentaBancariaId=${cbInactiva.id}`);
    assert.equal(bad.status, 400, 'cuenta inactiva deberia dar 400');
  }
  const badId = await get(`/api/oficina/planilla/${mesId}/asiento-preview?cuentaBancariaId=00000000-0000-0000-0000-000000000000`);
  assert.equal(badId.status, 400, 'cuenta inexistente deberia dar 400');

  // ── Caso 7 · preview == cerrar ──
  const prevPago = await get(
    `/api/oficina/planilla/${mesId}/asiento-preview?cuentaBancariaId=${cbOk.id}`,
  ).then((x) => x.json());

  // dejar la planilla en 'calculada' antes de cerrar
  if (planilla.mes.estado === 'cerrada') {
    const re = await send('POST', `/api/oficina/planilla/${mesId}/reabrir`);
    assert.equal(re.status, 200, await re.text());
  }

  const cerrada = await send('POST', `/api/oficina/planilla/${mesId}/cerrar`, { cuentaBancariaId: cbOk.id });
  const cerradaText = await cerrada.text();
  assert.equal(cerrada.status, 200, cerradaText);
  const cerradaBody = JSON.parse(cerradaText);
  const asientoId = cerradaBody.asientoId as string;
  assert.ok(cerradaBody.movimientoId, 'cerrar con cuenta bancaria debe devolver movimientoId');

  const lineasPosteadas = await db
    .select()
    .from(schema.asientosLineas)
    .where(eq(schema.asientosLineas.asientoId, asientoId));

  const clave = (l: { cuenta: string; debe: unknown; haber: unknown; obraId?: unknown }) =>
    `${l.cuenta}|${Number(l.debe).toFixed(2)}|${Number(l.haber).toFixed(2)}|${l.obraId ?? ''}`;
  const setPrev = new Set(prevPago.lineas.map((l: any) => clave(l)));
  for (const l of lineasPosteadas) {
    assert.ok(setPrev.has(clave(l as any)), `la linea posteada ${clave(l as any)} no estaba en el preview`);
  }
  assert.equal(lineasPosteadas.length, prevPago.lineas.length, 'preview y asiento tienen distinto numero de lineas');

  // ── Caso 8 · pago desde banco: 411 debe + 104x haber, y UN movimiento ──
  const neto = Number(prevPago.totalNeto);
  assert.ok(
    lineasPosteadas.some((l) => l.cuenta === '411' && Math.abs(Number(l.debe) - neto) < 0.005),
    'falta la linea 411 debe por el neto',
  );
  assert.ok(
    lineasPosteadas.some((l) => l.cuenta === cbOk.cuentaContable && Math.abs(Number(l.haber) - neto) < 0.005),
    'falta la linea 104x haber por el neto',
  );

  const movs = await db
    .select()
    .from(schema.movimientos)
    .where(eq(schema.movimientos.planillaOficinaMesId, mesId));
  assert.equal(movs.length, 1, `esperaba 1 movimiento de planilla, hay ${movs.length}`);
  assert.equal(movs[0]!.tipoMovimiento, 'Egreso');
  assert.equal(movs[0]!.proyectoId, null, 'el movimiento no lleva proyecto: el reparto vive en el asiento');
  assert.equal(Math.abs(Number(movs[0]!.monto) - neto) < 0.005, true);

  // ── Caso 9 · idempotencia: cerrar de nuevo no duplica ──
  const otraVez = await send('POST', `/api/oficina/planilla/${mesId}/cerrar`, { cuentaBancariaId: cbOk.id });
  assert.equal(otraVez.status, 400, 'ya cerrada → 400 (solo se cierra en estado calculada)');
  const movs2 = await db.select().from(schema.movimientos).where(eq(schema.movimientos.planillaOficinaMesId, mesId));
  assert.equal(movs2.length, 1, 'el reintento duplico el movimiento');

  // ── Caso 10 · el pass de movimientos de /generar salta el movimiento de planilla ──
  const gen = await send('POST', '/api/contabilidad/generar?dryRun=1', {
    periodo: MES,
  }).then((x) => x.json());
  assert.ok(gen.detalle?.movSkip, `la respuesta de /generar no trae detalle.movSkip; gen=${JSON.stringify(gen)}`);
  assert.ok(gen.detalle.movSkip.planillaOficina >= 1, 'el pass 5 no salto el movimiento de planilla');

  // ── Caso 12 · guardarrail de reapertura: conciliado → 409, el movimiento sobrevive ──
  const movId = movs[0]!.id;
  const [extracto] = await db.select().from(schema.extractosBancarios).limit(1);
  if (extracto) {
    const [linea] = await db
      .insert(schema.extractoLineas)
      .values({
        extractoId: extracto.id,
        fecha: `${MES}-30`,
        descripcion: 'test F2 conciliacion',
        monto: String(-neto),
        estado: 'conciliado',
        movimientoId: movId,
      })
      .returning();

    const bloqueado = await send('POST', `/api/oficina/planilla/${mesId}/reabrir`);
    assert.equal(bloqueado.status, 409, `movimiento conciliado deberia dar 409, dio ${bloqueado.status}`);
    const sobrevive = await db.select().from(schema.movimientos).where(eq(schema.movimientos.id, movId));
    assert.equal(sobrevive.length, 1, 'el movimiento conciliado se borro');

    await db.delete(schema.extractoLineas).where(eq(schema.extractoLineas.id, linea!.id));
  } else {
    console.log('AVISO: sin extractos bancarios en la DB; el caso 12 no se ejercio');
  }

  // ── Caso 9 (cont.) · reabrir + recerrar deja el mismo estado ──
  const re2 = await send('POST', `/api/oficina/planilla/${mesId}/reabrir`);
  assert.equal(re2.status, 200, await re2.clone().text());
  const movsTrasReabrir = await db.select().from(schema.movimientos).where(eq(schema.movimientos.planillaOficinaMesId, mesId));
  assert.equal(movsTrasReabrir.length, 0, 'reabrir debe borrar el movimiento no conciliado');

  const re3 = await send('POST', `/api/oficina/planilla/${mesId}/cerrar`, { cuentaBancariaId: cbOk.id });
  assert.equal(re3.status, 200, await re3.clone().text());
  const movsFinal = await db.select().from(schema.movimientos).where(eq(schema.movimientos.planillaOficinaMesId, mesId));
  assert.equal(movsFinal.length, 1, 'recerrar debe dejar exactamente 1 movimiento');

  // cleanup: reabrir para dejar la planilla en estado calculada
  await send('POST', `/api/oficina/planilla/${mesId}/reabrir`);

  server.close();
  console.log('planilla-f2 VERDE');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
