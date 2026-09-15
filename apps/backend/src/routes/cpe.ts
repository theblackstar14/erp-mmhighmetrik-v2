/**
 * Lectura de XML de comprobantes electrónicos → borrador (no escribe en BD).
 * Decide compra/venta con el RUC de la empresa activa y valida la detracción declarada.
 */
import { db, schema } from '@erp/db';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { requirePermiso } from '../lib/permisos.js';
import { CpeError, leerCpe, type CpeLeido } from '../lib/cpe/leerCpe.js';
import { calcularDetraccion, compararDetraccion } from '../lib/detraccionCalc.js';
import { buscarTipoCambio } from '../lib/tipoCambio.js';

const router = Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

async function validarDetraccion(doc: CpeLeido, rol: 'compra' | 'venta') {
  if (!doc.detraccion) return null;
  const declarada = doc.detraccion;
  const t = schema.detraccionTasa;
  const [tasa] = await db.select().from(t)
    .where(and(eq(t.codigo, declarada.codigo), lte(t.vigenciaDesde, doc.fechaEmision), or(isNull(t.vigenciaHasta), gte(t.vigenciaHasta, doc.fechaEmision))))
    .limit(1);
  if (!tasa || tasa.porcentaje == null) return { declarada, error: `Código de detracción ${declarada.codigo} no vigente o sin % al ${doc.fechaEmision}` };
  let tipoCambio: number | null = null;
  if (doc.moneda !== 'PEN') {
    const tc = await buscarTipoCambio(doc.fechaEmision, doc.moneda);
    if (!tc) return { declarada, error: `Falta tipo de cambio ${doc.moneda} del ${doc.fechaEmision}` };
    tipoCambio = rol === 'compra' ? tc.venta : tc.compra;
  }
  const calculada = calcularDetraccion({ total: doc.totales.total, moneda: doc.moneda, tipoCambio, tasa: { codigo: tasa.codigo, porcentaje: Number(tasa.porcentaje), montoMinimo: Number(tasa.montoMinimo) } });
  return { declarada, calculada, ...compararDetraccion(calculada, declarada) };
}

router.post('/leer', requirePermiso('finanzas', 'lectura'), upload.single('file') as any, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Adjunta el XML en el campo "file"' });
  let doc: CpeLeido;
  try {
    doc = leerCpe(req.file.buffer);
  } catch (e) {
    if (e instanceof CpeError) return res.status(422).json({ code: e.code, error: e.message });
    throw e;
  }
  const [empresa] = await db.select({ ruc: schema.empresas.ruc, razonSocial: schema.empresas.razonSocial }).from(schema.empresas).where(eq(schema.empresas.id, req.empresaId!)).limit(1);
  const rol = doc.cliente.numero === empresa?.ruc ? 'compra' : doc.emisor.ruc === empresa?.ruc ? 'venta' : null;
  if (!rol) {
    return res.status(422).json({ code: 'EMPRESA_AJENA', error: `El comprobante no es de ${empresa?.razonSocial ?? 'la empresa activa'} (emisor ${doc.emisor.ruc}, cliente ${doc.cliente.numero ?? '?'})` });
  }
  res.json({ rol, documento: doc, detraccion: await validarDetraccion(doc, rol) });
});

export default router;
