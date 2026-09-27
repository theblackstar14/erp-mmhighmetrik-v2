/**
 * Lectura de XML de comprobantes electrónicos → borrador (no escribe en BD).
 * Decide compra/venta con el RUC de la empresa activa y valida la detracción declarada.
 */
import { db, schema } from '@erp/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { requirePermiso } from '../lib/permisos.js';
import { CpeError, leerCpe, type CpeLeido } from '../lib/cpe/leerCpe.js';
import { calcularDetraccion, compararDetraccion } from '../lib/detraccionCalc.js';
import { buscarTipoCambio } from '../lib/tipoCambio.js';
import { buscarTasaDetraccion } from '../lib/detraccionTasa.js';

const router = Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

async function validarDetraccion(doc: CpeLeido) {
  if (!doc.detraccion) return null;
  const declarada = doc.detraccion;
  const tasa = await buscarTasaDetraccion(declarada.codigo, doc.fechaEmision);
  if (!tasa) return { declarada, error: `Código de detracción ${declarada.codigo} no vigente o sin % al ${doc.fechaEmision}` };
  let tipoCambio: number | null = null;
  if (doc.moneda !== 'PEN') {
    const tc = await buscarTipoCambio(doc.fechaEmision, doc.moneda);
    if (!tc) return { declarada, error: `Falta tipo de cambio ${doc.moneda} del ${doc.fechaEmision}` };
    // IGV/SPOT convierten moneda extranjera con el TC promedio ponderado venta (SBS) para ambas partes; a confirmar con Kelly.
    tipoCambio = tc.venta;
  }
  const calculada = calcularDetraccion({ total: doc.totales.total, moneda: doc.moneda, tipoCambio, tasa });
  return { declarada, calculada, ...compararDetraccion(calculada, declarada) };
}

router.post('/leer', requirePermiso('finanzas', 'lectura'), upload.single('file') as any, async (req, res, next) => {
  try {
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
    res.json({ rol, documento: doc, detraccion: await validarDetraccion(doc) });
  } catch (e) {
    next(e);
  }
});

// ─── F2.3 · Bandeja CPE · borradores persistidos ─────────────────
// factura → borrador de compra · boleta → gasto (no entra al RCE, regla Kelly) ·
// NC/ND → vincula al documento que modifica · venta → espera F3.1 · duplicados se rechazan.

const clasificar = (rol: 'compra' | 'venta', tipo: string): string => {
  if (rol === 'venta') return 'venta';
  if (tipo === '03') return 'boleta';
  if (tipo === '07') return 'nc';
  if (tipo === '08') return 'nd';
  return 'factura';
};

// POST /bandeja · varios XML de una vez · cada uno queda como borrador (o se reporta por qué no)
router.post('/bandeja', requirePermiso('finanzas', 'escritura'), upload.array('files', 50) as any, async (req, res, next) => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) return res.status(400).json({ error: 'Adjunta uno o más XML en el campo "files"' });
    const [empresa] = await db.select({ ruc: schema.empresas.ruc, razonSocial: schema.empresas.razonSocial }).from(schema.empresas).where(eq(schema.empresas.id, req.empresaId!)).limit(1);
    const resultados: { archivo: string; estado: string; clasificacion?: string; comprobante?: string; error?: string }[] = [];
    for (const f of files) {
      let doc: CpeLeido;
      try {
        doc = leerCpe(f.buffer);
      } catch (e) {
        resultados.push({ archivo: f.originalname, estado: 'rechazado', error: e instanceof CpeError ? e.message : 'XML ilegible' });
        continue;
      }
      const rol = doc.cliente.numero === empresa?.ruc ? 'compra' : doc.emisor.ruc === empresa?.ruc ? 'venta' : null;
      const comprobante = `${doc.serie}-${doc.numero}`;
      if (!rol) {
        resultados.push({ archivo: f.originalname, estado: 'rechazado', comprobante, error: `No es de ${empresa?.razonSocial ?? 'la empresa activa'} (emisor ${doc.emisor.ruc})` });
        continue;
      }
      // duplicado contra el registro de compras (mismo RUC + serie + número ya registrado)
      if (rol === 'compra' && doc.emisor.ruc && doc.serie && doc.numero) {
        const [ya] = await db.select({ id: schema.gastos.id }).from(schema.gastos)
          .where(and(eq(schema.gastos.proveedorRuc, doc.emisor.ruc), eq(schema.gastos.serie, doc.serie), eq(schema.gastos.numero, doc.numero))).limit(1);
        if (ya) {
          resultados.push({ archivo: f.originalname, estado: 'ya_registrada', comprobante });
          continue;
        }
      }
      const clasificacion = clasificar(rol, doc.tipo);
      const [row] = await db.insert(schema.cpeBandeja).values({
        empresaId: req.empresaId ?? 1,
        rol, clasificacion, tipoCpe: doc.tipo, serie: doc.serie, numero: doc.numero,
        emisorRuc: doc.emisor.ruc, emisorRazon: doc.emisor.razonSocial, clienteRuc: doc.cliente.numero,
        fechaEmision: doc.fechaEmision, moneda: doc.moneda, total: doc.totales.total.toFixed(2),
        payload: doc, detraccionInfo: await validarDetraccion(doc),
        nombreArchivo: f.originalname, hash: doc.hash, createdBy: req.user!.id,
      }).onConflictDoNothing({ target: schema.cpeBandeja.hash }).returning({ id: schema.cpeBandeja.id });
      resultados.push({ archivo: f.originalname, estado: row ? 'nuevo' : 'duplicado_xml', clasificacion, comprobante });
    }
    res.json({ resultados, resumen: { nuevos: resultados.filter((r) => r.estado === 'nuevo').length, rechazados: resultados.filter((r) => r.estado !== 'nuevo').length } });
  } catch (e) {
    next(e);
  }
});

// GET /bandeja?estado=pendiente&rol=compra
router.get('/bandeja', requirePermiso('finanzas', 'lectura'), async (req, res, next) => {
  try {
    const { estado, rol } = req.query as { estado?: string; rol?: string };
    const conds = [];
    conds.push(estado ? eq(schema.cpeBandeja.estado, estado) : inArray(schema.cpeBandeja.estado, ['pendiente']));
    if (rol === 'compra' || rol === 'venta') conds.push(eq(schema.cpeBandeja.rol, rol));
    const borradores = await db.select().from(schema.cpeBandeja).where(and(...conds)).orderBy(desc(schema.cpeBandeja.createdAt)).limit(200);
    res.json({ borradores });
  } catch (e) {
    next(e);
  }
});

// POST /bandeja/:id/descartar {motivo}
router.post('/bandeja/:id/descartar', requirePermiso('finanzas', 'escritura'), async (req, res, next) => {
  try {
    const motivo = String((req.body as { motivo?: unknown })?.motivo ?? '').trim() || 'descartado manual';
    const [row] = await db.update(schema.cpeBandeja).set({ estado: 'descartado', motivo, updatedAt: new Date() })
      .where(and(eq(schema.cpeBandeja.id, req.params.id!), eq(schema.cpeBandeja.estado, 'pendiente'))).returning();
    if (!row) return res.status(404).json({ error: 'Borrador no encontrado o ya procesado' });
    res.json({ borrador: row });
  } catch (e) {
    next(e);
  }
});

// POST /bandeja/:id/registrado {gastoId} · el alta real la hace POST /gastos (frontend arma el payload
// desde el borrador); aquí solo se marca el borrador como registrado y se vincula.
router.post('/bandeja/:id/registrado', requirePermiso('finanzas', 'escritura'), async (req, res, next) => {
  try {
    const { gastoId } = req.body as { gastoId?: string };
    if (!gastoId) return res.status(400).json({ error: 'gastoId requerido' });
    const [row] = await db.update(schema.cpeBandeja).set({ estado: 'registrado', gastoId, updatedAt: new Date() })
      .where(and(eq(schema.cpeBandeja.id, req.params.id!), eq(schema.cpeBandeja.estado, 'pendiente'))).returning();
    if (!row) return res.status(404).json({ error: 'Borrador no encontrado o ya procesado' });
    res.json({ borrador: row });
  } catch (e) {
    next(e);
  }
});

export default router;
