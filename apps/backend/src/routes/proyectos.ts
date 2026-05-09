import { db, schema } from '@erp/db';
import { proyectoCreateSchema } from '@erp/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { parseMSProjectXML, tasksToPartidas } from '../lib/mppParser.js';
import { convertMppToXml } from '../lib/mppToXml.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max XML
});

// GET /api/proyectos · lista
router.get('/', async (req, res) => {
  const list = await db
    .select()
    .from(schema.proyectos)
    .where(isNull(schema.proyectos.deletedAt))
    .orderBy(desc(schema.proyectos.createdAt));
  res.json({ proyectos: list });
});

// GET /api/proyectos/:id
router.get('/:id', async (req, res) => {
  const [proyecto] = await db
    .select()
    .from(schema.proyectos)
    .where(and(eq(schema.proyectos.id, req.params.id), isNull(schema.proyectos.deletedAt)))
    .limit(1);
  if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json({ proyecto });
});

// POST /api/proyectos · crear
router.post('/', async (req, res) => {
  const parse = proyectoCreateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  // Cálculo automático contractual
  const data = parse.data;
  const cd = data.costoDirecto ?? 0;
  const igvEnXml = data.igvEnXml ?? true;
  const pctGg = data.pctGg ?? 0.1;
  const pctUtilidad = data.pctUtilidad ?? 0.1;
  const cdSinIgv = igvEnXml ? cd / 1.18 : cd;
  const subtotal = cdSinIgv * (1 + pctGg + pctUtilidad);
  const igv = subtotal * 0.18;
  const contractual = subtotal + igv;

  const [proyecto] = await db
    .insert(schema.proyectos)
    .values({
      ...data,
      costoDirecto: cd.toString(),
      costoDirectoSinIgv: cdSinIgv.toString(),
      pctGg: pctGg.toString(),
      pctUtilidad: pctUtilidad.toString(),
      montoSubtotal: subtotal.toString(),
      montoIgv: igv.toString(),
      montoContractual: contractual.toFixed(2),
      lat: data.lat?.toString(),
      lng: data.lng?.toString(),
      pctAdelantoDirecto: data.pctAdelantoDirecto?.toString(),
      pctAdelantoMateriales: data.pctAdelantoMateriales?.toString(),
      pctFielCumplimiento: data.pctFielCumplimiento?.toString(),
      pctPenalidadDia: data.pctPenalidadDia?.toString(),
      pctPenalidadTope: data.pctPenalidadTope?.toString(),
      managerId: req.user!.id,
    })
    .returning();
  res.status(201).json({ proyecto });
});

// PATCH /api/proyectos/:id
router.patch('/:id', async (req, res) => {
  const parse = proyectoCreateSchema.partial().safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }
  const [proyecto] = await db
    .update(schema.proyectos)
    .set({ ...(parse.data as Record<string, unknown>), updatedAt: new Date() })
    .where(eq(schema.proyectos.id, req.params.id))
    .returning();
  if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json({ proyecto });
});

// DELETE /api/proyectos/:id · soft delete
router.delete('/:id', async (req, res) => {
  await db
    .update(schema.proyectos)
    .set({ deletedAt: new Date() })
    .where(eq(schema.proyectos.id, req.params.id));
  res.json({ ok: true });
});

// ─── Cronograma · upload + extract partidas ────────────────
// POST /api/proyectos/:id/cronograma · acepta .xml o .mpp
router.post('/:id/cronograma', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filename = req.file.originalname.toLowerCase();
    let xml: string;
    if (filename.endsWith('.mpp')) {
      // Convertir .mpp → .xml usando MPXJ Java
      xml = await convertMppToXml(req.file.buffer);
    } else if (filename.endsWith('.xml')) {
      xml = req.file.buffer.toString('utf8');
    } else {
      return res.status(400).json({ error: 'Solo .mpp o .xml son soportados' });
    }
    const parsed = parseMSProjectXML(xml);
    const tasksMpp = tasksToPartidas(parsed, req.params.id!);

    // Estrategia NO destructiva · UPDATE partidas existentes por nombre
    // (las partidas vienen del Excel S10 importado · NO sobrescribir códigos)
    const existing = await db
      .select()
      .from(schema.partidas)
      .where(eq(schema.partidas.proyectoId, req.params.id!));

    const normalize = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^\w\s.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const byName = new Map<string, typeof existing[number][]>();
    for (const p of existing) {
      const k = normalize(p.nombre);
      const arr = byName.get(k);
      if (arr) arr.push(p);
      else byName.set(k, [p]);
    }

    let matched = 0;
    let notMatched = 0;

    await db.transaction(async (tx) => {
      // Update fechas + duración por nombre match
      for (const t of tasksMpp) {
        const k = normalize(t.nombre);
        const candidatos = byName.get(k);
        const partida = candidatos?.length === 1 ? candidatos[0] : null;
        if (!partida) {
          notMatched++;
          continue;
        }
        matched++;
        await tx
          .update(schema.partidas)
          .set({
            fechaInicio: t.fechaInicio,
            fechaFin: t.fechaFin,
            duracionDias: t.duracionDias,
            isMilestone: t.isMilestone,
            isCritical: t.isCritical,
          })
          .where(eq(schema.partidas.id, partida.id));
      }

      // Update proyecto fechas · NO costoDirecto (sigue referencial del expediente)
      await tx
        .update(schema.proyectos)
        .set({
          fechaInicio: parsed.startDate ? parsed.startDate.toISOString().slice(0, 10) : undefined,
          fechaFin: parsed.finishDate ? parsed.finishDate.toISOString().slice(0, 10) : undefined,
          ganttFile: req.file!.originalname,
          updatedAt: new Date(),
        })
        .where(eq(schema.proyectos.id, req.params.id!));
    });

    res.json({
      ok: true,
      stats: {
        totalTasks: parsed.totalTasks,
        partidasMatched: matched,
        partidasNoMatched: notMatched,
        totalCost: parsed.totalCost,
        startDate: parsed.startDate,
        finishDate: parsed.finishDate,
      },
    });
  } catch (e) {
    console.error('Cronograma upload error:', e);
    res.status(500).json({ error: (e as Error).message ?? 'Error parseando XML' });
  }
});

// GET /api/proyectos/:id/partidas
router.get('/:id/partidas', async (req, res) => {
  const list = await db
    .select()
    .from(schema.partidas)
    .where(eq(schema.partidas.proyectoId, req.params.id!))
    .orderBy(asc(schema.partidas.orden));
  res.json({ partidas: list });
});

// GET /api/proyectos/:id/recursos · catálogo + cronograma adquisiciones
router.get('/:id/recursos', async (req, res) => {
  // Recursos del proyecto (todos · catálogo es global pero mostramos los del cronograma)
  const cronog = await db
    .select()
    .from(schema.cronogramaAdquisiciones)
    .where(eq(schema.cronogramaAdquisiciones.proyectoId, req.params.id!))
    .orderBy(asc(schema.cronogramaAdquisiciones.mesIndex));

  // Recursos únicos del cronograma
  const recursoIds = [...new Set(cronog.map((c) => c.recursoId).filter(Boolean) as string[])];
  if (recursoIds.length === 0) {
    return res.json({ recursos: [], cronograma: [], stats: null });
  }

  const recursosList = await db.select().from(schema.recursos);
  const recursosFiltered = recursosList.filter((r) => recursoIds.includes(r.id));

  // Stats
  const stats = {
    total: recursosFiltered.length,
    porTipo: {
      mano_obra: recursosFiltered.filter((r) => r.tipo === 'mano_obra').length,
      material: recursosFiltered.filter((r) => r.tipo === 'material').length,
      equipo: recursosFiltered.filter((r) => r.tipo === 'equipo').length,
      herramienta: recursosFiltered.filter((r) => r.tipo === 'herramienta').length,
      subcontrato: recursosFiltered.filter((r) => r.tipo === 'subcontrato').length,
    },
    montosPorTipo: {
      mano_obra: 0,
      material: 0,
      equipo: 0,
      herramienta: 0,
      subcontrato: 0,
    },
    montoPorMes: [0, 0, 0, 0],
    montoTotal: 0,
    iuClasificados: recursosFiltered.filter((r) => r.iuCodigo !== null).length,
  };

  const recursoTipoMap = new Map(recursosFiltered.map((r) => [r.id, r.tipo]));
  for (const c of cronog) {
    const tipo = recursoTipoMap.get(c.recursoId ?? '') ?? 'material';
    const monto = Number(c.monto ?? 0);
    stats.montosPorTipo[tipo as keyof typeof stats.montosPorTipo] += monto;
    const mIdx = (c.mesIndex ?? 1) - 1;
    if (stats.montoPorMes[mIdx] !== undefined) stats.montoPorMes[mIdx] += monto;
    stats.montoTotal += monto;
  }

  res.json({
    recursos: recursosFiltered,
    cronograma: cronog,
    stats,
  });
});

// GET /api/proyectos/:id/valorizaciones · cabeceras + reajustes + partidas resumen
router.get('/:id/valorizaciones', async (req, res) => {
  const proyectoId = req.params.id!;

  const cabeceras = await db
    .select()
    .from(schema.valorizaciones)
    .where(eq(schema.valorizaciones.proyectoId, proyectoId))
    .orderBy(asc(schema.valorizaciones.numero));

  if (cabeceras.length === 0) {
    return res.json({ valorizaciones: [], reajustes: [], stats: null });
  }

  const ids = cabeceras.map((v) => v.id);

  // Reajustes por valorización × FP
  const reajustesFiltered = await db
    .select()
    .from(schema.valorizacionesReajustes)
    .where(inArray(schema.valorizacionesReajustes.valorizacionId, ids));

  // Resumen partidas valorizadas
  const valpartFiltered = await db
    .select()
    .from(schema.valorizacionesPartidas)
    .where(inArray(schema.valorizacionesPartidas.valorizacionId, ids));

  const porSubp: Record<string, { monto: number; reajuste: number }> = {};
  for (const r of reajustesFiltered) {
    const k = r.subpresupuestoCodigo;
    if (!porSubp[k]) porSubp[k] = { monto: 0, reajuste: 0 };
    porSubp[k].monto += Number(r.montoSubpresupuesto);
    porSubp[k].reajuste += Number(r.montoReajuste);
  }

  // Stats
  const sumCd = cabeceras.reduce((s, v) => s + Number(v.montoCd), 0);
  const sumIgv = cabeceras.reduce((s, v) => s + Number(v.montoIgv), 0);
  const sumReajuste = cabeceras.reduce((s, v) => s + Number(v.montoReajuste ?? 0), 0);
  const sumTotal = cabeceras.reduce((s, v) => s + Number(v.montoTotal), 0);
  const ultima = cabeceras[cabeceras.length - 1];

  res.json({
    valorizaciones: cabeceras,
    reajustes: reajustesFiltered,
    partidasResumen: valpartFiltered.length,
    stats: {
      cantidad: cabeceras.length,
      sumCd,
      sumIgv,
      sumReajuste,
      sumTotal,
      pctAvanceUltima: ultima ? Number(ultima.pctAvance) : 0,
      kPromedio: ultima ? Number(ultima.factorReajusteK ?? 1) : 1,
      porSubpresupuesto: porSubp,
    },
  });
});

export default router;
