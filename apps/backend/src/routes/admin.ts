/** Admin · roles + matriz de permisos + módulos + empresas. Todo gated por requireAdmin. */
import { db, schema } from '@erp/db';
import { asc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { requireAdmin } from '../lib/permisos.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireAdmin());

const MODULOS = ['dashboard', 'finanzas', 'contabilidad', 'logistica', 'inventario', 'personal', 'proyectos', 'oficina', 'usuarios'] as const;
const NIVELES = ['ninguno', 'lectura', 'edicion'] as const;
const permisosSchema = z.record(z.enum(NIVELES)); // { modulo: nivel }

router.get('/modulos', (_req, res) => res.json({ modulos: MODULOS, niveles: NIVELES }));

// ── Roles ──────────────────────────────────────────────
// Filas válidas de la matriz (módulo conocido + nivel != ninguno) → array de inserts.
function matrizRows(roleId: string, permisos: Record<string, string>) {
  return Object.entries(permisos)
    .filter(([m, n]) => (MODULOS as readonly string[]).includes(m) && n !== 'ninguno')
    .map(([modulo, nivel]) => ({ roleId, modulo: modulo as (typeof MODULOS)[number], nivel: nivel as 'lectura' | 'edicion' }));
}

router.get('/roles', async (_req, res) => {
  const roles = await db.select().from(schema.roles).orderBy(asc(schema.roles.nombre));
  const perms = await db.select().from(schema.roleModulo);
  const porRol = new Map<string, Record<string, string>>();
  for (const p of perms) {
    const m = porRol.get(p.roleId) ?? {};
    m[p.modulo] = p.nivel;
    porRol.set(p.roleId, m);
  }
  res.json({ roles: roles.map((r) => ({ ...r, permisos: porRol.get(r.id) ?? {} })) });
});

const rolSchema = z.object({
  nombre: z.string().min(2).max(50),
  descripcion: z.string().max(255).optional(),
  permisos: permisosSchema.default({}),
});

router.post('/roles', async (req, res) => {
  const parse = rolSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Datos inválidos' });
  const { nombre, descripcion, permisos } = parse.data;
  try {
    const id = await db.transaction(async (tx) => {
      const [r] = await tx.insert(schema.roles).values({ nombre, descripcion, esSistema: false }).returning({ id: schema.roles.id });
      const rows = matrizRows(r.id, permisos);
      if (rows.length) await tx.insert(schema.roleModulo).values(rows);
      return r.id;
    });
    await audit(req, { action: 'role_create', entityType: 'role', entityId: id, after: parse.data });
    return res.json({ ok: true, id });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('unique') || msg.includes('duplicate')) return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    return res.status(400).json({ error: 'No se pudo crear el rol' });
  }
});

router.patch('/roles/:id', async (req, res) => {
  const parse = rolSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Datos inválidos' });
  const id = req.params.id;
  await db.transaction(async (tx) => {
    if (parse.data.nombre !== undefined || parse.data.descripcion !== undefined) {
      await tx
        .update(schema.roles)
        .set({ ...(parse.data.nombre !== undefined && { nombre: parse.data.nombre }), ...(parse.data.descripcion !== undefined && { descripcion: parse.data.descripcion }) })
        .where(eq(schema.roles.id, id));
    }
    if (parse.data.permisos) {
      await tx.delete(schema.roleModulo).where(eq(schema.roleModulo.roleId, id));
      const rows = matrizRows(id, parse.data.permisos);
      if (rows.length) await tx.insert(schema.roleModulo).values(rows);
    }
  });
  await audit(req, { action: 'role_update', entityType: 'role', entityId: id, after: parse.data });
  return res.json({ ok: true });
});

router.delete('/roles/:id', async (req, res) => {
  const id = req.params.id;
  const [r] = await db.select().from(schema.roles).where(eq(schema.roles.id, id)).limit(1);
  if (!r) return res.status(404).json({ error: 'Rol no encontrado' });
  if (r.esSistema) return res.status(400).json({ error: 'No se puede borrar un rol del sistema' });
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.usuarioEmpresa)
    .where(eq(schema.usuarioEmpresa.roleId, id));
  if (n > 0) return res.status(409).json({ error: `Rol en uso por ${n} usuario(s)` });
  await db.delete(schema.roles).where(eq(schema.roles.id, id));
  await audit(req, { action: 'role_delete', entityType: 'role', entityId: id });
  return res.json({ ok: true });
});

// ── Empresas ───────────────────────────────────────────
router.get('/empresas', async (_req, res) => {
  const rows = await db.select().from(schema.empresas).orderBy(asc(schema.empresas.id));
  res.json({ empresas: rows });
});

const empresaSchema = z.object({
  ruc: z.string().length(11),
  razonSocial: z.string().min(1),
  nombreCorto: z.string().max(50).optional(),
  direccion: z.string().optional(),
  email: z.string().email().optional(),
  telefono: z.string().optional(),
  tieneProyectos: z.boolean().optional(),
});

router.post('/empresas', async (req, res) => {
  const parse = empresaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Datos inválidos' });
  // id manual = max+1 (tabla chica, sin sequence)
  const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${schema.empresas.id}),0)+1` }).from(schema.empresas);
  const [e] = await db.insert(schema.empresas).values({ id: next, ...parse.data }).returning();
  await audit(req, { action: 'empresa_create', entityType: 'empresa', entityId: String(next), after: parse.data });
  return res.json({ ok: true, empresa: e });
});

router.patch('/empresas/:id', async (req, res) => {
  const parse = empresaSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Datos inválidos' });
  const id = Number(req.params.id);
  const [e] = await db.update(schema.empresas).set({ ...parse.data, updatedAt: new Date() }).where(eq(schema.empresas.id, id)).returning();
  if (!e) return res.status(404).json({ error: 'Empresa no encontrada' });
  await audit(req, { action: 'empresa_update', entityType: 'empresa', entityId: String(id), after: parse.data });
  return res.json({ ok: true, empresa: e });
});

export default router;
