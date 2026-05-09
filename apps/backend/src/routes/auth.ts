import { hash, verify } from '@node-rs/argon2';
import { db, schema } from '@erp/db';
import { loginSchema } from '@erp/shared';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { lucia } from '../auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'Email y password requeridos' });
  }
  const { email, password } = parse.data;

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);

  if (!user || !user.activo) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const valid = await verify(user.passwordHash, password);
  if (!valid) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const session = await lucia.createSession(user.id, {});
  res.appendHeader('Set-Cookie', lucia.createSessionCookie(session.id).serialize());

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      nombres: user.nombres,
      apellidos: user.apellidos,
      role: user.role,
    },
  });
});

router.post('/logout', requireAuth, async (req, res) => {
  if (req.sessionId) await lucia.invalidateSession(req.sessionId);
  res.appendHeader('Set-Cookie', lucia.createBlankSessionCookie().serialize());
  return res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  return res.json({ user: req.user });
});

router.post('/register', async (req, res) => {
  // Solo para dev / setup inicial · proteger con admin auth en producción
  const { email, password, nombres, apellidos, role } = req.body;
  if (!email || !password || !nombres || !apellidos) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  const passwordHash = await hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
  try {
    const [user] = await db
      .insert(schema.users)
      .values({ email, passwordHash, nombres, apellidos, role: role ?? 'admin' })
      .returning();
    return res.json({ user });
  } catch (e) {
    return res.status(409).json({ error: 'Email ya registrado' });
  }
});

export default router;
