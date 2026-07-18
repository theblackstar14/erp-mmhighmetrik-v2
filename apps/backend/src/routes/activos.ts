/**
 * Activos · herramientas y equipos (NO consumibles).
 * Depreciación lineal SUNAT calculada al vuelo · trazabilidad de traslados.
 */
import { db, schema } from '@erp/db';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Depreciación lineal: años transcurridos (fracción) × % anual · tope 100%
function depreciar(a: { fechaAdquisicion: string; valorAdquisicion: string; pctDepreciacionAnual: string }) {
  const adq = Number(a.valorAdquisicion);
  const anios = Math.max(0, (Date.now() - new Date(a.fechaAdquisicion).getTime()) / (365.25 * 86400000));
  const pct = Number(a.pctDepreciacionAnual) / 100;
  const depAcum = Math.min(adq, adq * pct * anios);
  return {
    aniosUso: anios,
    depreciacionAcum: depAcum,
    valorNeto: adq - depAcum,
    pctDepreciado: adq > 0 ? depAcum / adq : 0,
  };
}

async function nextCodigoActivo(): Promise<string> {
  const rows = await db.select({ c: schema.activos.codigo }).from(schema.activos);
  const max = rows.reduce((m, r) => {
    const n = /^MM-A-(\d+)$/.exec(r.c);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `MM-A-${String(max + 1).padStart(4, '0')}`;
}

// GET /activos · lista + depreciación + stats
router.get('/activos', async (_req, res) => {
  const list = await db.select().from(schema.activos).orderBy(asc(schema.activos.codigo));
  // solo los proyectos referenciados (antes traía TODA la tabla proyectos)
  const proyIds = [...new Set(list.map((a) => a.proyectoId).filter(Boolean) as string[])];
  const proys = proyIds.length
    ? await db.select({ id: schema.proyectos.id, codigo: schema.proyectos.codigo, nombre: schema.proyectos.nombre, lat: schema.proyectos.lat, lng: schema.proyectos.lng }).from(schema.proyectos).where(inArray(schema.proyectos.id, proyIds))
    : [];
  const pm = new Map(proys.map((p) => [p.id, p]));
  const enriched = list.map((a) => ({
    ...a,
    ...depreciar(a),
    proyecto: a.proyectoId ? pm.get(a.proyectoId) ?? null : null,
  }));
  const operativos = enriched.filter((a) => a.estado === 'operativo');
  res.json({
    activos: enriched,
    stats: {
      total: enriched.length,
      operativos: operativos.length,
      enObra: operativos.filter((a) => a.proyectoId).length,
      valorAdquisicion: enriched.reduce((s, a) => s + Number(a.valorAdquisicion), 0),
      valorNeto: enriched.reduce((s, a) => s + a.valorNeto, 0),
      porCategoria: enriched.reduce((acc, a) => { acc[a.categoria] = (acc[a.categoria] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    },
  });
});

const activoSchema = z.object({
  nombre: z.string().min(2),
  categoria: z.string().min(2),
  marca: z.string().optional().nullable(),
  serie: z.string().optional().nullable(),
  fechaAdquisicion: z.string().min(10),
  valorAdquisicion: z.number().positive(),
  pctDepreciacionAnual: z.number().min(0).max(100).default(10),
  proyectoId: z.string().uuid().optional().nullable(),
  ubicacion: z.string().optional().nullable(),
  responsable: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
});

router.post('/activos', async (req, res) => {
  const parse = activoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  const codigo = await nextCodigoActivo();
  const [activo] = await db.insert(schema.activos).values({
    codigo,
    nombre: d.nombre,
    categoria: d.categoria,
    marca: d.marca ?? null,
    serie: d.serie ?? null,
    fechaAdquisicion: d.fechaAdquisicion,
    valorAdquisicion: d.valorAdquisicion.toFixed(2),
    pctDepreciacionAnual: d.pctDepreciacionAnual.toFixed(2),
    proyectoId: d.proyectoId ?? null,
    ubicacion: d.ubicacion ?? null,
    responsable: d.responsable ?? null,
    notas: d.notas ?? null,
  }).returning();
  res.status(201).json({ activo });
});

router.patch('/activos/:id', async (req, res) => {
  const parse = activoSchema.partial().extend({ estado: z.enum(['operativo', 'baja', 'perdido']).optional() }).safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    if (k === 'valorAdquisicion') set[k] = (v as number).toFixed(2);
    else if (k === 'pctDepreciacionAnual') set[k] = (v as number).toFixed(2);
    else set[k] = v;
  }
  const [activo] = await db.update(schema.activos).set(set).where(eq(schema.activos.id, String(req.params.id))).returning();
  if (!activo) return res.status(404).json({ error: 'Activo no encontrado' });
  res.json({ activo });
});

// POST /activos/:id/traslado · mueve y deja rastro
router.post('/activos/:id/traslado', async (req, res) => {
  const { proyectoId, ubicacion, responsable, notas, fecha } = req.body as Record<string, string | null>;
  const [a] = await db.select().from(schema.activos).where(eq(schema.activos.id, String(req.params.id)));
  if (!a) return res.status(404).json({ error: 'Activo no encontrado' });

  const nombreDe = async (pid: string | null, ubi: string | null) => {
    if (pid) {
      const [p] = await db.select({ codigo: schema.proyectos.codigo, nombre: schema.proyectos.nombre }).from(schema.proyectos).where(eq(schema.proyectos.id, pid));
      return p ? `Obra ${p.codigo} · ${p.nombre}` : 'Obra';
    }
    return ubi || 'Almacén / Oficina';
  };
  const [desde, hacia] = await Promise.all([nombreDe(a.proyectoId, a.ubicacion), nombreDe(proyectoId ?? null, ubicacion ?? null)]);

  await db.insert(schema.activoMovimientos).values({
    activoId: a.id,
    fecha: fecha || new Date().toISOString().slice(0, 10),
    desde,
    hacia,
    proyectoId: proyectoId ?? null,
    responsable: responsable ?? null,
    notas: notas ?? null,
  });
  const [activo] = await db.update(schema.activos).set({
    proyectoId: proyectoId ?? null,
    ubicacion: ubicacion ?? null,
    responsable: responsable ?? a.responsable,
    updatedAt: new Date(),
  }).where(eq(schema.activos.id, a.id)).returning();
  res.json({ activo });
});

// GET /activos-movimientos · log global de traslados (tab Movimientos)
router.get('/activos-movimientos', async (_req, res) => {
  const movs = await db
    .select({
      id: schema.activoMovimientos.id,
      fecha: schema.activoMovimientos.fecha,
      desde: schema.activoMovimientos.desde,
      hacia: schema.activoMovimientos.hacia,
      responsable: schema.activoMovimientos.responsable,
      notas: schema.activoMovimientos.notas,
      activoCodigo: schema.activos.codigo,
      activoNombre: schema.activos.nombre,
      categoria: schema.activos.categoria,
    })
    .from(schema.activoMovimientos)
    .innerJoin(schema.activos, eq(schema.activoMovimientos.activoId, schema.activos.id))
    .orderBy(desc(schema.activoMovimientos.fecha), desc(schema.activoMovimientos.createdAt));
  res.json({ movimientos: movs });
});

// GET /activos/:id/historial
router.get('/activos/:id/historial', async (req, res) => {
  const movs = await db.select().from(schema.activoMovimientos)
    .where(eq(schema.activoMovimientos.activoId, String(req.params.id)))
    .orderBy(desc(schema.activoMovimientos.fecha), desc(schema.activoMovimientos.createdAt));
  res.json({ movimientos: movs });
});

// POST /activos/promover/:itemId · FX-5 · convierte ítem de inventario en activo y los enlaza
router.post('/activos/promover/:itemId', async (req, res) => {
  const itemId = String(req.params.itemId);
  const [item] = await db.select().from(schema.inventarioItems).where(eq(schema.inventarioItems.id, itemId));
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });
  if (item.activoId) return res.status(409).json({ error: 'Ítem ya promovido a activo' });

  // overrides opcionales del modal; valor por defecto = total de la línea (cant × vu)
  const b = req.body as Record<string, string | number | null | undefined>;
  const valorDef = Number(item.cantidad) * Number(item.valorUnitario);
  const codigo = await nextCodigoActivo();
  const [activo] = await db.insert(schema.activos).values({
    codigo,
    nombre: String(b.nombre ?? item.descripcionItem ?? 'Activo').slice(0, 255),
    categoria: String(b.categoria ?? item.categoria ?? 'Equipo').slice(0, 40),
    marca: (b.marca as string) ?? null,
    serie: (b.serie as string) ?? null,
    fechaAdquisicion: (b.fechaAdquisicion as string) || item.fecha,
    valorAdquisicion: (b.valorAdquisicion != null ? Number(b.valorAdquisicion) : valorDef).toFixed(2),
    pctDepreciacionAnual: (b.pctDepreciacionAnual != null ? Number(b.pctDepreciacionAnual) : 10).toFixed(2),
    proyectoId: item.proyectoId,
    responsable: item.responsable,
    notas: `Promovido desde inventario ${item.codigo ?? itemId}${item.numero ? ` · comp. ${item.serie ?? ''}-${item.numero}` : ''}`,
  }).returning();
  if (!activo) return res.status(500).json({ error: 'No se pudo crear el activo' });

  await db.update(schema.inventarioItems)
    .set({ activoId: activo.id, estado: 'Activo' })
    .where(eq(schema.inventarioItems.id, itemId));
  res.status(201).json({ activo });
});

// POST /activos/scan · resolve por código (QR deep-link, barcode, pistola, manual).
// payload puede ser: URL deep-link (?codigo=MM-A-0001) o el código crudo.
router.post('/activos/scan', async (req, res) => {
  const raw = String((req.body as { payload?: unknown }).payload ?? '').trim();
  if (!raw) return res.status(400).json({ error: 'payload vacío' });
  // si vino una URL, extrae ?codigo=
  let codigo = raw;
  const m = /[?&]codigo=([^&]+)/i.exec(raw);
  if (m) codigo = decodeURIComponent(m[1]);
  codigo = codigo.toUpperCase();

  const [a] = await db.select().from(schema.activos).where(eq(schema.activos.codigo, codigo));
  if (!a) return res.status(404).json({ error: `No encontrado: ${raw}` });
  res.json({ activo: { ...a, ...depreciar(a) } });
});

router.delete('/activos/:id', async (req, res) => {
  await db.delete(schema.activos).where(eq(schema.activos.id, String(req.params.id)));
  res.json({ ok: true });
});

export default router;
