import { db, schema } from '@erp/db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { clasificarHitos, type HitoItem } from '../lib/hitos.js';
import { audit } from '../lib/audit.js';

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

// Genera/actualiza la garantía de retención = Σ retención de las valorizaciones (evita sumar a mano).
router.post('/proyectos/:proyectoId/garantias/generar-retencion', async (req, res) => {
  const proyectoId = req.params.proyectoId!;
  const vals = await db.select({ ret: schema.valorizaciones.montoRetencion }).from(schema.valorizaciones).where(eq(schema.valorizaciones.proyectoId, proyectoId));
  const conRet = vals.filter((v) => Number(v.ret ?? 0) > 0);
  const total = conRet.reduce((s, v) => s + Number(v.ret ?? 0), 0);
  if (total <= 0) return res.status(400).json({ error: 'No hay retención acumulada en las valorizaciones' });
  const [existente] = await db.select().from(schema.garantias).where(and(eq(schema.garantias.proyectoId, proyectoId), eq(schema.garantias.tipo, 'retencion'))).limit(1);
  const notas = `Retención acumulada de ${conRet.length} valorización(es) · autogenerada`;
  let garantia;
  if (existente) {
    [garantia] = await db.update(schema.garantias).set({ monto: total.toFixed(2), notas }).where(eq(schema.garantias.id, existente.id)).returning();
  } else {
    [garantia] = await db.insert(schema.garantias).values({
      proyectoId, tipo: 'retencion', monto: total.toFixed(2), estado: 'vigente',
      liberaEnHito: 'consentimiento_liquidacion', notas,
    }).returning();
  }
  res.json({ garantia, total });
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
  const pid = req.params.proyectoId!;
  const [list, vals] = await Promise.all([
    db.select().from(schema.adelantos).where(eq(schema.adelantos.proyectoId, pid)).orderBy(asc(schema.adelantos.fechaSolicitud)),
    db.select({ am: schema.valorizaciones.montoAmortizaciones }).from(schema.valorizaciones).where(eq(schema.valorizaciones.proyectoId, pid)),
  ]);
  // Pendiente real desde valos (no confiar en montoAmortizado manual). MAX evita regresión/doble conteo.
  const totalAdelantos = list.reduce((s, a) => s + Number(a.monto ?? 0), 0);
  const amortizadoManual = list.reduce((s, a) => s + Number(a.montoAmortizado ?? 0), 0);
  const amortizadoValos = vals.reduce((s, v) => s + Number(v.am ?? 0), 0);
  const amortizadoReal = Math.max(amortizadoManual, amortizadoValos);
  res.json({ adelantos: list, resumen: { totalAdelantos, amortizadoManual, amortizadoValos, amortizadoReal, pendiente: Math.max(0, totalAdelantos - amortizadoReal) } });
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

// ════════════════════ LIQUIDACIÓN DE OBRA (Fase 1 · saldo + snapshot, sin asientos) ════════════════════
const num = (x: unknown) => Number(x ?? 0);

// Rollup del saldo final desde valos + conciliación con el libro (detecta retención sin segregar).
async function buildLiquidacion(proyectoId: string) {
  const [vals, adelantos, ledger, ledgerGar] = await Promise.all([
    db.select().from(schema.valorizaciones).where(eq(schema.valorizaciones.proyectoId, proyectoId)),
    db.select().from(schema.adelantos).where(eq(schema.adelantos.proyectoId, proyectoId)),
    db
      .select({ debe: sql<string>`COALESCE(SUM(${schema.asientosLineas.debe}),0)`, haber: sql<string>`COALESCE(SUM(${schema.asientosLineas.haber}),0)` })
      .from(schema.asientosLineas)
      .innerJoin(schema.asientos, eq(schema.asientosLineas.asientoId, schema.asientos.id))
      .where(and(eq(schema.asientos.proyectoId, proyectoId), sql`${schema.asientosLineas.cuenta} LIKE '1212%'`)),
    // F1.1 · saldo de la subcuenta de garantía (12122) · si >0, el motor ya segrega
    db
      .select({ debe: sql<string>`COALESCE(SUM(${schema.asientosLineas.debe}),0)`, haber: sql<string>`COALESCE(SUM(${schema.asientosLineas.haber}),0)` })
      .from(schema.asientosLineas)
      .innerJoin(schema.asientos, eq(schema.asientosLineas.asientoId, schema.asientos.id))
      .where(and(eq(schema.asientos.proyectoId, proyectoId), eq(schema.asientosLineas.cuenta, '12122'))),
  ]);

  // Base CAJA con-IGV consistente. montoTotalConIgv ya está NETO de deducciones+amortización (aguas arriba
  // en la cadena de la valo), así que NO se restan de nuevo. reajustes/deducciones/multas/amortización/retención
  // son informativos del desglose; el saldo real por cobrar = facturado c/IGV − cobrado.
  const round = (n: number) => Number(n.toFixed(2));
  const facturadoConIgv = vals.reduce((s, v) => s + (num(v.montoTotalConIgv) || num(v.montoValorizacionBruta) * 1.18 || num(v.totalContratista)), 0);
  const valorizadoSinIgv = vals.reduce((s, v) => s + (num(v.montoValorizacionBruta) || num(v.montoCd)), 0);
  const reajustes = vals.reduce((s, v) => s + num(v.montoReajuste), 0);
  const deducciones = vals.reduce((s, v) => s + num(v.montoDeducciones), 0);
  const multas = vals.reduce((s, v) => s + num(v.multa), 0);
  const amortizValos = vals.reduce((s, v) => s + num(v.montoAmortizaciones), 0);
  const amortizManual = adelantos.reduce((s, a) => s + num(a.montoAmortizado), 0);
  const amortizAdelantos = Math.max(amortizValos, amortizManual); // rollup pre-fix (informativo)
  const retencionAcum = vals.reduce((s, v) => s + num(v.montoRetencion), 0); // pendiente de liberar
  const cobrado = vals.filter((v) => v.status === 'cobrada').reduce((s, v) => s + num(v.totalContratista), 0);

  // Saldo por cobrar (+) al contratista / por pagar (−) a la entidad. Incluye la retención pendiente.
  const saldoFinal = facturadoConIgv - cobrado;

  const saldo1212 = num(ledger[0]?.debe) - num(ledger[0]?.haber); // LIKE 1212% → incluye la 12122 (CxC total)
  const saldoGarantia = num(ledgerGar[0]?.debe) - num(ledgerGar[0]?.haber); // solo 12122
  const segrega = num(ledgerGar[0]?.debe) > 0;

  return {
    componentes: { facturadoConIgv: round(facturadoConIgv), valorizadoSinIgv: round(valorizadoSinIgv), reajustes: round(reajustes), deducciones: round(deducciones), multas: round(multas), amortizAdelantos: round(amortizAdelantos), retencionAcum: round(retencionAcum), cobrado: round(cobrado) },
    saldoFinal: round(saldoFinal),
    conciliacion: {
      valorizadoBrutoIgv: round(facturadoConIgv),
      saldo1212: round(saldo1212),
      retencionMezclada: segrega ? 0 : round(retencionAcum),
      saldoGarantia12122: round(saldoGarantia),
      porCobrarNeto: round(saldoFinal),
      motorSegregaRetencion: segrega,
      nota: segrega
        ? 'Retención segregada en la 12122 desde el devengo (F1.1). Asientos previos al fix mantienen la retención dentro de la 1212: regenerar el período si se necesita el desglose retroactivo.'
        : 'Sin líneas 12122 aún para esta obra: asientos generados antes del fix F1.1 (retención dentro de la 1212) o sin retención. Regenerar el período aplica la segregación.',
    },
    valos: vals.length,
    valosCobradas: vals.filter((v) => v.status === 'cobrada').length,
  };
}

// GET · liquidación vigente (si existe) + preview en vivo del cálculo/conciliación.
router.get('/proyectos/:proyectoId/liquidacion', async (req, res) => {
  const proyectoId = req.params.proyectoId!;
  const [actual] = await db.select().from(schema.liquidaciones).where(eq(schema.liquidaciones.proyectoId, proyectoId)).orderBy(desc(schema.liquidaciones.createdAt)).limit(1);
  const preview = await buildLiquidacion(proyectoId);
  res.json({ liquidacion: actual ?? null, preview });
});

// POST · practicar: congela snapshot + hash. Idempotente: bloquea si ya hay una practicada vigente.
router.post('/proyectos/:proyectoId/liquidacion/practicar', async (req, res) => {
  const proyectoId = req.params.proyectoId!;
  const fecha = typeof req.body?.fecha === 'string' && req.body.fecha ? req.body.fecha : new Date().toISOString().slice(0, 10);
  const [vigente] = await db.select().from(schema.liquidaciones).where(and(eq(schema.liquidaciones.proyectoId, proyectoId), eq(schema.liquidaciones.estado, 'practicada'))).limit(1);
  if (vigente) return res.status(409).json({ error: 'Ya existe una liquidación practicada. Reábrela primero para volver a practicar.' });
  const snapshot = await buildLiquidacion(proyectoId);
  const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const [liq] = await db.insert(schema.liquidaciones).values({
    proyectoId,
    fechaPractica: fecha,
    practicadaPorUserId: req.user!.id,
    estado: 'practicada',
    snapshot,
    saldoFinal: String(snapshot.saldoFinal),
    hash,
  }).returning();
  await audit(req, { action: 'create', entityType: 'liquidacion', entityId: liq!.id, after: { saldoFinal: snapshot.saldoFinal, valos: snapshot.valos } });
  res.json({ liquidacion: liq });
});

// POST · reabrir: auditado con motivo (patrón cierre H2).
router.post('/liquidaciones/:id/reabrir', async (req, res) => {
  const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
  if (!motivo) return res.status(400).json({ error: 'Indica el motivo de reapertura' });
  const [liq] = await db.update(schema.liquidaciones)
    .set({ estado: 'reabierta', motivoReapertura: motivo, reabiertaPorUserId: req.user!.id, reabiertaAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.liquidaciones.id, req.params.id!)).returning();
  if (!liq) return res.status(404).json({ error: 'Liquidación no encontrada' });
  await audit(req, { action: 'update', entityType: 'liquidacion', entityId: liq.id, after: { estado: 'reabierta', motivo } });
  res.json({ liquidacion: liq });
});

export default router;
