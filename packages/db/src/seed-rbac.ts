// Seed RBAC · roles base + matriz de permisos + empresa MM + migrar usuarios → usuario_empresa.
// Idempotente (ON CONFLICT). Correr: tsx src/seed-rbac.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

// nivel por módulo · módulos no listados = sin acceso (fila ausente)
const MATRIZ: Record<string, Record<string, 'lectura' | 'edicion'>> = {
  admin: {
    dashboard: 'edicion', finanzas: 'edicion', contabilidad: 'edicion', logistica: 'edicion',
    inventario: 'edicion', personal: 'edicion', proyectos: 'edicion', oficina: 'edicion', usuarios: 'edicion',
  },
  logistica: { logistica: 'edicion', inventario: 'lectura', dashboard: 'lectura' },
  inventario: { inventario: 'edicion', logistica: 'lectura', dashboard: 'lectura' },
  contabilidad: {
    contabilidad: 'edicion', finanzas: 'edicion', oficina: 'edicion', personal: 'lectura', dashboard: 'lectura',
  },
};
const DESC: Record<string, string> = {
  admin: 'Acceso total · administra usuarios, roles y empresas',
  logistica: 'Órdenes de compra/servicio y proveedores',
  inventario: 'Almacén, activos y consumibles',
  contabilidad: 'Contabilidad, finanzas, oficina y cierres',
};
// legacy users.role → rol nuevo
const ROL_LEGACY: Record<string, string> = {
  admin: 'admin', gerente: 'admin', residente: 'admin', contadora: 'contabilidad', almacen: 'inventario',
};

// 1 · empresa MM (id=1): asegurar fila + flags, sin pisar ruc/razón reales
await sql`
  INSERT INTO empresa (id, ruc, razon_social, nombre_corto, tiene_proyectos, activo)
  VALUES (1, '00000000000', 'MM HIGH METRIK', 'MM', true, true)
  ON CONFLICT (id) DO UPDATE SET
    nombre_corto = COALESCE(empresa.nombre_corto, 'MM'),
    tiene_proyectos = true,
    activo = true
`;

// 2 · roles base (esSistema)
for (const nombre of Object.keys(MATRIZ)) {
  await sql`INSERT INTO roles (nombre, descripcion, es_sistema) VALUES (${nombre}, ${DESC[nombre]}, true)
            ON CONFLICT (nombre) DO NOTHING`;
}

// 3 · matriz rol→módulo (DO NOTHING para no pisar ediciones del admin en re-run)
for (const [rol, mods] of Object.entries(MATRIZ)) {
  for (const [modulo, nivel] of Object.entries(mods)) {
    await sql`
      INSERT INTO role_modulo (role_id, modulo, nivel)
      SELECT r.id, ${modulo}::modulo, ${nivel}::nivel_acceso FROM roles r WHERE r.nombre = ${rol}
      ON CONFLICT (role_id, modulo) DO NOTHING
    `;
  }
}

// 4 · migrar usuarios existentes → membresía en MM con rol mapeado
const usuarios = await sql<{ id: string; role: string }[]>`SELECT id, role FROM users`;
for (const u of usuarios) {
  const rol = ROL_LEGACY[u.role] ?? 'admin';
  await sql`
    INSERT INTO usuario_empresa (user_id, empresa_id, role_id)
    SELECT ${u.id}, 1, r.id FROM roles r WHERE r.nombre = ${rol}
    ON CONFLICT (user_id, empresa_id) DO NOTHING
  `;
}

const [{ count: nRoles }] = await sql<{ count: string }[]>`SELECT count(*) FROM roles`;
const [{ count: nPerms }] = await sql<{ count: string }[]>`SELECT count(*) FROM role_modulo`;
const [{ count: nMemb }] = await sql<{ count: string }[]>`SELECT count(*) FROM usuario_empresa`;
console.log(`✅ RBAC seed · roles=${nRoles} permisos=${nPerms} membresías=${nMemb} (usuarios=${usuarios.length})`);
await sql.end();
process.exit(0);
