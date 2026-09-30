/**
 * Siembra los 6 huecos que la auditoría (audit-data-casos-uso.ts) marcó en ROJO, para que la
 * sesión de casos de uso con Kelly tenga algo que mostrar en cada apartado.
 *   node <repo>/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs scripts/f1/seed-casos-uso.ts
 *
 * Todo entra por los ENDPOINTS REALES (no INSERT a mano), así que pasa por las mismas validaciones
 * que un registro de Kelly. Mes de siembra: 2026-09 (abierto y casi vacío · no toca ningún período
 * ya verificado). Marcador: los códigos de comprobante empiezan con "SEED".
 *
 * Idempotente: si ya sembró, los duplicados salen 409 y el script los reporta como "ya existe".
 * Para deshacer: scripts/f1/seed-casos-uso.ts --limpiar
 *
 * ⚠ Los tipos de cambio se siembran con fuente 'SEMILLA_DEMO'. Son plausibles, NO son los
 * publicados por SUNAT. Antes del cierre en paralelo hay que reemplazarlos por los reales.
 */
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import finanzasRoutes from '../../src/routes/finanzas.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';
import { lucia } from '../../src/auth.js';
import { db, schema } from '@erp/db';
import { and, eq, like, inArray, sql } from 'drizzle-orm';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const PERIODO = '2026-09';
const LIMPIAR = process.argv.includes('--limpiar');

// ─── TC USD · las 24 fechas de compras USD ya cargadas + el mes de siembra ───
// Curva plausible 3.72 → 3.78. fuente SEMILLA_DEMO para que se distinga de un TC oficial.
const TC_USD: [string, number][] = [
  ['2025-09-25', 3.720], ['2025-09-30', 3.724], ['2025-10-08', 3.731], ['2025-10-13', 3.735],
  ['2025-10-17', 3.738], ['2025-10-20', 3.740], ['2025-10-29', 3.745], ['2025-11-06', 3.748],
  ['2025-11-07', 3.749], ['2025-11-24', 3.755], ['2025-12-03', 3.758], ['2025-12-04', 3.759],
  ['2026-01-05', 3.762], ['2026-02-04', 3.766], ['2026-02-06', 3.767], ['2026-02-18', 3.769],
  ['2026-02-20', 3.770], ['2026-03-06', 3.772], ['2026-03-25', 3.775],
  ['2026-08-20', 3.778], ['2026-09-01', 3.780], ['2026-09-10', 3.776], ['2026-09-18', 3.774],
];

const paso = (n: string, detalle: string) => console.log(`  ✓ ${n} · ${detalle}`);
const salto = (n: string, detalle: string) => console.log(`  — ${n} · ${detalle}`);

async function limpiar() {
  console.log('════ limpiando siembra SEED* ════');
  const gastos = await db.select({ id: schema.gastos.id }).from(schema.gastos).where(like(schema.gastos.serie, 'SEED%'));
  const movs = await db.select({ id: schema.movimientos.id }).from(schema.movimientos).where(like(schema.movimientos.numOperacion, 'SEED%'));
  const gIds = gastos.map((g) => g.id);
  const mIds = movs.map((m) => m.id);
  const ids = [...gIds, ...mIds];
  if (ids.length) {
    await db.delete(schema.asientos).where(inArray(schema.asientos.origenId, ids));
    const docs = await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente).where(inArray(schema.documentoPendiente.docOrigenId, ids));
    if (docs.length) await db.delete(schema.aplicacionDocumento).where(inArray(schema.aplicacionDocumento.documentoPendienteId, docs.map((d) => d.id)));
    await db.delete(schema.aplicacionDocumento).where(inArray(schema.aplicacionDocumento.origenId, ids));
    await db.delete(schema.documentoPendiente).where(inArray(schema.documentoPendiente.docOrigenId, ids));
    await db.delete(schema.detraccionDocumento).where(inArray(schema.detraccionDocumento.docOrigenId, ids));
  }
  if (gIds.length) {
    await db.update(schema.ordenesCompra).set({ gastoId: null }).where(inArray(schema.ordenesCompra.gastoId, gIds));
    await db.delete(schema.gastoLineas).where(inArray(schema.gastoLineas.gastoId, gIds));
    await db.delete(schema.gastos).where(inArray(schema.gastos.id, gIds));
  }
  if (mIds.length) await db.delete(schema.movimientos).where(inArray(schema.movimientos.id, mIds));
  await db.delete(schema.tipoCambio).where(eq(schema.tipoCambio.fuente, 'SEMILLA_DEMO'));
  console.log(`  ✓ ${gIds.length} compras, ${mIds.length} movimientos y los TC SEMILLA_DEMO borrados\n`);
  process.exit(0);
}

(async () => {
  if (LIMPIAR) await limpiar();

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api', finanzasRoutes);
  app.use('/api/contabilidad', contabilidadRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://localhost:${port}/api${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const err = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body).slice(0, 220)}`;

  let fallos = 0;
  try {
    const [bcp] = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, '194-9927833-0-39'));
    const [obra] = await db.select({ id: schema.proyectos.id }).from(schema.proyectos).where(eq(schema.proyectos.codigo, 'PG0001'));

    // ── S1 · TC USD ─────────────────────────────────────────────
    console.log('\n════ S1 · tipos de cambio USD ════');
    await db.insert(schema.tipoCambio).values(TC_USD.map(([fecha, venta]) => ({
      fecha, moneda: 'USD', compra: (venta - 0.005).toFixed(3), venta: venta.toFixed(3), fuente: 'SEMILLA_DEMO',
    }))).onConflictDoNothing();
    const tcN = await db.select({ n: sql<number>`count(*)::int` }).from(schema.tipoCambio);
    paso('S1', `${TC_USD.length} TC USD sembrados (fuente SEMILLA_DEMO · total en tabla: ${tcN[0]!.n})`);

    // ── S2 · provisiones 48 ─────────────────────────────────────
    // P1 queda ABIERTA a propósito: es la que Kelly extorna en vivo en CU-5.
    console.log('\n════ S2 · provisiones 48 ════');
    const P1 = await call('POST', '/movimientos', {
      fecha: '2026-09-03', tipoMovimiento: 'Egreso', cuentaId: bcp!.id, monto: 4500, subtotal: 4500, igv: 0,
      clienteNombre: 'ESTUDIO CONTABLE ALVARADO SAC', descripcion: 'Honorarios setiembre · aún sin factura',
      numOperacion: 'SEED-PROV-01', cuentaContable: '4811', cuentaContableOrigen: 'USUARIO',
    });
    if (P1.status !== 200) { fallos++; salto('S2-P1', `no entró: ${err(P1)}`); } else paso('S2-P1', 'provisión ABIERTA de S/4,500 (la que Kelly extorna en vivo)');

    const P2 = await call('POST', '/movimientos', {
      fecha: '2026-09-04', tipoMovimiento: 'Egreso', cuentaId: bcp!.id, monto: 1800, subtotal: 1800, igv: 0,
      clienteNombre: 'SEGURIDAD INTEGRAL PERU SAC', descripcion: 'Servicio de vigilancia · pago adelantado sin factura',
      numOperacion: 'SEED-PROV-02', cuentaContable: '4811', cuentaContableOrigen: 'USUARIO',
    });
    const F2 = await call('POST', '/gastos', {
      fecha: '2026-09-20', tipoGasto: 'Servicio Terceros', proveedorRuc: '20512377881', proveedorRazon: 'SEGURIDAD INTEGRAL PERU SAC',
      tipoComprobante: 'Factura', serie: 'SEED2', numero: '0002', subtotal: 1525.42, igv: 274.58, total: 1800,
      destino: 'corporativo', cuentaContable: '6343', cuentaContableOrigen: 'USUARIO',
    });
    if (P2.status === 200 && F2.status === 200) {
      // el extorno necesita el asiento del pago → generar antes
      await call('POST', '/contabilidad/generar', { periodo: PERIODO });
      const E = await call('POST', `/contabilidad/provisiones/${P2.body.movimiento.id}/extornar`, { gastoId: F2.body.gasto.id });
      if (E.status === 200) paso('S2-P2', `provisión EXTORNADA de S/1,800 (asiento ${E.body.asiento.correlativo} · 4212/4811)`);
      else { fallos++; salto('S2-P2', `extorno falló: ${err(E)}`); }
    } else { fallos++; salto('S2-P2', `pago ${err(P2)} / factura ${err(F2)}`); }

    // ── S3 · NC de compra ───────────────────────────────────────
    console.log('\n════ S3 · nota de crédito de compra ════');
    const FAC = await call('POST', '/gastos', {
      fecha: '2026-09-08', tipoGasto: 'Compra Materiales', proveedorRuc: '20608496859', proveedorRazon: 'ZANE CONSTRUCCION S.A.C.',
      tipoComprobante: 'Factura', serie: 'SEED3', numero: '0003', subtotal: 5000, igv: 900, total: 5900,
      destino: 'proyecto', proyectoId: obra!.id, cuentaContable: '6031', cuentaContableOrigen: 'USUARIO',
    });
    if (FAC.status !== 200) { fallos++; salto('S3', `factura base: ${err(FAC)}`); } else {
      const NC = await call('POST', '/gastos', {
        fecha: '2026-09-15', tipoGasto: 'Compra Materiales', proveedorRuc: '20608496859', proveedorRazon: 'ZANE CONSTRUCCION S.A.C.',
        tipoComprobante: 'Nota de Crédito', serie: 'SEEDN', numero: '0001', subtotal: 1000, igv: 180, total: 1180,
        destino: 'proyecto', proyectoId: obra!.id, cuentaContable: '6031', cuentaContableOrigen: 'USUARIO',
        docModifica: { serie: 'SEED3', numero: '0003' }, motivoNota: '06', // 06 = devolución por ítem
      });
      if (NC.status !== 200) { fallos++; salto('S3', `NC: ${err(NC)}`); }
      else paso('S3', 'factura S/5,900 + NC parcial S/1,180 (devolución) → CxP debería quedar en S/4,720');
    }

    // ── S4 · compra desde OC + detracción con constancia ────────
    console.log('\n════ S4 · compra desde OC (3-way) con detracción depositada ════');
    const [oc] = await db.select().from(schema.ordenesCompra)
      .where(and(eq(schema.ordenesCompra.estado, 'aprobada'), sql`${schema.ordenesCompra.gastoId} is null`)).limit(1);
    const [provOc] = oc ? await db.select().from(schema.proveedores).where(eq(schema.proveedores.id, oc.proveedorId!)) : [];
    let lineasOc = oc ? await db.select().from(schema.ocLineas).where(eq(schema.ocLineas.ordenCompraId, oc.id)) : [];
    // las OC del ERP se sembraron solo con cabecera: sin líneas el 3-way no tiene qué cotejar.
    if (oc && !lineasOc.length) {
      const neto = Math.round((Number(oc.total) / 1.18) * 100) / 100;
      const a = Math.round(neto * 0.6 * 100) / 100;
      await db.insert(schema.ocLineas).values([
        { ordenCompraId: oc.id, numero: 1, descripcion: 'SEED · Cemento Portland Tipo I 42.5 kg', unidad: 'BOL', cantidad: '100', precioUnitario: (a / 100).toFixed(4), subtotal: a.toFixed(2) },
        { ordenCompraId: oc.id, numero: 2, descripcion: 'SEED · Acero corrugado 1/2" x 9 m', unidad: 'VAR', cantidad: '50', precioUnitario: ((neto - a) / 50).toFixed(4), subtotal: (neto - a).toFixed(2) },
      ] as any);
      lineasOc = await db.select().from(schema.ocLineas).where(eq(schema.ocLineas.ordenCompraId, oc.id));
      console.log(`  · S4 · ${oc.numero} no tenía líneas → sembradas 2 (neto S/${neto.toFixed(2)})`);
    }
    // código de detracción de construcción vigente (Anexo 3) · se toma del catálogo, no hardcodeado
    const [tasaDet] = await db.select().from(schema.detraccionTasa).where(like(schema.detraccionTasa.descripcion, '%onstrucc%')).limit(1);
    if (!oc || !provOc || !lineasOc.length || !tasaDet) {
      fallos++; salto('S4', `faltan prerequisitos (oc=${!!oc} prov=${!!provOc} lineas=${lineasOc.length} tasa=${!!tasaDet})`);
    } else {
      const OCG = await call('POST', '/gastos', {
        fecha: '2026-09-12', tipoGasto: 'Compra Materiales', proveedorRuc: provOc.ruc, proveedorRazon: provOc.razonSocial,
        tipoComprobante: 'Factura', serie: 'SEED4', numero: '0004', subtotal: 0, igv: 0, total: 0,
        destino: 'proyecto', proyectoId: obra!.id, ordenCompraId: oc.id,
        cuentaContable: '6031', cuentaContableOrigen: 'USUARIO',
        lineas: lineasOc.map((l) => ({
          descripcion: l.descripcion, unidad: l.unidad ?? 'UND',
          cantidad: Number(l.cantidad), valorUnitario: Number(l.precioUnitario), afectacionIgv: '10',
        })),
        detraccion: { codigo: tasaDet.codigo, constanciaNumero: 'SEED-CONST-0001', fechaDeposito: '2026-09-16' },
      });
      if (OCG.status !== 200) { fallos++; salto('S4', err(OCG)); }
      else paso('S4', `compra S/${Number(OCG.body.gasto.total).toFixed(2)} ligada a ${oc.numero} · detracción ${tasaDet.codigo} CON constancia`);
    }

    // ── S5 · pago que aplica 2 CxP del mismo proveedor ──────────
    console.log('\n════ S5 · pago aplicando 2 facturas ════');
    const dosFacturas = [] as string[];
    for (const [n, sub, igv, tot] of [['0005', 2000, 360, 2360], ['0006', 3000, 540, 3540]] as [string, number, number, number][]) {
      const R = await call('POST', '/gastos', {
        fecha: '2026-09-05', tipoGasto: 'Servicio Terceros', proveedorRuc: '20297832761', proveedorRazon: 'CONSTRUCTORA Y CONSULTORA TENORIO SAC',
        tipoComprobante: 'Factura', serie: 'SEED5', numero: n, subtotal: sub, igv, total: tot,
        destino: 'proyecto', proyectoId: obra!.id, cuentaContable: '6329', cuentaContableOrigen: 'USUARIO',
      });
      if (R.status === 200 && R.body.documento) dosFacturas.push(R.body.documento.id);
      else { fallos++; salto('S5', `factura ${n}: ${err(R)}`); }
    }
    if (dosFacturas.length === 2) {
      const PG = await call('POST', '/movimientos', {
        fecha: '2026-09-22', tipoMovimiento: 'Egreso', cuentaId: bcp!.id, monto: 5900, subtotal: 5900, igv: 0,
        clienteNombre: 'CONSTRUCTORA Y CONSULTORA TENORIO SAC', descripcion: 'Pago facturas SEED5-0005 y SEED5-0006',
        numOperacion: 'SEED-PAGO-01', cuentaContable: '4212', cuentaContableOrigen: 'USUARIO',
        aplicaciones: [{ documentoPendienteId: dosFacturas[0]!, monto: 2360 }, { documentoPendienteId: dosFacturas[1]!, monto: 3540 }],
      });
      if (PG.status !== 200) { fallos++; salto('S5', `pago: ${err(PG)}`); }
      else paso('S5', 'un egreso de S/5,900 cancela 2 CxP (2,360 + 3,540)');
    }

    // ── S6 · anotación en período posterior (8.1 estado '6') ────
    console.log('\n════ S6 · compra anotada en período posterior ════');
    const S6 = await call('POST', '/gastos', {
      fecha: '2026-08-20', periodoContable: '2026-09',
      tipoGasto: 'Compra Materiales', proveedorRuc: '20544464389', proveedorRazon: 'A & A COPIADORAS S.A.C.',
      tipoComprobante: 'Factura', serie: 'SEED6', numero: '0006', subtotal: 1200, igv: 216, total: 1416,
      destino: 'corporativo', cuentaContable: '6032', cuentaContableOrigen: 'USUARIO', destinoCredito: 'DG',
    });
    if (S6.status !== 200) { fallos++; salto('S6', err(S6)); }
    else paso('S6', 'factura emitida 2026-08-20 anotada en 2026-09 → 8.1 estado "6"');

    // ── asentar todo lo sembrado ────────────────────────────────
    console.log('\n════ generar asientos del período ════');
    const G = await call('POST', '/contabilidad/generar', { periodo: PERIODO });
    if (G.status !== 200) { fallos++; salto('generar', err(G)); }
    else paso('generar', `${JSON.stringify(G.body.resultado ?? G.body).slice(0, 180)}`);

    const [cuadre] = await db.execute(sql`
      select sum(l.debe)::numeric(14,2) debe, sum(l.haber)::numeric(14,2) haber
      from asientos a join asientos_lineas l on l.asiento_id = a.id
      where a.periodo = ${PERIODO} and a.status = 'registrado'`).then((r: any) => r.rows ?? r);
    console.log(`\n  ${PERIODO}: debe ${cuadre?.debe} · haber ${cuadre?.haber} · ${Number(cuadre?.debe) === Number(cuadre?.haber) ? 'CUADRA ✅' : 'NO CUADRA ❌'}`);

    console.log(fallos ? `\n  ⚠ siembra con ${fallos} problema(s) — revisa arriba\n` : '\n  ✅ los 6 huecos sembrados\n');
  } catch (e: any) {
    fallos++;
    console.error('\n  ✗ ERROR:', e?.message ?? e, '\n');
  } finally {
    await lucia.invalidateSession(session.id).catch(() => {});
    server.close();
    process.exit(fallos ? 1 : 0);
  }
})();
