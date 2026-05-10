import { db, schema } from '@erp/db';
import { avanceCreateSchema } from '@erp/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { computeAvancesRollup } from '../lib/avancesRollup.js';
import { computeCurvaS } from '../lib/curvaS.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// POST /api/partidas/:partidaId/avances · registra nueva medición
router.post('/partidas/:partidaId/avances', async (req, res) => {
  try {
    const parse = avanceCreateSchema
      .omit({ partidaId: true })
      .safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: parse.error.flatten() });
    }

    // Validar que partida existe y es hoja
    const [partida] = await db
      .select()
      .from(schema.partidas)
      .where(eq(schema.partidas.id, req.params.partidaId!))
      .limit(1);
    if (!partida) return res.status(404).json({ error: 'Partida no encontrada' });

    // Insert avance
    const [avance] = await db
      .insert(schema.avances)
      .values({
        partidaId: req.params.partidaId!,
        avancePct: String(parse.data.avancePct),
        realCost: String(parse.data.realCost),
        nota: parse.data.nota ?? null,
        userId: req.user!.id,
      })
      .returning();

    return res.json({ avance });
  } catch (e) {
    console.error('createAvance error:', e);
    return res.status(500).json({ error: (e as Error).message });
  }
});

// GET /api/partidas/:partidaId/avances · histórico de una partida
router.get('/partidas/:partidaId/avances', async (req, res) => {
  const list = await db
    .select()
    .from(schema.avances)
    .where(eq(schema.avances.partidaId, req.params.partidaId!))
    .orderBy(desc(schema.avances.fecha));
  res.json({ avances: list });
});

// GET /api/proyectos/:id/avances · estado actual con rollup
router.get('/proyectos/:proyectoId/avances', async (req, res) => {
  const proyectoId = req.params.proyectoId!;

  // 1. Todas las partidas del proyecto
  const partidas = await db
    .select()
    .from(schema.partidas)
    .where(eq(schema.partidas.proyectoId, proyectoId));

  if (partidas.length === 0) {
    return res.json({ partidas: [], avances: {}, kpis: null });
  }

  // 2. Último avance por partida (DISTINCT ON)
  const partidaIds = partidas.map((p) => p.id);
  const latestAvances = await db.execute<typeof schema.avances.$inferSelect>(sql`
    SELECT DISTINCT ON (partida_id) *
    FROM ${schema.avances}
    WHERE partida_id IN (${sql.join(
      partidaIds.map((id) => sql`${id}::uuid`),
      sql`,`,
    )})
    ORDER BY partida_id, fecha DESC
  `);

  // 3. Compute rollup
  const avances = computeAvancesRollup(partidas, latestAvances as unknown as schema.Avance[]);

  // 4. KPIs proyecto
  const cap1 = partidas.filter((p) => p.nivel === 1);
  const totalCD = cap1.reduce((s, p) => s + Number(p.presupuesto), 0);
  const totalReal = cap1.reduce((s, p) => s + (avances[p.codigo]?.realCost ?? 0), 0);
  const earnedValue = cap1.reduce((s, p) => {
    const a = avances[p.codigo];
    return s + Number(p.presupuesto) * ((a?.avancePct ?? 0) / 100);
  }, 0);
  const avanceFisicoPct = totalCD > 0 ? (earnedValue / totalCD) * 100 : 0;
  const avanceFinancieroPct = totalCD > 0 ? (totalReal / totalCD) * 100 : 0;

  return res.json({
    partidas: partidas.map((p) => ({ id: p.id, codigo: p.codigo, presupuesto: p.presupuesto })),
    avances,
    kpis: {
      totalCD,
      totalReal,
      earnedValue,
      avanceFisicoPct,
      avanceFinancieroPct,
    },
  });
});

// GET /api/proyectos/:id/curva-s · datos para chart EVM
router.get('/proyectos/:proyectoId/curva-s', async (req, res) => {
  try {
    const proyectoId = req.params.proyectoId!;
    const partidas = await db
      .select()
      .from(schema.partidas)
      .where(eq(schema.partidas.proyectoId, proyectoId));
    if (partidas.length === 0) return res.json({ data: null });

    const partidaIds = partidas.map((p) => p.id);
    const allAvances =
      partidaIds.length > 0
        ? await db
            .select()
            .from(schema.avances)
            .where(inArray(schema.avances.partidaId, partidaIds))
        : [];

    // Valorizaciones · prioridad sobre avances histórico
    const valorizaciones = await db
      .select()
      .from(schema.valorizaciones)
      .where(eq(schema.valorizaciones.proyectoId, proyectoId));
    const valorizacionIds = valorizaciones.map((v) => v.id);
    const valpartidas =
      valorizacionIds.length > 0
        ? await db
            .select()
            .from(schema.valorizacionesPartidas)
            .where(inArray(schema.valorizacionesPartidas.valorizacionId, valorizacionIds))
        : [];

    const data = computeCurvaS(partidas, allAvances, valorizaciones, valpartidas);
    return res.json({ data });
  } catch (e) {
    console.error('curva-s error:', e);
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
