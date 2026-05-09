import { db, schema } from '@erp/db';
import { proyectoCreateSchema } from '@erp/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
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
    const partidasData = tasksToPartidas(parsed, req.params.id!);

    // Limpiar partidas previas + insertar nuevas (transaction)
    await db.transaction(async (tx) => {
      await tx.delete(schema.partidas).where(eq(schema.partidas.proyectoId, req.params.id!));
      if (partidasData.length > 0) {
        // Insert por chunks de 500 para evitar query gigante
        for (let i = 0; i < partidasData.length; i += 500) {
          const chunk = partidasData.slice(i, i + 500);
          await tx.insert(schema.partidas).values(chunk);
        }
      }
      // Actualiza proyecto con costoDirecto + fechas si vinieron
      await tx
        .update(schema.proyectos)
        .set({
          costoDirecto: parsed.totalCost.toFixed(2),
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
        partidasInsertadas: partidasData.length,
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

export default router;
