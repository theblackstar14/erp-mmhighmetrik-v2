import { db, schema } from '@erp/db';
import { and, asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { clasificarHitos, type HitoItem } from '../lib/hitos.js';

const router = Router();
router.use(requireAuth);

const dec = (n?: number | null) => (n == null ? undefined : n.toString());

// ─── Enums (mirror schema) ───────────────────────────────────
const hitoTipo = z.enum([
  'entrega_terreno',
  'inicio_plazo',
  'ampliacion_plazo',
  'culminacion',
  'recepcion',
  'liquidacion',
  'consentimiento_liquidacion',
]);
const garantiaTipo = z.enum([
  'fiel_cumplimiento',
  'adelanto_directo',
  'adelanto_materiales',
  'adelanto_avance',
  'retencion',
  'beneficios_sociales',
]);
const adelantoEstado = z.enum(['solicitado', 'aprobado', 'pagado', 'amortizado', 'rechazado']);

// ════════════════════ HITOS ════════════════════
const hitoSchema = z.object({
  tipo: hitoTipo,
  fecha: z.string().min(1),
  numeroDocumento: z.string().max(120).optional().nullable(),
  adjuntoNas: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
});

router.get('/proyectos/:proyectoId/hitos', async (req, res) => {
  const list = await db
    .select()
    .from(schema.hitosObra)
    .where(eq(schema.hitosObra.proyectoId, req.params.proyectoId!))
    .orderBy(asc(schema.hitosObra.fecha));
  res.json({ hitos: list });
});

// Sugerencias de hitos detectadas en el cronograma (partidas) · determinista, en vivo
router.get('/proyectos/:proyectoId/hitos-sugeridos', async (req, res) => {
  const pid = req.params.proyectoId!;
  const [proy] = await db
    .select({ fechaInicio: schema.proyectos.fechaInicio, fechaFin: schema.proyectos.fechaFin })
    .from(schema.proyectos)
    .where(eq(schema.proyectos.id, pid))
    .limit(1);
  const parts = await db
    .select({ nombre: schema.partidas.nombre, isMilestone: schema.partidas.isMilestone, inicio: schema.partidas.fechaInicio, fin: schema.partidas.fechaFin })
    .from(schema.partidas)
    .where(eq(schema.partidas.proyectoId, pid));
  const items: HitoItem[] = parts.map((p) => ({ nombre: p.nombre, isMilestone: !!p.isMilestone, inicio: p.inicio, fin: p.fin }));
  const sugeridos = clasificarHitos(items, proy?.fechaInicio ?? null, proy?.fechaFin ?? null);
  res.json({ sugeridos });
});

router.post('/proyectos/:proyectoId/hitos', async (req, res) => {
  const parse = hitoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const [hito] = await db
    .insert(schema.hitosObra)
    .values({
      proyectoId: req.params.proyectoId!,
      tipo: parse.data.tipo,
      fecha: parse.data.fecha,
      numeroDocumento: parse.data.numeroDocumento ?? null,
      adjuntoNas: parse.data.adjuntoNas ?? null,
      notas: parse.data.notas ?? null,
    })
    .returning();
  res.json({ hito });
});

router.put('/hitos/:id', async (req, res) => {
  const parse = hitoSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const [hito] = await db
    .update(schema.hitosObra)
    .set({
      ...(parse.data.tipo !== undefined && { tipo: parse.data.tipo }),
      ...(parse.data.fecha !== undefined && { fecha: parse.data.fecha }),
      ...(parse.data.numeroDocumento !== undefined && { numeroDocumento: parse.data.numeroDocumento }),
      ...(parse.data.adjuntoNas !== undefined && { adjuntoNas: parse.data.adjuntoNas }),
      ...(parse.data.notas !== undefined && { notas: parse.data.notas }),
    })
    .where(eq(schema.hitosObra.id, req.params.id!))
    .returning();
  if (!hito) return res.status(404).json({ error: 'Hito no encontrado' });
  res.json({ hito });
});

router.delete('/hitos/:id', async (req, res) => {
  await db.delete(schema.hitosObra).where(eq(schema.hitosObra.id, req.params.id!));
  res.json({ ok: true });
});

// ════════════════════ GARANTÍAS ════════════════════
const garantiaSchema = z.object({
  tipo: garantiaTipo,
  numeroCarta: z.string().max(80).optional().nullable(),
  monto: z.number().nonnegative(),
  bancoEmisor: z.string().max(100).optional().nullable(),
  fechaEmision: z.string().optional().nullable(),
  vigenciaDesde: z.string().optional().nullable(),
  vigenciaHasta: z.string().optional().nullable(),
  estado: z.enum(['vigente', 'ejecutada', 'devuelta']).optional(),
  liberaEnHito: hitoTipo.optional().nullable(),
  adjuntoNas: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
});

router.get('/proyectos/:proyectoId/garantias', async (req, res) => {
  const list = await db
    .select()
    .from(schema.garantias)
    .where(eq(schema.garantias.proyectoId, req.params.proyectoId!))
    .orderBy(asc(schema.garantias.vigenciaHasta));
  res.json({ garantias: list });
});

router.post('/proyectos/:proyectoId/garantias', async (req, res) => {
  const parse = garantiaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  const [garantia] = await db
    .insert(schema.garantias)
    .values({
      proyectoId: req.params.proyectoId!,
      tipo: d.tipo,
      numeroCarta: d.numeroCarta ?? null,
      monto: d.monto.toString(),
      bancoEmisor: d.bancoEmisor ?? null,
      fechaEmision: d.fechaEmision ?? null,
      vigenciaDesde: d.vigenciaDesde ?? null,
      vigenciaHasta: d.vigenciaHasta ?? null,
      estado: d.estado ?? 'vigente',
      liberaEnHito: d.liberaEnHito ?? null,
      adjuntoNas: d.adjuntoNas ?? null,
      notas: d.notas ?? null,
    })
    .returning();
  res.json({ garantia });
});

router.put('/garantias/:id', async (req, res) => {
  const parse = garantiaSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  const [garantia] = await db
    .update(schema.garantias)
    .set({
      ...(d.tipo !== undefined && { tipo: d.tipo }),
      ...(d.numeroCarta !== undefined && { numeroCarta: d.numeroCarta }),
      ...(d.monto !== undefined && { monto: d.monto.toString() }),
      ...(d.bancoEmisor !== undefined && { bancoEmisor: d.bancoEmisor }),
      ...(d.fechaEmision !== undefined && { fechaEmision: d.fechaEmision }),
      ...(d.vigenciaDesde !== undefined && { vigenciaDesde: d.vigenciaDesde }),
      ...(d.vigenciaHasta !== undefined && { vigenciaHasta: d.vigenciaHasta }),
      ...(d.estado !== undefined && { estado: d.estado }),
      ...(d.liberaEnHito !== undefined && { liberaEnHito: d.liberaEnHito }),
      ...(d.adjuntoNas !== undefined && { adjuntoNas: d.adjuntoNas }),
      ...(d.notas !== undefined && { notas: d.notas }),
    })
    .where(eq(schema.garantias.id, req.params.id!))
    .returning();
  if (!garantia) return res.status(404).json({ error: 'Garantía no encontrada' });
  res.json({ garantia });
});

router.delete('/garantias/:id', async (req, res) => {
  await db.delete(schema.garantias).where(eq(schema.garantias.id, req.params.id!));
  res.json({ ok: true });
});

// ════════════════════ ADELANTOS ════════════════════
const adelantoSchema = z.object({
  tipo: garantiaTipo, // reusa enum (adelanto_directo/materiales/avance)
  monto: z.number().nonnegative(),
  pctMontoContrato: z.number().optional().nullable(),
  fechaSolicitud: z.string().optional().nullable(),
  fechaPago: z.string().optional().nullable(),
  estado: adelantoEstado.optional(),
  montoAmortizado: z.number().optional().nullable(),
  notas: z.string().optional().nullable(),
});

router.get('/proyectos/:proyectoId/adelantos', async (req, res) => {
  const list = await db
    .select()
    .from(schema.adelantos)
    .where(eq(schema.adelantos.proyectoId, req.params.proyectoId!))
    .orderBy(asc(schema.adelantos.fechaSolicitud));
  res.json({ adelantos: list });
});

router.post('/proyectos/:proyectoId/adelantos', async (req, res) => {
  const parse = adelantoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  const [adelanto] = await db
    .insert(schema.adelantos)
    .values({
      proyectoId: req.params.proyectoId!,
      tipo: d.tipo,
      monto: d.monto.toString(),
      pctMontoContrato: dec(d.pctMontoContrato) ?? null,
      fechaSolicitud: d.fechaSolicitud ?? null,
      fechaPago: d.fechaPago ?? null,
      estado: d.estado ?? 'solicitado',
      montoAmortizado: dec(d.montoAmortizado) ?? '0',
      notas: d.notas ?? null,
    })
    .returning();
  res.json({ adelanto });
});

router.put('/adelantos/:id', async (req, res) => {
  const parse = adelantoSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const d = parse.data;
  const [adelanto] = await db
    .update(schema.adelantos)
    .set({
      ...(d.tipo !== undefined && { tipo: d.tipo }),
      ...(d.monto !== undefined && { monto: d.monto.toString() }),
      ...(d.pctMontoContrato !== undefined && { pctMontoContrato: dec(d.pctMontoContrato) ?? null }),
      ...(d.fechaSolicitud !== undefined && { fechaSolicitud: d.fechaSolicitud }),
      ...(d.fechaPago !== undefined && { fechaPago: d.fechaPago }),
      ...(d.estado !== undefined && { estado: d.estado }),
      ...(d.montoAmortizado !== undefined && { montoAmortizado: dec(d.montoAmortizado) ?? '0' }),
      ...(d.notas !== undefined && { notas: d.notas }),
    })
    .where(eq(schema.adelantos.id, req.params.id!))
    .returning();
  if (!adelanto) return res.status(404).json({ error: 'Adelanto no encontrado' });
  res.json({ adelanto });
});

router.delete('/adelantos/:id', async (req, res) => {
  await db.delete(schema.adelantos).where(eq(schema.adelantos.id, req.params.id!));
  res.json({ ok: true });
});

export default router;
