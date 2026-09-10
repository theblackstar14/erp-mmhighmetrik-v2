import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ─── Helper singleton ─────────────────────────────────────────
async function getConfig() {
  let [cfg] = await db.select().from(schema.configPlanilla).limit(1);
  if (!cfg) [cfg] = await db.insert(schema.configPlanilla).values({ id: 'singleton' }).returning();
  return cfg;
}

function cfgToDto(cfg: Awaited<ReturnType<typeof getConfig>>) {
  return {
    pctEssalud: Number(cfg.pctEsSalud),
    pctOnp: Number(cfg.pctOnp),
    pctAfpAporte: 0.10,
    rmv: Number(cfg.rmv),
    uit: Number(cfg.uit),
    topeSeguroAfp: Number(cfg.topeSeguroAfp),
    horasMesBase: Number(cfg.horasMesBase),
  };
}

// ─── GET /api/oficina/config-planilla ────────────────────────
router.get('/config-planilla', async (_req, res) => {
  const cfg = await getConfig();
  res.json(cfgToDto(cfg));
});

// ─── PUT /api/oficina/config-planilla ────────────────────────
router.put('/config-planilla', async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const allowed = ['rmv', 'uit', 'topeSeguroAfp', 'horasMesBase', 'pctEssalud', 'pctOnp'] as const;

  // Validate: every supplied field must be a finite number
  for (const key of allowed) {
    if (b[key] !== undefined && !Number.isFinite(Number(b[key]))) {
      return res.status(400).json({ error: `Campo '${key}' debe ser un número finito` });
    }
  }

  // Map to DB columns (decimal columns → String, integer → Number)
  const set: Record<string, string | number> = {};
  if (b.rmv !== undefined)           set.rmv           = String(Number(b.rmv));
  if (b.uit !== undefined)           set.uit           = String(Number(b.uit));
  if (b.topeSeguroAfp !== undefined) set.topeSeguroAfp = String(Number(b.topeSeguroAfp));
  if (b.horasMesBase !== undefined)  set.horasMesBase  = Number(b.horasMesBase);
  if (b.pctEssalud !== undefined)    set.pctEsSalud    = String(Number(b.pctEssalud));
  if (b.pctOnp !== undefined)        set.pctOnp        = String(Number(b.pctOnp));

  // Ensure singleton exists, then update
  await db.insert(schema.configPlanilla).values({ id: 'singleton' }).onConflictDoNothing();
  const [cfg] = await db
    .update(schema.configPlanilla)
    .set(set)
    .where(eq(schema.configPlanilla.id, 'singleton'))
    .returning();

  res.json(cfgToDto(cfg));
});

export default router;
