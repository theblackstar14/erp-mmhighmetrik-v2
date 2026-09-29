// RBAC · resuelve empresa activa + nivel de acceso por (rol, módulo) y guarda rutas.
// Empresa activa = header 'x-empresa-id' validado contra las membresías del usuario,
// o la única membresía si solo tiene una. Sin estado de servidor (no toca la sesión).
import { db, schema } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';

export type Nivel = 'ninguno' | 'lectura' | 'edicion';
const ORDEN: Record<Nivel, number> = { ninguno: 0, lectura: 1, edicion: 2 };

declare global {
  namespace Express {
    interface Request {
      empresaId?: number;
      roleId?: string;
      roleNombre?: string;
    }
  }
}

export type Membresia = {
  empresaId: number;
  roleId: string;
  roleNombre: string;
  empresaNombre: string | null;
  razonSocial: string;
  tieneProyectos: boolean;
};

export async function getMembresias(userId: string): Promise<Membresia[]> {
  return db
    .select({
      empresaId: schema.usuarioEmpresa.empresaId,
      roleId: schema.usuarioEmpresa.roleId,
      roleNombre: schema.roles.nombre,
      empresaNombre: schema.empresas.nombreCorto,
      razonSocial: schema.empresas.razonSocial,
      tieneProyectos: schema.empresas.tieneProyectos,
    })
    .from(schema.usuarioEmpresa)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.usuarioEmpresa.roleId))
    .innerJoin(schema.empresas, eq(schema.empresas.id, schema.usuarioEmpresa.empresaId))
    .where(eq(schema.usuarioEmpresa.userId, userId));
}

// Empresa activa: header válido → esa · si no, la de menor id (determinista). null si no tiene ninguna.
export async function resolverEmpresa(req: Request): Promise<Membresia | null> {
  if (!req.user) return null;
  const ms = await getMembresias(req.user.id);
  if (!ms.length) return null;
  const hdr = Number(req.get('x-empresa-id'));
  const porHeader = hdr ? ms.find((m) => m.empresaId === hdr) : undefined;
  return porHeader ?? ms.reduce((a, b) => (b.empresaId < a.empresaId ? b : a));
}

export async function nivelDe(roleId: string, modulo: string): Promise<Nivel> {
  const [row] = await db
    .select({ nivel: schema.roleModulo.nivel })
    .from(schema.roleModulo)
    .where(and(eq(schema.roleModulo.roleId, roleId), eq(schema.roleModulo.modulo, modulo as never)))
    .limit(1);
  return (row?.nivel as Nivel) ?? 'ninguno';
}

// Matriz completa de un rol → { modulo: nivel } (módulos ausentes = ninguno).
export async function permisosDeRol(roleId: string): Promise<Record<string, Nivel>> {
  const rows = await db
    .select({ modulo: schema.roleModulo.modulo, nivel: schema.roleModulo.nivel })
    .from(schema.roleModulo)
    .where(eq(schema.roleModulo.roleId, roleId));
  return Object.fromEntries(rows.map((r) => [r.modulo, r.nivel as Nivel]));
}

// Guard: exige nivel >= min en el módulo, dentro de la empresa activa.
// Cablea req.empresaId / req.roleId / req.roleNombre para que la ruta scopee.
export function requirePermiso(modulo: string, min: Nivel = 'lectura') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    const emp = await resolverEmpresa(req);
    if (!emp) return res.status(403).json({ error: 'Usuario sin empresa asignada' });
    req.empresaId = emp.empresaId;
    req.roleId = emp.roleId;
    req.roleNombre = emp.roleNombre;
    const nivel = await nivelDe(emp.roleId, modulo);
    if (ORDEN[nivel] < ORDEN[min]) {
      return res.status(403).json({ error: `Permiso insuficiente · ${modulo} requiere ${min}` });
    }
    next();
  };
}

// Admin = edición en el módulo 'usuarios'.
export const requireAdmin = () => requirePermiso('usuarios', 'edicion');

// Gate por NOMBRE de rol: admin o contabilidad en cualquier empresa del usuario.
// Usado por oficina (planilla + rendiciones), donde la captura la hace la contadora.
// Cablea la empresa activa en req para que la ruta scopee.
export function requireAdminOContab() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    const emp = await resolverEmpresa(req);
    if (emp) {
      req.empresaId = emp.empresaId;
      req.roleId = emp.roleId;
      req.roleNombre = emp.roleNombre;
    }
    const rows = await db
      .select({ rol: schema.roles.nombre })
      .from(schema.usuarioEmpresa)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.usuarioEmpresa.roleId))
      .where(eq(schema.usuarioEmpresa.userId, req.user.id));
    const allowed = new Set(['admin', 'contabilidad']);
    if (!rows.some((r) => allowed.has(r.rol))) {
      return res.status(403).json({ error: 'Permisos insuficientes: se requiere rol admin o contabilidad' });
    }
    next();
  };
}
