# Fase 0 (catálogos) + lector de XML CPE · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cargar los catálogos que necesita Finanzas (SUNAT, detracciones con % y mínimo, PCGE completo, tipo de cambio manual) y construir un lector de XML de comprobantes electrónicos (UBL 2.1) probado contra 50 XML reales y públicos.

**Architecture:** Tres tablas nuevas globales (`catalogo_sunat`, `detraccion_tasa`, `tipo_cambio`) creadas con SQL aplicado a mano. Los catálogos se generan UNA vez desde archivos fuente (Excel oficial SUNAT, tabla de Kelly, PDF del PCGE) a JSON versionado en `packages/db/src/data/`, y un seed idempotente los carga. El lector de XML es una función pura (`leerCpe(buf)`) sobre `fast-xml-parser` (ya instalado) con `removeNSPrefix`, y el cálculo de detracción es otra función pura. Un endpoint `POST /api/cpe/leer` los une y devuelve un borrador sin escribir en la base.

**Tech Stack:** Express + tsx (backend sin build), Drizzle + postgres.js, Postgres 18 (`erp_mmh_test`), `fast-xml-parser` 4.5.6, `xlsx` 0.18.5, `pdf-parse` 2.x, tests como scripts tsx con `node:assert/strict`.

**Spec:** Sin spec formal. Las decisiones salen de la sesión 2026-09-14/15 y quedan fijadas en *Global Constraints*. Contexto de negocio: `docs/PREGUNTAS-CIERRE-ALCANCE.md` (bloques B, C, L) y `docs/mockups/finanzas-reestructurado.html`.

## Global Constraints

- Base de trabajo: **solo `erp_mmh_test`**. `erp_mmh` y `erp_mmh_f4d` no se tocan. `.env` ya apunta a `erp_mmh_test`.
- psql: `C:\Program Files\PostgreSQL\18\bin\psql.exe`, usuario `postgres`, clave `MiClave123`. SQL y comentarios en SQL **solo ASCII** (las tildes corrompen UTF8 en psql).
- `drizzle-kit generate/push` **no se usa** (se cuelga y el journal está desincronizado). DDL = archivo `.sql` aplicado con psql + edición a mano de `packages/db/src/schema.ts`.
- **Sin APIs externas de SUNAT.** Todo dato sale de archivos locales.
- Tests: scripts tsx con `node:assert/strict`, que terminan imprimiendo `VERDE` y `process.exit(0)`. Ejecutar con `node apps/backend/node_modules/tsx/dist/cli.mjs <archivo>` desde la raíz del repo.
- El backend arrastra deuda de tipos. Verificación de tipos = los archivos nuevos no aportan errores: `pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "cpe|catalogos|detraccionCalc|tipoCambio"` debe salir vacío.
- **Datos reales de clientes nunca se commitean.** Los XML de MMH van a `apps/backend/scripts/cpe/fixtures/mmh/` (gitignored). Los fixtures públicos (MIT) sí se commitean, con `NOTICE.md`.
- Detracción: base = **total con IGV**; monto = **redondeo al entero más cercano (0.5 sube)**; **siempre en PEN**; aplica solo si `total en PEN > monto_minimo` (estricto).
- Lector CPE: solo **UBL 2.1** y raíz `Invoice` (01, 03), `CreditNote` (07) o `DebitNote` (08). Todo lo demás lanza `CpeError('NO_SOPORTADO')`.
- `plan_contable`: **no se modifican las 150 cuentas existentes** (`ON CONFLICT DO NOTHING`).
- Catálogos globales (sin `empresa_id`): aplican a todas las empresas.
- Commits en la rama `feat/rbac-multiempresa`, estilo `feat(finanzas): ...`, terminando con:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `apps/backend/scripts/finanzas/2026-09-15-fase0-catalogos.sql` | DDL de las 3 tablas |
| `packages/db/src/schema.ts` | ORM de las 3 tablas |
| `packages/db/src/generadores/gen-catalogos-sunat.ts` | Excel SUNAT → `data/sunat-catalogos.json` |
| `packages/db/src/generadores/gen-detracciones.ts` | cat. 54 + tabla Kelly → `data/detracciones.json` |
| `packages/db/src/generadores/pcge.ts` | `extraerCuentasPcge(texto)` puro |
| `packages/db/src/generadores/gen-pcge.ts` | PDF PCGE → `data/pcge-2010.json` |
| `packages/db/src/data/*.json` | Catálogos versionados |
| `packages/db/src/seed-catalogos-finanzas.ts` | Seed idempotente de los 3 JSON |
| `apps/backend/src/lib/tipoCambio.ts` | Elegir TC vigente a una fecha |
| `apps/backend/src/lib/detraccionCalc.ts` | Calcular y comparar detracción |
| `apps/backend/src/lib/cpe/leerCpe.ts` | Lector XML UBL 2.1 |
| `apps/backend/src/routes/catalogos.ts` | `GET /sunat/:catalogo`, `GET /detracciones`, `GET/PUT /tipo-cambio` |
| `apps/backend/src/routes/cpe.ts` | `POST /leer` |
| `apps/backend/scripts/finanzas/test-*.ts`, `apps/backend/scripts/cpe/test-*.ts` | Tests |
| `apps/backend/scripts/cpe/fixtures/publicos/` | 44 XML MIT + `NOTICE.md` |

## Archivos fuente (fuera del repo, solo para los generadores)

- `C:/Users/gabri/Downloads/Gabriel/DOCUMENTOS PARA GABRIEL/TABLA DE DETRACCIONES.xlsx`
- `C:/Users/gabri/Downloads/Gabriel/DOCUMENTOS PARA GABRIEL/DINAMICA CONTABLE - PLAN CONTABLE.pdf`
- Excel oficial SUNAT (se descarga en Task 2): `https://cpe.sunat.gob.pe/sites/default/files/2026-08/Reglas%20de%20validaci%C3%B3n%20-%20actualizado%20al%2026.08.2026.xlsx`
- XML reales MMH en `C:/Users/gabri/Desktop/`: `FACTURAE001-6920610639764.XML`, `FACTURAE001-7020610639764.XML`, `FACTURAE001-7220610639764.XML`, `NOTA_CREDITOE001-1720610639764.XML`, `20100047218-01-FN01-40548491.xml`, `FACTURAE001-172020613703340.xml`

---

### Task 1: Tablas `catalogo_sunat`, `detraccion_tasa`, `tipo_cambio`

**Files:**
- Create: `apps/backend/scripts/finanzas/2026-09-15-fase0-catalogos.sql`
- Modify: `packages/db/src/schema.ts` (después de `export type PlanContable`, línea ~548)
- Test: `apps/backend/scripts/finanzas/test-fase0-tablas.ts`

**Interfaces:**
- Produces: `schema.catalogoSunat`, `schema.detraccionTasa`, `schema.tipoCambio` (exportados desde `@erp/db`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-fase0-tablas.ts
/**
 * Fase 0 · las 3 tablas existen con sus columnas.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-fase0-tablas.ts
 */
import assert from 'node:assert/strict';
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';

const esperado: Record<string, string[]> = {
  catalogo_sunat: ['catalogo', 'codigo', 'descripcion', 'extra'],
  detraccion_tasa: ['codigo', 'descripcion', 'anexo', 'porcentaje', 'monto_minimo', 'vigencia_desde', 'vigencia_hasta', 'observacion'],
  tipo_cambio: ['fecha', 'moneda', 'compra', 'venta', 'fuente', 'updated_at'],
};

for (const [tabla, cols] of Object.entries(esperado)) {
  const rows = (await db.execute(sql`select column_name from information_schema.columns where table_name = ${tabla}`)) as unknown as { column_name: string }[];
  const reales = rows.map((r) => r.column_name);
  for (const c of cols) assert.ok(reales.includes(c), `${tabla}.${c} existe`);
  console.log(`  ✓ ${tabla}`);
}
console.log('fase0-tablas VERDE');
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-fase0-tablas.ts`
Expected: FAIL `AssertionError: catalogo_sunat.catalogo existe`

- [ ] **Step 3: Write the migration SQL**

```sql
-- apps/backend/scripts/finanzas/2026-09-15-fase0-catalogos.sql
-- Fase 0 finanzas: catalogos SUNAT, tasas de detraccion, tipo de cambio manual. Globales (sin empresa_id).
CREATE TABLE IF NOT EXISTS catalogo_sunat (
  catalogo    varchar(4)  NOT NULL,
  codigo      varchar(10) NOT NULL,
  descripcion text        NOT NULL,
  extra       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (catalogo, codigo)
);

CREATE TABLE IF NOT EXISTS detraccion_tasa (
  codigo         varchar(3)    NOT NULL,
  descripcion    text          NOT NULL,
  anexo          varchar(12),
  porcentaje     numeric(5,2),
  monto_minimo   numeric(12,2) NOT NULL DEFAULT 700,
  vigencia_desde date          NOT NULL DEFAULT '2000-01-01',
  vigencia_hasta date,
  observacion    text,
  PRIMARY KEY (codigo, vigencia_desde)
);

CREATE TABLE IF NOT EXISTS tipo_cambio (
  fecha      date         NOT NULL,
  moneda     varchar(3)   NOT NULL,
  compra     numeric(8,4) NOT NULL,
  venta      numeric(8,4) NOT NULL,
  fuente     varchar(30)  NOT NULL DEFAULT 'manual',
  updated_at timestamp    NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, moneda)
);
```

- [ ] **Step 4: Apply the migration**

Run (PowerShell):
```powershell
$env:PGPASSWORD='MiClave123'; & 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -d erp_mmh_test -v ON_ERROR_STOP=1 -f apps/backend/scripts/finanzas/2026-09-15-fase0-catalogos.sql
```
Expected: `CREATE TABLE` ×3

- [ ] **Step 5: Add the ORM definitions**

En `packages/db/src/schema.ts`, justo después de `export type PlanContable = typeof planContable.$inferSelect;`:

```ts
// ─── Fase 0 finanzas · catálogos globales ────────────────────
// Catálogos SUNAT (Anexo 8 reglas CPE): 01 tipo doc · 06 doc identidad · 07 afectación IGV ·
// 09/10 motivos NC/ND · 51 tipo operación · 52 leyendas · 53 cargos/descuentos · 54 detracciones · 59 medios de pago
export const catalogoSunat = pgTable(
  'catalogo_sunat',
  {
    catalogo: varchar('catalogo', { length: 4 }).notNull(),
    codigo: varchar('codigo', { length: 10 }).notNull(),
    descripcion: text('descripcion').notNull(),
    extra: jsonb('extra').$type<Record<string, string>>().notNull().default({}),
  },
  (t) => ({ pk: primaryKey({ columns: [t.catalogo, t.codigo] }) }),
);

// Tasa de detracción por código con vigencia. monto_minimo: la operación detrae si total PEN > mínimo.
export const detraccionTasa = pgTable(
  'detraccion_tasa',
  {
    codigo: varchar('codigo', { length: 3 }).notNull(),
    descripcion: text('descripcion').notNull(),
    anexo: varchar('anexo', { length: 12 }),
    porcentaje: decimal('porcentaje', { precision: 5, scale: 2 }),
    montoMinimo: decimal('monto_minimo', { precision: 12, scale: 2 }).notNull().default('700'),
    vigenciaDesde: date('vigencia_desde').notNull().default('2000-01-01'),
    vigenciaHasta: date('vigencia_hasta'),
    observacion: text('observacion'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.codigo, t.vigenciaDesde] }) }),
);
export type DetraccionTasa = typeof detraccionTasa.$inferSelect;

// Tipo de cambio cargado a mano (sin API SUNAT). Si no hay TC del día se usa el último publicado.
export const tipoCambio = pgTable(
  'tipo_cambio',
  {
    fecha: date('fecha').notNull(),
    moneda: varchar('moneda', { length: 3 }).notNull(),
    compra: decimal('compra', { precision: 8, scale: 4 }).notNull(),
    venta: decimal('venta', { precision: 8, scale: 4 }).notNull(),
    fuente: varchar('fuente', { length: 30 }).notNull().default('manual'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.fecha, t.moneda] }) }),
);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-fase0-tablas.ts`
Expected: `✓ catalogo_sunat`, `✓ detraccion_tasa`, `✓ tipo_cambio`, `fase0-tablas VERDE`

- [ ] **Step 7: Commit**

```bash
git add apps/backend/scripts/finanzas/2026-09-15-fase0-catalogos.sql apps/backend/scripts/finanzas/test-fase0-tablas.ts packages/db/src/schema.ts
git commit -m "feat(finanzas): tablas catalogo_sunat, detraccion_tasa y tipo_cambio

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: Catálogos SUNAT (generador + seed idempotente)

**Files:**
- Create: `packages/db/src/generadores/gen-catalogos-sunat.ts`
- Create: `packages/db/src/data/sunat-catalogos.json` (generado, se commitea)
- Create: `packages/db/src/seed-catalogos-finanzas.ts` (seed de los 3 JSON; cada sección se salta si su JSON aún no existe)
- Test: `apps/backend/scripts/finanzas/test-catalogos-sunat.ts`

**Interfaces:**
- Consumes: tabla `catalogo_sunat` (Task 1).
- Produces:
  - `data/sunat-catalogos.json` con forma `Record<string, { nombre: string; filas: { codigo: string; descripcion: string; extra: Record<string, string> }[] }>` y claves `01, 06, 07, 09, 10, 51, 52, 53, 54, 59`.
  - Seed que también entiende (Tasks 3 y 4):
    - `data/detracciones.json` → `{ fuente: string; tasas: { codigo: string; descripcion: string; anexo: string | null; porcentaje: number | null; montoMinimo: number; vigenciaDesde: string; vigenciaHasta: string | null; observacion: string | null }[]; conflictos: { codigo: string; tipo: string; detalle: string }[] }`
    - `data/pcge-2010.json` → `{ fuente: string; cuentas: { codigo: string; descripcion: string; tipo: string; nivel: number; parentCodigo: string | null; clasificable: boolean }[] }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-catalogos-sunat.ts
/**
 * Fase 0 · catálogos SUNAT cargados.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-catalogos-sunat.ts
 */
import assert from 'node:assert/strict';
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';

type Row = { catalogo: string; n: number };
const rows = (await db.execute(sql`select catalogo, count(*)::int as n from catalogo_sunat group by catalogo`)) as unknown as Row[];
const n = Object.fromEntries(rows.map((r) => [r.catalogo, r.n]));

assert.equal(n['54'], 44, 'cat 54 detracciones: 44 codigos');
assert.equal(n['09'], 13, 'cat 09 motivos NC: 13');
for (const [cat, min] of Object.entries({ '01': 30, '06': 10, '07': 15, '10': 5, '51': 25, '52': 10, '53': 20, '59': 20 })) {
  assert.ok((n[cat] ?? 0) >= min, `cat ${cat} tiene >= ${min} (tiene ${n[cat]})`);
}

const uno = async (cat: string, cod: string) =>
  ((await db.execute(sql`select descripcion, extra from catalogo_sunat where catalogo = ${cat} and codigo = ${cod}`)) as unknown as { descripcion: string; extra: Record<string, string> }[])[0];

assert.match((await uno('01', '07'))?.descripcion ?? '', /Nota de cr/i, '01/07 nota de credito');
assert.match((await uno('54', '030'))?.descripcion ?? '', /construcci/i, '54/030 construccion');
assert.match((await uno('54', '027'))?.descripcion ?? '', /transporte de carga/i, '54/027 transporte de carga');
assert.match((await uno('09', '01'))?.descripcion ?? '', /Anulaci/i, '09/01 anulacion');
assert.match((await uno('51', '1001'))?.descripcion ?? '', /Detracci/i, '51/1001 sujeta a detraccion');
assert.equal((await uno('07', '10'))?.extra?.['Codigo de tributo'], '1000', '07/10 trae codigo de tributo en extra');

console.log('catalogos-sunat VERDE');
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-catalogos-sunat.ts`
Expected: FAIL `cat 54 detracciones: 44 codigos` (`undefined !== 44`)

- [ ] **Step 3: Download the official SUNAT Excel**

```bash
mkdir -p .tmp && curl -sSL -o .tmp/reglas-validacion-sunat.xlsx "https://cpe.sunat.gob.pe/sites/default/files/2026-08/Reglas%20de%20validaci%C3%B3n%20-%20actualizado%20al%2026.08.2026.xlsx" -w "HTTP %{http_code} %{size_download}\n"
```
Expected: `HTTP 200 855113` (`.tmp/` ya está en `.gitignore`)

- [ ] **Step 4: Write the generator**

```ts
// packages/db/src/generadores/gen-catalogos-sunat.ts
/**
 * Genera data/sunat-catalogos.json desde la hoja "Catálogos" (Anexo 8) del Excel oficial
 * "Reglas de validación CPE" de SUNAT. Se corre una vez por actualización del Excel.
 *   pnpm --filter @erp/db exec tsx src/generadores/gen-catalogos-sunat.ts ../../.tmp/reglas-validacion-sunat.xlsx
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEREMOS = new Set(['01', '06', '07', '09', '10', '51', '52', '53', '54', '59']);

const origen = process.argv[2];
if (!origen) throw new Error('uso: gen-catalogos-sunat.ts <ruta-excel-reglas-sunat>');
const wb = XLSX.read(fs.readFileSync(origen));
const hoja = wb.Sheets['Catálogos'];
if (!hoja) throw new Error('El Excel no tiene la hoja "Catálogos"');
const rows = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, blankrows: false, raw: false });

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
type Fila = { codigo: string; descripcion: string; extra: Record<string, string> };
const out: Record<string, { nombre: string; filas: Fila[] }> = {};
let actual: string | null = null;
let headers: string[] = [];

for (const r of rows) {
  const c = r.map(limpio);
  if (c[0] === 'No.' && c[1]) { // inicio de un catálogo
    actual = QUEREMOS.has(c[1]) ? c[1] : null;
    headers = [];
    if (actual) out[actual] = { nombre: '', filas: [] };
    continue;
  }
  if (!actual) continue;
  if (c[0] === 'Catálogo') { out[actual].nombre = c[1] ?? ''; continue; }
  if (c[0] === 'Código') { headers = c; continue; }
  if (!headers.length || !c[0] || !c[1]) continue;
  const extra: Record<string, string> = {};
  for (let i = 2; i < headers.length; i++) if (headers[i] && c[i]) extra[headers[i]] = c[i];
  out[actual].filas.push({ codigo: c[0], descripcion: c[1], extra });
}

for (const k of QUEREMOS) if (!out[k]?.filas.length) throw new Error(`Catálogo ${k} vacío o ausente`);
const destino = path.resolve(__dirname, '../data/sunat-catalogos.json');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, `${JSON.stringify(out, null, 1)}\n`);
console.log(Object.entries(out).map(([k, v]) => `${k}:${v.filas.length}`).join(' '), '→', destino);
```

- [ ] **Step 5: Run the generator**

Run: `pnpm --filter @erp/db exec tsx src/generadores/gen-catalogos-sunat.ts ../../.tmp/reglas-validacion-sunat.xlsx`
Expected: una línea que incluye `09:13` y `54:44`, y la ruta de `sunat-catalogos.json`. Si `07` no trae `extra["Codigo de tributo"]`, abrir el JSON, ver el nombre exacto del encabezado y ajustar la aserción del Step 1 a ese nombre.

- [ ] **Step 6: Write the seed**

```ts
// packages/db/src/seed-catalogos-finanzas.ts
/**
 * Fase 0 finanzas · seed idempotente de catálogos globales desde data/*.json.
 * Cada sección se salta si su JSON no existe todavía.
 *   pnpm --filter @erp/db exec tsx src/seed-catalogos-finanzas.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });
const leer = <T>(nombre: string): T | null => {
  const p = path.resolve(__dirname, 'data', nombre);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as T) : null;
};

// ── catálogos SUNAT ──
type Catalogos = Record<string, { nombre: string; filas: { codigo: string; descripcion: string; extra: Record<string, string> }[] }>;
const cats = leer<Catalogos>('sunat-catalogos.json');
if (cats) {
  let n = 0;
  await sql.begin(async (tx) => {
    for (const [catalogo, { filas }] of Object.entries(cats)) {
      for (const f of filas) {
        await tx`insert into catalogo_sunat (catalogo, codigo, descripcion, extra)
                 values (${catalogo}, ${f.codigo}, ${f.descripcion}, ${tx.json(f.extra)})
                 on conflict (catalogo, codigo) do update set descripcion = excluded.descripcion, extra = excluded.extra`;
        n++;
      }
    }
  });
  console.log(`✅ catalogo_sunat · ${n} filas`);
} else console.log('⏭  sunat-catalogos.json no existe');

// ── tasas de detracción ──
type Detr = { tasas: { codigo: string; descripcion: string; anexo: string | null; porcentaje: number | null; montoMinimo: number; vigenciaDesde: string; vigenciaHasta: string | null; observacion: string | null }[] };
const detr = leer<Detr>('detracciones.json');
if (detr) {
  await sql.begin(async (tx) => {
    for (const t of detr.tasas) {
      await tx`insert into detraccion_tasa (codigo, descripcion, anexo, porcentaje, monto_minimo, vigencia_desde, vigencia_hasta, observacion)
               values (${t.codigo}, ${t.descripcion}, ${t.anexo}, ${t.porcentaje}, ${t.montoMinimo}, ${t.vigenciaDesde}, ${t.vigenciaHasta}, ${t.observacion})
               on conflict (codigo, vigencia_desde) do update set descripcion = excluded.descripcion, anexo = excluded.anexo,
                 porcentaje = excluded.porcentaje, monto_minimo = excluded.monto_minimo, vigencia_hasta = excluded.vigencia_hasta, observacion = excluded.observacion`;
    }
  });
  console.log(`✅ detraccion_tasa · ${detr.tasas.length} filas`);
} else console.log('⏭  detracciones.json no existe');

// ── PCGE: solo inserta cuentas nuevas, nunca pisa las existentes ──
type Pcge = { cuentas: { codigo: string; descripcion: string; tipo: string; nivel: number; parentCodigo: string | null; clasificable: boolean }[] };
const pcge = leer<Pcge>('pcge-2010.json');
if (pcge) {
  let nuevas = 0;
  await sql.begin(async (tx) => {
    for (const c of pcge.cuentas) {
      const r = await tx`insert into plan_contable (codigo, descripcion, tipo, parent_codigo, nivel, clasificable, es_divisionaria, activa)
                         values (${c.codigo}, ${c.descripcion}, ${c.tipo}, ${c.parentCodigo}, ${c.nivel}, ${c.clasificable}, false, true)
                         on conflict (codigo) do nothing`;
      nuevas += r.count;
    }
  });
  console.log(`✅ plan_contable · ${nuevas} cuentas nuevas (de ${pcge.cuentas.length} en el PCGE)`);
} else console.log('⏭  pcge-2010.json no existe');

await sql.end();
```

- [ ] **Step 7: Run the seed**

Run: `pnpm --filter @erp/db exec tsx src/seed-catalogos-finanzas.ts`
Expected: `✅ catalogo_sunat · N filas`, `⏭  detracciones.json no existe`, `⏭  pcge-2010.json no existe`

- [ ] **Step 8: Run test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-catalogos-sunat.ts`
Expected: `catalogos-sunat VERDE`

- [ ] **Step 9: Run the seed twice more to prove idempotence**

Run: `pnpm --filter @erp/db exec tsx src/seed-catalogos-finanzas.ts && node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-catalogos-sunat.ts`
Expected: mismo `N filas` y `catalogos-sunat VERDE` (el conteo de 54 sigue en 44, sin duplicados).

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/generadores/gen-catalogos-sunat.ts packages/db/src/data/sunat-catalogos.json packages/db/src/seed-catalogos-finanzas.ts apps/backend/scripts/finanzas/test-catalogos-sunat.ts
git commit -m "feat(finanzas): catalogos SUNAT desde reglas oficiales CPE + seed idempotente

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 3: Tasas de detracción (catálogo 54 SUNAT + tabla de Kelly)

**Files:**
- Create: `packages/db/src/generadores/gen-detracciones.ts`
- Create: `packages/db/src/data/detracciones.json` (generado, se commitea)
- Test: `apps/backend/scripts/finanzas/test-detracciones.ts`

**Interfaces:**
- Consumes: `data/sunat-catalogos.json` (Task 2), seed `seed-catalogos-finanzas.ts` (Task 2), tabla `detraccion_tasa` (Task 1).
- Produces: filas en `detraccion_tasa` y `data/detracciones.json` con la forma definida en Task 2.

**Reglas de negocio (evidencia en la sesión):**
- Códigos y descripciones oficiales: catálogo 54 de SUNAT (44 códigos). El % y la vigencia: tabla de Kelly (46 filas, sin % en SUNAT).
- Unión = **48 códigos**: 44 SUNAT + 4 solo en Kelly (006, 018, 029, 033, todos no vigentes).
- `montoMinimo` = 700 para todos, **400 para 027** (transporte de carga: F013-107901 de S/ 645 sí detrajo). Queda en `observacion` como "a confirmar con Kelly".
- Vigencia de Kelly: `Vigente` → `vigenciaHasta = null`; `Hasta el dd/mm/aaaa` → esa fecha; `No vigente` → `vigenciaHasta = '2000-01-01'`. `vigenciaDesde` siempre `'2000-01-01'` (no hay dato de inicio).
- Anexos de Kelly: los bloques con encabezado `Nº` son, en orden, `1`, `2`, `3` y `transporte`. Si el % de un anexo difiere del % de la lista principal, **gana la lista principal** y se registra un conflicto.
- Conflictos esperados: `003` y `045` (porcentaje), `034` (aparece en anexo 1 y 2), `006`/`018`/`029`/`033` (solo Kelly), `046`/`047` (solo SUNAT).

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-detracciones.ts
/**
 * Fase 0 · tasas de detracción cargadas con % , mínimo, anexo, vigencia y conflictos.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-detracciones.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';

type T = { codigo: string; porcentaje: string | null; monto_minimo: string; anexo: string | null; vigencia_hasta: string | null; descripcion: string };
const rows = (await db.execute(sql`select codigo, porcentaje, monto_minimo, anexo, vigencia_hasta::text, descripcion from detraccion_tasa`)) as unknown as T[];
const by = Object.fromEntries(rows.map((r) => [r.codigo, r]));

assert.equal(rows.length, 48, '48 codigos (44 SUNAT + 4 solo Kelly)');
const pct = (c: string) => (by[c]?.porcentaje == null ? null : Number(by[c].porcentaje));
assert.equal(pct('019'), 10, '019 arrendamiento 10%');
assert.equal(pct('022'), 12, '022 otros servicios empresariales 12%');
assert.equal(pct('027'), 4, '027 transporte de carga 4%');
assert.equal(pct('030'), 4, '030 construccion 4%');
assert.equal(pct('037'), 12, '037 demas servicios 12%');
assert.equal(pct('003'), 4, '003 gana la lista principal (4), no el anexo (10)');
assert.equal(pct('046'), null, '046 solo SUNAT: sin %');
assert.equal(Number(by['027'].monto_minimo), 400, '027 minimo 400');
assert.equal(Number(by['030'].monto_minimo), 700, '030 minimo 700');
assert.equal(by['030'].anexo, '3', '030 anexo 3');
assert.equal(by['027'].anexo, 'transporte', '027 bloque transporte');
assert.equal(by['001'].anexo, '1', '001 anexo 1');
assert.equal(by['006'].vigencia_hasta, '2014-12-31', '006 algodon hasta 2014-12-31');
assert.equal(by['042'].vigencia_hasta, '2000-01-01', '042 no vigente');
assert.equal(by['019'].vigencia_hasta, null, '019 vigente');
assert.match(by['030'].descripcion, /Contratos de construcci/i, 'descripcion oficial SUNAT');

const json = JSON.parse(fs.readFileSync(new URL('../../../../packages/db/src/data/detracciones.json', import.meta.url), 'utf8')) as { conflictos: { codigo: string; tipo: string }[] };
const c = new Set(json.conflictos.map((x) => `${x.codigo}:${x.tipo}`));
for (const k of ['003:porcentaje', '045:porcentaje', '034:anexo_duplicado', '006:solo_kelly', '018:solo_kelly', '029:solo_kelly', '033:solo_kelly', '046:solo_sunat', '047:solo_sunat']) {
  assert.ok(c.has(k), `conflicto ${k}`);
}
assert.ok(!json.conflictos.some((x) => x.tipo === 'anexo_sin_match'), 'todas las filas de anexo encuentran su codigo');

console.log('detracciones VERDE');
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-detracciones.ts`
Expected: FAIL `48 codigos` (`0 !== 48`)

- [ ] **Step 3: Write the generator**

```ts
// packages/db/src/generadores/gen-detracciones.ts
/**
 * Genera data/detracciones.json uniendo el catálogo 54 SUNAT (códigos oficiales) con la tabla
 * de detracciones de Kelly (% , vigencia, anexos). Conflictos quedan listados para revisión.
 *   pnpm --filter @erp/db exec tsx src/generadores/gen-detracciones.ts "C:/Users/gabri/Downloads/Gabriel/DOCUMENTOS PARA GABRIEL/TABLA DE DETRACCIONES.xlsx"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const origen = process.argv[2];
if (!origen) throw new Error('uso: gen-detracciones.ts <ruta TABLA DE DETRACCIONES.xlsx>');

const cats = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/sunat-catalogos.json'), 'utf8')) as Record<string, { filas: { codigo: string; descripcion: string }[] }>;
const sunat = new Map(cats['54'].filas.map((f) => [f.codigo, f.descripcion]));

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (s: string) => limpio(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const pad = (c: string) => c.padStart(3, '0');
const pctDe = (s: string): number | null => { const m = /([\d.,]+)\s*%/.exec(s); return m ? Number.parseFloat(m[1].replace(',', '.')) : null; };

const wb = XLSX.read(fs.readFileSync(origen));
const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, raw: false }).map((r) => r.map(limpio));

type Kelly = { codigo: string; descripcion: string; porcentaje: number | null; vigenciaHasta: string | null; noVigente: boolean };
const principal: Kelly[] = [];
const bloques: { descripcion: string; porcentaje: number | null }[][] = [];
let enAnexos = false;
for (const c of rows.slice(1)) {
  if (c[0] === 'Nº') { enAnexos = true; bloques.push([]); continue; }
  if (!c[0] || !c[1]) continue;
  if (!enAnexos) {
    const hasta = /Hasta el (\d{2})\/(\d{2})\/(\d{4})/i.exec(c[3] ?? '');
    principal.push({
      codigo: pad(c[0]), descripcion: c[1], porcentaje: pctDe(c[2] ?? ''),
      vigenciaHasta: hasta ? `${hasta[3]}-${hasta[2]}-${hasta[1]}` : null,
      noVigente: /no vigente/i.test(c[3] ?? ''),
    });
  } else bloques[bloques.length - 1].push({ descripcion: c[1], porcentaje: pctDe(c[2] ?? '') });
}
const NOMBRE_BLOQUE = ['1', '2', '3', 'transporte'];
if (bloques.length !== 4) throw new Error(`Se esperaban 4 bloques de anexos, hay ${bloques.length}`);

type Conflicto = { codigo: string; tipo: string; detalle: string };
const conflictos: Conflicto[] = [];

// Empareja una fila de anexo con la lista principal: igualdad, prefijo completo, o prefijo común >= 12 único.
function emparejar(desc: string): Kelly | null {
  const d = norm(desc);
  const exacto = principal.find((k) => norm(k.descripcion) === d);
  if (exacto) return exacto;
  const prefijo = principal.filter((k) => { const n = norm(k.descripcion); return n.startsWith(d) || d.startsWith(n); });
  if (prefijo.length === 1) return prefijo[0];
  const lcp = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
  const puntajes = principal.map((k) => ({ k, p: lcp(norm(k.descripcion), d) })).sort((a, b) => b.p - a.p);
  return puntajes[0].p >= 12 && puntajes[0].p > (puntajes[1]?.p ?? 0) ? puntajes[0].k : null;
}

const anexoDe = new Map<string, string>();
bloques.forEach((bloque, i) => {
  for (const fila of bloque) {
    const k = emparejar(fila.descripcion);
    if (!k) { conflictos.push({ codigo: '???', tipo: 'anexo_sin_match', detalle: `anexo ${NOMBRE_BLOQUE[i]}: ${fila.descripcion}` }); continue; }
    if (anexoDe.has(k.codigo)) conflictos.push({ codigo: k.codigo, tipo: 'anexo_duplicado', detalle: `anexo ${anexoDe.get(k.codigo)} y ${NOMBRE_BLOQUE[i]}` });
    else anexoDe.set(k.codigo, NOMBRE_BLOQUE[i]);
    if (fila.porcentaje !== k.porcentaje) conflictos.push({ codigo: k.codigo, tipo: 'porcentaje', detalle: `principal ${k.porcentaje}% vs anexo ${NOMBRE_BLOQUE[i]} ${fila.porcentaje}%` });
  }
});

const kellyPorCodigo = new Map(principal.map((k) => [k.codigo, k]));
const codigos = [...new Set([...sunat.keys(), ...kellyPorCodigo.keys()])].sort();
const tasas = codigos.map((codigo) => {
  const k = kellyPorCodigo.get(codigo);
  const obs: string[] = [];
  if (!sunat.has(codigo)) { conflictos.push({ codigo, tipo: 'solo_kelly', detalle: k?.descripcion ?? '' }); obs.push('no figura en catalogo 54 SUNAT'); }
  if (!k) { conflictos.push({ codigo, tipo: 'solo_sunat', detalle: sunat.get(codigo) ?? '' }); obs.push('sin % en tabla de Kelly'); }
  if (k?.noVigente) obs.push('No vigente segun tabla de Kelly');
  if (codigo === '027') obs.push('minimo 400 por evidencia F013-107901 (S/ 645 detrajo); a confirmar con Kelly');
  return {
    codigo,
    descripcion: sunat.get(codigo) ?? k!.descripcion,
    anexo: anexoDe.get(codigo) ?? null,
    porcentaje: k?.porcentaje ?? null,
    montoMinimo: codigo === '027' ? 400 : 700,
    vigenciaDesde: '2000-01-01',
    vigenciaHasta: k?.noVigente ? '2000-01-01' : (k?.vigenciaHasta ?? null),
    observacion: obs.length ? obs.join('; ') : null,
  };
});

const destino = path.resolve(__dirname, '../data/detracciones.json');
fs.writeFileSync(destino, `${JSON.stringify({ fuente: 'SUNAT catalogo 54 (reglas CPE 26.08.2026) + TABLA DE DETRACCIONES.xlsx (Kelly)', tasas, conflictos }, null, 1)}\n`);
console.log(`${tasas.length} tasas · ${conflictos.length} conflictos →`, destino);
for (const c of conflictos) console.log(`  ${c.codigo} ${c.tipo} · ${c.detalle}`);
```

- [ ] **Step 4: Run the generator**

Run: `pnpm --filter @erp/db exec tsx "src/generadores/gen-detracciones.ts" "C:/Users/gabri/Downloads/Gabriel/DOCUMENTOS PARA GABRIEL/TABLA DE DETRACCIONES.xlsx"`
Expected: `48 tasas · N conflictos`, con líneas `003 porcentaje`, `045 porcentaje`, `034 anexo_duplicado`, y ninguna `anexo_sin_match`.

- [ ] **Step 5: Run the seed**

Run: `pnpm --filter @erp/db exec tsx src/seed-catalogos-finanzas.ts`
Expected: `✅ catalogo_sunat · ...`, `✅ detraccion_tasa · 48 filas`, `⏭  pcge-2010.json no existe`

- [ ] **Step 6: Run test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-detracciones.ts`
Expected: `detracciones VERDE`

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/generadores/gen-detracciones.ts packages/db/src/data/detracciones.json apps/backend/scripts/finanzas/test-detracciones.ts
git commit -m "feat(finanzas): tasas de detraccion (cat 54 SUNAT + tabla Kelly) con minimo, anexo, vigencia y conflictos

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 4: Plan contable completo (PCGE desde el PDF)

**Files:**
- Create: `packages/db/src/generadores/pcge.ts` (extractor puro)
- Create: `packages/db/src/generadores/gen-pcge.ts`
- Create: `packages/db/src/data/pcge-2010.json` (generado, se commitea: es la norma pública)
- Test: `apps/backend/scripts/finanzas/test-pcge-extractor.ts` (unitario, sin BD)
- Test: `apps/backend/scripts/finanzas/test-pcge.ts` (JSON + BD)

**Interfaces:**
- Consumes: seed `seed-catalogos-finanzas.ts` (Task 2).
- Produces: `extraerCuentasPcge(texto: string): CuentaPcge[]` y `type CuentaPcge = { codigo: string; descripcion: string; tipo: string; nivel: number; parentCodigo: string | null; clasificable: boolean }`.

**Formato del PDF (verificado):** el catálogo va desde la primera línea `ELEMENTO 1:` (pág. 20) hasta la línea que contiene `PARTE III` (pág. 72). Cada cuenta es `CODIGO<tab o espacio>Descripción` con códigos de 2 a 5 dígitos (las cuentas de orden empiezan con 0). Hay descripciones partidas en dos líneas (`40 ... Y DE` / `SALUD POR PAGAR`). El elemento 9 no tiene cuentas, solo un párrafo. Cada página trae su número suelto y encabezados repetidos.

**Mapeo:** `tipo` por primer dígito: 1/2/3 `Activo`, 4 `Pasivo`, 5 `Patrimonio`, 6 `Gasto`, 7 `Ingreso`, 8 `Resultado` (salvo 88 `Gasto` y 89 `Patrimonio`, igual que el plan actual), 9 `Costo`, 0 `Orden`. `nivel = largo - 1`. `parentCodigo` = código sin el último dígito (null si tiene 2). `clasificable` = elemento 6 o 9 (regla WS1).

- [ ] **Step 1: Write the failing unit test**

```ts
// apps/backend/scripts/finanzas/test-pcge-extractor.ts
/**
 * Fase 0 · extractor de cuentas del texto del PCGE (sin BD).
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-pcge-extractor.ts
 */
import assert from 'node:assert/strict';
import { extraerCuentasPcge } from '../../../../packages/db/src/generadores/pcge.js';

const texto = [
  '=== PAGINA 19', '1 \tActivo disponible y exigible',
  'ELEMENTO 1: \tACTIVO DISPONIBLE Y EXIGIBLE',
  '10 \tEFECTIVO Y EQUIVALENTES DE EFECTIVO',
  '101 \tCaja',
  '=== PAGINA 21', '17', 'PLAN CONTABLE GENERAL EMPRESARIAL', 'CATÁLOGO DE CUENTAS',
  '1041 \tCuentas corrientes operativas',
  'ELEMENTO 4: \tPASIVO',
  '40 \tTRIBUTOS, CONTRAPRESTACIONES Y APORTES AL SISTEMA DE PENSIONES Y DE',
  'SALUD POR PAGAR',
  '4011 Impuesto general a las ventas',
  '40111 \tIGV – Cuenta propia',
  'ELEMENTO 6: \tGASTOS POR NATURALEZA',
  '6032 Suministros',
  'ELEMENTO 8: \tSALDOS INTERMEDIARIOS DE GESTIÓN Y DETERMINACIÓN DEL',
  'RESULTADO DEL EJERCICIO',
  '80 \tMARGEN COMERCIAL',
  '881 \tImpuesto a la renta – Corriente',
  'ELEMENTO 9: \tCONTABILIDAD ANALÍTICA DE EXPLOTACIÓN: COSTOS DE',
  'PRODUCCIÓN Y GASTOS POR FUNCIÓN',
  'El uso de las cuentas, subcuentas, divisionarias y detalles de este elemento, se determina de',
  'acuerdo con la clasificación requerida por cada entidad.',
  '=== PAGINA 70', '66',
  'ELEMENTO "0": \tCUENTAS DE ORDEN',
  'CUENTAS DE ORDEN DEUDORAS',
  '01 \tBIENES Y VALORES ENTREGADOS',
  '011 \tBienes en préstamo, custodia y no capitalizables',
  '=== PAGINA 72', '68',
  'PARTE III - DESCRIPCIÓN Y DINÁMICA CONTABLE',
  '10 \tEFECTIVO Y EQUIVALENTES DE EFECTIVO',
  'CONTENIDO',
].join('\n');

const r = extraerCuentasPcge(texto);
const by = Object.fromEntries(r.map((c) => [c.codigo, c]));

assert.deepEqual(r.map((c) => c.codigo), ['10', '101', '1041', '40', '4011', '40111', '6032', '80', '881', '01', '011'], 'orden y set de codigos (nada antes de ELEMENTO 1 ni despues de PARTE III)');
assert.deepEqual(by['10'], { codigo: '10', descripcion: 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', tipo: 'Activo', nivel: 1, parentCodigo: null, clasificable: false });
assert.deepEqual(by['1041'], { codigo: '1041', descripcion: 'Cuentas corrientes operativas', tipo: 'Activo', nivel: 3, parentCodigo: '104', clasificable: false });
assert.equal(by['40'].descripcion, 'TRIBUTOS, CONTRAPRESTACIONES Y APORTES AL SISTEMA DE PENSIONES Y DE SALUD POR PAGAR', 'une la linea partida');
assert.deepEqual(by['40111'], { codigo: '40111', descripcion: 'IGV – Cuenta propia', tipo: 'Pasivo', nivel: 4, parentCodigo: '4011', clasificable: false });
assert.equal(by['6032'].clasificable, true, 'elemento 6 clasificable');
assert.equal(by['6032'].tipo, 'Gasto');
assert.equal(by['80'].tipo, 'Resultado');
assert.equal(by['80'].descripcion, 'MARGEN COMERCIAL', 'no pega el titulo del elemento 8');
assert.equal(by['881'].tipo, 'Gasto', '88 es Gasto');
assert.deepEqual(by['011'], { codigo: '011', descripcion: 'Bienes en préstamo, custodia y no capitalizables', tipo: 'Orden', nivel: 2, parentCodigo: '01', clasificable: false });

console.log('pcge-extractor VERDE');
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-pcge-extractor.ts`
Expected: FAIL `Cannot find module '.../generadores/pcge.js'`

- [ ] **Step 3: Write the extractor**

```ts
// packages/db/src/generadores/pcge.ts
// Extrae el catálogo de cuentas del texto plano del PDF del PCGE (desde "ELEMENTO 1:" hasta "PARTE III").

export type CuentaPcge = { codigo: string; descripcion: string; tipo: string; nivel: number; parentCodigo: string | null; clasificable: boolean };

const CUENTA = /^(\d{2,5})\s+(\S.*)$/;
const RUIDO = [/^=== PAGINA \d+$/, /^\d{1,3}$/, /^PLAN CONTABLE GENERAL EMPRESARIAL$/i, /^CAT[ÁA]LOGO DE CUENTAS$/i, /^CUENTAS DE ORDEN (DEUDORAS|ACREEDORAS)$/i];

function tipoDe(codigo: string): string {
  if (codigo.startsWith('88')) return 'Gasto';
  if (codigo.startsWith('89')) return 'Patrimonio';
  return ({ '1': 'Activo', '2': 'Activo', '3': 'Activo', '4': 'Pasivo', '5': 'Patrimonio', '6': 'Gasto', '7': 'Ingreso', '8': 'Resultado', '9': 'Costo', '0': 'Orden' } as Record<string, string>)[codigo[0]];
}

export function extraerCuentasPcge(texto: string): CuentaPcge[] {
  const out: CuentaPcge[] = [];
  const vistos = new Set<string>();
  let dentro = false;
  let prev: CuentaPcge | null = null;
  for (const bruto of texto.split('\n')) {
    const linea = bruto.replace(/\s+/g, ' ').trim();
    if (!linea) continue;
    if (!dentro) { if (/^ELEMENTO 1:/i.test(linea)) dentro = true; continue; }
    if (/PARTE III/i.test(linea)) break;
    if (/^ELEMENTO /i.test(linea)) { prev = null; continue; } // títulos de elemento (y su línea partida) no son cuentas
    if (RUIDO.some((re) => re.test(linea))) continue;
    const m = CUENTA.exec(linea);
    if (m) {
      const codigo = m[1];
      if (vistos.has(codigo)) { prev = null; continue; }
      const e = codigo[0];
      prev = { codigo, descripcion: m[2], tipo: tipoDe(codigo), nivel: codigo.length - 1, parentCodigo: codigo.length > 2 ? codigo.slice(0, -1) : null, clasificable: e === '6' || e === '9' };
      out.push(prev);
      vistos.add(codigo);
    } else if (prev) {
      prev.descripcion = `${prev.descripcion} ${linea}`; // descripción partida en dos líneas
      prev = null;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-pcge-extractor.ts`
Expected: `pcge-extractor VERDE`

- [ ] **Step 5: Write the generator**

```ts
// packages/db/src/generadores/gen-pcge.ts
/**
 * Genera data/pcge-2010.json desde el PDF del PCGE que pasó el cliente (edición 2010).
 * Si Kelly confirma el PCGE modificado 2019, se vuelve a correr con ese PDF.
 *   pnpm --filter @erp/db exec tsx src/generadores/gen-pcge.ts "C:/Users/gabri/Downloads/Gabriel/DOCUMENTOS PARA GABRIEL/DINAMICA CONTABLE - PLAN CONTABLE.pdf"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';
import { extraerCuentasPcge } from './pcge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const origen = process.argv[2];
if (!origen) throw new Error('uso: gen-pcge.ts <ruta PDF PCGE>');

const parser = new PDFParse({ data: fs.readFileSync(origen) });
const res = await parser.getText();
const texto = res.pages.map((p: { num: number; text: string }) => `=== PAGINA ${p.num}\n${p.text}`).join('\n');
const cuentas = extraerCuentasPcge(texto);

const destino = path.resolve(__dirname, '../data/pcge-2010.json');
fs.writeFileSync(destino, `${JSON.stringify({ fuente: `PCGE 2010 · ${path.basename(origen)}`, cuentas }, null, 1)}\n`);
const porNivel = cuentas.reduce<Record<number, number>>((a, c) => ((a[c.nivel] = (a[c.nivel] ?? 0) + 1), a), {});
console.log(`${cuentas.length} cuentas · por nivel ${JSON.stringify(porNivel)} →`, destino);
```

- [ ] **Step 6: Run the generator**

Run: `pnpm --filter @erp/db exec tsx src/generadores/gen-pcge.ts "C:/Users/gabri/Downloads/Gabriel/DOCUMENTOS PARA GABRIEL/DINAMICA CONTABLE - PLAN CONTABLE.pdf"`
Expected: `N cuentas` con N entre 1200 y 2600, y los 4 niveles presentes.

- [ ] **Step 7: Write the JSON + DB test**

```ts
// apps/backend/scripts/finanzas/test-pcge.ts
/**
 * Fase 0 · PCGE completo en plan_contable sin pisar las 150 cuentas existentes.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-pcge.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from '@erp/db';
import { sql } from 'drizzle-orm';

type C = { codigo: string; descripcion: string; tipo: string; nivel: number; parentCodigo: string | null; clasificable: boolean };
const { cuentas } = JSON.parse(fs.readFileSync(new URL('../../../../packages/db/src/data/pcge-2010.json', import.meta.url), 'utf8')) as { cuentas: C[] };
const codigos = new Set(cuentas.map((c) => c.codigo));

assert.ok(cuentas.length >= 1200 && cuentas.length <= 2600, `cantidad razonable (${cuentas.length})`);
assert.equal(codigos.size, cuentas.length, 'sin codigos duplicados');
const huerfanas = cuentas.filter((c) => c.parentCodigo && !codigos.has(c.parentCodigo)).map((c) => c.codigo);
assert.deepEqual(huerfanas, [], 'toda cuenta tiene a su padre en el catalogo');
for (const k of ['10', '104', '1041', '1071', '4011', '40111', '4212', '6032', '011']) assert.ok(codigos.has(k), `JSON trae ${k}`);
assert.match(cuentas.find((c) => c.codigo === '40')!.descripcion, /SALUD POR PAGAR$/, '40 con su linea partida unida');

type P = { codigo: string; descripcion: string; tipo: string; nivel: number; parent_codigo: string | null; clasificable: boolean };
const pc = (await db.execute(sql`select codigo, descripcion, tipo, nivel, parent_codigo, clasificable from plan_contable`)) as unknown as P[];
const by = Object.fromEntries(pc.map((r) => [r.codigo, r]));
assert.equal(by['10'].descripcion, 'Efectivo y equivalentes de efectivo', '10 existente no se piso');
assert.equal(by['1071'].descripcion, 'Detracciones · Banco de la Nación', '1071 existente no se piso');
assert.ok(cuentas.every((c) => by[c.codigo]), 'todas las cuentas del PCGE estan en plan_contable');
assert.deepEqual(
  { tipo: by['11111'].tipo, nivel: by['11111'].nivel, parent: by['11111'].parent_codigo, clasificable: by['11111'].clasificable },
  { tipo: 'Activo', nivel: 4, parent: '1111', clasificable: false },
  '11111 nueva con nivel/padre/tipo',
);
assert.equal(by['6032'].clasificable, true, '6032 clasificable');

console.log(`pcge VERDE · plan_contable ${pc.length} cuentas`);
process.exit(0);
```

- [ ] **Step 8: Run the seed, then the test**

Run: `pnpm --filter @erp/db exec tsx src/seed-catalogos-finanzas.ts && node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-pcge.ts`
Expected: `✅ plan_contable · M cuentas nuevas (de N en el PCGE)` y `pcge VERDE · plan_contable ...`. Si la aserción de huérfanas falla, imprimir 5 huérfanas, buscarlas en el texto del PDF y corregir `RUIDO` o la unión de líneas en `pcge.ts` (con un caso nuevo en `test-pcge-extractor.ts`) antes de seguir.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/generadores/pcge.ts packages/db/src/generadores/gen-pcge.ts packages/db/src/data/pcge-2010.json apps/backend/scripts/finanzas/test-pcge-extractor.ts apps/backend/scripts/finanzas/test-pcge.ts
git commit -m "feat(contabilidad): PCGE completo desde el PDF sin pisar cuentas existentes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 5: Tipo de cambio vigente a una fecha

**Files:**
- Create: `apps/backend/src/lib/tipoCambio.ts`
- Test: `apps/backend/scripts/finanzas/test-tipo-cambio.ts`

**Interfaces:**
- Consumes: `schema.tipoCambio` (Task 1).
- Produces:
  - `type FilaTc = { fecha: string; moneda: string; compra: number; venta: number }`
  - `const MAX_DIAS_ATRAS = 10`
  - `elegirTipoCambio(filas: FilaTc[], fecha: string, moneda: string): (FilaTc & { diasAtras: number }) | null` (puro)
  - `buscarTipoCambio(fecha: string, moneda: string): Promise<(FilaTc & { diasAtras: number }) | null>` (BD)

**Regla:** si no hay TC de ese día (fin de semana, feriado) se usa el último publicado antes, hasta 10 días atrás. Más antiguo → `null` (el usuario debe cargar el TC). `PEN` siempre devuelve 1.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-tipo-cambio.ts
/**
 * Fase 0 · elegir tipo de cambio vigente (puro).
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-tipo-cambio.ts
 */
import assert from 'node:assert/strict';
import { elegirTipoCambio, type FilaTc } from '../../src/lib/tipoCambio.js';

const filas: FilaTc[] = [
  { fecha: '2026-01-08', moneda: 'USD', compra: 3.36, venta: 3.366 },
  { fecha: '2026-01-09', moneda: 'USD', compra: 3.361, venta: 3.368 },
  { fecha: '2026-01-12', moneda: 'USD', compra: 3.371, venta: 3.379 },
  { fecha: '2026-01-10', moneda: 'EUR', compra: 3.9, venta: 4.1 },
];

assert.deepEqual(elegirTipoCambio(filas, '2026-01-09', 'USD'), { ...filas[1], diasAtras: 0 }, 'dia exacto');
assert.deepEqual(elegirTipoCambio(filas, '2026-01-11', 'USD'), { ...filas[1], diasAtras: 2 }, 'domingo usa el viernes');
assert.equal(elegirTipoCambio(filas, '2026-01-10', 'USD')?.venta, 3.368, 'no mezcla monedas (el EUR del 10 no cuenta)');
assert.equal(elegirTipoCambio(filas, '2026-01-07', 'USD'), null, 'no hay TC anterior');
assert.equal(elegirTipoCambio(filas, '2026-01-23', 'USD'), null, '11 dias atras es demasiado viejo');
assert.equal(elegirTipoCambio(filas, '2026-01-22', 'USD')?.diasAtras, 10, '10 dias atras todavia vale');
assert.deepEqual(elegirTipoCambio([], '2026-01-09', 'PEN'), { fecha: '2026-01-09', moneda: 'PEN', compra: 1, venta: 1, diasAtras: 0 }, 'PEN = 1');

console.log('tipo-cambio VERDE');
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-tipo-cambio.ts`
Expected: FAIL `Cannot find module '../../src/lib/tipoCambio.js'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/backend/src/lib/tipoCambio.ts
// Fase 0 · tipo de cambio cargado a mano (sin API SUNAT). Sin TC del día → último publicado, hasta MAX_DIAS_ATRAS.
import { db, schema } from '@erp/db';
import { and, desc, eq, gte, lte } from 'drizzle-orm';

export type FilaTc = { fecha: string; moneda: string; compra: number; venta: number };
export const MAX_DIAS_ATRAS = 10;

const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);

export function elegirTipoCambio(filas: FilaTc[], fecha: string, moneda: string): (FilaTc & { diasAtras: number }) | null {
  if (moneda === 'PEN') return { fecha, moneda, compra: 1, venta: 1, diasAtras: 0 };
  const candidata = filas.filter((f) => f.moneda === moneda && f.fecha <= fecha).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  if (!candidata) return null;
  const diasAtras = dias(candidata.fecha, fecha);
  return diasAtras <= MAX_DIAS_ATRAS ? { ...candidata, diasAtras } : null;
}

export async function buscarTipoCambio(fecha: string, moneda: string) {
  if (moneda === 'PEN') return elegirTipoCambio([], fecha, moneda);
  const desde = new Date(Date.parse(`${fecha}T00:00:00Z`) - MAX_DIAS_ATRAS * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select().from(schema.tipoCambio)
    .where(and(eq(schema.tipoCambio.moneda, moneda), lte(schema.tipoCambio.fecha, fecha), gte(schema.tipoCambio.fecha, desde)))
    .orderBy(desc(schema.tipoCambio.fecha)).limit(1);
  return elegirTipoCambio(rows.map((r) => ({ fecha: r.fecha, moneda: r.moneda, compra: Number(r.compra), venta: Number(r.venta) })), fecha, moneda);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-tipo-cambio.ts`
Expected: `tipo-cambio VERDE`

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/tipoCambio.ts apps/backend/scripts/finanzas/test-tipo-cambio.ts
git commit -m "feat(finanzas): tipo de cambio vigente a una fecha con fallback de 10 dias

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Rutas `/api/catalogos`

**Files:**
- Create: `apps/backend/src/routes/catalogos.ts`
- Modify: `apps/backend/src/server.ts` (import + `app.use` junto a `contabilidadRoutes`, línea ~77)
- Test: `apps/backend/scripts/finanzas/test-catalogos-endpoints.ts`

**Interfaces:**
- Consumes: `schema.catalogoSunat`, `schema.detraccionTasa`, `schema.tipoCambio` (Task 1); `buscarTipoCambio` (Task 5); `requirePermiso` (`../lib/permisos.js`); `audit` (`../lib/audit.js`).
- Produces:
  - `GET /api/catalogos/sunat/:catalogo` → `{ catalogo, filas: { codigo, descripcion, extra }[] }`
  - `GET /api/catalogos/detracciones?fecha=YYYY-MM-DD` → `{ fecha, tasas: { codigo, descripcion, anexo, porcentaje: number, montoMinimo: number }[] }` (solo vigentes y con %)
  - `GET /api/catalogos/tipo-cambio?fecha=&moneda=` → `{ fecha, moneda, compra, venta, diasAtras }` o 404
  - `PUT /api/catalogos/tipo-cambio` body `{ filas: { fecha, moneda: 'USD'|'EUR', compra, venta }[] }` (1 a 400) → `{ ok: true, n }`. Requiere `contabilidad:edicion`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-catalogos-endpoints.ts
/**
 * Fase 0 · endpoints /api/catalogos (in-process). Usa fechas 2099 para no tocar TC reales.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-catalogos-endpoints.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import { db, schema } from '@erp/db';
import { and, eq, gte } from 'drizzle-orm';
import { authMiddleware } from '../../src/middleware/auth.js';
import { lucia } from '../../src/auth.js';
import catalogosRoutes from '../../src/routes/catalogos.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // admin@mmhighmetrik.com · MM y MG con edicion
const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/catalogos', catalogosRoutes);
const server = app.listen(0);
const base = `http://localhost:${(server.address() as { port: number }).port}`;
const session = await lucia.createSession(USER, {});
const headers = { cookie: lucia.createSessionCookie(session.id).serialize(), 'x-empresa-id': '1', 'content-type': 'application/json' };
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as any };
};

try {
  const s54 = await call('GET', '/api/catalogos/sunat/54');
  assert.equal(s54.status, 200);
  assert.equal(s54.json.filas.length, 44, 'cat 54 con 44 filas');
  assert.equal((await call('GET', '/api/catalogos/sunat/abc')).status, 400, 'catalogo invalido');

  const det = await call('GET', '/api/catalogos/detracciones?fecha=2026-01-15');
  const cods = new Map(det.json.tasas.map((t: any) => [t.codigo, t]));
  assert.equal((cods.get('030') as any)?.porcentaje, 4, '030 vigente al 4%');
  assert.equal((cods.get('027') as any)?.montoMinimo, 400, '027 minimo 400');
  for (const c of ['006', '042', '046']) assert.ok(!cods.has(c), `${c} no aparece (no vigente o sin %)`);

  const put = await call('PUT', '/api/catalogos/tipo-cambio', { filas: [
    { fecha: '2099-01-09', moneda: 'USD', compra: 3.361, venta: 3.368 },
    { fecha: '2099-01-12', moneda: 'USD', compra: 3.371, venta: 3.379 },
  ] });
  assert.deepEqual(put.json, { ok: true, n: 2 });
  const tc = await call('GET', '/api/catalogos/tipo-cambio?fecha=2099-01-10&moneda=USD');
  assert.deepEqual(tc.json, { fecha: '2099-01-09', moneda: 'USD', compra: 3.361, venta: 3.368, diasAtras: 1 }, 'sabado usa el viernes');
  assert.equal((await call('GET', '/api/catalogos/tipo-cambio?fecha=2099-02-01&moneda=USD')).status, 404, 'sin TC reciente');
  assert.equal((await call('PUT', '/api/catalogos/tipo-cambio', { filas: [{ fecha: '2099-01-09', moneda: 'XXX', compra: 1, venta: 1 }] })).status, 400, 'moneda invalida');

  console.log('catalogos-endpoints VERDE');
} finally {
  await db.delete(schema.tipoCambio).where(and(eq(schema.tipoCambio.moneda, 'USD'), gte(schema.tipoCambio.fecha, '2099-01-01')));
  await lucia.invalidateSession(session.id);
  server.close();
}
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-catalogos-endpoints.ts`
Expected: FAIL `Cannot find module '../../src/routes/catalogos.js'`

- [ ] **Step 3: Write the router**

```ts
// apps/backend/src/routes/catalogos.ts
/**
 * Fase 0 finanzas · catálogos globales de solo lectura (SUNAT, detracciones) + tipo de cambio manual.
 */
import { db, schema } from '@erp/db';
import { and, asc, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePermiso } from '../lib/permisos.js';
import { audit } from '../lib/audit.js';
import { buscarTipoCambio } from '../lib/tipoCambio.js';

const router = Router();
router.use(requireAuth);

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const hoy = () => new Date().toISOString().slice(0, 10);
const sqlExcluded = (col: string) => sql.raw(`excluded.${col}`); // upsert: valor de la fila entrante

router.get('/sunat/:catalogo', requirePermiso('finanzas', 'lectura'), async (req, res) => {
  const { catalogo } = req.params;
  if (!/^\d{2}$/.test(catalogo)) return res.status(400).json({ error: 'catalogo invalido' });
  const filas = await db.select({ codigo: schema.catalogoSunat.codigo, descripcion: schema.catalogoSunat.descripcion, extra: schema.catalogoSunat.extra })
    .from(schema.catalogoSunat).where(eq(schema.catalogoSunat.catalogo, catalogo)).orderBy(asc(schema.catalogoSunat.codigo));
  res.json({ catalogo, filas });
});

router.get('/detracciones', requirePermiso('finanzas', 'lectura'), async (req, res) => {
  const fecha = typeof req.query.fecha === 'string' && FECHA.test(req.query.fecha) ? req.query.fecha : hoy();
  const t = schema.detraccionTasa;
  const rows = await db.select().from(t)
    .where(and(lte(t.vigenciaDesde, fecha), or(isNull(t.vigenciaHasta), gte(t.vigenciaHasta, fecha)), isNotNull(t.porcentaje)))
    .orderBy(asc(t.codigo));
  res.json({ fecha, tasas: rows.map((r) => ({ codigo: r.codigo, descripcion: r.descripcion, anexo: r.anexo, porcentaje: Number(r.porcentaje), montoMinimo: Number(r.montoMinimo) })) });
});

router.get('/tipo-cambio', requirePermiso('finanzas', 'lectura'), async (req, res) => {
  const fecha = String(req.query.fecha ?? '');
  const moneda = String(req.query.moneda ?? '');
  if (!FECHA.test(fecha) || !/^[A-Z]{3}$/.test(moneda)) return res.status(400).json({ error: 'fecha (YYYY-MM-DD) y moneda (ISO) requeridas' });
  const tc = await buscarTipoCambio(fecha, moneda);
  if (!tc) return res.status(404).json({ error: `Sin tipo de cambio ${moneda} para ${fecha} (ni en los 10 dias previos). Cargalo primero.` });
  res.json(tc);
});

const tcSchema = z.object({
  filas: z.array(z.object({
    fecha: z.string().regex(FECHA),
    moneda: z.enum(['USD', 'EUR']),
    compra: z.number().positive().max(99),
    venta: z.number().positive().max(99),
  })).min(1).max(400),
});

router.put('/tipo-cambio', requirePermiso('contabilidad', 'edicion'), async (req, res) => {
  const parse = tcSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { filas } = parse.data;
  await db.insert(schema.tipoCambio)
    .values(filas.map((f) => ({ fecha: f.fecha, moneda: f.moneda, compra: String(f.compra), venta: String(f.venta), fuente: 'manual' })))
    .onConflictDoUpdate({
      target: [schema.tipoCambio.fecha, schema.tipoCambio.moneda],
      set: { compra: sqlExcluded('compra'), venta: sqlExcluded('venta'), fuente: 'manual', updatedAt: new Date() },
    });
  const fechas = filas.map((f) => f.fecha).sort();
  await audit(req, { action: 'update_tipo_cambio', entityType: 'tipo_cambio', after: { n: filas.length, desde: fechas[0], hasta: fechas[fechas.length - 1] } });
  res.json({ ok: true, n: filas.length });
});

export default router;
```

- [ ] **Step 4: Mount the router**

En `apps/backend/src/server.ts`, junto a los otros imports de rutas:
```ts
import catalogosRoutes from './routes/catalogos.js';
```
y debajo de `app.use('/api/contabilidad', contabilidadRoutes);`:
```ts
app.use('/api/catalogos', catalogosRoutes); // Fase 0 · catálogos SUNAT · detracciones · tipo de cambio manual
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-catalogos-endpoints.ts`
Expected: `catalogos-endpoints VERDE`

- [ ] **Step 6: Check types of the new files**

Run: `pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "catalogos|tipoCambio"`
Expected: sin salida

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/routes/catalogos.ts apps/backend/src/server.ts apps/backend/scripts/finanzas/test-catalogos-endpoints.ts
git commit -m "feat(finanzas): endpoints de catalogos SUNAT, detracciones vigentes y tipo de cambio manual

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 7: Lector de XML CPE (UBL 2.1)

**Files:**
- Create: `apps/backend/src/lib/cpe/leerCpe.ts`
- Create: `apps/backend/scripts/cpe/fixtures/publicos/` (44 XML descargados) + `NOTICE.md`
- Create: `apps/backend/scripts/cpe/fixtures/mmh/` (6 XML reales, **no se commitean**)
- Modify: `.gitignore`
- Test: `apps/backend/scripts/cpe/test-leer-cpe.ts`

**Interfaces:**
- Produces:
```ts
export type CpeTipo = '01' | '03' | '07' | '08';
export type CpeLeido = {
  tipo: CpeTipo; serie: string; numero: string;
  fechaEmision: string; fechaVencimiento: string | null;
  moneda: string; tipoOperacion: string | null;
  emisor: { ruc: string; razonSocial: string | null };
  cliente: { tipoDoc: string | null; numero: string | null; razonSocial: string | null };
  totales: { valorVenta: number; igv: number; descuentos: number; cargos: number; anticipos: number; total: number };
  formaPago: 'Contado' | 'Credito' | null;
  cuotas: { monto: number; vence: string | null }[];
  detraccion: { codigo: string; porcentaje: number; monto: number; cuentaBn: string | null } | null;
  percepcion: { codigo: string; monto: number } | null;
  retencion: { monto: number } | null;
  anticipos: { documento: string | null; monto: number }[];
  modifica: { tipo: string | null; serieNumero: string; motivo: string | null } | null;
  ordenCompra: string | null;
  guias: string[];
  lineas: { descripcion: string; cantidad: number; unidad: string | null; valorUnitario: number | null; valorVenta: number; igv: number; afectacionIgv: string | null }[];
  hash: string; // sha256 del archivo original
};
export class CpeError extends Error { code: 'XML_INVALIDO' | 'NO_SOPORTADO' }
export function leerCpe(buf: Buffer): CpeLeido;
```

**Casos que ya se comprobaron en la sesión (la prueba los fija):** prefijo `n2:` del BCP, encoding latin1 que declara otra cosa, CDATA con tabs, detracción (019 y 030 reales, 022 público), percepción 51/52, retención código 62, anticipos, NC con referencia `"E001 - 52"` (con espacios), cuotas, orden de servicio, UBL 2.0 y documentos que no son facturas → rechazo.

- [ ] **Step 1: Download the public fixtures (MIT)**

```bash
D=apps/backend/scripts/cpe/fixtures/publicos
mkdir -p $D/gaspersoft $D/greenter/invoice $D/greenter/note $D/greenter/perception $D/greenter/retention $D/greenter/rrhh $D/greenter/clavesol $D/greenter/guias
G=https://raw.githubusercontent.com/GasperSoft/GasperSoft.SUNAT/master/Xml
for f in 01-F001-1 01-F001-2 01-F001-3 01-F001-4 01-F001-5 01-F001-6 01-F001-7 01-F001-8 01-F001-9 01-F001-10 01-F001-11 03-B001-1 03-B001-2 03-B001-3 03-B001-4 07-F001-1 09-T001-1 20-R001-1 20-R001-2 31-V001-1; do
  curl -sSfL -o "$D/gaspersoft/20606433094-$f.xml" "$G/20606433094-$f.xml" || echo "FALLO $f"
done
R=https://raw.githubusercontent.com/thegreenter/xml-parser/master/tests/Resources
for f in invoice/20480072872-01-FB99-70000.xml invoice/anticipos-regularizacion.xml invoice/anticipos.xml invoice/boleta-itinerante.xml invoice/datos-no-trib.xml invoice/detraccion.xml invoice/dte_1513569521004.xml invoice/exportacion.xml invoice/factura-guia.xml invoice/gravada.xml invoice/invoice-full.xml invoice/plazavea-bol.xml note/20480072872-07-FB99-00001.xml note/NOTA_CREDITOE001-27.XML note/notacr-fac.xml note/notadb-fac.xml perception/20000000001-40-P001-1.xml retention/20000000001-20-R001-1.xml retention/with-creditNote.xml rrhh/RHE1048344835617.xml rrhh/RHE1048344835618.xml clavesol/FACTURAE001-17.xml clavesol/FACTURAE001-174.xml guias/20338570041-09-T002-012.xml; do
  curl -sSfL -o "$D/greenter/$f" "$R/$f" || echo "FALLO $f"
done
find $D -type f | wc -l
```
Expected: sin líneas `FALLO` y `44`.

- [ ] **Step 2: Add NOTICE.md, ignore real client fixtures, copy them**

`apps/backend/scripts/cpe/fixtures/publicos/NOTICE.md`:
```md
# Fixtures públicos de XML CPE (SUNAT)

Copiados sin modificar para usarlos como casos de prueba del lector `leerCpe`.

- `gaspersoft/` · https://github.com/GasperSoft/GasperSoft.SUNAT (carpeta `Xml/`) · Licencia MIT · © sus autores.
- `greenter/` · https://github.com/thegreenter/xml-parser (carpeta `tests/Resources/`) · Licencia MIT · © sus autores.

La licencia MIT permite copiarlos y redistribuirlos conservando este aviso y la licencia original de cada repositorio.
```

Agregar al final de `.gitignore`:
```
# XML reales de clientes (fixtures locales, nunca al repo)
apps/backend/scripts/cpe/fixtures/mmh/
```

Copiar los 6 reales:
```bash
M=apps/backend/scripts/cpe/fixtures/mmh; mkdir -p $M
for f in FACTURAE001-6920610639764.XML FACTURAE001-7020610639764.XML FACTURAE001-7220610639764.XML NOTA_CREDITOE001-1720610639764.XML 20100047218-01-FN01-40548491.xml FACTURAE001-172020613703340.xml; do cp "/c/Users/gabri/Desktop/$f" $M/; done
git status --short apps/backend/scripts/cpe/fixtures/mmh
```
Expected: `git status` no lista nada de `fixtures/mmh`.

- [ ] **Step 3: Write the failing test**

```ts
// apps/backend/scripts/cpe/test-leer-cpe.ts
/**
 * Lector CPE · 20 XML públicos aceptados/rechazados + 24 de Greenter rechazados + 6 reales MMH (si están).
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/cpe/test-leer-cpe.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CpeError, leerCpe, type CpeLeido } from '../../src/lib/cpe/leerCpe.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const leer = (rel: string) => leerCpe(fs.readFileSync(path.join(DIR, rel)));
const FFFD = String.fromCharCode(65533);

type E = Partial<{ tipo: string; tipoOperacion: string; formaPago: string; cuotas: number; lineas: number; total: number; detraccion: [string, number, number]; percepcion: string; retencion: boolean; anticipos: number; totalAnticipos: number; modifica: [string, string] }>;
function verificar(nombre: string, r: CpeLeido, e: E) {
  const m = (campo: string) => `${nombre} · ${campo}`;
  if (e.tipo) assert.equal(r.tipo, e.tipo, m('tipo'));
  if (e.tipoOperacion) assert.equal(r.tipoOperacion, e.tipoOperacion, m('tipoOperacion'));
  if (e.formaPago) assert.equal(r.formaPago, e.formaPago, m('formaPago'));
  if (e.cuotas !== undefined) assert.equal(r.cuotas.length, e.cuotas, m('cuotas'));
  if (e.lineas !== undefined) assert.equal(r.lineas.length, e.lineas, m('lineas'));
  if (e.total !== undefined) assert.equal(r.totales.total, e.total, m('total'));
  if (e.detraccion) assert.deepEqual([r.detraccion?.codigo, r.detraccion?.porcentaje, r.detraccion?.monto], e.detraccion, m('detraccion'));
  else assert.equal(r.detraccion, null, m('sin detraccion'));
  if (e.percepcion) assert.equal(r.percepcion?.codigo, e.percepcion, m('percepcion'));
  if (e.retencion) assert.ok(r.retencion && r.retencion.monto > 0, m('retencion'));
  if (e.anticipos !== undefined) assert.equal(r.anticipos.length, e.anticipos, m('anticipos'));
  if (e.totalAnticipos !== undefined) assert.equal(r.totales.anticipos, e.totalAnticipos, m('totales.anticipos'));
  if (e.modifica) assert.deepEqual([r.modifica?.serieNumero, r.modifica?.motivo], e.modifica, m('modifica'));
  assert.match(r.hash, /^[0-9a-f]{64}$/, m('hash'));
  assert.ok(!JSON.stringify(r).includes(FFFD), m('sin caracteres rotos'));
}

// ── GasperSoft (UBL 2.1) aceptados ──
const GS: Record<string, E> = {
  '01-F001-1': { tipo: '01', tipoOperacion: '0101', formaPago: 'Credito', cuotas: 1, lineas: 1, total: 118 },
  '01-F001-2': { tipo: '01', formaPago: 'Contado', lineas: 1, total: 0 },
  '01-F001-3': { tipoOperacion: '1001', detraccion: ['022', 12, 123], formaPago: 'Contado', total: 1180 },
  '01-F001-4': { lineas: 5, total: 423225 },
  '01-F001-5': { tipoOperacion: '2001', percepcion: '51', lineas: 3, total: 71354.99 },
  '01-F001-6': { anticipos: 2, totalAnticipos: 236, total: 944 },
  '01-F001-7': { anticipos: 2, totalAnticipos: 1180, total: 0 },
  '01-F001-8': { retencion: true, total: 1180 },
  '01-F001-9': { tipoOperacion: '2001', percepcion: '52', total: 1180 },
  '01-F001-10': { formaPago: 'Credito', cuotas: 1, total: 118 },
  '01-F001-11': { formaPago: 'Contado', total: 118 },
  '03-B001-1': { tipo: '03', lineas: 3, total: 1660.6 },
  '03-B001-2': { tipo: '03', lineas: 2, total: 11.5 },
  '03-B001-3': { tipo: '03', lineas: 2, total: 10.5 },
  '03-B001-4': { tipo: '03', lineas: 1, total: 0 },
  '07-F001-1': { tipo: '07', modifica: ['F001-1', '13'], cuotas: 2, lineas: 1, total: 0 },
};
for (const [f, e] of Object.entries(GS)) {
  const r = leer(`publicos/gaspersoft/20606433094-${f}.xml`);
  assert.equal(r.emisor.ruc, '20606433094', `${f} emisor`);
  verificar(f, r, e);
}
console.log(`  ✓ ${Object.keys(GS).length} GasperSoft aceptados`);

// ── rechazos: guías, retención/percepción (UBL 2.0), todo Greenter (UBL 2.0, RHE, guía) ──
const rechazos = ['09-T001-1', '20-R001-1', '20-R001-2', '31-V001-1'].map((f) => `publicos/gaspersoft/20606433094-${f}.xml`);
for (const sub of ['invoice', 'note', 'perception', 'retention', 'rrhh', 'clavesol', 'guias']) {
  for (const f of fs.readdirSync(path.join(DIR, 'publicos/greenter', sub))) rechazos.push(`publicos/greenter/${sub}/${f}`);
}
for (const rel of rechazos) {
  assert.throws(() => leer(rel), (e) => e instanceof CpeError, `${rel} debe rechazarse con CpeError`);
}
assert.throws(() => leerCpe(Buffer.from('<Invoice><sin cerrar>')), (e) => e instanceof CpeError && e.code === 'XML_INVALIDO', 'XML roto');
console.log(`  ✓ ${rechazos.length} rechazados + XML roto`);

// ── reales MMH (solo si están en la máquina) ──
const mmh = path.join(DIR, 'mmh');
if (fs.existsSync(mmh)) {
  const r69 = leer('mmh/FACTURAE001-6920610639764.XML');
  verificar('E001-69', r69, { tipo: '01', tipoOperacion: '1001', detraccion: ['019', 10, 3761], formaPago: 'Credito', cuotas: 1, lineas: 7, total: 37611.44 });
  assert.deepEqual([r69.serie, r69.numero, r69.fechaEmision, r69.emisor.ruc, r69.cliente.numero], ['E001', '69', '2025-06-16', '20610639764', '20608496859']);
  assert.deepEqual([r69.detraccion?.cuentaBn, r69.cuotas[0], r69.totales.igv, r69.totales.valorVenta], ['00003354431', { monto: 33850.44, vence: '2025-07-04' }, 5737.34, 31874.1]);
  assert.match(r69.emisor.razonSocial ?? '', /HIGH METRIK/);

  const r70 = leer('mmh/FACTURAE001-7020610639764.XML');
  verificar('E001-70', r70, { tipoOperacion: '0101', formaPago: 'Contado', lineas: 1, total: 1000 });
  assert.deepEqual([r70.cliente.numero, r70.fechaEmision, r70.totales.igv, r70.lineas[0].afectacionIgv], ['20610780572', '2025-07-30', 0, '20']);

  const r72 = leer('mmh/FACTURAE001-7220610639764.XML');
  verificar('E001-72', r72, { tipoOperacion: '1001', detraccion: ['030', 4, 1560], formaPago: 'Credito', cuotas: 1, lineas: 1, total: 39000 });
  assert.deepEqual([r72.ordenCompra, r72.detraccion?.cuentaBn, r72.cuotas[0], r72.cliente.numero, r72.totales.igv], ['OS2500333', '00003354431', { monto: 37440, vence: '2025-09-25' }, '20376082114', 5949.15]);

  const nc = leer('mmh/NOTA_CREDITOE001-1720610639764.XML');
  verificar('NC E001-17', nc, { tipo: '07', modifica: ['E001-52', '01'], cuotas: 1, lineas: 1, total: 107886.86 });
  assert.deepEqual([nc.serie, nc.numero, nc.fechaEmision, nc.cliente.numero, nc.modifica?.tipo, nc.totales.igv], ['E001', '17', '2025-03-28', '20131380951', '01', 16457.32]);

  const bcp = leer('mmh/20100047218-01-FN01-40548491.xml');
  verificar('BCP FN01', bcp, { tipo: '01', tipoOperacion: '2103', formaPago: 'Contado', lineas: 4, total: 90.86 });
  assert.deepEqual([bcp.serie, bcp.numero, bcp.emisor.ruc, bcp.cliente.numero, bcp.fechaEmision, bcp.fechaVencimiento, bcp.totales.igv], ['FN01', '40548491', '20100047218', '20610639764', '2025-12-17', '2025-12-13', 0]);

  const ajena = leer('mmh/FACTURAE001-172020613703340.xml');
  verificar('E001-1720', ajena, { tipoOperacion: '0101', formaPago: 'Credito', cuotas: 1, lineas: 4, total: 18698.52 });
  assert.deepEqual([ajena.emisor.ruc, ajena.cliente.numero, ajena.fechaVencimiento, ajena.totales.igv, ajena.totales.valorVenta], ['20613703340', '20609286360', '2025-12-03', 2852.32, 15846.2]);
  console.log('  ✓ 6 reales MMH');
} else console.log('  ⏭  fixtures/mmh no existe (maquina sin datos del cliente)');

console.log('leer-cpe VERDE');
process.exit(0);
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/cpe/test-leer-cpe.ts`
Expected: FAIL `Cannot find module '../../src/lib/cpe/leerCpe.js'`

- [ ] **Step 5: Write the implementation**

```ts
// apps/backend/src/lib/cpe/leerCpe.ts
/**
 * Lector de comprobantes electrónicos SUNAT (UBL 2.1): Factura/Boleta (Invoice), NC, ND.
 * Puro: no toca BD ni decide si es compra o venta (eso lo hace la ruta con el RUC de la empresa).
 * - removeNSPrefix: cada OSE usa prefijos distintos (cbc:, n2:, sin prefijo).
 * - Encoding: intenta UTF-8 estricto y cae a latin1 (hay XML que declaran una cosa y traen otra).
 * - UBL 2.0, guías, retención/percepción como documento y RHE → NO_SOPORTADO.
 */
import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type CpeTipo = '01' | '03' | '07' | '08';
export type CpeLeido = {
  tipo: CpeTipo; serie: string; numero: string;
  fechaEmision: string; fechaVencimiento: string | null;
  moneda: string; tipoOperacion: string | null;
  emisor: { ruc: string; razonSocial: string | null };
  cliente: { tipoDoc: string | null; numero: string | null; razonSocial: string | null };
  totales: { valorVenta: number; igv: number; descuentos: number; cargos: number; anticipos: number; total: number };
  formaPago: 'Contado' | 'Credito' | null;
  cuotas: { monto: number; vence: string | null }[];
  detraccion: { codigo: string; porcentaje: number; monto: number; cuentaBn: string | null } | null;
  percepcion: { codigo: string; monto: number } | null;
  retencion: { monto: number } | null;
  anticipos: { documento: string | null; monto: number }[];
  modifica: { tipo: string | null; serieNumero: string; motivo: string | null } | null;
  ordenCompra: string | null;
  guias: string[];
  lineas: { descripcion: string; cantidad: number; unidad: string | null; valorUnitario: number | null; valorVenta: number; igv: number; afectacionIgv: string | null }[];
  hash: string;
};

export class CpeError extends Error {
  constructor(public code: 'XML_INVALIDO' | 'NO_SOPORTADO', mensaje: string) {
    super(mensaje);
    this.name = 'CpeError';
  }
}

const ARRAYS = new Set(['InvoiceLine', 'CreditNoteLine', 'DebitNoteLine', 'PaymentTerms', 'PaymentMeans', 'AllowanceCharge', 'BillingReference',
  'DespatchDocumentReference', 'PrepaidPayment', 'TaxTotal', 'TaxSubtotal', 'PartyIdentification', 'PartyLegalEntity', 'Description', 'Note']);
const parser = new XMLParser({
  removeNSPrefix: true, ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, parseAttributeValue: false, trimValues: true,
  isArray: (nombre) => ARRAYS.has(nombre),
});

type N = any; // nodo de fast-xml-parser
const arr = (v: N): N[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const first = (v: N): N => (Array.isArray(v) ? v[0] : v);
const txt = (v: N): string | null => {
  const x = first(v);
  if (x == null) return null;
  const s = typeof x === 'object' ? x['#text'] : x;
  return s == null ? null : String(s).replace(/\s+/g, ' ').trim() || null;
};
const attr = (v: N, nombre: string): string | null => { const x = first(v); return x && typeof x === 'object' ? (x[`@_${nombre}`] ?? null) : null; };
const num = (v: N): number => { const n = Number(txt(v) ?? 0); return Number.isFinite(n) ? n : 0; };

function decodificar(buf: Buffer): string {
  let s: string;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { s = new TextDecoder('latin1').decode(buf); }
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function leerCpe(buf: Buffer): CpeLeido {
  const xml = decodificar(buf);
  if (XMLValidator.validate(xml) !== true) throw new CpeError('XML_INVALIDO', 'El archivo no es un XML válido');
  const raiz = parser.parse(xml) as Record<string, N>;
  const nombreRaiz = Object.keys(raiz).find((k) => k !== '?xml');
  if (!nombreRaiz || !['Invoice', 'CreditNote', 'DebitNote'].includes(nombreRaiz)) throw new CpeError('NO_SOPORTADO', `Documento "${nombreRaiz ?? '?'}" no soportado (solo factura, boleta, nota de crédito y débito)`);
  const doc = raiz[nombreRaiz];
  if (txt(doc.UBLVersionID) !== '2.1') throw new CpeError('NO_SOPORTADO', `Solo UBL 2.1 (el archivo trae ${txt(doc.UBLVersionID) ?? 'sin versión'})`);

  let tipo: CpeTipo;
  if (nombreRaiz === 'CreditNote') tipo = '07';
  else if (nombreRaiz === 'DebitNote') tipo = '08';
  else {
    const t = txt(doc.InvoiceTypeCode);
    if (t !== '01' && t !== '03') throw new CpeError('NO_SOPORTADO', `Tipo de comprobante ${t ?? '?'} no soportado`);
    tipo = t;
  }

  const id = txt(doc.ID) ?? '';
  const guion = id.lastIndexOf('-');
  const serie = guion > 0 ? id.slice(0, guion).trim() : id;
  const numeroCrudo = guion > 0 ? id.slice(guion + 1).trim() : '';
  const numero = /^\d+$/.test(numeroCrudo) ? String(Number.parseInt(numeroCrudo, 10)) : numeroCrudo;

  const sup = first(doc.AccountingSupplierParty)?.Party ?? {};
  const cus = first(doc.AccountingCustomerParty)?.Party ?? {};
  const idCliente = first(cus.PartyIdentification)?.ID;

  const total = first(doc.LegalMonetaryTotal ?? doc.RequestedMonetaryTotal) ?? {};
  const igv = arr(doc.TaxTotal).flatMap((tt) => arr(tt.TaxSubtotal))
    .filter((ts) => txt(first(ts.TaxCategory)?.TaxScheme?.ID) === '1000')
    .reduce((a, ts) => a + num(ts.TaxAmount), 0);

  const terms = arr(doc.PaymentTerms);
  const det = terms.find((t) => (txt(t.ID) ?? '').toLowerCase() === 'detraccion');
  const medioDet = arr(doc.PaymentMeans).find((p) => (txt(p.ID) ?? '').toLowerCase() === 'detraccion');
  const forma = terms.map((t) => txt(t.PaymentMeansID)).find((x) => x === 'Contado' || x === 'Credito') as 'Contado' | 'Credito' | undefined;
  const cuotas = terms.filter((t) => (txt(t.PaymentMeansID) ?? '').startsWith('Cuota')).map((t) => ({ monto: num(t.Amount), vence: txt(t.PaymentDueDate) }));

  const cargos = arr(doc.AllowanceCharge);
  const porCodigo = (codigos: string[]) => cargos.find((c) => codigos.includes(txt(c.AllowanceChargeReasonCode) ?? ''));
  const perc = porCodigo(['51', '52', '53']);
  const ret = porCodigo(['62']);

  const billing = first(doc.BillingReference)?.InvoiceDocumentReference;
  const lineaTag = nombreRaiz === 'CreditNote' ? 'CreditNoteLine' : nombreRaiz === 'DebitNote' ? 'DebitNoteLine' : 'InvoiceLine';
  const qtyTag = nombreRaiz === 'CreditNote' ? 'CreditedQuantity' : nombreRaiz === 'DebitNote' ? 'DebitedQuantity' : 'InvoicedQuantity';

  return {
    tipo, serie, numero,
    fechaEmision: txt(doc.IssueDate) ?? '',
    fechaVencimiento: txt(doc.DueDate) ?? cuotas[0]?.vence ?? null,
    moneda: txt(doc.DocumentCurrencyCode) ?? 'PEN',
    tipoOperacion: attr(doc.InvoiceTypeCode, 'listID'),
    emisor: { ruc: txt(first(sup.PartyIdentification)?.ID) ?? '', razonSocial: txt(first(sup.PartyLegalEntity)?.RegistrationName) },
    cliente: { tipoDoc: attr(idCliente, 'schemeID'), numero: txt(idCliente), razonSocial: txt(first(cus.PartyLegalEntity)?.RegistrationName) },
    totales: {
      valorVenta: num(total.LineExtensionAmount), igv: Math.round(igv * 100) / 100, descuentos: num(total.AllowanceTotalAmount),
      cargos: num(total.ChargeTotalAmount), anticipos: num(total.PrepaidAmount), total: num(total.PayableAmount),
    },
    formaPago: forma ?? null,
    cuotas,
    detraccion: det ? { codigo: txt(det.PaymentMeansID) ?? '', porcentaje: num(det.PaymentPercent), monto: num(det.Amount), cuentaBn: txt(medioDet?.PayeeFinancialAccount?.ID) } : null,
    percepcion: perc ? { codigo: txt(perc.AllowanceChargeReasonCode) ?? '', monto: num(perc.Amount) } : null,
    retencion: ret ? { monto: num(ret.Amount) } : null,
    anticipos: arr(doc.PrepaidPayment).map((p) => ({ documento: txt(p.ID), monto: num(p.PaidAmount) })),
    modifica: billing ? { tipo: txt(billing.DocumentTypeCode), serieNumero: (txt(billing.ID) ?? '').replace(/\s*-\s*/g, '-'), motivo: txt(first(doc.DiscrepancyResponse)?.ResponseCode) } : null,
    ordenCompra: txt(first(doc.OrderReference)?.ID),
    guias: arr(doc.DespatchDocumentReference).map((g) => txt(g.ID)).filter((x): x is string => !!x),
    lineas: arr(doc[lineaTag]).map((l) => {
      const tt = first(l.TaxTotal);
      return {
        descripcion: arr(l.Item?.Description).map(txt).filter(Boolean).join(' '),
        cantidad: num(l[qtyTag]),
        unidad: attr(l[qtyTag], 'unitCode'),
        valorUnitario: l.Price ? num(l.Price.PriceAmount) : null,
        valorVenta: num(l.LineExtensionAmount),
        igv: num(tt?.TaxAmount),
        afectacionIgv: txt(first(first(tt?.TaxSubtotal)?.TaxCategory)?.TaxExemptionReasonCode),
      };
    }),
    hash: createHash('sha256').update(buf).digest('hex'),
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/cpe/test-leer-cpe.ts`
Expected: `✓ 16 GasperSoft aceptados`, `✓ 28 rechazados + XML roto`, `✓ 6 reales MMH`, `leer-cpe VERDE`.

Si falla una expectativa, **no se cambia el valor esperado**: se compara contra la prueba de la sesión (`scratchpad/probar-xml.cjs`, que leyó esos mismos archivos) y se corrige el lector. La única excepción es un campo que la prueba de la sesión no midió.

- [ ] **Step 7: Check types**

Run: `pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "cpe/leerCpe"`
Expected: sin salida

- [ ] **Step 8: Commit**

```bash
git add .gitignore apps/backend/src/lib/cpe/leerCpe.ts apps/backend/scripts/cpe/test-leer-cpe.ts apps/backend/scripts/cpe/fixtures/publicos
git status --short | grep fixtures/mmh && echo "ALTO: hay XML de cliente en stage" || true
git commit -m "feat(finanzas): lector de XML CPE UBL 2.1 con 44 fixtures publicos (MIT)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 8: Cálculo y comparación de detracción

**Files:**
- Create: `apps/backend/src/lib/detraccionCalc.ts`
- Test: `apps/backend/scripts/finanzas/test-detraccion-calc.ts`

**Interfaces:**
- Produces:
```ts
export type TasaDetraccion = { codigo: string; porcentaje: number; montoMinimo: number };
export type DetraccionCalculada = { aplica: boolean; codigo: string; porcentaje: number; basePen: number; monto: number; motivo: string | null };
export function calcularDetraccion(p: { total: number; moneda: string; tipoCambio?: number | null; tasa: TasaDetraccion }): DetraccionCalculada;
export function compararDetraccion(calculada: DetraccionCalculada, declarada: { monto: number } | null): { diferencia: number; coincide: boolean };
```

**Casos (todos reales salvo el de USD):** E001-85 (250,000 → 10,000), **E001-87 (259,097.50 → 10,364, la factura dijo 10,634)**, hoja de enero de Kelly (4,543 → 182 sube; 2,973.60 → 297 baja), F013-107901 (645 con código 027 → 26), plantilla Vivanco (885 → 89, el .5 sube).

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-detraccion-calc.ts
/**
 * Detracción · base total con IGV · entero más cercano · siempre PEN · aplica si total > mínimo.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-detraccion-calc.ts
 */
import assert from 'node:assert/strict';
import { calcularDetraccion, compararDetraccion } from '../../src/lib/detraccionCalc.js';

const T030 = { codigo: '030', porcentaje: 4, montoMinimo: 700 };
const T027 = { codigo: '027', porcentaje: 4, montoMinimo: 400 };
const T019 = { codigo: '019', porcentaje: 10, montoMinimo: 700 };
const T037 = { codigo: '037', porcentaje: 12, montoMinimo: 700 };
const monto = (total: number, tasa: typeof T030, moneda = 'PEN', tipoCambio?: number) => calcularDetraccion({ total, moneda, tipoCambio, tasa }).monto;

assert.equal(monto(250000, T030), 10000, 'E001-85');
const e87 = calcularDetraccion({ total: 259097.5, moneda: 'PEN', tasa: T030 });
assert.equal(e87.monto, 10364, 'E001-87 calculado');
assert.deepEqual(compararDetraccion(e87, { monto: 10634 }), { diferencia: 270, coincide: false }, 'E001-87: la factura declaro 10634');
assert.deepEqual(compararDetraccion(calcularDetraccion({ total: 39000, moneda: 'PEN', tasa: T030 }), { monto: 1560 }), { diferencia: 0, coincide: true }, 'E001-72 coincide');

assert.equal(monto(4543, T027), 182, '181.72 sube a 182');
assert.equal(monto(2973.6, T019), 297, '297.36 baja a 297');
assert.equal(monto(885, T019), 89, '88.50 sube a 89');
assert.equal(monto(645, T027), 26, '027 bajo 700 pero sobre 400 aplica');

const bajo = calcularDetraccion({ total: 700, moneda: 'PEN', tasa: T037 });
assert.deepEqual([bajo.aplica, bajo.monto], [false, 0], '700 exacto no supera el minimo');
assert.match(bajo.motivo ?? '', /no supera el m.nimo/i);
assert.deepEqual(compararDetraccion(bajo, null), { diferencia: 0, coincide: true }, 'no aplica y no se declaro');

const usd = calcularDetraccion({ total: 1000, moneda: 'USD', tipoCambio: 3.389, tasa: T037 });
assert.deepEqual([usd.basePen, usd.monto], [3389, 407], 'USD: base en soles, monto en soles');
assert.throws(() => calcularDetraccion({ total: 1000, moneda: 'USD', tasa: T037 }), /tipo de cambio/i, 'USD sin TC');

console.log('detraccion-calc VERDE');
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-detraccion-calc.ts`
Expected: FAIL `Cannot find module '../../src/lib/detraccionCalc.js'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/backend/src/lib/detraccionCalc.ts
// Detracción SPOT · base = total con IGV en PEN · monto redondeado al entero más cercano · aplica si base > mínimo del código.
// SUNAT no valida que el monto declarado cuadre con el % (E001-87 salió aceptada con 10,634 en vez de 10,364): lo validamos aquí.

export type TasaDetraccion = { codigo: string; porcentaje: number; montoMinimo: number };
export type DetraccionCalculada = { aplica: boolean; codigo: string; porcentaje: number; basePen: number; monto: number; motivo: string | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcularDetraccion(p: { total: number; moneda: string; tipoCambio?: number | null; tasa: TasaDetraccion }): DetraccionCalculada {
  if (p.moneda !== 'PEN' && !p.tipoCambio) throw new Error(`Falta tipo de cambio para calcular la detracción en ${p.moneda}`);
  const basePen = r2(p.moneda === 'PEN' ? p.total : p.total * (p.tipoCambio as number));
  const base = { codigo: p.tasa.codigo, porcentaje: p.tasa.porcentaje, basePen };
  if (!(basePen > p.tasa.montoMinimo)) {
    return { ...base, aplica: false, monto: 0, motivo: `El total S/ ${basePen.toFixed(2)} no supera el mínimo S/ ${p.tasa.montoMinimo.toFixed(2)} del código ${p.tasa.codigo}` };
  }
  // enteros para evitar error de coma flotante: céntimos × puntos básicos / 1e6 = soles
  const soles = (Math.round(basePen * 100) * Math.round(p.tasa.porcentaje * 100)) / 1_000_000;
  return { ...base, aplica: true, monto: Math.round(soles), motivo: null };
}

export function compararDetraccion(calculada: DetraccionCalculada, declarada: { monto: number } | null) {
  const diferencia = r2((declarada?.monto ?? 0) - calculada.monto);
  return { diferencia, coincide: diferencia === 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-detraccion-calc.ts`
Expected: `detraccion-calc VERDE`

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/detraccionCalc.ts apps/backend/scripts/finanzas/test-detraccion-calc.ts
git commit -m "feat(finanzas): calculo de detraccion (entero mas cercano, PEN, minimo por codigo) y comparacion con lo declarado

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: `POST /api/cpe/leer` (borrador, sin escribir en BD)

**Files:**
- Create: `apps/backend/src/routes/cpe.ts`
- Modify: `apps/backend/src/server.ts` (import + `app.use('/api/cpe', ...)` debajo de `/api/catalogos`)
- Test: `apps/backend/scripts/cpe/test-cpe-endpoint.ts`

**Interfaces:**
- Consumes: `leerCpe`, `CpeError` (Task 7); `calcularDetraccion`, `compararDetraccion` (Task 8); `buscarTipoCambio` (Task 5); `schema.detraccionTasa`, `schema.empresas`; `requirePermiso`.
- Produces: `POST /api/cpe/leer` (multipart, campo `file`, máx. 2 MB) →
  - 200 `{ rol: 'compra' | 'venta', documento: CpeLeido, detraccion: null | { declarada, calculada, diferencia, coincide } | { declarada, error } }`
  - 400 sin archivo · 422 `{ code: 'XML_INVALIDO' | 'NO_SOPORTADO' | 'EMPRESA_AJENA', error }`

**Reglas:** `compra` si el cliente es la empresa activa; `venta` si la empresa es el emisor; si no, `EMPRESA_AJENA` (caso E001-1720 de DORATTA). Tipo de cambio: compras usan el TC **venta** y ventas el TC **compra**. Solo se valida la detracción que el XML declara; si el código no está vigente o no tiene %, se devuelve `error`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/cpe/test-cpe-endpoint.ts
/**
 * POST /api/cpe/leer (in-process). Necesita fixtures/mmh (XML reales); sin ellos solo prueba rechazos.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/cpe/test-cpe-endpoint.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth.js';
import { lucia } from '../../src/auth.js';
import cpeRoutes from '../../src/routes/cpe.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d'; // empresa 1 = MM (20610639764) · empresa 2 = MG
const app = express();
app.use(authMiddleware);
app.use('/api/cpe', cpeRoutes);
const server = app.listen(0);
const base = `http://localhost:${(server.address() as { port: number }).port}`;
const session = await lucia.createSession(USER, {});
const cookie = lucia.createSessionCookie(session.id).serialize();

async function subir(rel: string | null, empresa = '1') {
  const form = new FormData();
  if (rel) form.append('file', new Blob([fs.readFileSync(path.join(DIR, rel))]), path.basename(rel));
  const r = await fetch(`${base}/api/cpe/leer`, { method: 'POST', headers: { cookie, 'x-empresa-id': empresa }, body: form });
  return { status: r.status, json: (await r.json()) as any };
}

try {
  assert.equal((await subir(null)).status, 400, 'sin archivo');
  const v20 = await subir('publicos/greenter/invoice/detraccion.xml');
  assert.deepEqual([v20.status, v20.json.code], [422, 'NO_SOPORTADO'], 'UBL 2.0');

  if (fs.existsSync(path.join(DIR, 'mmh'))) {
    const e72 = await subir('mmh/FACTURAE001-7220610639764.XML');
    assert.equal(e72.status, 200);
    assert.equal(e72.json.rol, 'venta', 'MMH emite E001-72');
    assert.deepEqual([e72.json.detraccion.calculada.monto, e72.json.detraccion.coincide], [1560, true], 'detraccion 030 coincide');

    const e69 = await subir('mmh/FACTURAE001-6920610639764.XML');
    assert.deepEqual([e69.json.detraccion.calculada.monto, e69.json.detraccion.coincide], [3761, true], '019 10% de 37,611.44 = 3,761');

    const bcp = await subir('mmh/20100047218-01-FN01-40548491.xml');
    assert.deepEqual([bcp.status, bcp.json.rol, bcp.json.detraccion], [200, 'compra', null], 'BCP le factura a MMH');

    const ajena = await subir('mmh/FACTURAE001-172020613703340.xml');
    assert.deepEqual([ajena.status, ajena.json.code], [422, 'EMPRESA_AJENA'], 'factura entre terceros');

    const otraEmpresa = await subir('mmh/FACTURAE001-7220610639764.XML', '2');
    assert.deepEqual([otraEmpresa.status, otraEmpresa.json.code], [422, 'EMPRESA_AJENA'], 'con MG activa, la factura de MM es ajena');
    console.log('  ✓ reales MMH');
  } else console.log('  ⏭  fixtures/mmh no existe');

  console.log('cpe-endpoint VERDE');
} finally {
  await lucia.invalidateSession(session.id);
  server.close();
}
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/cpe/test-cpe-endpoint.ts`
Expected: FAIL `Cannot find module '../../src/routes/cpe.js'`

- [ ] **Step 3: Write the router**

```ts
// apps/backend/src/routes/cpe.ts
/**
 * Lectura de XML de comprobantes electrónicos → borrador (no escribe en BD).
 * Decide compra/venta con el RUC de la empresa activa y valida la detracción declarada.
 */
import { db, schema } from '@erp/db';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { requirePermiso } from '../lib/permisos.js';
import { CpeError, leerCpe, type CpeLeido } from '../lib/cpe/leerCpe.js';
import { calcularDetraccion, compararDetraccion } from '../lib/detraccionCalc.js';
import { buscarTipoCambio } from '../lib/tipoCambio.js';

const router = Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

async function validarDetraccion(doc: CpeLeido, rol: 'compra' | 'venta') {
  if (!doc.detraccion) return null;
  const declarada = doc.detraccion;
  const t = schema.detraccionTasa;
  const [tasa] = await db.select().from(t)
    .where(and(eq(t.codigo, declarada.codigo), lte(t.vigenciaDesde, doc.fechaEmision), or(isNull(t.vigenciaHasta), gte(t.vigenciaHasta, doc.fechaEmision))))
    .limit(1);
  if (!tasa || tasa.porcentaje == null) return { declarada, error: `Código de detracción ${declarada.codigo} no vigente o sin % al ${doc.fechaEmision}` };
  let tipoCambio: number | null = null;
  if (doc.moneda !== 'PEN') {
    const tc = await buscarTipoCambio(doc.fechaEmision, doc.moneda);
    if (!tc) return { declarada, error: `Falta tipo de cambio ${doc.moneda} del ${doc.fechaEmision}` };
    tipoCambio = rol === 'compra' ? tc.venta : tc.compra;
  }
  const calculada = calcularDetraccion({ total: doc.totales.total, moneda: doc.moneda, tipoCambio, tasa: { codigo: tasa.codigo, porcentaje: Number(tasa.porcentaje), montoMinimo: Number(tasa.montoMinimo) } });
  return { declarada, calculada, ...compararDetraccion(calculada, declarada) };
}

router.post('/leer', requirePermiso('finanzas', 'lectura'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Adjunta el XML en el campo "file"' });
  let doc: CpeLeido;
  try {
    doc = leerCpe(req.file.buffer);
  } catch (e) {
    if (e instanceof CpeError) return res.status(422).json({ code: e.code, error: e.message });
    throw e;
  }
  const [empresa] = await db.select({ ruc: schema.empresas.ruc, razonSocial: schema.empresas.razonSocial }).from(schema.empresas).where(eq(schema.empresas.id, req.empresaId!)).limit(1);
  const rol = doc.cliente.numero === empresa?.ruc ? 'compra' : doc.emisor.ruc === empresa?.ruc ? 'venta' : null;
  if (!rol) {
    return res.status(422).json({ code: 'EMPRESA_AJENA', error: `El comprobante no es de ${empresa?.razonSocial ?? 'la empresa activa'} (emisor ${doc.emisor.ruc}, cliente ${doc.cliente.numero ?? '?'})` });
  }
  res.json({ rol, documento: doc, detraccion: await validarDetraccion(doc, rol) });
});

export default router;
```

- [ ] **Step 4: Mount the router**

En `apps/backend/src/server.ts`:
```ts
import cpeRoutes from './routes/cpe.js';
```
y debajo de `app.use('/api/catalogos', catalogosRoutes);`:
```ts
app.use('/api/cpe', cpeRoutes); // lector XML CPE → borrador (no escribe)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/cpe/test-cpe-endpoint.ts`
Expected: `✓ reales MMH`, `cpe-endpoint VERDE`

- [ ] **Step 6: Full regression of this plan + types**

Run:
```bash
for t in finanzas/test-fase0-tablas finanzas/test-catalogos-sunat finanzas/test-detracciones finanzas/test-pcge-extractor finanzas/test-pcge finanzas/test-tipo-cambio finanzas/test-catalogos-endpoints finanzas/test-detraccion-calc cpe/test-leer-cpe cpe/test-cpe-endpoint ws1/test-ws1-endpoints; do
  node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/$t.ts > /dev/null 2>&1 && echo "OK   $t" || echo "FAIL $t"
done
pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "cpe|catalogos|detraccionCalc|tipoCambio"
```
Expected: 11 líneas `OK` (incluye `ws1/test-ws1-endpoints`, que prueba que el plan contable ampliado no rompió WS1) y ninguna salida del `grep`.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/routes/cpe.ts apps/backend/src/server.ts apps/backend/scripts/cpe/test-cpe-endpoint.ts
git commit -m "feat(finanzas): POST /api/cpe/leer · borrador desde XML con rol compra/venta y validacion de detraccion

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Fuera de este plan (siguiente plan)

- Bug L869 del formulario (detracción, retención y vencimiento se pierden si la factura queda pendiente).
- Modelo: `gasto_lineas`, detracción/retención/vencimiento en el documento, tres fechas, tabla de detracciones por documento con NPD y constancia, pagos parciales (`documentoPendiente` + `aplicacionDocumento`), NC/ND con referencia.
- Pantallas del mockup (Compras, Ventas, Bancos, Cajas; modal de compra revamp; importar XML; pago contra varias facturas).
- Recibo por honorarios electrónico (RHE), guías de remisión (`DespatchAdvice`), importador SIRE y cuadre, importador del Excel de bancos y compras.
- UI para cargar tipo de cambio (este plan deja solo el endpoint).
- Confirmaciones con Kelly que pueden cambiar datos cargados aquí: PCGE 2010 vs 2019 (L.1), mínimos por código de detracción, y los conflictos listados en `data/detracciones.json`.
