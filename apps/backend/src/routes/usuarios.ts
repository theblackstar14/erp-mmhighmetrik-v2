/** Usuarios · listado para asignar responsables de obra (residente/gerente). */
import { db, schema } from '@erp/db';
import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/usuarios', async (_req, res) => {
  const users = await db
    .select({ id: schema.users.id, nombres: schema.users.nombres, apellidos: schema.users.apellidos, role: schema.users.role, activo: schema.users.activo })
    .from(schema.users)
    .where(eq(schema.users.activo, true))
    .orderBy(asc(schema.users.nombres));
  res.json({ usuarios: users.map((u) => ({ ...u, nombre: `${u.nombres} ${u.apellidos}`.trim() })) });
});

export default router;
