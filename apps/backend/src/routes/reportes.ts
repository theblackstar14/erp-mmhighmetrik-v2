/**
 * Reportes financieros · cada reporte devuelve { titulo, headers, data[][], footer? }.
 * Mismo shape sirve para pantalla (tabla genérica) y para Excel (.xlsx server-side).
 *   A2 cuentas-cobrar · A4 detracciones · A5 utilidad por proyecto
 * (A1 estado de obra y C1 export plantilla van aparte.)
 */
import { db, schema } from '@erp/db';
import { inArray } from 'drizzle-orm';
import { Router } from 'express';
import * as XLSX from 'xlsx';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

export type Reporte = {
  titulo: string;
  headers: string[];
  data: (string | number)[][];
  footer?: (string | number)[];
  nota?: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const diasDesde = (d: string) => Math.floor((Date.now() - new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000);
const bucket = (d: number) => (d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+');

async function proyMap() {
  const ps = await db.select({ id: schema.proyectos.id, codigo: schema.proyectos.codigo, nombre: schema.proyectos.nombre }).from(schema.proyectos);
  return new Map(ps.map((p) => [p.id, p]));
}

// A2 · Cuentas por cobrar (valos facturadas/emitidas sin cobrar · antigüedad)
async function repCuentasCobrar(): Promise<Reporte> {
  const pm = await proyMap();
  const vals = await db.select().from(schema.valorizaciones);
  const rows = vals
    .filter((v) => !['cobrada', 'borrador', 'rechazada'].includes(v.status))
    .map((v) => {
      const p = pm.get(v.proyectoId);
      const dias = diasDesde(String(v.fechaEmision));
      return { proy: p ? `${p.codigo} · ${p.nombre}` : '—', num: `V${String(v.numero).padStart(2, '0')}`, per: v.mesPeriodo ?? '', fe: String(v.fechaEmision).slice(0, 10), dias, bk: bucket(dias), monto: r2(Number(v.montoTotal)) };
    })
    .sort((a, b) => b.dias - a.dias);
  const total = r2(rows.reduce((s, x) => s + x.monto, 0));
  return {
    titulo: 'Cuentas por cobrar',
    headers: ['Proyecto', 'Valorización', 'Periodo', 'Fecha emisión', 'Días', 'Antigüedad', 'Monto S/'],
    data: rows.map((x) => [x.proy, x.num, x.per, x.fe, x.dias, x.bk, x.monto]),
    footer: ['TOTAL', '', '', '', '', '', total],
    nota: 'Valorizaciones emitidas/facturadas aún no cobradas.',
  };
}

// A4 · Detracciones SUNAT (de movimientos con detracción · filtra periodo)
async function repDetracciones(anio?: string, mes?: string): Promise<Reporte> {
  const pm = await proyMap();
  const movs = await db.select().from(schema.movimientos);
  const mm = mes ? String(mes).padStart(2, '0') : null;
  const rows = movs
    .filter((m) => Number(m.detraccion ?? 0) > 0
      && (!anio || String(m.fecha).slice(0, 4) === anio)
      && (!mm || String(m.fecha).slice(5, 7) === mm))
    .map((m) => {
      const p = m.proyectoId ? pm.get(m.proyectoId) : null;
      return { fecha: String(m.fecha).slice(0, 10), cp: m.clienteNombre ?? '—', comp: [m.serie, m.numero].filter(Boolean).join('-') || '—', base: r2(Number(m.subtotal ?? 0)), det: r2(Number(m.detraccion ?? 0)), proy: p ? p.codigo : '—', desc: (m.descripcion ?? '').slice(0, 60) };
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const total = r2(rows.reduce((s, x) => s + x.det, 0));
  return {
    titulo: `Detracciones SUNAT${anio ? ` · ${mm ? `${mm}/` : ''}${anio}` : ''}`,
    headers: ['Fecha', 'Contraparte', 'Comprobante', 'Base S/', 'Detracción S/', 'Proyecto', 'Detalle'],
    data: rows.map((x) => [x.fecha, x.cp, x.comp, x.base, x.det, x.proy, x.desc]),
    footer: ['', '', 'TOTAL', '', total, '', ''],
    nota: 'Detracciones registradas en movimientos de cuenta.',
  };
}

// A5 · Utilidad por proyecto (ingresos=valos facturadas/cobradas − costos=gastos)
async function repUtilidad(anio?: string): Promise<Reporte> {
  const pm = await proyMap();
  const vals = await db.select().from(schema.valorizaciones).where(inArray(schema.valorizaciones.status, ['facturada', 'cobrada']));
  const gs = await db.select().from(schema.gastos);
  const ing = new Map<string, number>();
  const cos = new Map<string, number>();
  for (const v of vals) {
    if (anio && String(v.fechaEmision).slice(0, 4) !== anio) continue;
    ing.set(v.proyectoId, (ing.get(v.proyectoId) ?? 0) + Number(v.montoTotal));
  }
  for (const g of gs) {
    if (!g.proyectoId) continue;
    if (anio && String(g.fecha).slice(0, 4) !== anio) continue;
    cos.set(g.proyectoId, (cos.get(g.proyectoId) ?? 0) + Number(g.total));
  }
  const ids = new Set([...ing.keys(), ...cos.keys()]);
  const rows = [...ids].map((id) => {
    const p = pm.get(id);
    const i = r2(ing.get(id) ?? 0);
    const c = r2(cos.get(id) ?? 0);
    const u = r2(i - c);
    const m = i > 0 ? r2((u / i) * 100) : 0;
    return { proy: p ? `${p.codigo} · ${p.nombre}` : '—', i, c, u, m };
  }).sort((a, b) => b.i - a.i);
  const ti = r2(rows.reduce((s, x) => s + x.i, 0));
  const tc = r2(rows.reduce((s, x) => s + x.c, 0));
  const tu = r2(ti - tc);
  return {
    titulo: `Utilidad por proyecto${anio ? ` · ${anio}` : ''}`,
    headers: ['Proyecto', 'Ingresos S/', 'Costos S/', 'Utilidad S/', 'Margen %'],
    data: rows.map((x) => [x.proy, x.i, x.c, x.u, x.m]),
    footer: ['TOTAL', ti, tc, tu, ti > 0 ? r2((tu / ti) * 100) : 0],
    nota: 'Ingresos = valorizaciones facturadas/cobradas · Costos = gastos (Fact de Compras).',
  };
}

const REPORTES: Record<string, (anio?: string, mes?: string) => Promise<Reporte>> = {
  'cuentas-cobrar': () => repCuentasCobrar(),
  detracciones: (a, m) => repDetracciones(a, m),
  utilidad: (a) => repUtilidad(a),
};

// GET /reportes/:tipo · JSON para pantalla
router.get('/reportes/:tipo', async (req, res) => {
  const fn = REPORTES[String(req.params.tipo)];
  if (!fn) return res.status(404).json({ error: 'Reporte no encontrado' });
  try {
    const rep = await fn(req.query.anio as string | undefined, req.query.mes as string | undefined);
    res.json(rep);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /reportes/:tipo/xlsx · descarga Excel del mismo reporte
router.get('/reportes/:tipo/xlsx', async (req, res, next) => {
  if (req.params.tipo === 'plantilla') return next(); // lo maneja la ruta /reportes/plantilla/xlsx
  const fn = REPORTES[String(req.params.tipo)];
  if (!fn) return res.status(404).json({ error: 'Reporte no encontrado' });
  try {
    const rep = await fn(req.query.anio as string | undefined, req.query.mes as string | undefined);
    const aoa = [rep.headers, ...rep.data, ...(rep.footer ? [rep.footer] : [])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, rep.titulo.slice(0, 31));
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${String(req.params.tipo)}.xlsx"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ════════════════ C1 · Export modelo PLANTILLA MM ════════════════
// Réplica EXACTA de las hojas del Excel: fila1 = labels humanos · fila2 = códigos · fila3+ = datos.
// Solo Compras + Flujo Cuentas + Inventario (lo pedido).
const HDR_COMPRAS = {
  labels: ['ID de Registro', 'Fecha de Compra', 'Código de Proyecto Asociado', 'Nombre de Proyecto Asociado', 'Tipo de Registro de Compra', 'Tipo IGV', 'RUC de Proveedor', 'Razón Social de proveedor', 'Tipo de Comprobante', 'Serie del Comprobante', 'N° de Comprobante', 'Moneda', 'Forma de Pago', 'Fuente de Pago', 'Número de Cuenta Asociada', 'Descripción de Cuenta Asociada', 'Descripción del Item', 'Monto Subtotal', 'Monto IGV', 'Monto Exonerado', 'Monto Total', 'Tipo de Gasto', 'Observaciones'],
  codes: ['codregistro', 'fecgestion', 'codproyecto', 'desproyecto', 'tipregistrocompra', 'codordencompra', 'codproveedor', 'desproveedor', 'tipcomprobante', 'desseriecomprobante', 'numcomprobante', 'desmoneda', 'desformapago', 'desfuentepago', 'codcuentacomercial', 'desdescripcion', 'desitemdescripcion', 'mtosubtotal', 'mtoigv', 'mtoexonerado', 'mtototal', 'tipgasto', 'desobservaciones'],
};
const HDR_FLUJO = {
  labels: ['ID de Registro', 'Fecha de Movimiento', 'Código de Proyecto Asociado', 'Nombre de Proyecto Asociado', 'Tipo de Movimiento', 'Fuente de Pago', 'Número de Cuenta Asociada', 'Descripción de Cuenta Asociada', 'Fuente de Movimiento', 'Código de Cliente Asociado', 'Nombre de Cliente Asociado', 'Tipo de Comprobante', 'Serie del Comprobante', 'N° de Comprobante', 'Moneda', 'Monto Total de Movimiento', 'Descripción del Movimiento', 'N° operación'],
  codes: ['codmovimiento', 'fecmovimiento', 'codproyecto', 'desproyecto', 'tipmovimiento', 'desfuentepago', 'codcuentacomercial', 'desdescripcion', 'desfuenteingreso', 'codcliente', 'descliente', 'tipcomprobante', 'desseriecomprobante', 'numcomprobante', 'desmoneda', 'mtototal', 'desdescripcionmov', 'Columna1'],
};
const HDR_INV = {
  labels: ['ID de Registro', 'Fecha de Movimiento', 'RUC de Proveedor', 'Razón Social de proveedor', 'Tipo de Comprobante', 'Serie del Comprobante', 'N° de Comprobante', 'Cantidad de Items', 'Descripción del Item', 'Monto Total', 'Categoría', 'Estado', 'Código de Proyecto Asociado', 'Nombre de Proyecto Asociado', 'Responsable', 'Observación'],
  codes: ['coditem', 'fecmovimiento', 'codproveedor', 'desproveedor', 'tipcomprobante', 'desseriecomprobante', 'numcomprobante', 'numitem', 'desdescripcionitem', 'mtovalorunitario', 'tipcategoria', 'desestado', 'codproyecto', 'desproyecto', 'nbrresponsable', 'desobservacion'],
};

const d10 = (d: unknown) => (d ? String(d).slice(0, 10) : '');
const num = (n: unknown) => Number(n ?? 0);

router.get('/reportes/plantilla/xlsx', async (req, res) => {
  try {
    const anio = req.query.anio as string | undefined;
    const proyId = req.query.proyectoId as string | undefined;
    const enRango = (fecha: unknown, pid: string | null) =>
      (!anio || String(fecha).slice(0, 4) === anio) && (!proyId || pid === proyId);

    const pm = await proyMap();
    const cuentas = await db.select().from(schema.cuentasBancarias);
    const cm = new Map(cuentas.map((c) => [c.id, c]));
    const clis = await db.select().from(schema.clientes);
    const clm = new Map(clis.map((c) => [c.id, c]));

    const gastos = await db.select().from(schema.gastos);
    const movs = await db.select().from(schema.movimientos);
    const items = await db.select().from(schema.inventarioItems);

    const wb = XLSX.utils.book_new();

    // Fact de Compras
    const comprasData = gastos.filter((g) => enRango(g.fecha, g.proyectoId)).map((g) => {
      const p = g.proyectoId ? pm.get(g.proyectoId) : null;
      const cta = g.cuentaId ? cm.get(g.cuentaId) : null;
      return [g.codigo ?? '', d10(g.fecha), p?.codigo ?? '', p?.nombre ?? '', g.tipoRegistro ?? '', g.tipoIgv ?? '', g.proveedorRuc ?? '', g.proveedorRazon ?? '', g.tipoComprobante ?? '', g.serie ?? '', g.numero ?? '', g.moneda ?? 'PEN', g.formaPago ?? '', g.fuentePago ?? '', cta?.codigo ?? '', cta?.descripcion ?? '', g.descripcionItem ?? '', num(g.subtotal), num(g.igv), num(g.exonerado), num(g.total), g.tipoGasto ?? '', g.observaciones ?? ''];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HDR_COMPRAS.labels, HDR_COMPRAS.codes, ...comprasData]), 'Fact de Compras');

    // Fact de Flujo Cuentas
    const flujoData = movs.filter((m) => enRango(m.fecha, m.proyectoId)).map((m) => {
      const p = m.proyectoId ? pm.get(m.proyectoId) : null;
      const cta = m.cuentaId ? cm.get(m.cuentaId) : null;
      const cli = m.clienteId ? clm.get(m.clienteId) : null;
      const monto = m.tipoMovimiento === 'Egreso' ? -num(m.monto) : num(m.monto);
      return [m.codigo ?? '', d10(m.fecha), p?.codigo ?? '', p?.nombre ?? '', m.tipoMovimiento ?? '', m.fuentePago ?? '', cta?.codigo ?? '', cta?.descripcion ?? '', m.fuenteMovimiento ?? '', cli?.ruc ?? '', m.clienteNombre ?? cli?.razonSocial ?? '', m.tipoComprobante ?? '', m.serie ?? '', m.numero ?? '', m.moneda ?? 'PEN', monto, m.descripcion ?? '', m.numOperacion ?? ''];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HDR_FLUJO.labels, HDR_FLUJO.codes, ...flujoData]), 'Fact de Flujo Cuentas');

    // Fact de Inventario
    const invData = items.filter((it) => enRango(it.fecha, it.proyectoId)).map((it) => {
      const p = it.proyectoId ? pm.get(it.proyectoId) : null;
      return [it.codigo ?? '', d10(it.fecha), it.proveedorRuc ?? '', it.proveedorRazon ?? '', it.tipoComprobante ?? '', it.serie ?? '', it.numero ?? '', num(it.cantidad), it.descripcionItem ?? '', num(it.valorUnitario), it.categoria ?? '', it.estado ?? '', p?.codigo ?? '', p?.nombre ?? '', it.responsable ?? '', it.observacion ?? ''];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HDR_INV.labels, HDR_INV.codes, ...invData]), 'Fact de Inventario');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="PLANTILLA_MM${anio ? `_${anio}` : ''}.xlsx"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
