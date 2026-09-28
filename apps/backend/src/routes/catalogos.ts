/**
 * Fase 0 finanzas · catálogos globales de solo lectura (SUNAT, detracciones) + tipo de cambio manual.
 */
import { db, schema } from '@erp/db';
import { and, asc, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePermiso } from '../lib/permisos.js';
import { audit } from '../lib/audit.js';
import { buscarTipoCambio } from '../lib/tipoCambio.js';
import { obtenerTcSunat } from '../lib/tcSunat.js';
import { consultarRuc } from '../lib/rucSunat.js';

const router = Router();
router.use(requireAuth);

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const hoy = () => new Date().toISOString().slice(0, 10);
const sqlExcluded = (col: string) => sql.raw(`excluded.${col}`); // upsert: valor de la fila entrante

router.get('/sunat/:catalogo', requirePermiso('finanzas', 'lectura'), async (req, res) => {
  const catalogo = req.params.catalogo as string;
  if (!/^\d{2}$/.test(catalogo)) return res.status(400).json({ error: 'catalogo invalido' });
  const filas = await db.select({ codigo: schema.catalogoSunat.codigo, descripcion: schema.catalogoSunat.descripcion, extra: schema.catalogoSunat.extra })
    .from(schema.catalogoSunat).where(eq(schema.catalogoSunat.catalogo, catalogo)).orderBy(asc(schema.catalogoSunat.codigo));
  res.json({ catalogo, filas });
});

router.get('/detracciones', requirePermiso('finanzas', 'lectura'), async (req, res) => {
  const fecha = typeof req.query.fecha === 'string' && FECHA.test(req.query.fecha) ? req.query.fecha : hoy();
  const t = schema.detraccionTasa;
  const rows = await db.select().from(t)
    .where(and(lte(t.vigenciaDesde, fecha), or(isNull(t.vigenciaHasta), gte(t.vigenciaHasta, fecha)), isNotNull(t.porcentaje)))
    .orderBy(asc(t.codigo));
  res.json({ fecha, tasas: rows.map((r) => ({ codigo: r.codigo, descripcion: r.descripcion, anexo: r.anexo, porcentaje: Number(r.porcentaje), montoMinimo: Number(r.montoMinimo) })) });
});

router.get('/tipo-cambio', requirePermiso('finanzas', 'lectura'), async (req, res) => {
  const fecha = String(req.query.fecha ?? '');
  const moneda = String(req.query.moneda ?? '');
  if (!FECHA.test(fecha) || !/^[A-Z]{3}$/.test(moneda)) return res.status(400).json({ error: 'fecha (YYYY-MM-DD) y moneda (ISO) requeridas' });
  const tc = await buscarTipoCambio(fecha, moneda);
  if (!tc) return res.status(404).json({ error: `Sin tipo de cambio ${moneda} para ${fecha} (ni en los 10 dias previos). Cargalo primero.` });
  res.json(tc);
});

// F3.6 · trae el TC SUNAT del día (API pública) y lo guarda; si la API no responde → 502 y carga manual
router.post('/tipo-cambio/sunat', requirePermiso('contabilidad', 'edicion'), async (req, res) => {
  const fecha = String((req.body as { fecha?: unknown })?.fecha ?? '');
  if (!FECHA.test(fecha)) return res.status(400).json({ error: 'fecha (YYYY-MM-DD) requerida' });
  const tc = await obtenerTcSunat(fecha);
  if (!tc) return res.status(502).json({ error: `SUNAT no respondió el TC del ${fecha}. Cárgalo manual en la tabla de tipo de cambio.` });
  await db.insert(schema.tipoCambio)
    .values({ fecha: tc.fecha, moneda: 'USD', compra: tc.compra.toFixed(4), venta: tc.venta.toFixed(4), fuente: 'sunat' })
    .onConflictDoUpdate({
      target: [schema.tipoCambio.fecha, schema.tipoCambio.moneda],
      set: { compra: tc.compra.toFixed(4), venta: tc.venta.toFixed(4), fuente: 'sunat', updatedAt: new Date() },
    });
  await audit(req, { action: 'update_tipo_cambio', entityType: 'tipo_cambio', before: null, after: { fuente: 'sunat', fecha: tc.fecha, moneda: 'USD', compra: tc.compra, venta: tc.venta }, motivo: null });
  res.json({ fecha: tc.fecha, moneda: 'USD', compra: tc.compra, venta: tc.venta, fuente: 'sunat' });
});

// F5.1 · RUC → razón social: maestro de proveedores → historial de compras → API SUNAT (y cachea al maestro)
router.get('/ruc/:numero', requirePermiso('finanzas', 'lectura'), async (req, res) => {
  const numero = String(req.params.numero ?? '');
  if (!/^\d{11}$/.test(numero)) return res.status(400).json({ error: 'RUC de 11 dígitos requerido' });
  const [prov] = await db.select().from(schema.proveedores).where(eq(schema.proveedores.ruc, numero)).limit(1);
  if (prov) {
    return res.json({ fuente: 'maestro', ruc: numero, razonSocial: prov.razonSocial, proveedorId: prov.id, estadoSunat: prov.estadoSunat, condicionSunat: prov.condicionSunat, cuentaDetraccionesBn: prov.cuentaDetraccionesBn });
  }
  const [previo] = await db.select({ razon: schema.gastos.proveedorRazon }).from(schema.gastos)
    .where(and(eq(schema.gastos.proveedorRuc, numero), isNotNull(schema.gastos.proveedorRazon)))
    .orderBy(sql`${schema.gastos.fecha} desc`).limit(1);
  if (previo?.razon) return res.json({ fuente: 'historial', ruc: numero, razonSocial: previo.razon, proveedorId: null, estadoSunat: null, condicionSunat: null, cuentaDetraccionesBn: null });
  const sunat = await consultarRuc(numero);
  if (!sunat) return res.status(404).json({ error: 'RUC no encontrado (ni local ni en SUNAT) · escribe la razón social' });
  // cachea al maestro: la próxima consulta es local y el autocomplete lo ofrece
  const [nuevo] = await db.insert(schema.proveedores)
    .values({ ruc: sunat.ruc, razonSocial: sunat.razonSocial, estadoSunat: sunat.estado, condicionSunat: sunat.condicion, domicilio: sunat.direccion })
    .onConflictDoNothing({ target: schema.proveedores.ruc }).returning();
  res.json({ fuente: 'sunat', ruc: sunat.ruc, razonSocial: sunat.razonSocial, proveedorId: nuevo?.id ?? null, estadoSunat: sunat.estado, condicionSunat: sunat.condicion, cuentaDetraccionesBn: null });
});

const tcSchema = z.object({
  filas: z.array(z.object({
    fecha: z.string().regex(FECHA),
    moneda: z.enum(['USD', 'EUR']),
    compra: z.number().positive().max(99),
    venta: z.number().positive().max(99),
  })).min(1).max(400),
}).superRefine((v, ctx) => {
  const vistos = new Set<string>();
  v.filas.forEach((f, i) => {
    const key = `${f.fecha}|${f.moneda}`;
    if (vistos.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `fecha+moneda duplicado: ${key}`, path: ['filas', i] });
    vistos.add(key);
  });
});

router.put('/tipo-cambio', requirePermiso('contabilidad', 'edicion'), async (req, res, next) => {
  try {
    const parse = tcSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
    const { filas } = parse.data;
    const t = schema.tipoCambio;
    const existentes = await db.select().from(t)
      .where(or(...filas.map((f) => and(eq(t.fecha, f.fecha), eq(t.moneda, f.moneda))!)));
    const before = existentes.map((r) => ({ fecha: r.fecha, moneda: r.moneda, compra: Number(r.compra), venta: Number(r.venta) }));
    await db.insert(schema.tipoCambio)
      .values(filas.map((f) => ({ fecha: f.fecha, moneda: f.moneda, compra: String(f.compra), venta: String(f.venta), fuente: 'manual' })))
      .onConflictDoUpdate({
        target: [schema.tipoCambio.fecha, schema.tipoCambio.moneda],
        set: { compra: sqlExcluded('compra'), venta: sqlExcluded('venta'), fuente: 'manual', updatedAt: new Date() },
      });
    const fechas = filas.map((f) => f.fecha).sort();
    await audit(req, {
      action: 'update_tipo_cambio', entityType: 'tipo_cambio',
      before,
      after: { empresaId: req.empresaId, n: filas.length, desde: fechas[0], hasta: fechas[fechas.length - 1], filas },
      motivo: null,
    });
    res.json({ ok: true, n: filas.length });
  } catch (e) {
    next(e);
  }
});

export default router;
