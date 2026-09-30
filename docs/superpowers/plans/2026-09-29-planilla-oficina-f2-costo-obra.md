# Planilla de oficina F2 — Destino del costo, cuentas configurables y pago desde banco · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cierre de la planilla de oficina reparta su costo entre obras con porcentajes editables, use cuentas configurables por concepto, y pague el neto desde una cuenta bancaria elegida, con vista previa del asiento antes de cerrar.

**Architecture:** El armado de líneas del asiento sale de la ruta y se convierte en dos módulos: un núcleo puro (`planillaOficinaDistribucion.ts`: resolver reglas + repartir importes al céntimo) y un armador (`planillaOficinaAsiento.ts`: agrega por (cuenta, obra) y emite `LineaIn[]`). La ruta `cerrar` y el nuevo `asiento-preview` llaman al mismo armador, así que la vista previa no puede divergir del asiento real. Dos tablas nuevas (`planilla_oficina_distribucion`, `planilla_oficina_concepto_cuenta`) hacen editable lo que hoy está hardcodeado. La clase CD/GG no se fuerza: la oficina usa cuentas propias (`6211`, `62711`) mapeadas a `GG_OBRA`, y el motor deriva `GG_OBRA`/`GG_CORP` solo.

**Tech Stack:** TypeScript ESM (imports con extensión `.js`), tsx como runtime (el backend NO compila con tsc), Drizzle ORM + driver `postgres`, Express, React + TanStack Query, Tailwind con tokens del proyecto. Tests = scripts tsx con `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-09-29-planilla-oficina-f2-costo-obra-design.md`

## Global Constraints

- Rama de trabajo: `feat/rbac-multiempresa`. No crear ramas nuevas, no mergear a `main`.
- DB de trabajo: `erp_mmh_test`. Todo comando que toque DB lleva `DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test"`.
- Migraciones: scripts aditivos e idempotentes en `packages/db/src/alter-*.ts` (array de strings SQL + `sql.unsafe`). NUNCA `drizzle-kit push`. Nota: la spec §4.3 nombra la migración en `apps/backend/scripts/oficina/`; este plan la pone en `packages/db/src/` por consistencia con las 9 migraciones ya existentes.
- El backend no compila con `tsc`; la verificación de tipos es `pnpm typecheck` en `apps/frontend` para el front. El backend se valida ejecutando sus scripts de test.
- Imports relativos en backend SIEMPRE con extensión `.js` (ESM): `import { x } from '../lib/y.js'`.
- Dinero: toda suma/producto pasa por `round2(n) = Math.round(n * 100) / 100`. Umbral de emisión de línea: `0.005`.
- Las cuentas de obreros `621` y `6271` NO se modifican ni se remapean. La oficina usa `6211` y `62711`.
- UI: sin emojis. Reutilizar los componentes ya presentes en `PlanillaOficinaTab.tsx` (`Modal`, `SectionHeader`, `EditNum`) y los tokens Tailwind del proyecto (`text-ink-4`, `border-line`, `bg-bg-elev`, `text-[11.5px]`, `tabular-nums`).
- Mutaciones de planilla gateadas por `requireOficinaEdit` (roles `admin` | `contabilidad`).
- Los tests imprimen `<nombre> VERDE` al final. En Windows el exit code 9 es cosmético (libuv): éxito = VERDE impreso.
- Commits en español, imperativo, prefijo `feat(planilla-oficina):` / `fix(planilla-oficina):`.

## Review Focus

- **`pct` no numérico** (`{obraId, pct: "abc"}` o `pct` ausente) → 400, no una columna decimal corrompida con `NaN`. Ya pasó una vez en `PUT /param-legal`. Test en Task 4.
- **`obraId` inexistente en `proyectos`** → 400 con mensaje, no un 500 crudo de violación de FK. Test en Task 4.
- **Fuga entre empresas**: reglas de la empresa 2 no deben afectar el cierre de la empresa 1. `resolverDistribucion` recibe reglas ya filtradas por `empresaId`; si el filtro falta, el costo se reparte a obras ajenas. Test en Task 3.
- **`Σ pct == 100` exacto** → no se emite slice de oficina; ninguna línea con `debe = 0` y `haber = 0` entra al asiento (`crearAsiento` la rechazaría o ensuciaría el libro). Test en Task 2.
- **Cuenta bancaria inactiva o con `moneda ≠ PEN`** → 400. La spec §6.4 solo exige validar `cuentaContable`; una cuenta USD produciría un asiento en PEN por un monto en dólares. Test en Task 5.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `packages/db/src/alter-planilla-oficina-f2.ts` (crear) | Migración aditiva: 2 tablas, columna en `movimientos`, divisionaria `62711`, mapa de clases, semilla de conceptos |
| `packages/db/src/schema.ts` (modificar) | `planillaOficinaDistribucion`, `planillaOficinaConceptoCuenta`, `movimientos.planillaOficinaMesId` |
| `apps/backend/src/lib/planillaOficinaDistribucion.ts` (crear) | Núcleo puro: `resolverDistribucion`, `repartir`, `round2` |
| `apps/backend/src/lib/planillaOficinaAsiento.ts` (crear) | `CONCEPTOS`, `armarLineasCierre` → `LineaIn[]`. Única fuente de las líneas del asiento |
| `apps/backend/src/routes/planillaOficina.ts` (modificar) | `cerrar` delega al armador; `asiento-preview`; endpoints de distribución y concepto-cuenta; guardarraíl de `reabrir` |
| `apps/backend/src/routes/contabilidad.ts` (modificar) | Pass 5 salta movimientos de planilla |
| `apps/backend/scripts/oficina/test-distribucion.ts` (crear) | Tests puros del núcleo (sin DB) |
| `apps/backend/scripts/oficina/test-planilla-f2.ts` (crear) | Tests de aceptación 1-12 sobre HTTP in-process |
| `apps/frontend/src/lib/api.ts` (modificar) | Tipos + llamadas nuevas |
| `apps/frontend/src/components/oficina/PlanillaOficinaTab.tsx` (modificar) | Bloques de configuración nuevos + diálogo de cierre |
| `docs/planilla-oficina-guia.md` (modificar) | Documentar distribución, mapa de cuentas, pago desde banco |

---

### Task 1: Migración y schema

**Files:**
- Create: `packages/db/src/alter-planilla-oficina-f2.ts`
- Modify: `packages/db/src/schema.ts` (tras `planillaOficinaDetalle`, ~línea 1484; y `movimientos`, ~línea 947)
- Test: verificación por SQL en el paso 4 (una migración no lleva test unitario propio; su deliverable se comprueba consultando el catálogo)

**Interfaces:**
- Consumes: nada.
- Produces: tablas `planilla_oficina_distribucion`, `planilla_oficina_concepto_cuenta`; columna `movimientos.planilla_oficina_mes_id`; exports Drizzle `schema.planillaOficinaDistribucion`, `schema.planillaOficinaConceptoCuenta`, `schema.movimientos.planillaOficinaMesId`.

- [ ] **Step 1: Escribir la migración**

Crear `packages/db/src/alter-planilla-oficina-f2.ts`:

```ts
/**
 * F2 planilla oficina · distribución por obra + mapa concepto→cuenta + link movimiento.
 * Aditiva e idempotente. Correr:
 *   cd packages/db && ./node_modules/.bin/tsx src/alter-planilla-oficina-f2.ts
 */
import 'dotenv/config';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

const stmts = [
  // 1· distribución del costo por obra (empleado_id null = regla global)
  `CREATE TABLE IF NOT EXISTS planilla_oficina_distribucion (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     empresa_id integer NOT NULL REFERENCES empresas(id),
     empleado_id uuid REFERENCES empleados(id) ON DELETE CASCADE,
     obra_id uuid NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
     pct numeric(5,2) NOT NULL,
     actualizado_en timestamp NOT NULL DEFAULT now()
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS pod_dist_scope_uq
     ON planilla_oficina_distribucion (empresa_id, empleado_id, obra_id) NULLS NOT DISTINCT;`,
  `CREATE INDEX IF NOT EXISTS pod_dist_empresa_idx ON planilla_oficina_distribucion (empresa_id);`,

  // 2· mapa concepto→cuenta (espejo de gasto_cuenta_map)
  `CREATE TABLE IF NOT EXISTS planilla_oficina_concepto_cuenta (
     concepto varchar(40) PRIMARY KEY,
     cuenta varchar(10) NOT NULL REFERENCES plan_contable(codigo),
     actualizado_en timestamp NOT NULL DEFAULT now()
   );`,

  // 3· link movimiento de tesorería ↔ planilla (idempotencia + skip en /generar)
  `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS planilla_oficina_mes_id uuid;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mov_planilla_oficina_mes_fk') THEN
       ALTER TABLE movimientos ADD CONSTRAINT mov_planilla_oficina_mes_fk
         FOREIGN KEY (planilla_oficina_mes_id) REFERENCES planilla_oficina_mes(id) ON DELETE SET NULL;
     END IF;
   END $$;`,
  `CREATE INDEX IF NOT EXISTS mov_planilla_oficina_idx ON movimientos (planilla_oficina_mes_id);`,

  // 4· divisionaria propia de oficina para EsSalud empleador (621/6271 de obreros NO se tocan)
  `INSERT INTO plan_contable (codigo, descripcion, tipo, parent_codigo, nivel, clasificable, es_divisionaria, activa)
   VALUES ('62711', 'EsSalud - personal administrativo', 'Gasto', '6271', 4, true, true, true)
   ON CONFLICT (codigo) DO NOTHING;`,

  // 5· clase de obra: el costo de oficina es gasto general, nunca costo directo
  `INSERT INTO mapa_cuenta_clase (cuenta, clase_obra) VALUES ('6211', 'GG_OBRA') ON CONFLICT (cuenta) DO NOTHING;`,
  `INSERT INTO mapa_cuenta_clase (cuenta, clase_obra) VALUES ('62711', 'GG_OBRA') ON CONFLICT (cuenta) DO NOTHING;`,

  // 6· semilla del conjunto cerrado de conceptos (no pisa lo que Kelly ya cambió)
  `INSERT INTO planilla_oficina_concepto_cuenta (concepto, cuenta) VALUES
     ('sueldos', '6211'),
     ('essalud_empleador', '62711'),
     ('essalud_por_pagar', '4031'),
     ('afp_por_pagar', '407'),
     ('onp_por_pagar', '4032'),
     ('renta5ta_por_pagar', '40173'),
     ('otros_por_pagar', '469'),
     ('neto_por_pagar', '411')
   ON CONFLICT (concepto) DO NOTHING;`,
];

for (const s of stmts) {
  await sql.unsafe(s);
  console.log('✓', s.slice(0, 70).replace(/\s+/g, ' '));
}
await sql.end();
console.log('alter-planilla-oficina-f2 VERDE');
```

- [ ] **Step 2: Correr la migración**

```bash
cd packages/db
DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" ./node_modules/.bin/tsx src/alter-planilla-oficina-f2.ts
```

Esperado: 10 líneas `✓` y `alter-planilla-oficina-f2 VERDE`.

- [ ] **Step 3: Correrla otra vez para probar idempotencia**

Mismo comando. Esperado: idéntica salida, sin errores. Si algo falla en la segunda corrida, el `IF NOT EXISTS`/`ON CONFLICT` de ese statement está mal.

- [ ] **Step 4: Verificar el resultado en DB**

```bash
cd packages/db
DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" ./node_modules/.bin/tsx -e "
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
console.log(await sql\`SELECT count(*)::int AS conceptos FROM planilla_oficina_concepto_cuenta\`);
console.log(await sql\`SELECT cuenta, clase_obra FROM mapa_cuenta_clase WHERE cuenta IN ('621','6211','6271','62711') ORDER BY cuenta\`);
console.log(await sql\`SELECT column_name FROM information_schema.columns WHERE table_name='movimientos' AND column_name='planilla_oficina_mes_id'\`);
await sql.end();
"
```

Esperado: `conceptos: 8`; `6211 → GG_OBRA`, `62711 → GG_OBRA`, y `621`/`6271` con lo que ya tenían (`621 → CD`, `6271` sin fila); una fila con `planilla_oficina_mes_id`.

- [ ] **Step 5: Reflejar el schema en Drizzle**

En `packages/db/src/schema.ts`, después de `export type PlanillaOficinaDetalle = ...` (~línea 1484):

```ts
// ─── F2 · distribución del costo de planilla oficina por obra ──
// empleado_id null = regla GLOBAL (default para quien no tiene reglas propias).
// Σ pct ≤ 100 por scope; el resto va a oficina (obra_id null → GG_CORP).
export const planillaOficinaDistribucion = pgTable(
  'planilla_oficina_distribucion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    empleadoId: uuid('empleado_id').references(() => empleados.id, { onDelete: 'cascade' }),
    obraId: uuid('obra_id').notNull().references(() => proyectos.id, { onDelete: 'cascade' }),
    pct: decimal('pct', { precision: 5, scale: 2 }).notNull(),
    actualizadoEn: timestamp('actualizado_en').notNull().defaultNow(),
  },
  (t) => ({
    empresaIdx: index('pod_dist_empresa_idx').on(t.empresaId),
  }),
);
export type PlanillaOficinaDistribucion = typeof planillaOficinaDistribucion.$inferSelect;

// ─── F2 · mapa concepto→cuenta del asiento de planilla oficina ──
// Conjunto de conceptos CERRADO (lo define el código, ver CONCEPTOS en
// apps/backend/src/lib/planillaOficinaAsiento.ts). Kelly edita la cuenta, no la lista.
export const planillaOficinaConceptoCuenta = pgTable('planilla_oficina_concepto_cuenta', {
  concepto: varchar('concepto', { length: 40 }).primaryKey(),
  cuenta: varchar('cuenta', { length: 10 }).notNull().references(() => planContable.codigo),
  actualizadoEn: timestamp('actualizado_en').notNull().defaultNow(),
});
export type PlanillaOficinaConceptoCuenta = typeof planillaOficinaConceptoCuenta.$inferSelect;
```

El índice único con `NULLS NOT DISTINCT` no se declara en Drizzle (no lo soporta); vive solo en la migración. Dejar este comentario junto a la tabla:

```ts
// El UNIQUE (empresa_id, empleado_id, obra_id) NULLS NOT DISTINCT vive en
// packages/db/src/alter-planilla-oficina-f2.ts (Drizzle no expresa NULLS NOT DISTINCT).
```

- [ ] **Step 6: Añadir la columna a `movimientos`**

En `packages/db/src/schema.ts`, dentro de `movimientos`, justo antes de `createdAt: timestamp('created_at')...` (~línea 947):

```ts
    // F2 · si el movimiento nace del cierre de una planilla de oficina. Da idempotencia
    // y hace que el pass 5 de /generar lo salte (el asiento de planilla ya acreditó el 104x).
    planillaOficinaMesId: uuid('planilla_oficina_mes_id').references(() => planillaOficinaMes.id, { onDelete: 'set null' }),
```

`planillaOficinaMes` se declara más abajo en el archivo que `movimientos`; la referencia como thunk (`() => ...`) es lazy, así que no hay problema de orden.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/alter-planilla-oficina-f2.ts packages/db/src/schema.ts
git commit -m "feat(planilla-oficina): schema F2 (distribucion por obra, mapa concepto-cuenta, link movimiento)"
```

---

### Task 2: Núcleo puro de distribución y reparto

**Files:**
- Create: `apps/backend/src/lib/planillaOficinaDistribucion.ts`
- Test: `apps/backend/scripts/oficina/test-distribucion.ts`

**Interfaces:**
- Consumes: nada (módulo puro, sin DB, sin imports del proyecto).
- Produces:
  - `type ReglaDistribucion = { empleadoId: string | null; obraId: string; pct: number }`
  - `type Slice = { obraId: string | null; pct: number }`
  - `type Porcion = { obraId: string | null; monto: number }`
  - `function round2(n: number): number`
  - `function resolverDistribucion(empleadoId: string, reglas: ReglaDistribucion[]): Slice[]`
  - `function repartir(total: number, slices: Slice[]): Porcion[]`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/backend/scripts/oficina/test-distribucion.ts`:

```ts
/**
 * F2 · tests puros de resolverDistribucion + repartir (sin DB).
 *   cd apps/backend && ./node_modules/.bin/tsx scripts/oficina/test-distribucion.ts
 * Imprime 'distribucion VERDE' en éxito.
 */
import assert from 'node:assert/strict';
import { repartir, resolverDistribucion, round2 } from '../../src/lib/planillaOficinaDistribucion.js';

const A = '11111111-1111-1111-1111-111111111111'; // obra A
const B = '22222222-2222-2222-2222-222222222222'; // obra B
const E1 = 'aaaaaaaa-0000-0000-0000-000000000001'; // empleado con reglas propias
const E2 = 'aaaaaaaa-0000-0000-0000-000000000002'; // empleado sin reglas propias

const reglas = [
  { empleadoId: null, obraId: A, pct: 70 },
  { empleadoId: null, obraId: B, pct: 30 },
  { empleadoId: E1, obraId: B, pct: 100 },
];

// 1· el empleado con reglas propias IGNORA el global por completo
assert.deepEqual(resolverDistribucion(E1, reglas), [{ obraId: B, pct: 100 }]);

// 2· el empleado sin reglas propias hereda el global, ordenado por obraId asc
assert.deepEqual(resolverDistribucion(E2, reglas), [
  { obraId: A, pct: 70 },
  { obraId: B, pct: 30 },
]);

// 3· sin ninguna regla → 100% oficina (obraId null)
assert.deepEqual(resolverDistribucion(E2, []), [{ obraId: null, pct: 100 }]);

// 4· Σ pct < 100 → el resto va a oficina, al final
assert.deepEqual(resolverDistribucion(E2, [{ empleadoId: null, obraId: A, pct: 60 }]), [
  { obraId: A, pct: 60 },
  { obraId: null, pct: 40 },
]);

// 5· Σ pct == 100 exacto → NO se emite slice de oficina (Review Focus)
assert.deepEqual(resolverDistribucion(E2, [
  { empleadoId: null, obraId: A, pct: 33.34 },
  { empleadoId: null, obraId: B, pct: 66.66 },
]).length, 2);

// 6· reparto exacto con céntimos: Σ porciones == total al céntimo
const total = 12345.67;
const porciones = repartir(total, resolverDistribucion(E2, [
  { empleadoId: null, obraId: A, pct: 60 },
  { empleadoId: null, obraId: B, pct: 40 },
]));
assert.equal(round2(porciones.reduce((s, p) => s + p.monto, 0)), total);

// 7· el ÚLTIMO slice absorbe la diferencia de redondeo
const tres = repartir(100, [
  { obraId: A, pct: 33.33 },
  { obraId: B, pct: 33.33 },
  { obraId: null, pct: 33.34 },
]);
assert.equal(round2(tres.reduce((s, p) => s + p.monto, 0)), 100);
assert.equal(tres[2]!.obraId, null);

// 8· total 0 → una porción en 0 (el armador la descarta por umbral, no explota aquí)
assert.equal(round2(repartir(0, [{ obraId: A, pct: 100 }]).reduce((s, p) => s + p.monto, 0)), 0);

// 9· slices vacío → todo a oficina (defensa; no debería ocurrir)
assert.deepEqual(repartir(500, []), [{ obraId: null, monto: 500 }]);

console.log('distribucion VERDE');
```

Cobertura de la sección 8 del spec: el assert 4 es el caso de aceptación **3** ("resto a oficina") y el assert 6 es el caso **2** ("reparto exacto"). Los dos viven aquí, no en `test-planilla-f2.ts`, porque son lógica pura y no necesitan DB.

- [ ] **Step 2: Correr el test y ver que falla**

```bash
cd apps/backend
./node_modules/.bin/tsx scripts/oficina/test-distribucion.ts
```

Esperado: FALLA con `Cannot find module '.../lib/planillaOficinaDistribucion.js'`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `apps/backend/src/lib/planillaOficinaDistribucion.ts`:

```ts
// F2 · núcleo PURO del reparto del costo de planilla oficina entre obras.
// Sin DB, sin Express: se testea solo (scripts/oficina/test-distribucion.ts).

export type ReglaDistribucion = { empleadoId: string | null; obraId: string; pct: number };
export type Slice = { obraId: string | null; pct: number };
export type Porcion = { obraId: string | null; monto: number };

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resuelve los slices de un empleado (spec §4.1):
 *   1· hay filas con empleado_id = empleado → se usan SOLO esas
 *   2· si no, filas globales (empleado_id null)
 *   3· si no hay ninguna → 100% oficina (obraId null)
 * El resto hasta 100 va a oficina, siempre al FINAL (orden determinista para `repartir`).
 * Las reglas deben venir ya filtradas por empresa: esta función no sabe de empresas.
 */
export function resolverDistribucion(empleadoId: string, reglas: ReglaDistribucion[]): Slice[] {
  const propias = reglas.filter((r) => r.empleadoId === empleadoId);
  const base = propias.length > 0 ? propias : reglas.filter((r) => r.empleadoId === null);

  const slices: Slice[] = base
    .map((r) => ({ obraId: r.obraId, pct: Number(r.pct) }))
    .sort((a, b) => String(a.obraId).localeCompare(String(b.obraId)));

  const suma = round2(slices.reduce((s, x) => s + x.pct, 0));
  const resto = round2(100 - suma);
  if (resto > 0) slices.push({ obraId: null, pct: resto });

  return slices;
}

/**
 * Reparte `total` entre `slices` sin descuadre: cada porción es round2(total*pct/100)
 * y la ÚLTIMA absorbe la diferencia, de modo que Σ porciones = total al céntimo.
 */
export function repartir(total: number, slices: Slice[]): Porcion[] {
  if (slices.length === 0) return [{ obraId: null, monto: round2(total) }];

  const out: Porcion[] = slices.map((s) => ({ obraId: s.obraId, monto: round2((total * s.pct) / 100) }));
  const suma = round2(out.reduce((s, x) => s + x.monto, 0));
  const last = out[out.length - 1]!;
  last.monto = round2(last.monto + (total - suma));
  return out;
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

```bash
cd apps/backend
./node_modules/.bin/tsx scripts/oficina/test-distribucion.ts
```

Esperado: `distribucion VERDE`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/planillaOficinaDistribucion.ts apps/backend/scripts/oficina/test-distribucion.ts
git commit -m "feat(planilla-oficina): nucleo puro de distribucion por obra y reparto sin descuadre"
```

---

### Task 3: Armador de líneas + `cerrar` delega + `asiento-preview`

**Files:**
- Create: `apps/backend/src/lib/planillaOficinaAsiento.ts`
- Modify: `apps/backend/src/routes/planillaOficina.ts` (reemplaza el bloque "Step 3: Build accounting lines" del handler `cerrar`, hoy líneas ~838-968; añade `GET /planilla/:mesId/asiento-preview`)
- Create: `apps/backend/scripts/oficina/test-planilla-f2.ts`

**Interfaces:**
- Consumes: `resolverDistribucion`, `repartir`, `round2`, `ReglaDistribucion` (Task 2); `type LineaIn` de `../routes/contabilidad.js`; `schema.planillaOficinaDistribucion`, `schema.planillaOficinaConceptoCuenta` (Task 1).
- Produces:
  - `const CONCEPTOS: ReadonlyArray<{ concepto: string; cuentaDefault: string; label: string; lado: 'debe' | 'haber'; reparte: boolean }>`
  - `const CONCEPTOS_SET: Set<string>`
  - `type DetalleCierre` (subconjunto de columnas de `planilla_oficina_detalle` que usa el armador)
  - `function armarLineasCierre(input: { detalle: DetalleCierre[]; reglas: ReglaDistribucion[]; mapa: Record<string, string>; cuentaBanco?: string | null }): { lineas: LineaIn[]; totalNeto: number }`
  - `async function cargarMapaConceptos(): Promise<Record<string, string>>`
  - `async function cargarReglas(empresaId: number): Promise<ReglaDistribucion[]>`
  - En la ruta: `async function validarCuentaBanco(id: string): Promise<{ cuentaContable: string } | { error: string }>` (Task 5 la reusa)

- [ ] **Step 1: Escribir el armador**

Crear `apps/backend/src/lib/planillaOficinaAsiento.ts`:

```ts
// F2 · armado de las líneas del asiento de planilla oficina.
// ÚNICA fuente de las líneas: la usan `cerrar` y `asiento-preview`. Si se duplica,
// la vista previa puede divergir del asiento real, que es justo lo que F2 evita.
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';
import type { LineaIn } from '../routes/contabilidad.js';
import {
  repartir,
  resolverDistribucion,
  round2,
  type ReglaDistribucion,
} from './planillaOficinaDistribucion.js';

// Conjunto CERRADO de conceptos. Kelly edita la cuenta (planilla_oficina_concepto_cuenta),
// no la lista. `reparte` = la línea lleva dimensión obra; los pasivos van agregados.
export const CONCEPTOS = [
  { concepto: 'sueldos',            cuentaDefault: '6211',  label: 'Sueldos y salarios',            lado: 'debe',  reparte: true },
  { concepto: 'essalud_empleador',  cuentaDefault: '62711', label: 'EsSalud empleador',             lado: 'debe',  reparte: true },
  { concepto: 'essalud_por_pagar',  cuentaDefault: '4031',  label: 'EsSalud por pagar',             lado: 'haber', reparte: false },
  { concepto: 'afp_por_pagar',      cuentaDefault: '407',   label: 'AFP por pagar',                 lado: 'haber', reparte: false },
  { concepto: 'onp_por_pagar',      cuentaDefault: '4032',  label: 'ONP por pagar',                 lado: 'haber', reparte: false },
  { concepto: 'renta5ta_por_pagar', cuentaDefault: '40173', label: 'Renta 5ta por pagar',           lado: 'haber', reparte: false },
  { concepto: 'otros_por_pagar',    cuentaDefault: '469',   label: 'Otros por pagar (judicial + descuentos + adelanto)', lado: 'haber', reparte: false },
  { concepto: 'neto_por_pagar',     cuentaDefault: '411',   label: 'Neto por pagar',                lado: 'haber', reparte: false },
] as const;

export const CONCEPTOS_SET = new Set<string>(CONCEPTOS.map((c) => c.concepto));

// Umbral de emisión: por debajo de medio céntimo la línea no existe.
const MIN = 0.005;

export type DetalleCierre = {
  empleadoId: string;
  cuentaContable: string | null;
  totalBruto: string | number | null;
  essalud: string | number | null;
  onp: string | number | null;
  afpAporte: string | number | null;
  afpSeguro: string | number | null;
  afpComision: string | number | null;
  imptoRenta5ta: string | number | null;
  retencionJudicial: string | number | null;
  otrosDescuentos: string | number | null;
  adelantoCuota: string | number | null;
  netoPago: string | number | null;
};

export type ArmarLineasInput = {
  detalle: DetalleCierre[];
  reglas: ReglaDistribucion[];
  mapa: Record<string, string>;
  cuentaBanco?: string | null; // código 104x de la cuenta elegida; null = el neto queda en 411
};

export type ArmarLineasOut = { lineas: LineaIn[]; totalNeto: number };

const n = (v: string | number | null | undefined) => Number(v ?? 0);

export function armarLineasCierre({ detalle, reglas, mapa, cuentaBanco }: ArmarLineasInput): ArmarLineasOut {
  const def = new Map(CONCEPTOS.map((c) => [c.concepto as string, c]));
  const cta = (concepto: string) => mapa[concepto] ?? def.get(concepto)!.cuentaDefault;
  const label = (concepto: string) => def.get(concepto)!.label;

  // Agregación de costo por (cuenta, obra): 17 empleados y 2 obras dan 4 líneas, no 34.
  type Costo = { cuenta: string; obraId: string | null; monto: number; hasManual: boolean; label: string };
  const costo = new Map<string, Costo>();
  const acum = (cuenta: string, obraId: string | null, monto: number, hasManual: boolean, desc: string) => {
    if (Math.abs(monto) < MIN) return;
    const k = `${cuenta}|${obraId ?? ''}`;
    const prev = costo.get(k);
    if (prev) {
      prev.monto = round2(prev.monto + monto);
      prev.hasManual = prev.hasManual || hasManual;
    } else {
      costo.set(k, { cuenta, obraId, monto: round2(monto), hasManual, label: desc });
    }
  };

  let totEssalud = 0, totAfp = 0, totOnp = 0, totRenta = 0, totOtros = 0, totNeto = 0;

  for (const det of detalle) {
    const slices = resolverDistribucion(det.empleadoId, reglas);

    // Precedencia WS1: cuenta manual del trabajador > mapa > default.
    const cuentaSueldo = det.cuentaContable ?? cta('sueldos');
    for (const p of repartir(round2(n(det.totalBruto)), slices)) {
      acum(cuentaSueldo, p.obraId, p.monto, !!det.cuentaContable, label('sueldos'));
    }

    const essalud = round2(n(det.essalud));
    for (const p of repartir(essalud, slices)) {
      acum(cta('essalud_empleador'), p.obraId, p.monto, false, label('essalud_empleador'));
    }

    totEssalud = round2(totEssalud + essalud);
    totAfp = round2(totAfp + n(det.afpAporte) + n(det.afpSeguro) + n(det.afpComision));
    totOnp = round2(totOnp + n(det.onp));
    totRenta = round2(totRenta + n(det.imptoRenta5ta));
    totOtros = round2(totOtros + n(det.retencionJudicial) + n(det.otrosDescuentos) + n(det.adelantoCuota));
    totNeto = round2(totNeto + n(det.netoPago));
  }

  const lineas: LineaIn[] = [];

  // Debe · costo repartido, orden determinista (cuenta, luego obra; oficina —null— primero por '')
  const ordenadas = [...costo.values()].sort(
    (a, b) => a.cuenta.localeCompare(b.cuenta) || (a.obraId ?? '').localeCompare(b.obraId ?? ''),
  );
  for (const c of ordenadas) {
    lineas.push({
      cuenta: c.cuenta,
      descripcion: c.label,
      debe: c.monto,
      haber: 0,
      cuentaContable: c.cuenta,
      obraId: c.obraId,
      cuentaOrigen: c.hasManual ? 'USUARIO' : 'AUTOMATICO',
    });
  }

  // Haber · pasivos agregados, SIN dimensión obra (la deuda con la AFP no es de una obra)
  const haber = (concepto: string, monto: number) => {
    if (monto < MIN) return;
    const cuenta = cta(concepto);
    lineas.push({
      cuenta,
      descripcion: label(concepto),
      debe: 0,
      haber: monto,
      cuentaContable: cuenta,
      obraId: null,
      cuentaOrigen: 'AUTOMATICO',
    });
  };
  haber('essalud_por_pagar', totEssalud);
  haber('afp_por_pagar', totAfp);
  haber('onp_por_pagar', totOnp);
  haber('renta5ta_por_pagar', totRenta);
  haber('otros_por_pagar', totOtros);
  haber('neto_por_pagar', totNeto);

  // Pago (opción A): el 411 queda escrito en los dos lados — se lee qué se devengó y qué se pagó.
  // Si totNeto < MIN no hay nada que pagar: ni líneas de pago ni movimiento.
  if (cuentaBanco && totNeto >= MIN) {
    const c411 = cta('neto_por_pagar');
    lineas.push({
      cuenta: c411, descripcion: 'Pago de planilla · neto', debe: totNeto, haber: 0,
      cuentaContable: c411, obraId: null, cuentaOrigen: 'AUTOMATICO',
    });
    lineas.push({
      cuenta: cuentaBanco, descripcion: 'Pago de planilla · banco', debe: 0, haber: totNeto,
      cuentaContable: cuentaBanco, obraId: null, cuentaOrigen: 'AUTOMATICO',
    });
  }

  return { lineas, totalNeto: totNeto };
}

export async function cargarMapaConceptos(): Promise<Record<string, string>> {
  const rows = await db.select().from(schema.planillaOficinaConceptoCuenta);
  const mapa: Record<string, string> = {};
  for (const r of rows) if (CONCEPTOS_SET.has(r.concepto)) mapa[r.concepto] = r.cuenta;
  return mapa;
}

// Reglas de UNA empresa. El filtro es obligatorio: sin él el costo de la empresa 1
// se repartiría a obras de la empresa 2.
export async function cargarReglas(empresaId: number): Promise<ReglaDistribucion[]> {
  const rows = await db
    .select({
      empleadoId: schema.planillaOficinaDistribucion.empleadoId,
      obraId: schema.planillaOficinaDistribucion.obraId,
      pct: schema.planillaOficinaDistribucion.pct,
    })
    .from(schema.planillaOficinaDistribucion)
    .where(eq(schema.planillaOficinaDistribucion.empresaId, empresaId));
  return rows.map((r) => ({ empleadoId: r.empleadoId, obraId: r.obraId, pct: Number(r.pct) }));
}
```

- [ ] **Step 2: Escribir el arnés de aceptación y los casos 4, 5, 6 y el de fuga entre empresas**

Crear `apps/backend/scripts/oficina/test-planilla-f2.ts`. Este archivo crece en las Tasks 4 y 5.

```ts
/**
 * F2 planilla oficina · aceptación (spec §8).
 *   cd apps/backend && ./node_modules/.bin/tsx scripts/oficina/test-planilla-f2.ts
 * Requiere DATABASE_URL=erp_mmh_test. Imprime 'planilla-f2 VERDE' en éxito.
 * En Windows el exit code 9 es cosmético (libuv): éxito = VERDE impreso.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { db, schema } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { authMiddleware } from '../../src/middleware/auth.js';
import planillaOficinaRoutes from '../../src/routes/planillaOficina.js';
import { lucia } from '../../src/auth.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin
const MES = '2026-07'; // periodo abierto

(async () => {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/oficina', planillaOficinaRoutes);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://localhost:${port}`;

  const session = await lucia.createSession(USER, {});
  const cookie = lucia.createSessionCookie(session.id).serialize();
  const get = (p: string) => fetch(base + p, { headers: { cookie } });
  const send = (m: string, p: string, body?: unknown) =>
    fetch(base + p, {
      method: m,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body ?? {}),
    });

  // ── Fixtures: dos obras ──
  const obras = await db
    .select({ id: schema.proyectos.id, codigo: schema.proyectos.codigo })
    .from(schema.proyectos)
    .limit(2);
  assert.ok(obras.length === 2, 'se requieren 2 proyectos en erp_mmh_test');
  const [obraA, obraB] = obras as [(typeof obras)[0], (typeof obras)[0]];

  // La planilla del mes debe existir y estar calculada.
  const planilla = await get(`/api/oficina/planilla?mes=${MES}`).then((x) => x.json());
  assert.ok(planilla.mes?.id, `no hay planilla ${MES}; córrela con test-planilla-julio17 primero`);
  const mesId = planilla.mes.id as string;
  const empresaIdMes = planilla.mes.empresaId as number;

  // ── Caso 4 · asiento cuadra y la clase se deriva GG_OBRA / GG_CORP ──
  // 60% obraA / 40% oficina en modo global.
  let r = await send('PUT', '/api/oficina/planilla/distribucion', {
    empleadoId: null,
    filas: [{ obraId: obraA.id, pct: 60 }],
  });
  assert.equal(r.status, 200, await r.text());

  const prev = await get(`/api/oficina/planilla/${mesId}/asiento-preview`).then((x) => x.json());
  const sumDebe = prev.lineas.reduce((s: number, l: any) => s + Number(l.debe), 0);
  const sumHaber = prev.lineas.reduce((s: number, l: any) => s + Number(l.haber), 0);
  assert.equal(Math.round(sumDebe * 100), Math.round(sumHaber * 100), 'asiento no cuadra');
  assert.equal(prev.cuadra, true);

  const conObra = prev.lineas.filter((l: any) => l.obraId);
  assert.ok(conObra.length > 0, 'no hay líneas de costo con obra');
  for (const l of conObra) assert.equal(l.clase, 'GG_OBRA', `${l.cuenta} con obra debería ser GG_OBRA`);
  for (const l of prev.lineas.filter((l: any) => !l.obraId && Number(l.debe) > 0 && l.cuenta.startsWith('6'))) {
    assert.equal(l.clase, 'GG_CORP', `${l.cuenta} sin obra debería ser GG_CORP`);
  }

  // ── Caso 5 · pasivos y banco SIN dimensión obra ──
  const PASIVOS = ['4031', '407', '4032', '40173', '469', '411'];
  for (const l of prev.lineas) {
    if (PASIVOS.includes(l.cuenta) || l.cuenta.startsWith('104')) {
      assert.equal(l.obraId, null, `${l.cuenta} no debe llevar obra`);
    }
  }

  // ── Caso 6 · mapa editable: cambiar afp_por_pagar mueve SOLO esa línea ──
  if (prev.lineas.some((l: any) => l.cuenta === '407')) {
    const otras = prev.lineas.filter((l: any) => l.cuenta !== '407').map((l: any) => `${l.cuenta}|${l.debe}|${l.haber}`);
    r = await send('PUT', '/api/oficina/planilla/concepto-cuenta/afp_por_pagar', { cuenta: '469' });
    assert.equal(r.status, 200, await r.text());
    const prev2 = await get(`/api/oficina/planilla/${mesId}/asiento-preview`).then((x) => x.json());
    assert.equal(prev2.lineas.some((l: any) => l.cuenta === '407'), false, '407 debería haber desaparecido');
    // las líneas de costo no se movieron
    for (const clave of otras.filter((k: string) => k.startsWith('6'))) {
      assert.ok(
        prev2.lineas.some((l: any) => `${l.cuenta}|${l.debe}|${l.haber}` === clave),
        `la línea ${clave} cambió y no debía`,
      );
    }
    await send('PUT', '/api/oficina/planilla/concepto-cuenta/afp_por_pagar', { cuenta: '407' }); // restaurar
  }

  // ── Review Focus · fuga entre empresas ──
  const empresas = await db.select({ id: schema.empresas.id }).from(schema.empresas);
  const ajena = empresas.find((e) => e.id !== empresaIdMes);
  if (ajena) {
    await db.insert(schema.planillaOficinaDistribucion)
      .values({ empresaId: ajena.id, empleadoId: null, obraId: obraB.id, pct: '100' })
      .onConflictDoNothing();
    const prev3 = await get(`/api/oficina/planilla/${mesId}/asiento-preview`).then((x) => x.json());
    assert.equal(
      prev3.lineas.some((l: any) => l.obraId === obraB.id),
      false,
      'una regla de otra empresa se filtró al reparto',
    );
    await db.delete(schema.planillaOficinaDistribucion).where(and(
      eq(schema.planillaOficinaDistribucion.empresaId, ajena.id),
      eq(schema.planillaOficinaDistribucion.obraId, obraB.id),
    ));
  } else {
    console.log('AVISO: solo hay una empresa en la DB; el caso de fuga entre empresas no se ejerció');
  }

  server.close();
  console.log('planilla-f2 VERDE');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Correr el test y ver que falla**

```bash
cd apps/backend
DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" ./node_modules/.bin/tsx scripts/oficina/test-planilla-f2.ts
```

Esperado: FALLA en el primer `assert.equal(r.status, 200, ...)` porque `PUT /planilla/distribucion` aún no existe (404, se implementa en Task 4). Comentar temporalmente ese `assert` NO es aceptable; el fallo esperado en ESTA task es que `asiento-preview` responde 404. Verificarlo directo:

```bash
cd apps/backend
DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" ./node_modules/.bin/tsx -e "console.log('preview aún no existe')"
```

El criterio operativo de esta task: tras el Step 6, `GET /planilla/:mesId/asiento-preview` responde 200 con líneas que cuadran. El VERDE completo llega en Task 4.

- [ ] **Step 4: Añadir el validador de cuenta bancaria**

En `apps/backend/src/routes/planillaOficina.ts`, junto a `getConfig()` en el bloque de helpers:

```ts
// ─── validarCuentaBanco ───────────────────────────────────────
// La cuenta debe existir, estar activa, ser PEN (el asiento se postea en moneda base)
// y tener su 104x configurada y activa en el plan.
async function validarCuentaBanco(
  cuentaBancariaId: string,
): Promise<{ cuentaContable: string } | { error: string }> {
  const [cb] = await db
    .select()
    .from(schema.cuentasBancarias)
    .where(eq(schema.cuentasBancarias.id, cuentaBancariaId))
    .limit(1);
  if (!cb) return { error: 'Cuenta bancaria no encontrada' };
  if (!cb.activo) return { error: `Cuenta bancaria '${cb.codigo}' está inactiva` };
  if (cb.moneda !== 'PEN') return { error: `Cuenta bancaria '${cb.codigo}' es ${cb.moneda}; la planilla se paga en PEN` };
  if (!cb.cuentaContable) return { error: `Cuenta bancaria '${cb.codigo}' sin cuenta contable 104x configurada` };

  const [pc] = await db
    .select({ activa: schema.planContable.activa })
    .from(schema.planContable)
    .where(eq(schema.planContable.codigo, cb.cuentaContable))
    .limit(1);
  if (!pc) return { error: `Cuenta contable ${cb.cuentaContable} no existe en el plan` };
  if (pc.activa === false) return { error: `Cuenta contable ${cb.cuentaContable} está inactiva` };

  return { cuentaContable: cb.cuentaContable };
}
```

- [ ] **Step 5: Añadir `GET /planilla/:mesId/asiento-preview`**

En el header de `apps/backend/src/routes/planillaOficina.ts`, añadir:

```ts
import { armarLineasCierre, cargarMapaConceptos, cargarReglas, CONCEPTOS, CONCEPTOS_SET } from '../lib/planillaOficinaAsiento.js';
```

y ampliar el import existente de clasificación a:

```ts
import { cargarDerivarCtx, derivarClaseCore } from '../lib/clasificacion.js';
```

Insertar el endpoint ANTES de `router.post('/planilla/:mesId/cerrar', ...)`:

```ts
// ─── GET /api/oficina/planilla/:mesId/asiento-preview ────────
// Mismas líneas que posteará `cerrar` (misma función), con la clase derivada por línea.
// Query opcional ?cuentaBancariaId= para ver también las dos líneas del pago.
router.get('/planilla/:mesId/asiento-preview', async (req, res) => {
  const { mesId } = req.params;
  const cuentaBancariaId = (req.query.cuentaBancariaId as string | undefined) ?? null;

  const [mesRow] = await db
    .select()
    .from(schema.planillaOficinaMes)
    .where(eq(schema.planillaOficinaMes.id, mesId!))
    .limit(1);
  if (!mesRow) return res.status(404).json({ error: 'Planilla mes no encontrada' });

  const detalle = await db
    .select()
    .from(schema.planillaOficinaDetalle)
    .where(eq(schema.planillaOficinaDetalle.planillaMesId, mesId!));
  if (detalle.length === 0) return res.status(400).json({ error: 'La planilla no tiene detalle; calcula primero' });

  let cuentaBanco: string | null = null;
  if (cuentaBancariaId) {
    const val = await validarCuentaBanco(cuentaBancariaId);
    if ('error' in val) return res.status(400).json({ error: val.error });
    cuentaBanco = val.cuentaContable;
  }

  const [reglas, mapa, derivarCtx] = await Promise.all([
    cargarReglas(mesRow.empresaId),
    cargarMapaConceptos(),
    cargarDerivarCtx(),
  ]);

  const { lineas, totalNeto } = armarLineasCierre({ detalle, reglas, mapa, cuentaBanco });

  const obrasRows = await db
    .select({ id: schema.proyectos.id, codigo: schema.proyectos.codigo, nombre: schema.proyectos.nombre })
    .from(schema.proyectos);
  const obraPorId = new Map(obrasRows.map((o) => [o.id, o]));

  const out = lineas.map((l) => ({
    cuenta: l.cuenta,
    descripcion: l.descripcion,
    debe: l.debe,
    haber: l.haber,
    obraId: l.obraId ?? null,
    obraCodigo: l.obraId ? obraPorId.get(l.obraId)?.codigo ?? null : null,
    obraNombre: l.obraId ? obraPorId.get(l.obraId)?.nombre ?? null : null,
    clase: derivarClaseCore(
      derivarCtx.clasificablePorCuenta.get(l.cuenta) ?? false,
      l.obraId,
      derivarCtx.claseObraPorCuenta.get(l.cuenta),
    ),
  }));

  const debe = Math.round(out.reduce((s, l) => s + Number(l.debe), 0) * 100) / 100;
  const haber = Math.round(out.reduce((s, l) => s + Number(l.haber), 0) * 100) / 100;

  res.json({ lineas: out, totales: { debe, haber }, cuadra: Math.abs(debe - haber) < 0.005, totalNeto });
});
```

- [ ] **Step 6: Hacer que `cerrar` delegue en el armador**

En `apps/backend/src/routes/planillaOficina.ts`, reemplazar TODO el bloque desde el comentario `// ── Step 3: Build accounting lines ──` hasta justo antes de `// ── Step 4: Create accounting entry via WS1 engine (idempotent) ──` por:

```ts
  // ── Step 3: Build accounting lines (F2 · misma función que asiento-preview) ──
  const [reglas, mapaConceptos] = await Promise.all([
    cargarReglas(mesRow.empresaId),
    cargarMapaConceptos(),
  ]);
  const { lineas } = armarLineasCierre({
    detalle: detalleRows,
    reglas,
    mapa: mapaConceptos,
    cuentaBanco: null, // Task 5 lo reemplaza por la cuenta elegida
  });
```

Quedan muertas y se eliminan del handler: `suelDoGroupMap`, `totalEssalud`, `totalAfp`, `totalOnp`, `totalRenta5ta`, `totalOtros`, `totalNeto`, el `for (const det of detalleRows)` que las llenaba, y los `lineas.push({...})` de sueldos, EsSalud y los seis pasivos. El resto del handler (crear asiento, actualizar mes, ledger renta5ta, boletas) no se toca.

- [ ] **Step 7: Verificar preview y regresión de cierre**

```bash
cd apps/backend
DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" ./node_modules/.bin/tsx scripts/oficina/test-cierre.ts
```

Esperado: `cierre VERDE`. Salvedad intencional: la oficina ya no usa `621` sino `6211` (spec §3.2). Si `test-cierre` asertaba `621`, actualizar esa expectativa a `6211` y dejarlo dicho en el mensaje del commit.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/lib/planillaOficinaAsiento.ts apps/backend/src/routes/planillaOficina.ts apps/backend/scripts/oficina/test-planilla-f2.ts apps/backend/scripts/oficina/test-cierre.ts
git commit -m "feat(planilla-oficina): armador unico de lineas + asiento-preview (oficina pasa a 6211/62711)"
```

---

### Task 4: Endpoints de configuración (distribución y mapa de cuentas)

**Files:**
- Modify: `apps/backend/src/routes/planillaOficina.ts` (4 endpoints nuevos, antes del bloque `// ─── GET /api/oficina/param-legal ───`)
- Modify: `apps/backend/scripts/oficina/test-planilla-f2.ts` (casos 1, 2, 3 y 11)

**Interfaces:**
- Consumes: `CONCEPTOS`, `CONCEPTOS_SET` (Task 3); `empresaIdDe(req)`, `requireOficinaEdit` (ya en el archivo); `inArray` (ya importado de `drizzle-orm`).
- Produces:
  - `GET /api/oficina/planilla/distribucion` → `{ global: Fila[], porEmpleado: [{ empleadoId, empleadoNombre, filas: Fila[] }] }` con `Fila = { obraId, obraCodigo, obraNombre, pct }`
  - `PUT /api/oficina/planilla/distribucion` body `{ empleadoId: string | null, filas: [{ obraId, pct }] }` → `{ empleadoId, filas, resto }`
  - `GET /api/oficina/planilla/concepto-cuenta` → `{ conceptos: [{ concepto, label, lado, reparte, cuenta, cuentaDefault, cuentaDescripcion }] }`
  - `PUT /api/oficina/planilla/concepto-cuenta/:concepto` body `{ cuenta }` → `{ conceptoCuenta }`

- [ ] **Step 1: Escribir los tests que fallan**

En `apps/backend/scripts/oficina/test-planilla-f2.ts`, insertar antes de `server.close();`:

```ts
  // ── Caso 1 · resolución por scope, vista desde el endpoint ──
  const detEmp = await db
    .select({ id: schema.planillaOficinaDetalle.empleadoId })
    .from(schema.planillaOficinaDetalle)
    .where(eq(schema.planillaOficinaDetalle.planillaMesId, mesId))
    .limit(1);
  const empId = detEmp[0]!.id;

  r = await send('PUT', '/api/oficina/planilla/distribucion', {
    empleadoId: empId,
    filas: [{ obraId: obraB.id, pct: 100 }],
  });
  assert.equal(r.status, 200, await r.text());

  const dist = await get('/api/oficina/planilla/distribucion').then((x) => x.json());
  assert.equal(dist.global.length, 1);
  assert.equal(dist.global[0].obraId, obraA.id);
  assert.ok(dist.global[0].obraCodigo, 'falta obraCodigo en el global');
  const mio = dist.porEmpleado.find((p: any) => p.empleadoId === empId);
  assert.ok(mio, 'el empleado con reglas propias no aparece en porEmpleado');
  assert.equal(mio.filas.length, 1);
  assert.equal(mio.filas[0].obraId, obraB.id);
  assert.ok(mio.empleadoNombre, 'falta empleadoNombre');

  // ── Casos 2/3 · el empleado con regla propia manda; el resto hereda el global y deja resto en oficina ──
  const prevMix = await get(`/api/oficina/planilla/${mesId}/asiento-preview`).then((x) => x.json());
  assert.ok(prevMix.lineas.some((l: any) => l.obraId === obraB.id), 'falta la obra del empleado propio');
  assert.ok(prevMix.lineas.some((l: any) => l.obraId === obraA.id), 'falta la obra del global');
  assert.ok(
    prevMix.lineas.some((l: any) => !l.obraId && Number(l.debe) > 0 && l.cuenta.startsWith('6')),
    'el 40% restante debería quedar en oficina (obraId null)',
  );

  // ── Caso 11 · validaciones ──
  const casos: Array<[unknown, string]> = [
    [{ empleadoId: null, filas: [{ obraId: obraA.id, pct: 60 }, { obraId: obraB.id, pct: 50 }] }, 'Σ > 100'],
    [{ empleadoId: null, filas: [{ obraId: obraA.id, pct: 0 }] }, 'pct = 0'],
    [{ empleadoId: null, filas: [{ obraId: obraA.id, pct: -5 }] }, 'pct negativo'],
    [{ empleadoId: null, filas: [{ obraId: obraA.id, pct: 'abc' }] }, 'pct no numérico'],
    [{ empleadoId: null, filas: [{ obraId: obraA.id }] }, 'pct ausente'],
    [{ empleadoId: null, filas: [{ obraId: '00000000-0000-0000-0000-000000000000', pct: 10 }] }, 'obra inexistente'],
    [{ empleadoId: null, filas: [{ obraId: obraA.id, pct: 10 }, { obraId: obraA.id, pct: 20 }] }, 'obra repetida'],
    [{ empleadoId: null }, 'filas ausente'],
  ];
  for (const [body, que] of casos) {
    const bad = await send('PUT', '/api/oficina/planilla/distribucion', body);
    assert.equal(bad.status, 400, `${que} debería dar 400, dio ${bad.status}`);
  }

  // concepto fuera del conjunto cerrado / cuenta inexistente → 400
  assert.equal((await send('PUT', '/api/oficina/planilla/concepto-cuenta/inventado', { cuenta: '6211' })).status, 400);
  assert.equal((await send('PUT', '/api/oficina/planilla/concepto-cuenta/sueldos', { cuenta: '999999' })).status, 400);
  assert.equal((await send('PUT', '/api/oficina/planilla/concepto-cuenta/sueldos', {})).status, 400);

  // el global sigue intacto tras los rechazos: el PUT reemplaza el scope entero o nada
  const distTras = await get('/api/oficina/planilla/distribucion').then((x) => x.json());
  assert.equal(distTras.global.length, 1);
  assert.equal(Number(distTras.global[0].pct), 60);

  // mapa de conceptos: los 8, todos con cuenta y label
  const mapaRes = await get('/api/oficina/planilla/concepto-cuenta').then((x) => x.json());
  assert.equal(mapaRes.conceptos.length, 8);
  for (const c of mapaRes.conceptos) assert.ok(c.cuenta && c.label, `concepto ${c.concepto} incompleto`);

  // limpiar las reglas del empleado para no ensuciar corridas siguientes
  await send('PUT', '/api/oficina/planilla/distribucion', { empleadoId: empId, filas: [] });
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd apps/backend
DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" ./node_modules/.bin/tsx scripts/oficina/test-planilla-f2.ts
```

Esperado: FALLA con `404` en el primer `assert.equal(r.status, 200, ...)` — el endpoint no existe.

- [ ] **Step 3: Implementar los endpoints de distribución**

En `apps/backend/src/routes/planillaOficina.ts`, antes del bloque `// ─── GET /api/oficina/param-legal ───`:

```ts
// ─── GET /api/oficina/planilla/distribucion ──────────────────
// Reglas de la empresa activa: scope global + scopes por empleado, con nombres legibles.
router.get('/planilla/distribucion', async (req, res) => {
  const empresaId = await empresaIdDe(req);

  const rows = await db
    .select({
      empleadoId: schema.planillaOficinaDistribucion.empleadoId,
      obraId: schema.planillaOficinaDistribucion.obraId,
      pct: schema.planillaOficinaDistribucion.pct,
      obraCodigo: schema.proyectos.codigo,
      obraNombre: schema.proyectos.nombre,
      empleadoNombre: schema.empleados.nombre,
    })
    .from(schema.planillaOficinaDistribucion)
    .innerJoin(schema.proyectos, eq(schema.planillaOficinaDistribucion.obraId, schema.proyectos.id))
    .leftJoin(schema.empleados, eq(schema.planillaOficinaDistribucion.empleadoId, schema.empleados.id))
    .where(eq(schema.planillaOficinaDistribucion.empresaId, empresaId));

  type Fila = { obraId: string; obraCodigo: string; obraNombre: string; pct: number };
  const global: Fila[] = rows
    .filter((r) => r.empleadoId === null)
    .map((r) => ({ obraId: r.obraId, obraCodigo: r.obraCodigo, obraNombre: r.obraNombre, pct: Number(r.pct) }))
    .sort((a, b) => a.obraCodigo.localeCompare(b.obraCodigo));

  const porEmpleadoMap = new Map<string, { empleadoId: string; empleadoNombre: string | null; filas: Fila[] }>();
  for (const r of rows) {
    if (!r.empleadoId) continue;
    const entry = porEmpleadoMap.get(r.empleadoId) ?? {
      empleadoId: r.empleadoId,
      empleadoNombre: r.empleadoNombre,
      filas: [],
    };
    entry.filas.push({ obraId: r.obraId, obraCodigo: r.obraCodigo, obraNombre: r.obraNombre, pct: Number(r.pct) });
    porEmpleadoMap.set(r.empleadoId, entry);
  }

  res.json({ global, porEmpleado: [...porEmpleadoMap.values()] });
});

// ─── PUT /api/oficina/planilla/distribucion ──────────────────
// Reemplaza el SCOPE COMPLETO (borra + inserta en una transacción). empleadoId null = global.
// Reemplazar en vez de parchear hace la operación idempotente y deja imposible un
// estado intermedio con Σ > 100. filas: [] borra el scope (vuelve a heredar el global).
router.put('/planilla/distribucion', requireOficinaEdit, async (req, res) => {
  const empresaId = await empresaIdDe(req);
  const b = req.body as { empleadoId?: unknown; filas?: unknown };

  const empleadoId = b.empleadoId === null || b.empleadoId === undefined ? null : String(b.empleadoId);
  if (!Array.isArray(b.filas)) return res.status(400).json({ error: 'Campo filas requerido (array)' });

  const filas: Array<{ obraId: string; pct: number }> = [];
  const vistas = new Set<string>();
  let suma = 0;

  for (const f of b.filas as Array<Record<string, unknown>>) {
    const obraId = f?.obraId === undefined || f?.obraId === null ? '' : String(f.obraId);
    if (!obraId) return res.status(400).json({ error: 'Cada fila requiere obraId' });
    if (vistas.has(obraId)) return res.status(400).json({ error: `Obra repetida: ${obraId}` });
    vistas.add(obraId);

    // Number(undefined) y Number('abc') son NaN: rechazar ANTES de tocar la columna decimal.
    if (f.pct === undefined || f.pct === null || !Number.isFinite(Number(f.pct))) {
      return res.status(400).json({ error: `Campo pct requerido y numérico (obra ${obraId})` });
    }
    const pct = Math.round(Number(f.pct) * 100) / 100;
    if (pct <= 0) return res.status(400).json({ error: `pct debe ser mayor que 0 (obra ${obraId})` });
    if (pct > 100) return res.status(400).json({ error: `pct no puede pasar de 100 (obra ${obraId})` });

    suma = Math.round((suma + pct) * 100) / 100;
    filas.push({ obraId, pct });
  }

  if (suma > 100) return res.status(400).json({ error: `La suma de porcentajes es ${suma}; no puede pasar de 100` });

  if (empleadoId) {
    const [emp] = await db
      .select({ id: schema.empleados.id })
      .from(schema.empleados)
      .where(eq(schema.empleados.id, empleadoId))
      .limit(1);
    if (!emp) return res.status(400).json({ error: 'Empleado no encontrado' });
  }

  if (filas.length > 0) {
    const obrasOk = await db
      .select({ id: schema.proyectos.id })
      .from(schema.proyectos)
      .where(inArray(schema.proyectos.id, filas.map((f) => f.obraId)));
    const set = new Set(obrasOk.map((o) => o.id));
    const faltante = filas.find((f) => !set.has(f.obraId));
    if (faltante) return res.status(400).json({ error: `Obra no encontrada: ${faltante.obraId}` });
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.planillaOficinaDistribucion).where(and(
      eq(schema.planillaOficinaDistribucion.empresaId, empresaId),
      empleadoId
        ? eq(schema.planillaOficinaDistribucion.empleadoId, empleadoId)
        : sql`${schema.planillaOficinaDistribucion.empleadoId} IS NULL`,
    ));
    if (filas.length > 0) {
      await tx.insert(schema.planillaOficinaDistribucion).values(
        filas.map((f) => ({ empresaId, empleadoId, obraId: f.obraId, pct: String(f.pct) })),
      );
    }
  });

  res.json({ empleadoId, filas, resto: Math.round((100 - suma) * 100) / 100 });
});
```

Nota sobre UUID mal formado: el test usa el UUID nulo (`00000000-…`), sintácticamente válido, que cae en el 400 de "Obra no encontrada". Una cadena que no sea UUID hace fallar el `inArray` con error de sintaxis de Postgres → 500 del handler de errores de Express. No se añade validación de formato: la UI solo envía IDs de un selector.

- [ ] **Step 4: Implementar los endpoints del mapa de cuentas**

A continuación, en el mismo archivo:

```ts
// ─── GET /api/oficina/planilla/concepto-cuenta ───────────────
// Conjunto CERRADO de conceptos con la cuenta vigente y su descripción del plan.
router.get('/planilla/concepto-cuenta', async (_req, res) => {
  const rows = await db.select().from(schema.planillaOficinaConceptoCuenta);
  const porConcepto = new Map(rows.map((r) => [r.concepto, r.cuenta]));

  const plan = await db
    .select({ codigo: schema.planContable.codigo, descripcion: schema.planContable.descripcion })
    .from(schema.planContable);
  const desc = new Map(plan.map((p) => [p.codigo, p.descripcion]));

  const conceptos = CONCEPTOS.map((c) => {
    const cuenta = porConcepto.get(c.concepto) ?? c.cuentaDefault;
    return {
      concepto: c.concepto,
      label: c.label,
      lado: c.lado,
      reparte: c.reparte,
      cuenta,
      cuentaDefault: c.cuentaDefault,
      cuentaDescripcion: desc.get(cuenta) ?? null,
    };
  });

  res.json({ conceptos });
});

// ─── PUT /api/oficina/planilla/concepto-cuenta/:concepto ─────
router.put('/planilla/concepto-cuenta/:concepto', requireOficinaEdit, async (req, res) => {
  const concepto = decodeURIComponent(req.params.concepto ?? '').trim();
  if (!CONCEPTOS_SET.has(concepto)) {
    return res.status(400).json({ error: `Concepto '${concepto}' no existe; el conjunto es cerrado` });
  }

  const cuenta = typeof req.body?.cuenta === 'string' ? req.body.cuenta.trim() : '';
  if (!cuenta) return res.status(400).json({ error: 'Campo cuenta requerido' });

  const [pc] = await db
    .select({ codigo: schema.planContable.codigo, activa: schema.planContable.activa })
    .from(schema.planContable)
    .where(eq(schema.planContable.codigo, cuenta))
    .limit(1);
  if (!pc) return res.status(400).json({ error: `Cuenta ${cuenta} no existe en el plan contable` });
  if (pc.activa === false) return res.status(400).json({ error: `Cuenta ${cuenta} está inactiva` });

  const [row] = await db
    .insert(schema.planillaOficinaConceptoCuenta)
    .values({ concepto, cuenta })
    .onConflictDoUpdate({
      target: schema.planillaOficinaConceptoCuenta.concepto,
      set: { cuenta, actualizadoEn: new Date() },
    })
    .returning();

  res.json({ conceptoCuenta: row });
});
```

- [ ] **Step 5: Correr el test y ver que pasa**

```bash
cd apps/backend
DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" ./node_modules/.bin/tsx scripts/oficina/test-planilla-f2.ts
```

Esperado: `planilla-f2 VERDE`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/planillaOficina.ts apps/backend/scripts/oficina/test-planilla-f2.ts
git commit -m "feat(planilla-oficina): endpoints de distribucion por obra y mapa concepto-cuenta"
```

---

### Task 5: Pago desde banco, skip en `/generar` y guardarraíl de reapertura

**Files:**
- Modify: `apps/backend/src/routes/planillaOficina.ts` (handler `cerrar` ~línea 746; handler `reabrir` ~línea 1084)
- Modify: `apps/backend/src/routes/contabilidad.ts:837` (contador `movSkip`) y `:1180-1183` (loop del pass 5)
- Modify: `apps/backend/scripts/oficina/test-planilla-f2.ts` (casos 8, 9, 10, 12 y el resto del 11)

**Interfaces:**
- Consumes: `validarCuentaBanco`, `armarLineasCierre`, `cargarReglas`, `cargarMapaConceptos` (Task 3); `schema.movimientos.planillaOficinaMesId` (Task 1).
- Produces:
  - `POST /api/oficina/planilla/:mesId/cerrar` acepta body `{ cuentaBancariaId?: string }` y devuelve `{ mes, asientoId, movimientoId: string | null, boletasSubidas, boletasFallidas }`
  - `POST /api/oficina/planilla/:mesId/reabrir` devuelve 409 si el movimiento ligado está conciliado
  - `resultado.movSkip.planillaOficina` en la respuesta de `POST /api/contabilidad/generar`

- [ ] **Step 1: Escribir los tests que fallan**

En `apps/backend/scripts/oficina/test-planilla-f2.ts`, insertar antes de `server.close();`. Añadir `import contabilidadRoutes from '../../src/routes/contabilidad.js';` al header y `app.use('/api/contabilidad', contabilidadRoutes);` junto al otro `app.use`.

```ts
  // ── Fixture: una cuenta bancaria PEN activa con 104x ──
  const cuentas = await db.select().from(schema.cuentasBancarias);
  const cbOk = cuentas.find((c) => c.activo && c.moneda === 'PEN' && !!c.cuentaContable);
  assert.ok(cbOk, 'se requiere una cuenta bancaria PEN activa con cuentaContable');

  // ── Caso 11 (resto) · cuenta bancaria inválida → 400 (Review Focus) ──
  const cbUsd = cuentas.find((c) => c.moneda !== 'PEN');
  if (cbUsd) {
    const bad = await get(`/api/oficina/planilla/${mesId}/asiento-preview?cuentaBancariaId=${cbUsd.id}`);
    assert.equal(bad.status, 400, 'cuenta en moneda distinta de PEN debería dar 400');
  }
  const cbInactiva = cuentas.find((c) => !c.activo);
  if (cbInactiva) {
    const bad = await get(`/api/oficina/planilla/${mesId}/asiento-preview?cuentaBancariaId=${cbInactiva.id}`);
    assert.equal(bad.status, 400, 'cuenta inactiva debería dar 400');
  }
  const badId = await get(`/api/oficina/planilla/${mesId}/asiento-preview?cuentaBancariaId=00000000-0000-0000-0000-000000000000`);
  assert.equal(badId.status, 400, 'cuenta inexistente debería dar 400');

  // ── Caso 7 · preview == cerrar ──
  const prevPago = await get(
    `/api/oficina/planilla/${mesId}/asiento-preview?cuentaBancariaId=${cbOk.id}`,
  ).then((x) => x.json());

  // dejar la planilla en 'calculada' antes de cerrar
  if (planilla.mes.estado === 'cerrada') {
    const re = await send('POST', `/api/oficina/planilla/${mesId}/reabrir`);
    assert.equal(re.status, 200, await re.text());
  }

  const cerrada = await send('POST', `/api/oficina/planilla/${mesId}/cerrar`, { cuentaBancariaId: cbOk.id });
  assert.equal(cerrada.status, 200, await cerrada.text());
  const cerradaBody = await cerrada.json();
  const asientoId = cerradaBody.asientoId as string;
  assert.ok(cerradaBody.movimientoId, 'cerrar con cuenta bancaria debe devolver movimientoId');

  const lineasPosteadas = await db
    .select()
    .from(schema.asientosLineas)
    .where(eq(schema.asientosLineas.asientoId, asientoId));

  const clave = (l: { cuenta: string; debe: unknown; haber: unknown; obraId?: unknown }) =>
    `${l.cuenta}|${Number(l.debe).toFixed(2)}|${Number(l.haber).toFixed(2)}|${l.obraId ?? ''}`;
  const setPrev = new Set(prevPago.lineas.map((l: any) => clave(l)));
  for (const l of lineasPosteadas) {
    assert.ok(setPrev.has(clave(l as any)), `la línea posteada ${clave(l as any)} no estaba en el preview`);
  }
  assert.equal(lineasPosteadas.length, prevPago.lineas.length, 'preview y asiento tienen distinto número de líneas');

  // ── Caso 8 · pago desde banco: 411 debe + 104x haber, y UN movimiento ──
  const neto = Number(prevPago.totalNeto);
  assert.ok(
    lineasPosteadas.some((l) => l.cuenta === '411' && Math.abs(Number(l.debe) - neto) < 0.005),
    'falta la línea 411 debe por el neto',
  );
  assert.ok(
    lineasPosteadas.some((l) => l.cuenta === cbOk.cuentaContable && Math.abs(Number(l.haber) - neto) < 0.005),
    'falta la línea 104x haber por el neto',
  );

  const movs = await db
    .select()
    .from(schema.movimientos)
    .where(eq(schema.movimientos.planillaOficinaMesId, mesId));
  assert.equal(movs.length, 1, `esperaba 1 movimiento de planilla, hay ${movs.length}`);
  assert.equal(movs[0]!.tipoMovimiento, 'Egreso');
  assert.equal(movs[0]!.proyectoId, null, 'el movimiento no lleva proyecto: el reparto vive en el asiento');
  assert.equal(Math.abs(Number(movs[0]!.monto) - neto) < 0.005, true);

  // ── Caso 9 · idempotencia: cerrar de nuevo no duplica ──
  const otraVez = await send('POST', `/api/oficina/planilla/${mesId}/cerrar`, { cuentaBancariaId: cbOk.id });
  assert.equal(otraVez.status, 400, 'ya cerrada → 400 (solo se cierra en estado calculada)');
  const movs2 = await db.select().from(schema.movimientos).where(eq(schema.movimientos.planillaOficinaMesId, mesId));
  assert.equal(movs2.length, 1, 'el reintento duplicó el movimiento');

  // ── Caso 10 · el pass de movimientos de /generar salta el movimiento de planilla ──
  const gen = await send('POST', '/api/contabilidad/generar?dryRun=1', {
    desde: `${MES}-01`,
    hasta: `${MES}-31`,
    cutover: `${MES}-01`, // cutover simulado ≤ la fecha del movimiento
  }).then((x) => x.json());
  assert.ok(gen.movSkip, 'la respuesta de /generar no trae movSkip');
  assert.ok(gen.movSkip.planillaOficina >= 1, 'el pass 5 no saltó el movimiento de planilla');

  // ── Caso 12 · guardarraíl de reapertura: conciliado → 409, el movimiento sobrevive ──
  const movId = movs[0]!.id;
  const [extracto] = await db.select().from(schema.extractosBancarios).limit(1);
  if (extracto) {
    const [linea] = await db
      .insert(schema.extractoLineas)
      .values({
        extractoId: extracto.id,
        fecha: `${MES}-30`,
        descripcion: 'test F2 conciliacion',
        monto: String(-neto),
        estado: 'conciliado',
        movimientoId: movId,
      })
      .returning();

    const bloqueado = await send('POST', `/api/oficina/planilla/${mesId}/reabrir`);
    assert.equal(bloqueado.status, 409, `movimiento conciliado debería dar 409, dio ${bloqueado.status}`);
    const sobrevive = await db.select().from(schema.movimientos).where(eq(schema.movimientos.id, movId));
    assert.equal(sobrevive.length, 1, 'el movimiento conciliado se borró');

    await db.delete(schema.extractoLineas).where(eq(schema.extractoLineas.id, linea!.id));
  } else {
    console.log('AVISO: sin extractos bancarios en la DB; el caso 12 no se ejerció');
  }

  // ── Caso 9 (cont.) · reabrir + recerrar deja el mismo estado ──
  const re2 = await send('POST', `/api/oficina/planilla/${mesId}/reabrir`);
  assert.equal(re2.status, 200, await re2.text());
  const movsTrasReabrir = await db.select().from(schema.movimientos).where(eq(schema.movimientos.planillaOficinaMesId, mesId));
  assert.equal(movsTrasReabrir.length, 0, 'reabrir debe borrar el movimiento no conciliado');

  const re3 = await send('POST', `/api/oficina/planilla/${mesId}/cerrar`, { cuentaBancariaId: cbOk.id });
  assert.equal(re3.status, 200, await re3.text());
  const movsFinal = await db.select().from(schema.movimientos).where(eq(schema.movimientos.planillaOficinaMesId, mesId));
  assert.equal(movsFinal.length, 1, 'recerrar debe dejar exactamente 1 movimiento');
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd apps/backend
DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" ./node_modules/.bin/tsx scripts/oficina/test-planilla-f2.ts
```

Esperado: FALLA en `assert.ok(cerradaBody.movimientoId, ...)` — `cerrar` ignora el body y no crea movimiento.

- [ ] **Step 3: Aceptar la cuenta bancaria en `cerrar`**

En `apps/backend/src/routes/planillaOficina.ts`, dentro de `router.post('/planilla/:mesId/cerrar', ...)`:

1. Justo tras `const { mesId } = req.params;`, añadir:

```ts
  const cuentaBancariaId = typeof req.body?.cuentaBancariaId === 'string' ? req.body.cuentaBancariaId : null;
```

2. Tras el guard de `detalleRows.length === 0`, validar la cuenta antes de tocar nada:

```ts
  // F2 · si Kelly eligió cuenta, validar ANTES de aplicar cuotas (un 400 tardío dejaría
  // las cuotas aplicadas sin asiento).
  let cuentaBanco: string | null = null;
  if (cuentaBancariaId) {
    const val = await validarCuentaBanco(cuentaBancariaId);
    if ('error' in val) return res.status(400).json({ error: val.error });
    cuentaBanco = val.cuentaContable;
  }
```

3. En la llamada a `armarLineasCierre` del Step 6 de la Task 3, cambiar `cuentaBanco: null` por `cuentaBanco`:

```ts
  const { lineas, totalNeto } = armarLineasCierre({
    detalle: detalleRows,
    reglas,
    mapa: mapaConceptos,
    cuentaBanco,
  });
```

- [ ] **Step 4: Crear el movimiento de tesorería (idempotente)**

En el mismo handler, entre `// ── Step 5: Update mes row ──` y `// ── Step 5b: Upsert renta5ta_mes ledger rows ──`, insertar:

```ts
  // ── Step 5a: Movimiento de tesorería del pago (F2 · idempotente por planillaOficinaMesId) ──
  // proyectoId null a propósito: un movimiento tiene un solo proyecto y el costo puede estar
  // repartido entre varias obras. La dimensión obra vive en las líneas del asiento.
  let movimientoId: string | null = null;
  if (cuentaBanco && cuentaBancariaId && totalNeto >= 0.005) {
    const [existenteMov] = await db
      .select({ id: schema.movimientos.id })
      .from(schema.movimientos)
      .where(and(
        eq(schema.movimientos.planillaOficinaMesId, mesId!),
        eq(schema.movimientos.anulado, false),
      ))
      .limit(1);

    if (existenteMov) {
      movimientoId = existenteMov.id;
    } else {
      const [mov] = await db
        .insert(schema.movimientos)
        .values({
          fecha,
          tipoMovimiento: 'Egreso',
          cuentaId: cuentaBancariaId,
          moneda: 'PEN',
          monto: String(totalNeto),
          montoBase: String(totalNeto), // PEN = moneda base; tipoCambio queda null
          descripcion: `Planilla oficina ${mesRow.mes}`,
          subtipo: 'Planilla',
          proyectoId: null,
          planillaOficinaMesId: mesId!,
          estado: 'Pagada',
          userId: req.user!.id,
        })
        .returning({ id: schema.movimientos.id });
      movimientoId = mov!.id;
    }
  }
```

`codigo` queda null: el correlativo lo genera la ruta de movimientos y este movimiento no nace de ahí. No es un campo obligatorio.

4. Cambiar la respuesta final del handler:

```ts
  res.json({ mes: updatedMes, asientoId, movimientoId, boletasSubidas, boletasFallidas: boletaErrores.length });
```

- [ ] **Step 5: Guardarraíl y borrado en `reabrir`**

En `router.post('/planilla/:mesId/reabrir', ...)`, tras el guard de `periodoCerrado` y ANTES de `const result = await db.transaction(...)`:

```ts
  // F2 · el movimiento del pago se borra al reabrir, salvo que ya esté conciliado:
  // borrarlo desharía en silencio una conciliación cerrada (extracto_lineas.movimiento_id
  // es ON DELETE SET NULL, así que la línea del banco quedaría suelta sin aviso).
  const movsPlanilla = await db
    .select({ id: schema.movimientos.id })
    .from(schema.movimientos)
    .where(eq(schema.movimientos.planillaOficinaMesId, mesId!));

  if (movsPlanilla.length > 0) {
    const ids = movsPlanilla.map((m) => m.id);
    const conciliadas = await db
      .select({ id: schema.extractoLineas.id, movimientoId: schema.extractoLineas.movimientoId })
      .from(schema.extractoLineas)
      .where(and(
        inArray(schema.extractoLineas.movimientoId, ids),
        eq(schema.extractoLineas.estado, 'conciliado'),
      ));
    if (conciliadas.length > 0) {
      return res.status(409).json({
        error: 'El movimiento del pago de esta planilla está conciliado con el extracto bancario; desconcílialo antes de reabrir',
        lineasConciliadas: conciliadas.map((c) => c.id),
      });
    }
  }
```

Y dentro de la transacción, junto al borrado del asiento:

```ts
    // Borrar el movimiento del pago (ya se verificó que no está conciliado)
    if (movsPlanilla.length > 0) {
      await tx.delete(schema.movimientos).where(inArray(schema.movimientos.id, movsPlanilla.map((m) => m.id)));
    }
```

- [ ] **Step 6: Hacer que el pass 5 de `/generar` salte el movimiento**

En `apps/backend/src/routes/contabilidad.ts:837`, ampliar el contador:

```ts
  const resultado = { gastos: 0, pagosOc: 0, valorizaciones: 0, cobros: 0, adelantos: 0, ventas: 0, planillas: 0, movimientos: 0, movSkip: { preCutover: 0, sinCuenta104x: 0, transferEspejo: 0, planillaOficina: 0 }, errores: [] as string[] };
```

En el loop del pass 5 (~línea 1180), justo después de `if (yaSet.has(...)) continue;` y ANTES del check de `movOwns`:

```ts
    // F2 · el asiento de la planilla de oficina YA acreditó el 104x por este neto.
    // Sin este skip, tras el cutover el banco se acreditaría dos veces.
    if (m.planillaOficinaMesId) { resultado.movSkip.planillaOficina++; continue; }
```

Va antes de `movOwns` a propósito: así el contador sube también con `CUTOVER=null`, que es lo que el test verifica hoy.

- [ ] **Step 7: Correr el test y ver que pasa**

```bash
cd apps/backend
DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" ./node_modules/.bin/tsx scripts/oficina/test-planilla-f2.ts
```

Esperado: `planilla-f2 VERDE`.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/routes/planillaOficina.ts apps/backend/src/routes/contabilidad.ts apps/backend/scripts/oficina/test-planilla-f2.ts
git commit -m "feat(planilla-oficina): pago del neto desde banco + skip en /generar + 409 si el movimiento esta conciliado"
```

---

### Task 6: Frontend — configuración del destino del costo, mapa de cuentas y diálogo de cierre

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` (bloque `oficina`, tras `putAfpTasa` ~línea 376; tipos al final del archivo)
- Modify: `apps/frontend/src/components/oficina/PlanillaOficinaTab.tsx` (`cerrarMut` ~línea 94; toolbar ~línea 172; `ConfigMotorPanel` ~línea 297; componentes nuevos al final)
- Test: `pnpm typecheck` en `apps/frontend` + verificación manual en el navegador

**Interfaces:**
- Consumes: los 5 endpoints de las Tasks 3-5; `api.proyectos.list()` → `{ proyectos: Proyecto[] }`, `api.planilla.listEmpleados('admin')` → `{ empleados: Empleado[] }`, `api.finanzas.listCuentas()` → `{ cuentas: CuentaBancaria[] }`; `Modal`, `SectionHeader`, `EditNum`, `cn`, `fmtPEN` (ya en el archivo).
- Produces: `api.oficina.getDistribucionOficina`, `putDistribucionOficina`, `getConceptoCuentaOficina`, `putConceptoCuentaOficina`, `getAsientoPreviewOficina`; `cerrarPlanillaOficina(mesId, cuentaBancariaId?)`; componentes `DistribucionSection`, `ConceptoCuentaSection`, `CerrarMesDialog`.

- [ ] **Step 1: Añadir tipos y llamadas en `api.ts`**

En `apps/frontend/src/lib/api.ts`, junto a los otros tipos de oficina:

```ts
export type DistribucionFila = { obraId: string; obraCodigo: string; obraNombre: string; pct: number };
export type DistribucionResponse = {
  global: DistribucionFila[];
  porEmpleado: Array<{ empleadoId: string; empleadoNombre: string | null; filas: DistribucionFila[] }>;
};
export type ConceptoCuenta = {
  concepto: string;
  label: string;
  lado: 'debe' | 'haber';
  reparte: boolean;
  cuenta: string;
  cuentaDefault: string;
  cuentaDescripcion: string | null;
};
export type AsientoPreviewLinea = {
  cuenta: string;
  descripcion: string;
  debe: number;
  haber: number;
  obraId: string | null;
  obraCodigo: string | null;
  obraNombre: string | null;
  clase: 'CD' | 'GG_OBRA' | 'GG_CORP' | null;
};
export type AsientoPreview = {
  lineas: AsientoPreviewLinea[];
  totales: { debe: number; haber: number };
  cuadra: boolean;
  totalNeto: number;
};
```

En el bloque `oficina`, tras `putAfpTasa`:

```ts
    // F2 · destino del costo, mapa de cuentas y vista previa del asiento
    getDistribucionOficina: () => req<DistribucionResponse>('/api/oficina/planilla/distribucion'),
    putDistribucionOficina: (empleadoId: string | null, filas: Array<{ obraId: string; pct: number }>) =>
      req<{ empleadoId: string | null; filas: Array<{ obraId: string; pct: number }>; resto: number }>(
        '/api/oficina/planilla/distribucion',
        { method: 'PUT', body: JSON.stringify({ empleadoId, filas }) },
      ),
    getConceptoCuentaOficina: () => req<{ conceptos: ConceptoCuenta[] }>('/api/oficina/planilla/concepto-cuenta'),
    putConceptoCuentaOficina: (concepto: string, cuenta: string) =>
      req<{ conceptoCuenta: { concepto: string; cuenta: string } }>(
        `/api/oficina/planilla/concepto-cuenta/${encodeURIComponent(concepto)}`,
        { method: 'PUT', body: JSON.stringify({ cuenta }) },
      ),
    getAsientoPreviewOficina: (mesId: string, cuentaBancariaId?: string | null) =>
      req<AsientoPreview>(
        `/api/oficina/planilla/${mesId}/asiento-preview${cuentaBancariaId ? `?cuentaBancariaId=${encodeURIComponent(cuentaBancariaId)}` : ''}`,
      ),
```

Y cambiar `cerrarPlanillaOficina` para que acepte la cuenta:

```ts
    cerrarPlanillaOficina: (mesId: string, cuentaBancariaId?: string | null) =>
      req<{ mes: PlanillaOficinaMes; asientoId: string; movimientoId: string | null }>(
        `/api/oficina/planilla/${mesId}/cerrar`,
        { method: 'POST', body: JSON.stringify(cuentaBancariaId ? { cuentaBancariaId } : {}) },
      ),
```

- [ ] **Step 2: Escribir el bloque de destino del costo**

Al final de `apps/frontend/src/components/oficina/PlanillaOficinaTab.tsx`:

```tsx
// ─── DistribucionSection · destino del costo por obra ─────────
// Selector Global | Por empleado. La fila "Oficina" es calculada (100 − Σ), no editable:
// es el resto, no un dato. Guardar reemplaza el scope completo (el backend borra + inserta).
function DistribucionSection({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const [scope, setScope] = useState<'global' | 'empleado'>('global');
  const [empleadoId, setEmpleadoId] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const { data: dist } = useQuery({ queryKey: ['oficina-distribucion'], queryFn: () => api.oficina.getDistribucionOficina() });
  const { data: proyectosData } = useQuery({ queryKey: ['proyectos'], queryFn: () => api.proyectos.list() });
  const { data: empleadosData } = useQuery({ queryKey: ['empleados', 'admin'], queryFn: () => api.planilla.listEmpleados('admin') });

  const obras = proyectosData?.proyectos ?? [];
  // el endpoint ya filtra por tipo, el filtro extra es defensivo por si devuelve todo
  const administrativos = (empleadosData?.empleados ?? []).filter((e) => e.tipoPlanilla === 'admin');

  // filas en edición: obraId → pct
  const guardadas = scope === 'global'
    ? dist?.global ?? []
    : dist?.porEmpleado.find((p) => p.empleadoId === empleadoId)?.filas ?? [];
  const [draft, setDraft] = useState<Record<string, number>>({});
  const filas = Object.keys(draft).length > 0
    ? draft
    : Object.fromEntries(guardadas.map((f) => [f.obraId, f.pct]));

  const suma = Math.round(Object.values(filas).reduce((s, v) => s + Number(v || 0), 0) * 100) / 100;
  const resto = Math.round((100 - suma) * 100) / 100;
  const hereda = scope === 'empleado' && !!empleadoId && guardadas.length === 0;

  const guardarMut = useMutation({
    mutationFn: () =>
      api.oficina.putDistribucionOficina(
        scope === 'global' ? null : empleadoId,
        Object.entries(filas).filter(([, pct]) => Number(pct) > 0).map(([obraId, pct]) => ({ obraId, pct: Number(pct) })),
      ),
    onSuccess: () => {
      setErr(null);
      setOkMsg('Distribución guardada');
      setDraft({});
      qc.invalidateQueries({ queryKey: ['oficina-distribucion'] });
    },
    onError: (e: Error) => { setOkMsg(null); setErr(e.message); },
  });

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-line p-0.5">
          {(['global', 'empleado'] as const).map((s) => (
            <button key={s} type="button"
              onClick={() => { setScope(s); setDraft({}); setErr(null); setOkMsg(null); }}
              className={cn('rounded px-2.5 py-1 text-[11.5px] font-medium',
                scope === s ? 'bg-primary text-primary-foreground' : 'text-ink-3 hover:text-ink-2')}>
              {s === 'global' ? 'Global' : 'Por empleado'}
            </button>
          ))}
        </div>
        {scope === 'empleado' && (
          <select value={empleadoId}
            onChange={(e) => { setEmpleadoId(e.target.value); setDraft({}); setErr(null); setOkMsg(null); }}
            className="h-8 rounded-md border border-line bg-bg-elev px-2 text-[11.5px]">
            <option value="">Elige un trabajador…</option>
            {administrativos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )}
      </div>

      {scope === 'empleado' && !empleadoId ? (
        <p className="text-[11.5px] text-ink-4">Elige un trabajador para definir su distribución propia.</p>
      ) : (
        <>
          {hereda && (
            <p className="text-[11.5px] text-ink-4">
              Sin reglas propias: hereda el global ({dist?.global.map((f) => `${f.obraCodigo} ${f.pct}%`).join(' · ') || '100% oficina'}).
              Al guardar aquí, el global deja de aplicarle.
            </p>
          )}
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="px-2 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-4">Obra</th>
                <th className="px-2 py-1.5 text-right font-mono text-[10px] uppercase tracking-wider text-ink-4">%</th>
              </tr>
            </thead>
            <tbody>
              {obras.map((o) => (
                <tr key={o.id} className="border-b border-line/60">
                  <td className="px-2 py-1.5 text-[11.5px]">{o.codigo} · {o.nombre}</td>
                  <td className="px-2 py-1">
                    <input type="number" step="0.01" min="0" max="100"
                      value={filas[o.id] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value === '' ? 0 : Number(e.target.value);
                        setDraft({ ...filas, [o.id]: Number.isFinite(v) ? v : 0 });
                      }}
                      className="h-7 w-24 rounded-md border border-line bg-bg-elev px-2 text-right font-mono text-[11.5px] tabular-nums" />
                  </td>
                </tr>
              ))}
              <tr className="bg-bg-sunken">
                <td className="px-2 py-1.5 text-[11.5px] font-medium text-ink-2">Oficina (gasto general corporativo)</td>
                <td className="px-2 py-1.5 text-right font-mono text-[11.5px] font-semibold tabular-nums">
                  {resto.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {resto < 0 && <p className="text-[11.5px] text-rose-600">La suma es {suma.toFixed(2)}: no puede pasar de 100.</p>}
          {err && <p className="text-[11.5px] text-rose-600">{err}</p>}
          {okMsg && <p className="text-[11.5px] text-emerald-600">{okMsg}</p>}

          <button type="button" disabled={resto < 0 || guardarMut.isPending}
            onClick={() => guardarMut.mutate()}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[11.5px] font-medium text-primary-foreground disabled:opacity-50">
            {guardarMut.isPending ? 'Guardando…' : 'Guardar distribución'}
          </button>
        </>
      )}
    </div>
  );
}
```

`api.planilla.listEmpleados(tipo?)` ya existe (`apps/frontend/src/lib/api.ts:318`) y devuelve `{ empleados: Empleado[] }`; `Empleado.tipoPlanilla` es `string`. No hay que añadir nada en `api.ts` para esto.

- [ ] **Step 3: Escribir el bloque del mapa de cuentas**

A continuación, en el mismo archivo:

```tsx
// ─── ConceptoCuentaSection · cuentas por concepto ─────────────
// Conjunto de conceptos cerrado (lo define el backend). Se edita la cuenta, no la lista.
// Misma mecánica que EditNum: guarda al salir del campo si cambió.
function ConceptoCuentaSection({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const [err, setErr] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['oficina-concepto-cuenta'], queryFn: () => api.oficina.getConceptoCuentaOficina() });

  const guardarMut = useMutation({
    mutationFn: ({ concepto, cuenta }: { concepto: string; cuenta: string }) =>
      api.oficina.putConceptoCuentaOficina(concepto, cuenta),
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ['oficina-concepto-cuenta'] }); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="space-y-2 rounded-md border border-line p-3">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            {['Concepto', 'Lado', 'Obra', 'Cuenta', 'Descripción'].map((h) => (
              <th key={h} className="px-2 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-4">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data?.conceptos ?? []).map((c) => (
            <tr key={c.concepto} className="border-b border-line/60">
              <td className="px-2 py-1.5 text-[11.5px]">{c.label}</td>
              <td className="px-2 py-1.5 text-[11.5px] text-ink-3">{c.lado === 'debe' ? 'Debe' : 'Haber'}</td>
              <td className="px-2 py-1.5 text-[11.5px] text-ink-3">{c.reparte ? 'se reparte' : 'agregado'}</td>
              <td className="px-2 py-1">
                <input type="text" defaultValue={c.cuenta} key={c.cuenta}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== c.cuenta) guardarMut.mutate({ concepto: c.concepto, cuenta: v });
                  }}
                  className="h-7 w-24 rounded-md border border-line bg-bg-elev px-2 font-mono text-[11.5px] tabular-nums" />
              </td>
              <td className="px-2 py-1.5 text-[11.5px] text-ink-4">{c.cuentaDescripcion ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && <p className="text-[11.5px] text-rose-600">{err}</p>}
      <p className="text-[11.5px] text-ink-4">
        La cuenta del sueldo definida por trabajador en la planilla manda sobre esta.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Colgar los dos bloques de `ConfigMotorPanel`**

En `ConfigMotorPanel` (~línea 297), añadir dos estados y dos secciones tras la de baseline:

```tsx
  const [openDist, setOpenDist] = useState(false);
  const [openCuentas, setOpenCuentas] = useState(false);
```

```tsx
      {/* Section 4: Destino del costo */}
      <div className="space-y-1">
        <SectionHeader title="Destino del costo (reparto por obra)" open={openDist} onToggle={() => setOpenDist((v) => !v)} />
        {openDist && <DistribucionSection qc={qc} />}
      </div>

      {/* Section 5: Cuentas por concepto */}
      <div className="space-y-1">
        <SectionHeader title="Cuentas por concepto del asiento" open={openCuentas} onToggle={() => setOpenCuentas((v) => !v)} />
        {openCuentas && <ConceptoCuentaSection qc={qc} />}
      </div>
```

- [ ] **Step 5: Escribir el diálogo de cierre**

Al final del archivo:

```tsx
// ─── CerrarMesDialog · cuenta bancaria + asiento antes de firmar ──
// Kelly ve el asiento ANTES de cerrar: es el momento en que su criterio importa.
function CerrarMesDialog({ mesId, mes, onClose, onConfirm, pending }: {
  mesId: string;
  mes: string;
  onClose: () => void;
  onConfirm: (cuentaBancariaId: string | null) => void;
  pending: boolean;
}) {
  const [cuentaId, setCuentaId] = useState<string>('');

  const { data: cuentasData } = useQuery({ queryKey: ['cuentas-bancarias'], queryFn: () => api.finanzas.listCuentas() });
  const cuentas = (cuentasData?.cuentas ?? []).filter((c) => c.activo && c.moneda === 'PEN' && !!c.cuentaContable);

  const { data: preview, isLoading, error } = useQuery({
    queryKey: ['oficina-asiento-preview', mesId, cuentaId],
    queryFn: () => api.oficina.getAsientoPreviewOficina(mesId, cuentaId || null),
  });

  const porObra = new Map<string, { codigo: string; monto: number }>();
  for (const l of preview?.lineas ?? []) {
    if (!l.obraId || Number(l.debe) <= 0) continue;
    const prev = porObra.get(l.obraId);
    porObra.set(l.obraId, { codigo: l.obraCodigo ?? l.obraId, monto: (prev?.monto ?? 0) + Number(l.debe) });
  }
  const oficina = (preview?.lineas ?? [])
    .filter((l) => !l.obraId && Number(l.debe) > 0 && l.cuenta.startsWith('6'))
    .reduce((s, l) => s + Number(l.debe), 0);

  return (
    <Modal title={`Cerrar planilla de ${mes}`} onClose={onClose}>
      <div className="space-y-4">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-4">Pagar el neto desde</span>
          <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}
            className="h-8 rounded-md border border-line bg-bg-elev px-2 text-[11.5px]">
            <option value="">Dejar como pasivo en 411 (pagar después)</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.banco ?? ''} {c.codigo} — {c.descripcion ?? ''}</option>
            ))}
          </select>
        </label>

        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4">Reparto del costo</div>
          <div className="space-y-0.5 text-[11.5px]">
            {[...porObra.values()].map((o) => (
              <div key={o.codigo} className="flex justify-between">
                <span>{o.codigo}</span><span className="font-mono tabular-nums">{fmtPEN(o.monto)}</span>
              </div>
            ))}
            {oficina > 0 && (
              <div className="flex justify-between text-ink-3">
                <span>Oficina (gasto general corporativo)</span>
                <span className="font-mono tabular-nums">{fmtPEN(oficina)}</span>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4">Asiento que se va a postear</div>
          {isLoading && <p className="text-[11.5px] text-ink-4">Cargando…</p>}
          {error && <p className="text-[11.5px] text-rose-600">{(error as Error).message}</p>}
          {preview && (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="border-b border-line bg-bg-sunken">
                    {['Cuenta', 'Descripción', 'Obra', 'Clase', 'Debe', 'Haber'].map((h, i) => (
                      <th key={h} className={cn('px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-4', i >= 4 ? 'text-right' : 'text-left')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.lineas.map((l, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="px-2 py-1 font-mono text-[11px] tabular-nums">{l.cuenta}</td>
                      <td className="px-2 py-1 text-[11px]">{l.descripcion}</td>
                      <td className="px-2 py-1 text-[11px] text-ink-3">{l.obraCodigo ?? '—'}</td>
                      <td className="px-2 py-1 text-[11px] text-ink-3">{l.clase ?? '—'}</td>
                      <td className="px-2 py-1 text-right font-mono text-[11px] tabular-nums">{Number(l.debe) > 0 ? fmtPEN(Number(l.debe)) : ''}</td>
                      <td className="px-2 py-1 text-right font-mono text-[11px] tabular-nums">{Number(l.haber) > 0 ? fmtPEN(Number(l.haber)) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line bg-bg-sunken">
                    <td colSpan={4} className="px-2 py-1.5 text-[11px] font-semibold text-ink-3">
                      {preview.cuadra ? 'Cuadra' : 'NO cuadra'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-[11px] font-bold tabular-nums">{fmtPEN(preview.totales.debe)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[11px] font-bold tabular-nums">{fmtPEN(preview.totales.haber)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="inline-flex h-9 items-center rounded-md border border-line px-3.5 text-[12.5px] font-medium text-ink-2 hover:bg-bg-sunken">
            Cancelar
          </button>
          <button type="button" disabled={pending || !preview?.cuadra}
            onClick={() => onConfirm(cuentaId || null)}
            className="inline-flex h-9 items-center rounded-md bg-emerald-600 px-3.5 text-[12.5px] font-medium text-white disabled:opacity-50">
            {pending ? 'Cerrando…' : 'Confirmar cierre'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 6: Enganchar el diálogo al botón "Cerrar mes"**

En `PlanillaOficinaTab`:

1. Añadir estado: `const [cerrarOpen, setCerrarOpen] = useState(false);`
2. Cambiar `cerrarMut` para que acepte la cuenta y cierre el diálogo:

```tsx
  const cerrarMut = useMutation({
    mutationFn: ({ id, cuentaBancariaId }: { id: string; cuentaBancariaId: string | null }) =>
      api.oficina.cerrarPlanillaOficina(id, cuentaBancariaId),
    onSuccess: (res) => {
      setErrMsg(null);
      setCerrarOpen(false);
      setAsientoMsg(
        res.movimientoId
          ? `Asiento generado: ${res.asientoId} · egreso registrado en tesorería`
          : `Asiento generado: ${res.asientoId} · el neto quedó como pasivo en 411`,
      );
      invalidate();
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 423) setErrMsg(`Periodo cerrado: ${e.message}`);
      else setErrMsg(e.message);
    },
  });
```

3. El botón abre el diálogo en vez de cerrar directo:

```tsx
        {planilla && estado === 'calculada' && (
          <button disabled={cerrarMut.isPending} onClick={() => setCerrarOpen(true)}
            className="inline-flex h-9 items-center rounded-md bg-emerald-600 px-3.5 text-[12.5px] font-medium text-white disabled:opacity-50">
            Cerrar mes
          </button>
        )}
```

4. Renderizar el diálogo junto a los otros modales:

```tsx
      {cerrarOpen && planilla && (
        <CerrarMesDialog
          mesId={planilla.id}
          mes={mes}
          pending={cerrarMut.isPending}
          onClose={() => setCerrarOpen(false)}
          onConfirm={(cuentaBancariaId) => cerrarMut.mutate({ id: planilla.id, cuentaBancariaId })}
        />
      )}
```

5. `reabrirMut`: añadir el 409 al manejo de errores, que ahora es un caso real:

```tsx
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 423) setErrMsg(`Periodo cerrado: ${e.message}`);
      else if (e instanceof ApiError && e.status === 409) setErrMsg(`No se puede reabrir: ${e.message}`);
      else setErrMsg(e.message);
    },
```

- [ ] **Step 7: Verificar tipos**

```bash
cd apps/frontend
pnpm typecheck
```

Esperado: sin errores. Si alguna llamada existente (`api.proyectos.list()`, `api.planilla.listEmpleados()`, `api.finanzas.listCuentas()`) tiene otra forma, el typecheck lo dice y se corrige ahí.

- [ ] **Step 8: Verificación manual**

Arrancar el dev server, entrar a Oficina → Planilla de oficina, mes `2026-07`:
1. Sub-tab Configuración del motor → "Destino del costo": poner 60% en una obra, guardar; la fila Oficina muestra 40.00.
2. "Cuentas por concepto": las 8 filas con su cuenta; cambiar una a un código inexistente muestra el error y no rompe la tabla.
3. Recalcular la planilla y pulsar "Cerrar mes": el diálogo muestra el reparto por obra y el asiento; elegir una cuenta bancaria añade las líneas `411`/`104x`; "Dejar como pasivo en 411" las quita.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/lib/api.ts apps/frontend/src/components/oficina/PlanillaOficinaTab.tsx
git commit -m "feat(planilla-oficina): UI de destino del costo, cuentas por concepto y dialogo de cierre con preview"
```

---

### Task 7: Regresión y documentación

**Files:**
- Modify: `docs/planilla-oficina-guia.md`
- Test: los cuatro scripts de regresión ya existentes + los dos de F2

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código. Deliverable: la suite verde y la guía al día.

- [ ] **Step 1: Correr la suite completa**

```bash
cd apps/backend
export DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test"
./node_modules/.bin/tsx scripts/oficina/test-distribucion.ts
./node_modules/.bin/tsx scripts/oficina/test-planilla-f2.ts
./node_modules/.bin/tsx scripts/oficina/test-planilla-julio17.ts
./node_modules/.bin/tsx scripts/oficina/test-calc.ts
./node_modules/.bin/tsx scripts/oficina/test-cierre.ts
./node_modules/.bin/tsx scripts/oficina/test-config-oficina.ts
```

(En PowerShell: `$env:DATABASE_URL="…"` en vez de `export`.)

Esperado: seis VERDE. Si alguno falla, arreglar el código —no el test— salvo que el fallo sea la expectativa `621 → 6211`, que es el cambio intencional de la spec §3.2.

- [ ] **Step 2: Verificar que el asiento de obreros no cambió**

```bash
cd apps/backend
DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" ./node_modules/.bin/tsx -e "
import { db, schema } from '@erp/db';
import { eq, inArray } from 'drizzle-orm';
const rows = await db.select({ cuenta: schema.asientosLineas.cuenta }).from(schema.asientosLineas)
  .where(inArray(schema.asientosLineas.cuenta, ['621','6271','6211','62711']));
const tally = {};
for (const r of rows) tally[r.cuenta] = (tally[r.cuenta] ?? 0) + 1;
console.log(tally);
process.exit(0);
"
```

Esperado: `621` y `6271` siguen presentes (planilla de obreros) y aparecen `6211`/`62711` (oficina). Si `621` desapareció, el armador se aplicó a obreros por error.

- [ ] **Step 3: Actualizar la guía**

En `docs/planilla-oficina-guia.md`, añadir una sección "Destino del costo y pago (F2)" que cubra:
- Cómo se reparte el costo: global vs por empleado, el empleado gana al global por completo, el resto hasta 100 va a oficina (`GG_CORP`).
- Que la oficina usa `6211` y `62711` (no `621`/`6271` de obreros) y que ambas están mapeadas a `GG_OBRA`, así que con obra dan `GG_OBRA` y sin obra `GG_CORP`.
- Que las cuentas por concepto se editan en Configuración del motor y que la cuenta puesta por trabajador manda sobre el mapa.
- Que al cerrar se puede elegir cuenta bancaria: se añaden `411 debe` / `104x haber` y nace un egreso en tesorería; si no se elige, el neto queda en `411`.
- Que reabrir borra el asiento y el egreso, y que devuelve 409 si el egreso ya está conciliado con el extracto.

- [ ] **Step 4: Commit**

```bash
git add docs/planilla-oficina-guia.md
git commit -m "docs(planilla-oficina): documenta destino del costo, cuentas por concepto y pago desde banco (F2)"
```

- [ ] **Step 5: Verificar el árbol limpio**

```bash
git status --short
git log --oneline -8
```

Esperado: nada pendiente de F2 y siete commits nuevos en `feat/rbac-multiempresa`.
