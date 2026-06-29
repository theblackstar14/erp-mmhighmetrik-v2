/** Profesionales · padrón de staff técnico (sin login). Pool del Equipo profesional de obras. */
import { db, schema } from '@erp/db';
import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const profSchema = z.object({
  nombre: z.string().min(1).max(160),
  profesion: z.string().max(120).optional().nullable(),
  colegiatura: z.string().max(40).optional().nullable(),
  dni: z.string().max(12).optional().nullable(),
  telefono: z.string().max(30).optional().nullable(),
  email: z.string().max(255).optional().nullable(),
  cargoDefault: z.string().max(100).optional().nullable(),
});

router.get('/profesionales', async (_req, res) => {
  const list = await db.select().from(schema.profesionales).where(eq(schema.profesionales.activo, true)).orderBy(asc(schema.profesionales.nombre));
  res.json({ profesionales: list });
});

router.post('/profesionales', async (req, res) => {
  const p = profSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const [row] = await db.insert(schema.profesionales).values(p.data).returning();
  res.json({ profesional: row });
});

router.patch('/profesionales/:id', async (req, res) => {
  const p = profSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const [row] = await db.update(schema.profesionales).set(p.data).where(eq(schema.profesionales.id, String(req.params.id))).returning();
  if (!row) return res.status(404).json({ error: 'Profesional no encontrado' });
  res.json({ profesional: row });
});

// Soft-delete · no rompe equipos ya asignados; solo lo saca del padrón activo
router.delete('/profesionales/:id', async (req, res) => {
  await db.update(schema.profesionales).set({ activo: false }).where(eq(schema.profesionales.id, String(req.params.id)));
  res.json({ ok: true });
});

export default router;
