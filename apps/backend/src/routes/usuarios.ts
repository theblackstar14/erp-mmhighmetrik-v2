/** Usuarios · listado (responsables) + administración (alta/edición/baja/reset · solo admin). */
import { db, schema } from '@erp/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { genTempPassword, hashPassword } from '../lib/password.js';
import { requireAdmin } from '../lib/permisos.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// memberships agrupadas por usuario (1 query, sin N+1)
async function membresiasPorUsuario(userIds: string[]) {
  if (!userIds.length) return new Map<string, { empresaId: number; empresaNombre: string | null; roleId: string; rol: string }[]>();
  const rows = await db
    .select({
      userId: schema.usuarioEmpresa.userId,
      empresaId: schema.usuarioEmpresa.empresaId,
      empresaNombre: schema.empresas.nombreCorto,
      roleId: schema.usuarioEmpresa.roleId,
      rol: schema.roles.nombre,
    })
    .from(schema.usuarioEmpresa)
    .innerJoin(schema.empresas, eq(schema.empresas.id, schema.usuarioEmpresa.empresaId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.usuarioEmpresa.roleId))
    .where(inArray(schema.usuarioEmpresa.userId, userIds));
  const map = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = map.get(r.userId) ?? [];
    arr.push(r);
    map.set(r.userId, arr);
  }
  return map;
}

// GET /usuarios · lista (responsables usan id+nombre · admin usa el resto). ?todos=1 incluye inactivos.
router.get('/usuarios', async (req, res) => {
  const incluirInactivos = req.query.todos === '1';
  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      nombres: schema.users.nombres,
      apellidos: schema.users.apellidos,
      telefono: schema.users.telefono,
      role: schema.users.role,
      activo: schema.users.activo,
      lastLogin: schema.users.lastLogin,
    })
    .from(schema.users)
    .orderBy(asc(schema.users.nombres));
  const filtrados = incluirInactivos ? users : users.filter((u) => u.activo);
  const ms = await membresiasPorUsuario(filtrados.map((u) => u.id));
  res.json({
    usuarios: filtrados.map((u) => ({
      ...u,
      nombre: `${u.nombres} ${u.apellidos}`.trim(),
      empresas: ms.get(u.id) ?? [],
    })),
  });
});

const membresiaSchema = z.object({ empresaId: z.number().int(), roleId: z.string().uuid() });
const crearSchema = z.object({
  email: z.string().email(),
  nombres: z.string().min(1),
  apellidos: z.string().min(1),
  telefono: z.string().optional(),
  password: z.string().min(8).optional(), // si falta → clave temporal generada
  empresas: z.array(membresiaSchema).min(1),
});

// POST /usuarios · alta (admin). Clave temporal + must_change_password si no se envía password.
router.post('/usuarios', requireAdmin(), async (req, res) => {
  const parse = crearSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Datos incompletos', detalle: parse.error.flatten() });
  const { email, nombres, apellidos, telefono, empresas, password } = parse.data;

  const tempPassword = password ?? genTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  try {
    const userId = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(schema.users)
        .values({ email, passwordHash, nombres, apellidos, telefono, mustChangePassword: true })
        .returning({ id: schema.users.id });
      await tx.insert(schema.usuarioEmpresa).values(empresas.map((e) => ({ userId: u.id, empresaId: e.empresaId, roleId: e.roleId })));
      return u.id;
    });
    await audit(req, { action: 'user_create', entityType: 'user', entityId: userId, after: { email, empresas } });
    // Devuelve la clave temporal SOLO si la generamos (para que el admin la entregue).
    return res.json({ ok: true, userId, tempPassword: password ? undefined : tempPassword });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('unique') || msg.includes('duplicate')) return res.status(409).json({ error: 'Email ya registrado' });
    return res.status(400).json({ error: 'No se pudo crear el usuario', detalle: msg.slice(0, 200) });
  }
});

const editarSchema = z.object({
  nombres: z.string().min(1).optional(),
  apellidos: z.string().min(1).optional(),
  telefono: z.string().nullable().optional(),
  activo: z.boolean().optional(),
  empresas: z.array(membresiaSchema).optional(), // si viene, reemplaza las membresías
});

// PATCH /usuarios/:id · editar perfil + baja lógica (activo) + reemplazar membresías (admin).
router.patch('/usuarios/:id', requireAdmin(), async (req, res) => {
  const parse = editarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Datos inválidos' });
  const { empresas, ...campos } = parse.data;
  const id = req.params.id;

  await db.transaction(async (tx) => {
    if (Object.keys(campos).length) {
      await tx.update(schema.users).set({ ...campos, updatedAt: new Date() }).where(eq(schema.users.id, id));
    }
    if (empresas) {
      await tx.delete(schema.usuarioEmpresa).where(eq(schema.usuarioEmpresa.userId, id));
      if (empresas.length) {
        await tx.insert(schema.usuarioEmpresa).values(empresas.map((e) => ({ userId: id, empresaId: e.empresaId, roleId: e.roleId })));
      }
    }
  });
  await audit(req, { action: 'user_update', entityType: 'user', entityId: id, after: parse.data });
  return res.json({ ok: true });
});

// POST /usuarios/:id/reset-password · clave temporal + must_change_password (admin · sin correo).
router.post('/usuarios/:id/reset-password', requireAdmin(), async (req, res) => {
  const id = req.params.id;
  const tempPassword = genTempPassword();
  const [u] = await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(tempPassword), mustChangePassword: true, updatedAt: new Date() })
    .where(eq(schema.users.id, id))
    .returning({ id: schema.users.id });
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  await audit(req, { action: 'user_reset_pw', entityType: 'user', entityId: id });
  return res.json({ ok: true, tempPassword });
});

export default router;
