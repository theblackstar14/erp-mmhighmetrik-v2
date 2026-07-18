import { verify } from '@node-rs/argon2';
import { db, schema } from '@erp/db';
import { loginSchema } from '@erp/shared';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { lucia } from '../auth.js';
import { audit } from '../lib/audit.js';
import { hashPassword } from '../lib/password.js';
import { getMembresias, permisosDeRol, resolverEmpresa } from '../lib/permisos.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Rate-limit de login · in-memory (ponytail: 1 proceso on-prem · mover a redis si escala a multi-instancia).
const intentos = new Map<string, { n: number; until: number }>();
const MAX_INTENTOS = 8;
const VENTANA_MS = 15 * 60 * 1000;
function rateLimited(key: string): boolean {
  const now = Date.now();
  const e = intentos.get(key);
  if (!e || e.until < now) {
    intentos.set(key, { n: 1, until: now + VENTANA_MS });
    return false;
  }
  e.n += 1;
  return e.n > MAX_INTENTOS;
}

router.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Email y password requeridos' });
  const { email, password } = parse.data;

  const key = `${req.ip}:${email.toLowerCase()}`;
  if (rateLimited(key)) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos.' });
  }

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);

  // Error genérico (anti-enumeración): no revelar si el email existe o la clave es la mala.
  if (!user || !user.activo || !(await verify(user.passwordHash, password))) {
    await audit(req, { action: 'login_fail', entityType: 'user', motivo: email });
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  intentos.delete(key);

  const session = await lucia.createSession(user.id, {});
  res.appendHeader('Set-Cookie', lucia.createSessionCookie(session.id).serialize());
  await db.update(schema.users).set({ lastLogin: new Date() }).where(eq(schema.users.id, user.id));

  req.user = { id: user.id, email: user.email, nombres: user.nombres, apellidos: user.apellidos, role: user.role };
  await audit(req, { action: 'login', entityType: 'user', entityId: user.id });

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      nombres: user.nombres,
      apellidos: user.apellidos,
      mustChangePassword: user.mustChangePassword,
    },
  });
});

router.post('/logout', requireAuth, async (req, res) => {
  if (req.sessionId) await lucia.invalidateSession(req.sessionId);
  res.appendHeader('Set-Cookie', lucia.createBlankSessionCookie().serialize());
  return res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const [row] = await db
    .select({ mustChangePassword: schema.users.mustChangePassword, telefono: schema.users.telefono })
    .from(schema.users)
    .where(eq(schema.users.id, req.user.id))
    .limit(1);
  const ms = await getMembresias(req.user.id);
  const activa = await resolverEmpresa(req);
  const permisos = activa ? await permisosDeRol(activa.roleId) : {};
  return res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      nombres: req.user.nombres,
      apellidos: req.user.apellidos,
      telefono: row?.telefono ?? null,
      mustChangePassword: row?.mustChangePassword ?? false,
    },
    empresas: ms.map((m) => ({
      id: m.empresaId,
      nombre: m.empresaNombre,
      razonSocial: m.razonSocial,
      rol: m.roleNombre,
      tieneProyectos: m.tieneProyectos,
    })),
    empresaActiva: activa ? { id: activa.empresaId, nombre: activa.empresaNombre, rol: activa.roleNombre } : null,
    permisos,
  });
});

// Cambio de clave propio · exige clave actual · limpia must_change_password.
router.post('/cambiar-password', requireAuth, async (req, res) => {
  const parse = z.object({ actual: z.string().min(1), nueva: z.string().min(8) }).safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'La clave nueva debe tener mínimo 8 caracteres' });

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, req.user!.id)).limit(1);
  if (!user || !(await verify(user.passwordHash, parse.data.actual))) {
    return res.status(400).json({ error: 'La clave actual es incorrecta' });
  }
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(parse.data.nueva), mustChangePassword: false, updatedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  await audit(req, { action: 'password_change', entityType: 'user', entityId: user.id });
  return res.json({ ok: true });
});

// Auto-edición de perfil (cualquier usuario · nombre/teléfono propios).
router.patch('/perfil', requireAuth, async (req, res) => {
  const parse = z
    .object({ nombres: z.string().min(1).optional(), apellidos: z.string().min(1).optional(), telefono: z.string().nullable().optional() })
    .safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Datos inválidos' });
  if (Object.keys(parse.data).length) {
    await db.update(schema.users).set({ ...parse.data, updatedAt: new Date() }).where(eq(schema.users.id, req.user!.id));
    await audit(req, { action: 'perfil_update', entityType: 'user', entityId: req.user!.id, after: parse.data });
  }
  return res.json({ ok: true });
});

export default router;
