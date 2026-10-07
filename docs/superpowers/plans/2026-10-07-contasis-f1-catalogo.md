# F1 · Catálogo canónico CONTASIS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cargar las 3396 cuentas del plan de CONTASIS en `plan_contable` como catálogo canónico, con sus columnas propias (destino automático, análisis, centro de costos, formularios EEFF), sin alterar el comportamiento actual de ninguna cuenta ya en uso.

**Architecture:** Una migración SQL idempotente agrega columnas a `plan_contable` y crea `contasis_centro_costo` vacía. Un parser puro lee el Excel del plan y deriva nuestros campos (`tipo`, `nivel`, `parent_codigo`, `clasificable`) de los suyos; un loader hace upsert diferenciando códigos nuevos (inserta todo) de códigos compartidos (actualiza **solo** las columnas CONTASIS, no pisa nuestra data). Cierra una regresión que prueba que `derivarClase()` y las 39 cuentas en uso siguen comportándose igual.

**Tech Stack:** TypeScript + tsx (sin compilar), Drizzle ORM, PostgreSQL 18, `xlsx@0.18.5` (SheetJS, ya instalado), checks con `node:assert/strict` en scripts ejecutables (el repo no usa framework de test).

**Spec:** [docs/superpowers/specs/2026-10-07-contasis-espejo-design.md](../specs/2026-10-07-contasis-espejo-design.md)

## Global Constraints

- **DB de trabajo:** `erp_mmh_test`. `DATABASE_URL=postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test`. No tocar `erp_mmh` ni `erp_mmh_f4d`.
- **Migraciones:** archivo SQL a mano en `apps/backend/scripts/contasis/`, nombrado `YYYY-MM-DD-<nombre>.sql`, **idempotente** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`), envuelto en `BEGIN; … COMMIT;`. Es el patrón del repo (ver `apps/backend/scripts/oficina/2026-09-10-planilla-oficina-schema.sql`). No se usa `drizzle-kit generate` para esto.
- **Nombre real de la tabla de empresas en la DB es `empresa`** (singular), aunque Drizzle la exporte como `schema.empresas`. En SQL crudo usar `REFERENCES empresa(id)`.
- **`plan_contable.codigo` es `varchar(10)`** y el código más largo de CONTASIS tiene 10 caracteres. No se migra el tipo.
- **Correr scripts:** desde `apps/backend`, con tsx invocado por ruta absoluta:
  ```
  $env:DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test"
  Set-Location C:\Users\gabri\Desktop\erp-mmhighmetrik-v2\apps\backend
  node C:\Users\gabri\Desktop\erp-mmhighmetrik-v2\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\cli.mjs scripts/contasis/<script>.ts
  ```
  **Exit code 9 con `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` es un artefacto cosmético de libuv en Windows al cerrar el proceso, NO es una falla.** Si los asserts imprimieron OK, pasó.
- **Importar `xlsx` en ESM:** `import * as XLSX from 'xlsx'` y leer el archivo con `fs.readFileSync` + `XLSX.read(buf, { type: 'buffer' })`. `XLSX.readFile()` **falla** en el build ESM (`Cannot access file`) porque no tiene `fs` seteado.
- **`cper` (2026) no se modela.** Decisión del spec §3.1. Marcar con comentario `ponytail:` en el loader.
- **No se siembra `mapa_cuenta_clase` en F1.** Ver "Desvío del spec" abajo.

## Desvío deliberado del spec

El spec §8 pone en F1 la *"siembra de `mapa_cuenta_clase` desde los sufijos de destino"*. **Se posterga a F2**, porque depende de la pregunta 4 a Kelly (§9): no sabemos si `093` junta costo directo de obra con gastos generales de obra. Sembrar el mapa con una suposición significa que `derivarClase()` devuelva CD o GG_OBRA según un criterio inventado, y el mapa es exactamente lo que alimenta el resultado por obra.

Las columnas `destino_debe` / `destino_haber` sí se cargan en F1, con lo que la siembra posterior es un `INSERT … SELECT` sobre data ya presente. No se pierde nada esperando.

Riesgo asumido y acotado: las cuentas nuevas de elemento 6/9 quedan `clasificable = true` sin fila en `mapa_cuenta_clase`, y `derivarClaseCore()` hace default a `'CD'` en ese caso (`clasificacion.ts:54`). Es inofensivo en F1 porque **ninguna de esas cuentas aparece en un asiento hasta que F2 importe**. La Task 4 verifica que ninguna cuenta nueva esté en uso.

## Review Focus

Cinco clases de entrada que el spec implica y que conviene fijar con un test, cada una asignada a la task que es dueña del código:

1. **`ccodcue` viene con relleno** (`C (20,0)`): sin `trim()` el código entra con espacios, no casa con los 1328 compartidos y se duplica el catálogo. → Task 2.
2. **Cuenta cuyo padre no existe en ningún prefijo** (ej. `60322521`, cuyo `6032252` no está en el catálogo): `parent_codigo` tiene que resolver al prefijo existente más largo, no al de longitud −1, o el rollup del árbol se rompe. → Task 2.
3. **Elemento `0` y `8`** (cuentas de orden y saldos intermediarios): `plan_contable.tipo` es `NOT NULL` y hoy solo tiene 6 valores; sin mapeo para esos elementos el INSERT falla a mitad de los 2068. → Task 2.
4. **Re-ejecutar el loader** debe ser idempotente **y no pisar nuestras descripciones** en los 1328 códigos compartidos. Una segunda corrida que reescriba `descripcion`/`clasificable` cambia el comportamiento de cuentas en producción. → Task 3.
5. **`GET /plan?q=` tiene `.limit(30)`** (`contabilidad.ts:204`): al pasar de 1814 a 3882 cuentas, una búsqueda como `627` devuelve 30 de 50 y el selector de cuentas esconde las que el usuario busca, sin avisar. → Task 4.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `apps/backend/scripts/contasis/2026-10-07-contasis-catalogo.sql` | **Crear.** Migración: columnas nuevas en `plan_contable`, tabla `contasis_centro_costo`. |
| `packages/db/src/schema.ts` | **Modificar** (`planContable` en `:536-547`). Columnas nuevas + tabla `contasisCentroCosto`. |
| `apps/backend/src/lib/contasisPlan.ts` | **Crear.** Parser PURO del Excel del plan + derivaciones. Sin DB, sin side effects. Unit-testeable. |
| `apps/backend/scripts/contasis/PLAN DE CUENTAS ESTANDAR_SQL.xlsx` | **Crear** (copia del archivo de Kelly). Fixture canónica: el loader tiene que ser reproducible sin el Downloads de Gabriel. |
| `apps/backend/scripts/contasis/test-parse-plan.ts` | **Crear.** Check del parser contra la fixture real. |
| `apps/backend/scripts/contasis/cargar-plan.ts` | **Crear.** Loader: lee la fixture, upsert diferenciado, imprime resumen. |
| `apps/backend/scripts/contasis/test-regresion-plan.ts` | **Crear.** Check de no-regresión post-carga. |

---

### Task 1: Migración y schema

**Files:**
- Create: `apps/backend/scripts/contasis/2026-10-07-contasis-catalogo.sql`
- Modify: `packages/db/src/schema.ts:536-547` (bloque `planContable`) y agregar `contasisCentroCosto` después de `mapaCuentaClase` (`:726-730`)

**Interfaces:**
- Consumes: nada (primera task).
- Produces: columnas `plan_contable.contasis_nivel`, `.contasis_tipo`, `.contasis_analisis`, `.destino_debe`, `.destino_haber`, `.exige_centro_costo`, `.cod_balance_1`, `.cod_balance_2`, `.cuenta_cierre`, `.es_contasis`. Tabla `contasis_centro_costo(codigo, proyecto_id, descripcion, empresa_id, activo)`. Exports Drizzle `schema.planContable.contasisNivel` … y `schema.contasisCentroCosto`.

- [ ] **Step 1: Escribir la migración**

Crear `apps/backend/scripts/contasis/2026-10-07-contasis-catalogo.sql`:

```sql
-- F1 espejo CONTASIS · columnas del catálogo canónico + mapeo de centros de costo.
-- Idempotente. Solo erp_mmh_test.
-- Spec: docs/superpowers/specs/2026-10-07-contasis-espejo-design.md §3.1 y §3.3
BEGIN;

-- ── plan_contable · columnas propias de CONTASIS (spec §3.1) ──
-- codigo ya es varchar(10) y el código más largo de CONTASIS tiene 10 chars: no se migra el tipo.
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS contasis_nivel      integer;      -- nnivcue 1|2|3
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS contasis_tipo       integer;      -- ntipcue 1..7
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS contasis_analisis   integer;      -- nanacue 0 ninguno · 1 genérico · 2 tercero · 5 tributo
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS destino_debe        varchar(10);  -- cdesdeb
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS destino_haber       varchar(10);  -- cdeshab
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS exige_centro_costo  boolean NOT NULL DEFAULT false; -- nafecos <> null
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS cod_balance_1       varchar(4);   -- ccodbal1 (F115, F210…)
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS cod_balance_2       varchar(4);   -- ccodbal2 (N215, N310…)
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS cuenta_cierre       varchar(10);  -- ccuecie
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS es_contasis         boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS plan_contable_es_contasis_idx ON plan_contable (es_contasis);

-- ── contasis_centro_costo · centro de costo de CONTASIS ↔ obra del ERP (spec §3.3) ──
-- Sin fila acá, una línea con centro de costo desconocido RECHAZA la importación en F2:
-- una obra mal asignada corrompe el resultado del proyecto, que es el reporte que mira Mario.
CREATE TABLE IF NOT EXISTS contasis_centro_costo (
  codigo      varchar(20) PRIMARY KEY,
  proyecto_id uuid REFERENCES proyectos(id) ON DELETE SET NULL,  -- null = corporativo (GG_CORP)
  descripcion text,
  empresa_id  integer NOT NULL REFERENCES empresa(id),
  activo      boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS ccc_proyecto_idx ON contasis_centro_costo (proyecto_id);

COMMIT;
```

- [ ] **Step 2: Correr la migración y verificar que las 10 columnas existen**

```bash
PGPASSWORD=MiClave123 psql -U postgres -d erp_mmh_test -f apps/backend/scripts/contasis/2026-10-07-contasis-catalogo.sql
```

En Windows el binario está en `C:\Program Files\PostgreSQL\18\bin\psql.exe`.

Verificar:

```bash
PGPASSWORD=MiClave123 psql -U postgres -d erp_mmh_test -t -c "select count(*) from information_schema.columns where table_name='plan_contable' and column_name in ('contasis_nivel','contasis_tipo','contasis_analisis','destino_debe','destino_haber','exige_centro_costo','cod_balance_1','cod_balance_2','cuenta_cierre','es_contasis');"
```

Expected: `10`

```bash
PGPASSWORD=MiClave123 psql -U postgres -d erp_mmh_test -t -c "select count(*) from contasis_centro_costo;"
```

Expected: `0`

- [ ] **Step 3: Correr la migración una segunda vez (idempotencia)**

Mismo comando del Step 2. Expected: termina sin error, los counts no cambian.

- [ ] **Step 4: Reflejar las columnas en `schema.ts`**

En `packages/db/src/schema.ts`, reemplazar el bloque `planContable` (`:536-547`) por:

```ts
export const planContable = pgTable('plan_contable', {
  codigo: varchar('codigo', { length: 10 }).primaryKey(),
  descripcion: text('descripcion').notNull(),
  tipo: varchar('tipo', { length: 30 }).notNull(), // Activo · Pasivo · Patrimonio · Ingreso · Gasto · Costo · Orden · Resultado
  parentCodigo: varchar('parent_codigo', { length: 10 }),
  nivel: integer('nivel').notNull(),
  // WS0 · promoción a cuenta_contable canónica (in situ)
  clasificable: boolean('clasificable'), // true si cuenta de gasto/costo (elem 6/9) · alimenta derivarClase
  esDivisionaria: boolean('es_divisionaria').notNull().default(false),
  empresaId: integer('empresa_id').references(() => empresas.id, { onDelete: 'set null' }), // null = compartida
  activa: boolean('activa').notNull().default(true),
  // F1 espejo CONTASIS · columnas propias de su plan (spec §3.1)
  contasisNivel: integer('contasis_nivel'), // nnivcue 1|2|3 · nivel 3 = cuenta a la que se imputa
  contasisTipo: integer('contasis_tipo'), // ntipcue 1..7
  contasisAnalisis: integer('contasis_analisis'), // nanacue · 2 = exige tercero (CxC/CxP)
  destinoDebe: varchar('destino_debe', { length: 10 }), // cdesdeb · destino automático al debe
  destinoHaber: varchar('destino_haber', { length: 10 }), // cdeshab · destino automático al haber
  exigeCentroCosto: boolean('exige_centro_costo').notNull().default(false), // nafecos
  codBalance1: varchar('cod_balance_1', { length: 4 }), // ccodbal1 · formulario EEFF
  codBalance2: varchar('cod_balance_2', { length: 4 }), // ccodbal2
  cuentaCierre: varchar('cuenta_cierre', { length: 10 }), // ccuecie
  esContasis: boolean('es_contasis').notNull().default(false),
});
export type PlanContable = typeof planContable.$inferSelect;
```

Y después del bloque `mapaCuentaClase` (`:726-730`) agregar:

```ts
// ─── F1 espejo CONTASIS · centro de costo de CONTASIS ↔ obra del ERP (spec §3.3) ───
// Sin fila acá, la importación de F2 RECHAZA la línea: no se adivina la obra.
export const contasisCentroCosto = pgTable('contasis_centro_costo', {
  codigo: varchar('codigo', { length: 20 }).primaryKey(),
  proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }), // null = corporativo
  descripcion: text('descripcion'),
  empresaId: integer('empresa_id').notNull().references(() => empresas.id),
  activo: boolean('activo').notNull().default(true),
});
export type ContasisCentroCosto = typeof contasisCentroCosto.$inferSelect;
```

- [ ] **Step 5: Verificar que el schema de Drizzle casa con la DB**

```bash
cd packages/db && pnpm typecheck
```

Expected: PASS (sin errores de tipo).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/scripts/contasis/2026-10-07-contasis-catalogo.sql packages/db/src/schema.ts
git commit -m "feat(contasis): columnas del catalogo CONTASIS en plan_contable + contasis_centro_costo"
```

---

### Task 2: Parser puro del plan

**Files:**
- Create: `apps/backend/src/lib/contasisPlan.ts`
- Create: `apps/backend/scripts/contasis/PLAN DE CUENTAS ESTANDAR_SQL.xlsx` (copia de `C:\Users\gabri\Downloads\PLAN DE CUENTAS ESTANDAR_SQL.xlsx`, 321 KB)
- Test: `apps/backend/scripts/contasis/test-parse-plan.ts`

**Interfaces:**
- Consumes: nada de Task 1 (es puro, no toca DB).
- Produces:
  ```ts
  export type CuentaContasis = {
    codigo: string; descripcion: string; tipo: string; nivel: number;
    parentCodigo: string | null; clasificable: boolean;
    contasisNivel: number | null; contasisTipo: number | null; contasisAnalisis: number | null;
    destinoDebe: string | null; destinoHaber: string | null; exigeCentroCosto: boolean;
    codBalance1: string | null; codBalance2: string | null; cuentaCierre: string | null;
  };
  export function tipoPorElemento(codigo: string): string;
  export function parsePlanContasis(buf: Buffer): CuentaContasis[];
  ```

- [ ] **Step 1: Copiar la fixture al repo**

El loader tiene que ser reproducible sin el `Downloads` de Gabriel. El repo ya versiona fixtures xlsx (`apps/backend/scripts/ws1/apertura_prueba_MG.xlsx`).

```bash
cp "C:/Users/gabri/Downloads/PLAN DE CUENTAS ESTANDAR_SQL.xlsx" "apps/backend/scripts/contasis/PLAN DE CUENTAS ESTANDAR_SQL.xlsx"
```

- [ ] **Step 2: Escribir el check que falla**

Crear `apps/backend/scripts/contasis/test-parse-plan.ts`:

```ts
/**
 * Check del parser del plan de CONTASIS contra la fixture real de Kelly.
 * No toca DB. Correr:
 *   node <tsx> scripts/contasis/test-parse-plan.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlanContasis, tipoPorElemento } from '../../src/lib/contasisPlan.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(AQUI, 'PLAN DE CUENTAS ESTANDAR_SQL.xlsx');

const cuentas = parsePlanContasis(fs.readFileSync(FIXTURE));

// ── forma general ──
assert.equal(cuentas.length, 3396, `esperaba 3396 cuentas, vinieron ${cuentas.length}`);
assert.ok(cuentas.every((c) => c.codigo.length >= 2 && c.codigo.length <= 10), 'código fuera de 2..10 chars');
console.log('  ✓ 3396 cuentas, códigos de 2 a 10 caracteres');

// ── Review Focus 1 · ccodcue viene padded a C(20,0): sin trim el código no casa ──
assert.ok(cuentas.every((c) => c.codigo === c.codigo.trim()), 'hay códigos con espacios de relleno');
assert.ok(cuentas.every((c) => c.descripcion === c.descripcion.trim()), 'hay descripciones con relleno');
assert.equal(new Set(cuentas.map((c) => c.codigo)).size, 3396, 'hay códigos duplicados tras el trim');
console.log('  ✓ códigos y descripciones sin relleno, sin duplicados');

const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]));

// ── la cuenta del asiento de prueba, con su destino automático (spec §1.2) ──
const c6011020 = porCodigo.get('6011020');
assert.ok(c6011020, '6011020 no vino en el parseo');
assert.equal(c6011020.descripcion, 'MERCADERÍAS - COMPRAS');
assert.equal(c6011020.destinoDebe, '20111');
assert.equal(c6011020.destinoHaber, '6111020');
assert.equal(c6011020.tipo, 'Gasto');
assert.equal(c6011020.clasificable, true);
assert.equal(c6011020.contasisNivel, 3);
assert.equal(c6011020.nivel, 6); // nivel = largo − 1
console.log('  ✓ 6011020 · destino 20111/6111020, Gasto, clasificable, nivel 6');

// ── Review Focus 2 · parent = prefijo EXISTENTE más largo, no largo−1 ──
// 6011020 (7 chars): no existen 601102 ni 60110 → el padre es 6011 (4 chars).
assert.equal(c6011020.parentCodigo, '6011', `padre de 6011020 debía ser 6011, vino ${c6011020.parentCodigo}`);
// 60322521 (8 chars): tampoco existe 6032252 → padre 6032 o el prefijo que sí esté.
const c60322521 = porCodigo.get('60322521');
assert.ok(c60322521, '60322521 no vino en el parseo');
assert.ok(c60322521.parentCodigo && porCodigo.has(c60322521.parentCodigo), 'padre de 60322521 no existe en el catálogo');
assert.ok(c60322521.codigo.startsWith(c60322521.parentCodigo), 'el padre no es prefijo del hijo');
// invariante global: todo padre declarado existe y es prefijo propio del hijo
for (const c of cuentas) {
  if (c.parentCodigo === null) continue;
  assert.ok(porCodigo.has(c.parentCodigo), `${c.codigo} declara padre ${c.parentCodigo} que no existe`);
  assert.ok(c.codigo.startsWith(c.parentCodigo) && c.parentCodigo.length < c.codigo.length, `padre inválido en ${c.codigo}`);
}
// y es el MÁS largo posible: no debe existir otro prefijo propio más largo que el elegido
for (const c of cuentas) {
  for (let n = c.codigo.length - 1; n > (c.parentCodigo?.length ?? 0); n--) {
    assert.ok(!porCodigo.has(c.codigo.slice(0, n)), `${c.codigo} debió colgar de ${c.codigo.slice(0, n)}, no de ${c.parentCodigo}`);
  }
}
console.log('  ✓ parent_codigo = prefijo existente más largo, en las 3396');

// ── Review Focus 3 · elementos 0 y 8 tienen tipo (la columna es NOT NULL) ──
assert.ok(cuentas.every((c) => typeof c.tipo === 'string' && c.tipo.length > 0), 'hay cuentas sin tipo');
assert.equal(tipoPorElemento('01'), 'Orden');
assert.equal(tipoPorElemento('8211'), 'Resultado');
assert.equal(tipoPorElemento('1041'), 'Activo');
assert.equal(tipoPorElemento('4212'), 'Pasivo');
assert.equal(tipoPorElemento('50'), 'Patrimonio');
assert.equal(tipoPorElemento('6011020'), 'Gasto');
assert.equal(tipoPorElemento('7041'), 'Ingreso');
assert.equal(tipoPorElemento('9311'), 'Costo');
const cOrden = porCodigo.get('0111');
assert.ok(cOrden && cOrden.tipo === 'Orden', '0111 debía ser tipo Orden');
console.log('  ✓ todas las cuentas tienen tipo · elementos 0 y 8 mapeados');

// ── clasificable = elemento 6 o 9 (regla WS0, alimenta derivarClase) ──
assert.ok(cuentas.filter((c) => c.clasificable).every((c) => c.codigo[0] === '6' || c.codigo[0] === '9'), 'clasificable fuera de elem 6/9');
assert.ok(porCodigo.get('9311')!.clasificable, '9311 debía ser clasificable');
assert.equal(porCodigo.get('4212')!.clasificable, false, '4212 no debía ser clasificable');
console.log('  ✓ clasificable solo en elementos 6 y 9');

// ── destino automático: 1369 cuentas, y viene en PAR (spec §1.2) ──
const conDestino = cuentas.filter((c) => c.destinoDebe || c.destinoHaber);
assert.equal(conDestino.length, 1369, `esperaba 1369 con destino, vinieron ${conDestino.length}`);
assert.ok(conDestino.every((c) => c.destinoDebe && c.destinoHaber), 'hay destino a medias (solo debe o solo haber)');
console.log('  ✓ 1369 cuentas con destino automático, todas con el par completo');

// ── el sufijo de destino es la clase (spec §1.3) ──
assert.equal(porCodigo.get('6271094')!.destinoDebe, '9411'); // ADM
assert.equal(porCodigo.get('6271093')!.destinoDebe, '9311'); // CDS
assert.equal(porCodigo.get('6271093')!.destinoHaber, '7911');
console.log('  ✓ sufijos de destino 093→9311 y 094→9411');

// ── exige_centro_costo: nafecos está casi vacío y ESO es el bloqueante del spec §1.4 ──
const conCC = cuentas.filter((c) => c.exigeCentroCosto);
assert.ok(conCC.length <= 5, `nafecos poblado en ${conCC.length} cuentas: Kelly ya configuró, revisar el spec §1.4`);
console.log(`  ✓ exige_centro_costo en ${conCC.length} cuentas (sin configurar, como esperaba el spec §1.4)`);

// ── formularios EEFF ──
assert.equal(cuentas.filter((c) => c.codBalance1).length, 927);
assert.equal(cuentas.filter((c) => c.codBalance2).length, 2321);
assert.equal(cuentas.filter((c) => c.cuentaCierre).length, 1470);
console.log('  ✓ 927 cod_balance_1 · 2321 cod_balance_2 · 1470 cuenta_cierre');

console.log('✅ parser del plan CONTASIS OK');
```

- [ ] **Step 3: Correr el check y verificar que falla**

```bash
node C:\Users\gabri\Desktop\erp-mmhighmetrik-v2\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\cli.mjs scripts/contasis/test-parse-plan.ts
```

Expected: FAIL con `Cannot find module '.../src/lib/contasisPlan.js'`.

- [ ] **Step 4: Escribir el parser**

Crear `apps/backend/src/lib/contasisPlan.ts`:

```ts
/**
 * Parser del plan de cuentas de CONTASIS.
 *
 * El Excel que manda Kelly ES el esquema de su tabla: fila 1 títulos, fila 2 tipos
 * (`C (20,0)`), fila 3 NOMBRES DE COLUMNA de su DB, datos desde la fila 5.
 * Se mapea por el nombre de columna de la fila 3, no por índice: las posiciones cambian
 * entre versiones del export, los nombres no.
 *
 * Puro: no toca DB ni filesystem. Recibe el buffer, devuelve filas listas para upsert.
 * Spec: docs/superpowers/specs/2026-10-07-contasis-espejo-design.md §3.1
 */
import * as XLSX from 'xlsx';

export type CuentaContasis = {
  codigo: string;
  descripcion: string;
  tipo: string;
  nivel: number;
  parentCodigo: string | null;
  clasificable: boolean;
  contasisNivel: number | null;
  contasisTipo: number | null;
  contasisAnalisis: number | null;
  destinoDebe: string | null;
  destinoHaber: string | null;
  exigeCentroCosto: boolean;
  codBalance1: string | null;
  codBalance2: string | null;
  cuentaCierre: string | null;
};

// Elemento (primer dígito) → nuestro `tipo`. `plan_contable.tipo` es NOT NULL, así que
// los elementos 0 (cuentas de orden) y 8 (saldos intermediarios) TAMBIÉN necesitan valor:
// sin esto el INSERT revienta a mitad de las 2068 nuevas. Nadie hace switch sobre `tipo`
// (se pasa tal cual en contabilidad.ts:192), así que sumar dos valores es seguro.
const TIPO_POR_ELEMENTO: Record<string, string> = {
  '0': 'Orden',
  '1': 'Activo',
  '2': 'Activo',
  '3': 'Activo',
  '4': 'Pasivo',
  '5': 'Patrimonio',
  '6': 'Gasto',
  '7': 'Ingreso',
  '8': 'Resultado',
  '9': 'Costo',
};

export function tipoPorElemento(codigo: string): string {
  return TIPO_POR_ELEMENTO[codigo[0]] ?? 'Orden';
}

const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim(); // todo viene padded a ancho fijo: C (20,0), C (100,0)…
  return s === '' ? null : s;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parsePlanContasis(buf: Buffer): CuentaContasis[] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets['Plan de Cuentas'];
  if (!ws) throw new Error(`hoja 'Plan de Cuentas' no encontrada · hojas: ${wb.SheetNames.join(', ')}`);

  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  // fila 3 (índice 2) = nombres de columna de su DB
  const cols = (raw[2] ?? []).map((c) => (c == null ? '' : String(c).trim()));
  const idx = (nombre: string): number => {
    const i = cols.indexOf(nombre);
    if (i < 0) throw new Error(`columna '${nombre}' no está en el archivo · columnas: ${cols.filter(Boolean).join(', ')}`);
    return i;
  };
  const C = {
    cod: idx('ccodcue'), desc: idx('cdescue'), niv: idx('nnivcue'), tip: idx('ntipcue'),
    ana: idx('nanacue'), bal1: idx('ccodbal1'), bal2: idx('ccodbal2'),
    deb: idx('cdesdeb'), hab: idx('cdeshab'), cos: idx('nafecos'), cie: idx('ccuecie'),
  };
  // ponytail: `cper` (2026) se ignora a propósito. El plan es un catálogo, no una serie
  // temporal; si 2027 difiere se recarga. Si alguna vez hay que ver dos años a la vez,
  // `periodo_plan` entra a la PK y se migra — no antes. Spec §3.1.

  // datos desde la fila 5 (índice 4); filas sin código son separadores
  const filas = raw.slice(3).filter((r) => txt(r[C.cod]) !== null);

  const codigos = new Set(filas.map((r) => txt(r[C.cod])!));

  // El padre es el prefijo EXISTENTE más largo, no el de largo−1: 6011020 cuelga de 6011
  // porque 601102 y 60110 no existen en el catálogo. Si se usara largo−1, el rollup del
  // árbol de cuentas quedaría colgando de un padre inexistente.
  const padreDe = (codigo: string): string | null => {
    for (let n = codigo.length - 1; n >= 1; n--) {
      const p = codigo.slice(0, n);
      if (codigos.has(p)) return p;
    }
    return null;
  };

  return filas.map((r) => {
    const codigo = txt(r[C.cod])!;
    return {
      codigo,
      descripcion: txt(r[C.desc]) ?? codigo,
      tipo: tipoPorElemento(codigo),
      // nuestra convención de nivel es por largo del código: '10'→1, '101'→2, '1041'→3, '10411'→4
      nivel: codigo.length - 1,
      parentCodigo: padreDe(codigo),
      // regla WS0: clasificable = cuenta de gasto/costo (elemento 6 o 9) · alimenta derivarClase
      clasificable: codigo[0] === '6' || codigo[0] === '9',
      contasisNivel: num(r[C.niv]),
      contasisTipo: num(r[C.tip]),
      contasisAnalisis: num(r[C.ana]),
      destinoDebe: txt(r[C.deb]),
      destinoHaber: txt(r[C.hab]),
      exigeCentroCosto: num(r[C.cos]) !== null,
      codBalance1: txt(r[C.bal1]),
      codBalance2: txt(r[C.bal2]),
      cuentaCierre: txt(r[C.cie]),
    };
  });
}
```

- [ ] **Step 5: Correr el check y verificar que pasa**

```bash
node C:\Users\gabri\Desktop\erp-mmhighmetrik-v2\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\cli.mjs scripts/contasis/test-parse-plan.ts
```

Expected: las 10 líneas `✓` y `✅ parser del plan CONTASIS OK`.

Si falla el assert de `cuentas.length`, **no ajustes el número para que pase**: significa que la fixture cambió o que el filtro de filas está comiendo/sumando filas. Dumpeá las primeras 10 filas parseadas y compará contra el Excel.

- [ ] **Step 6: Commit**

```bash
git add "apps/backend/scripts/contasis/PLAN DE CUENTAS ESTANDAR_SQL.xlsx" apps/backend/src/lib/contasisPlan.ts apps/backend/scripts/contasis/test-parse-plan.ts
git commit -m "feat(contasis): parser del plan de cuentas + fixture canonica"
```

---

### Task 3: Loader idempotente

**Files:**
- Create: `apps/backend/scripts/contasis/cargar-plan.ts`

**Interfaces:**
- Consumes: `parsePlanContasis()` de Task 2; las columnas de Task 1; `schema.planContable`.
- Produces: `plan_contable` con 3882 filas (1814 nuestras + 2068 nuevas), `es_contasis = true` en 3396.

- [ ] **Step 1: Capturar el estado previo (línea base de la regresión)**

```bash
PGPASSWORD=MiClave123 psql -U postgres -d erp_mmh_test -t -c "select 'cuentas='||count(*)||' clasificables='||count(*) filter (where clasificable)||' maxlen='||max(length(codigo)) from plan_contable;"
```

Anotar el resultado. Expected hoy: `cuentas=1814 clasificables=383 maxlen=5`.

- [ ] **Step 2: Escribir el loader**

Crear `apps/backend/scripts/contasis/cargar-plan.ts`:

```ts
/**
 * Carga el plan de cuentas de CONTASIS como catálogo canónico (spec §3.1).
 *
 * Idempotente y conservador:
 *   · código NUEVO        → INSERT completo (descripción, tipo, nivel, parent, clasificable + CONTASIS)
 *   · código COMPARTIDO   → UPDATE SOLO de las columnas CONTASIS + es_contasis.
 *                           NO pisa descripcion/tipo/nivel/parent/clasificable/activa/es_divisionaria:
 *                           esas cuentas están EN USO en asientos históricos y cambiarles
 *                           `clasificable` cambiaría derivarClase() sobre data ya registrada.
 *   · nuestras 486 propias → no se tocan ni se desactivan: el histórico las referencia por FK.
 *
 * Correr desde apps/backend:
 *   node <tsx> scripts/contasis/cargar-plan.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, schema } from '@erp/db';
import { sql } from 'drizzle-orm';
import { parsePlanContasis } from '../../src/lib/contasisPlan.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(AQUI, 'PLAN DE CUENTAS ESTANDAR_SQL.xlsx');

const cuentas = parsePlanContasis(fs.readFileSync(FIXTURE));
console.log(`· parseadas ${cuentas.length} cuentas de la fixture`);

const previas = new Set(
  (await db.select({ codigo: schema.planContable.codigo }).from(schema.planContable)).map((r) => r.codigo),
);
const nuevas = cuentas.filter((c) => !previas.has(c.codigo));
const compartidas = cuentas.filter((c) => previas.has(c.codigo));
console.log(`· ${nuevas.length} nuevas · ${compartidas.length} compartidas · ${previas.size} ya existentes`);

// Ordenar por largo de código para que el padre entre antes que el hijo. parent_codigo no es
// FK en la DB, pero insertar en orden deja el árbol consistente si alguna vez se valida.
nuevas.sort((a, b) => a.codigo.length - b.codigo.length);

const LOTE = 500; // insert masivo por lotes: 2068 filas en un solo VALUES infla el parse del server
let insertadas = 0;
for (let i = 0; i < nuevas.length; i += LOTE) {
  const lote = nuevas.slice(i, i + LOTE);
  await db.insert(schema.planContable).values(
    lote.map((c) => ({
      codigo: c.codigo,
      descripcion: c.descripcion,
      tipo: c.tipo,
      parentCodigo: c.parentCodigo,
      nivel: c.nivel,
      clasificable: c.clasificable,
      empresaId: null, // compartida: hay una sola empresa real
      activa: true,
      contasisNivel: c.contasisNivel,
      contasisTipo: c.contasisTipo,
      contasisAnalisis: c.contasisAnalisis,
      destinoDebe: c.destinoDebe,
      destinoHaber: c.destinoHaber,
      exigeCentroCosto: c.exigeCentroCosto,
      codBalance1: c.codBalance1,
      codBalance2: c.codBalance2,
      cuentaCierre: c.cuentaCierre,
      esContasis: true,
    })),
  ).onConflictDoNothing({ target: schema.planContable.codigo });
  insertadas += lote.length;
}
console.log(`· insertadas ${insertadas} cuentas nuevas`);

// Compartidas: SOLO las columnas CONTASIS. Un UPDATE por cuenta es aceptable (1328 filas,
// corre una vez por carga de catálogo); no vale la pena un VALUES/FROM a mano.
let actualizadas = 0;
for (const c of compartidas) {
  await db.update(schema.planContable).set({
    contasisNivel: c.contasisNivel,
    contasisTipo: c.contasisTipo,
    contasisAnalisis: c.contasisAnalisis,
    destinoDebe: c.destinoDebe,
    destinoHaber: c.destinoHaber,
    exigeCentroCosto: c.exigeCentroCosto,
    codBalance1: c.codBalance1,
    codBalance2: c.codBalance2,
    cuentaCierre: c.cuentaCierre,
    esContasis: true,
  }).where(sql`${schema.planContable.codigo} = ${c.codigo}`);
  actualizadas++;
}
console.log(`· actualizadas ${actualizadas} compartidas (solo columnas CONTASIS)`);

const r: any = await db.execute(sql`
  select count(*)::int total,
         count(*) filter (where es_contasis)::int contasis,
         count(*) filter (where not es_contasis)::int propias,
         max(length(codigo))::int maxlen
    from plan_contable`);
const [fila] = (r.rows ?? r) as any[];
console.log(`✅ plan_contable: ${fila.total} cuentas · ${fila.contasis} CONTASIS · ${fila.propias} solo nuestras · maxlen ${fila.maxlen}`);
```

- [ ] **Step 3: Correr el loader**

```bash
node C:\Users\gabri\Desktop\erp-mmhighmetrik-v2\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\cli.mjs scripts/contasis/cargar-plan.ts
```

Expected:
```
· parseadas 3396 cuentas de la fixture
· 2068 nuevas · 1328 compartidas · 1814 ya existentes
· insertadas 2068 cuentas nuevas
· actualizadas 1328 compartidas (solo columnas CONTASIS)
✅ plan_contable: 3882 cuentas · 3396 CONTASIS · 486 solo nuestras · maxlen 10
```

`486` y no 487: `1814 − 1328 = 486`. El 487 del spec §1.1 salió de contar al revés (`plan_contable` menos los que matchean) y está mal por uno. Si te sale 486, está bien; si te sale 487, revisá el conteo de compartidas.

- [ ] **Step 4: Review Focus 4 · correr el loader una segunda vez y verificar idempotencia**

Antes de correrlo, capturar una huella de las cuentas compartidas que están en uso:

```bash
PGPASSWORD=MiClave123 psql -U postgres -d erp_mmh_test -t -c "select md5(string_agg(codigo||'|'||descripcion||'|'||tipo||'|'||nivel||'|'||coalesce(clasificable::text,'n'), ',' order by codigo)) from plan_contable where not es_contasis or codigo in ('4212','20111','1212','1071','631','641');"
```

Anotar el hash. Correr el loader de nuevo (mismo comando del Step 3).

Expected la segunda vez:
```
· 0 nuevas · 3396 compartidas · 3882 ya existentes
✅ plan_contable: 3882 cuentas · 3396 CONTASIS · 486 solo nuestras · maxlen 10
```

Y el hash **idéntico**:

```bash
PGPASSWORD=MiClave123 psql -U postgres -d erp_mmh_test -t -c "select md5(string_agg(codigo||'|'||descripcion||'|'||tipo||'|'||nivel||'|'||coalesce(clasificable::text,'n'), ',' order by codigo)) from plan_contable where not es_contasis or codigo in ('4212','20111','1212','1071','631','641');"
```

Expected: el mismo hash del principio del step. Si cambió, el loader está pisando data nuestra y hay que arreglarlo antes de seguir — es exactamente el riesgo que este step existe para atrapar.

- [ ] **Step 5: Verificar que las 4 cuentas huérfanas del spec §1.1 siguen vivas**

```bash
PGPASSWORD=MiClave123 psql -U postgres -d erp_mmh_test -t -c "select codigo||' es_contasis='||es_contasis||' activa='||activa from plan_contable where codigo in ('10441','10451','407','6279') order by codigo;"
```

Expected: las 4 presentes, `es_contasis=f`, `activa=t`. No existen en el plan de CONTASIS (son las que Kelly tiene que crear o mapear, pregunta 5 del §9) y **no deben desaparecer ni desactivarse**: están en uso en asientos históricos.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/scripts/contasis/cargar-plan.ts
git commit -m "feat(contasis): loader idempotente del catalogo (2068 nuevas, 1328 solo columnas CONTASIS)"
```

---

### Task 4: Regresión — nada de lo que ya andaba cambió

**Files:**
- Create: `apps/backend/scripts/contasis/test-regresion-plan.ts`

**Interfaces:**
- Consumes: el estado de la DB después de Task 3; `derivarClase`, `cargarDerivarCtx` de `src/lib/clasificacion.js`.
- Produces: nada (es el gate de la fase).

- [ ] **Step 1: Escribir el check**

Crear `apps/backend/scripts/contasis/test-regresion-plan.ts`:

```ts
/**
 * Gate de F1: cargar 2068 cuentas nuevas no cambió el comportamiento de ninguna cuenta en uso.
 * Corre DESPUÉS de cargar-plan.ts. Solo lee.
 *   node <tsx> scripts/contasis/test-regresion-plan.ts
 */
import assert from 'node:assert/strict';
import { db, schema } from '@erp/db';
import { sql } from 'drizzle-orm';
import { derivarClase, cargarDerivarCtx } from '../../src/lib/clasificacion.js';

const q = async (s: string) => {
  const r: any = await db.execute(sql.raw(s));
  return (r.rows ?? r) as any[];
};

// ── 1 · el catálogo quedó como se esperaba ──
const [tot] = await q(`select count(*)::int total, count(*) filter (where es_contasis)::int cont,
                              max(length(codigo))::int maxlen from plan_contable`);
assert.equal(tot.total, 3882, `plan_contable tiene ${tot.total}, esperaba 3882`);
assert.equal(tot.cont, 3396, `es_contasis en ${tot.cont}, esperaba 3396`);
assert.equal(tot.maxlen, 10, `maxlen ${tot.maxlen}, esperaba 10`);
console.log('  ✓ 3882 cuentas · 3396 CONTASIS · código hasta 10 chars');

// ── 2 · toda cuenta usada en un asiento sigue existiendo y activa (FK validada) ──
const huerfanas = await q(`
  select distinct l.cuenta_contable c
    from asientos_lineas l
   where l.cuenta_contable is not null
     and not exists (select 1 from plan_contable p where p.codigo = l.cuenta_contable and p.activa)`);
assert.equal(huerfanas.length, 0, `cuentas en uso que ya no resuelven: ${huerfanas.map((r) => r.c).join(', ')}`);
const [enUso] = await q(`select count(distinct cuenta_contable)::int n from asientos_lineas where cuenta_contable is not null`);
assert.equal(enUso.n, 39, `cuentas distintas en uso: ${enUso.n}, esperaba 39`);
console.log('  ✓ las 39 cuentas en uso resuelven contra el plan y están activas');

// ── 3 · ninguna cuenta NUEVA quedó usada en un asiento (el desvío del plan depende de esto) ──
// Una cuenta compartida también tiene es_contasis=true y SÍ puede estar en uso, así que
// filtrar por es_contasis no sirve. La vía directa: antes de F1 el código más largo del plan
// era de 5 chars, así que toda cuenta en uso tiene ≤5 y ninguna nueva puede haber entrado.
const largas = await q(`
  select distinct l.cuenta_contable c from asientos_lineas l
   where l.cuenta_contable is not null and length(l.cuenta_contable) > 5`);
assert.equal(largas.length, 0, `asientos usando divisionarias CONTASIS antes de F2: ${largas.map((r) => r.c).join(', ')}`);
console.log('  ✓ ningún asiento usa todavía una divisionaria CONTASIS (F2 no corrió)');

// ── 4 · derivarClase() da lo mismo que antes en las cuentas de siempre ──
// mapa_cuenta_clase NO se sembró en F1 (desvío documentado), así que las clases mapeadas
// siguen siendo las 14 de siempre y el default sigue siendo CD.
const [mapa] = await q(`select count(*)::int n from mapa_cuenta_clase`);
assert.equal(mapa.n, 14, `mapa_cuenta_clase tiene ${mapa.n} filas, esperaba 14 (F1 no lo siembra)`);

const OBRA = (await q(`select id from proyectos limit 1`))[0]?.id ?? null;
assert.ok(OBRA, 'no hay proyectos en la DB: el check de derivarClase necesita una obra');

// 631 (transporte) es clasificable y está mapeada; con obra da su clase del mapa, sin obra GG_CORP
const claseMapeada = (await q(`select clase_obra from mapa_cuenta_clase where cuenta = '631'`))[0]?.clase_obra ?? null;
if (claseMapeada) {
  assert.equal(await derivarClase('631', OBRA), claseMapeada, '631 con obra cambió de clase');
}
assert.equal(await derivarClase('631', null), 'GG_CORP', '631 sin obra debía ser GG_CORP');
// 4212 no es clasificable → null, con o sin obra
assert.equal(await derivarClase('4212', OBRA), null, '4212 no debía clasificar');
assert.equal(await derivarClase('4212', null), null, '4212 no debía clasificar');
// cuenta inexistente sigue tirando error de dominio (spec WS1 §2)
await assert.rejects(() => derivarClase('ZZZZZ', null), /no existe en el plan/, 'cuenta inexistente debía throw');
console.log('  ✓ derivarClase() sin cambios en las cuentas de siempre');

// ── 5 · el ctx del motor carga las 3882 sin romperse ──
const ctx = await cargarDerivarCtx();
assert.equal(ctx.clasificablePorCuenta.size, 3882, `ctx cargó ${ctx.clasificablePorCuenta.size}, esperaba 3882`);
assert.equal(ctx.claseObraPorCuenta.size, 14, `ctx mapa ${ctx.claseObraPorCuenta.size}, esperaba 14`);
console.log('  ✓ cargarDerivarCtx() carga el catálogo completo');

// ── 6 · Review Focus 5 · el selector de cuentas tiene limit 30 y ahora hay más familias ──
// contabilidad.ts:204 limita a 30. Con las divisionarias de CONTASIS, un prefijo frecuente
// devuelve 30 de muchas más y el usuario no ve la cuenta que busca, SIN aviso.
const [m627] = await q(`select count(*)::int n from plan_contable where codigo like '627%' and activa`);
console.log(`  · '627%' matchea ${m627.n} cuentas y GET /plan?q= devuelve 30`);
assert.ok(m627.n > 30, 'esperaba que 627 pase de 30 matches: si no, revisá que la carga corrió');
console.log('  ⚠ limit 30 del selector queda CORTO · anotado para F5 (UI), no se arregla acá');

// ── 7 · el destino automático quedó cargado (lo que F2 y el export van a leer) ──
const [d] = await q(`select count(*)::int n from plan_contable where destino_debe is not null and destino_haber is not null`);
assert.equal(d.n, 1369, `destino automático en ${d.n}, esperaba 1369`);
const [c6011020] = await q(`select destino_debe, destino_haber from plan_contable where codigo = '6011020'`);
assert.equal(c6011020.destino_debe, '20111');
assert.equal(c6011020.destino_haber, '6111020');
console.log('  ✓ 1369 destinos automáticos cargados · 6011020 → 20111/6111020');

console.log('✅ F1 sin regresiones');
```

- [ ] **Step 2: Correr el check**

```bash
node C:\Users\gabri\Desktop\erp-mmhighmetrik-v2\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\cli.mjs scripts/contasis/test-regresion-plan.ts
```

Expected: las 7 líneas `✓`/`·` y `✅ F1 sin regresiones`.

- [ ] **Step 3: Correr la regresión que ya existía del motor contable**

F1 toca `plan_contable`, que es el eje del motor. Correr la suite de WS1 para confirmar que el motor sigue entero:

```bash
node C:\Users\gabri\Desktop\erp-mmhighmetrik-v2\node_modules\.pnpm\tsx@4.21.0\node_modules\tsx\dist\cli.mjs scripts/ws1/regression.ts
```

Expected: verde. Si falla, **es una regresión real de F1** (antes de F1 pasaba): no la ignores ni la marques como pre-existente sin verificar con `git stash`.

- [ ] **Step 4: Verificar a mano que el tab de Contabilidad sigue cargando**

El endpoint `GET /contabilidad/plan?periodo=` (`contabilidad.ts:236`) hace `select()` sin `limit` sobre todo el plan: pasó de 1814 a 3882 filas, y ahora arma el rollup de saldos sobre el doble de cuentas.

Levantar el backend y pegarle al endpoint:

```bash
curl -s -o NUL -w "%{time_total}s %{size_download}bytes\n" "http://localhost:3001/api/contabilidad/plan?periodo=2026-09"
```

Expected: responde 200 en menos de 2 s. Si tarda más o el payload pasa de ~2 MB, anotarlo como hallazgo para F5 (paginar o filtrar por `es_divisionaria`) — **no** arreglarlo en esta task, pero sí dejarlo escrito en el commit.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/scripts/contasis/test-regresion-plan.ts
git commit -m "test(contasis): gate de regresion F1 (39 cuentas en uso, derivarClase, ctx del motor)"
```

---

## Cierre de F1

- [ ] **Actualizar el spec:** marcar F1 como hecho en §8 y anotar los dos hallazgos que quedan para F5: el `limit 30` del selector (`contabilidad.ts:204`) y el payload sin paginar de `GET /plan?periodo=` (`contabilidad.ts:236`).
- [ ] **Confirmar que F2 sigue bloqueada:** no arrancar el importador hasta que Kelly responda los puntos 1 y 2 del §9 (centros de costo = obras, y qué es `C.COSTOS 2`).
- [ ] **Anotar la deuda del desvío:** `mapa_cuenta_clase` se siembra en F2 desde `destino_debe`, cuando se sepa la respuesta a la pregunta 4.

## Lo que F1 NO hace

- No importa ningún asiento (F2).
- No siembra `mapa_cuenta_clase` (ver desvío arriba).
- No llena `contasis_centro_costo`: queda vacía hasta que Kelly mande su catálogo.
- No toca `es_divisionaria`: hoy solo 3 cuentas lo tienen en `true`, nada significativo depende de él, y `contasis_nivel = 3` ya identifica la cuenta imputable. YAGNI.
- No pisa descripciones ni `clasificable` de las 1328 compartidas (decisión del loader, Task 3).
- No toca `erp_mmh` ni `erp_mmh_f4d`.
