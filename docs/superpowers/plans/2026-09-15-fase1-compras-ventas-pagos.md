# Fase 1 · Modelo de compras, ventas y pagos · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una compra o una venta quede registrada como documento con su detalle, su detracción y su saldo, y que los pagos (parciales, varios documentos por pago o varios pagos por documento) lo cancelen — sin perder datos cuando la factura queda pendiente.

**Architecture:** Se activa el sub-mayor que el modelo WS0 congelado ya definió y nadie usa: `documento_pendiente` (CxP/CxC por documento) y `aplicacion_documento` (pago ↔ documento, saldo derivado). La compra (`gastos` + nueva `gasto_lineas`) crea su documento al guardarse; el pago (`movimientos`) crea sus aplicaciones al guardarse; el motor `/contabilidad/generar` postea los asientos y enlaza `asiento_origen_id` / `asiento_id`. La detracción por documento vive en `detraccion_documento` (compras y ventas). Toda la lógica de saldo está en una lib (`documentosPendientes.ts`); las rutas solo validan y la llaman dentro de una transacción.

**Tech Stack:** Express 4 + tsx, Drizzle + postgres.js, Postgres 18 (`erp_mmh_test`), React 18 + TanStack Query (solo Task 7), tests tsx + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-08-07-ws0-modelo-asiento-design.md` (§2 `documento_pendiente` y `aplicacion_documento`, casos B·C·D de la prueba de estrés) + `docs/superpowers/specs/2026-08-07-roadmap-rediseno-formularios.md` (WS2 compras, WS3 ventas, WS4 bancos). Fase anterior: `docs/superpowers/plans/2026-09-15-fase0-catalogos-lector-cpe.md`.

## Decisiones por defecto (a confirmar con Kelly/Mario — elegidas por el usuario el 2026-09-15)

1. **Detalle por línea opcional.** Sin líneas, la compra se comporta como hoy (una línea implícita). Los 1,576 gastos existentes no se tocan.
2. **Partida y obra por línea**, con la de cabecera como default.
3. **Pagos N:N con pago parcial** vía `aplicacion_documento`. El saldo es siempre `monto_original − Σ aplicaciones activas`.
4. **Tres fechas:** emisión (`gastos.fecha`), vencimiento (`gastos.fecha_vencimiento`) y pago (la fecha de cada movimiento aplicado; no se duplica en la compra).
5. **Ventas con número real.** Se elimina el correlativo mock al marcar facturada: sin serie y número reales se rechaza.
6. **Retención IGV 3% desactivada por empresa** (`empresa.config.agenteRetencion`, hoy `{}` = no agente). La retención de 4ta (8%, recibos por honorarios) sí se acepta.
7. **Tipo de cambio:** venta de la fecha de emisión (Fase 0 `buscarTipoCambio`) cuando la compra viene en USD sin TC explícito.
8. **Cuenta BN de detracciones** = cuenta de tesorería con `tipo='detracciones'` y cuenta contable 1071.
9. **Sin backfill histórico:** los gastos y valorizaciones anteriores no generan documentos pendientes; el histórico se recarga con el importador de la Fase 3.
10. **Rendiciones** no generan cuenta por pagar (se pagan por caja al cerrarse).

## Desviaciones deliberadas del modelo WS0 congelado (registradas)

- `aplicacion_documento.asiento_id` pasa a **nullable** y se agregan `origen_tipo` (`movimiento`|`nota`) + `origen_id`. Motivo: el pago se captura antes de que el motor postee su asiento (el motor es batch). El motor completa `asiento_id` al postear. Los invariantes de WS0 (saldo derivado, idempotencia, anulación por estado) se mantienen.
- El índice único de `documento_pendiente` suma `tercero_ruc`. Motivo: dos proveedores pueden emitir la misma serie-número (F001-123); el índice original lo impediría.

## Global Constraints

- Base de trabajo: **solo `erp_mmh_test`**. `erp_mmh` y `erp_mmh_f4d` no se tocan.
- psql: `C:\Program Files\PostgreSQL\18\bin\psql.exe`, usuario `postgres`, clave `MiClave123`. **SQL y comentarios SQL solo ASCII.** DDL = archivo `.sql` aplicado con psql + edición a mano de `packages/db/src/schema.ts` (no `drizzle-kit`).
- **Todo script de test que importe `@erp/db` (directo o transitivo) carga `../../src/env.js` como PRIMER import.** Sin eso `@erp/db` se conecta a `erp_mmh` (el shell no tiene `DATABASE_URL`).
- Tests: scripts tsx con `node:assert/strict`, imprimen `VERDE` y `process.exit(0)`. Correr desde la raíz: `node apps/backend/node_modules/tsx/dist/cli.mjs <archivo>`. Los tests de lib usan una transacción que se revierte al final (patrón `Rollback`, Task 2) para no dejar residuos.
- Tipos: `pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "documentosPendientes|detraccionTasa|routes/finanzas|routes/contabilidad|routes/proyectos|routes/logistica|routes/cpe"` no debe mostrar errores **nuevos** respecto de la línea base que el Task 1 guarda en `.tmp/tsc-base-fase1.txt`. Frontend (Task 7): `pnpm --filter @erp/frontend exec tsc --noEmit` = 0.
- Montos: `numeric` en BD, strings con 2 decimales al escribir (`toFixed(2)`); comparaciones con tolerancia 0.005.
- `empresaId` operativo = **1 (MM)** en rutas de finanzas, igual que `validarCuentaContable` hoy (las rutas de finanzas no pasan por `requirePermiso`).
- Regresión obligatoria al final de cada task que toque rutas o motor: `apps/backend/scripts/ws1/test-ws1-motor.ts`, `apps/backend/scripts/ws1/regression.ts` y los tests de la Fase 0 (`finanzas/test-*`, `cpe/test-*`), corridos con `export "$(grep '^DATABASE_URL=' .env)"` en el mismo shell.
- Commits en `feat/rbac-multiempresa`, estilo `feat(finanzas): ...`, terminando con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Fuera de alcance (fases siguientes)

Pantallas nuevas del mockup (Fase 4) · importadores XML/SIRE/Excel y adjuntos con hash (Fase 3) · reglas de validación ampliadas, percepción aplicada, diferencia de cambio (Fase 2) · reportes de antigüedad y PLE con TC (Fase 5) · backfill histórico · edición de líneas de una compra ya posteada.

La CxC de una valorización queda `parcial` por retención de garantía, amortización de adelanto y detracción hasta la Fase 2 (notas/aplicaciones de retención y amortización; el depósito de detracción del cliente se aplica como ingreso de la cuenta BN).

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `apps/backend/scripts/finanzas/2026-09-15-fase1-compras-pagos.sql` | DDL Fase 1 |
| `packages/db/src/schema.ts` | ORM: `gastoLineas`, `detraccionDocumento`, columnas nuevas |
| `apps/backend/src/lib/documentosPendientes.ts` | Crear documento, aplicar/anular pagos, refrescar saldo |
| `apps/backend/src/lib/detraccionTasa.ts` | Tasa de detracción vigente a una fecha (compartida con `cpe.ts`) |
| `apps/backend/src/lib/compras.ts` | `registrarCompra(tx, input)`: gasto + líneas + documento + detracción + nota de crédito + inventario |
| `apps/backend/src/routes/finanzas.ts` | Rutas de gastos/movimientos usan las libs; `GET /documentos-pendientes`, `GET /gastos/:id/detalle` |
| `apps/backend/src/routes/contabilidad.ts` | Motor: líneas agrupadas, NC invertida, contra por aplicaciones, enlaces de asiento |
| `apps/backend/src/routes/logistica.ts` | Pago de OC aplica; rendición no crea CxP |
| `apps/backend/src/lib/ventas.ts`, `routes/proyectos.ts` | Factura de valorización real + CxC + detracción; cobro aplica |
| `apps/frontend/src/lib/api.ts`, `pages/FinanzasPage.tsx`, `components/proyectos/tabs/ValorizacionesTab.tsx` | Bug L869 y número real de factura |

---

### Task 1: Esquema Fase 1

**Files:**
- Create: `apps/backend/scripts/finanzas/2026-09-15-fase1-compras-pagos.sql`
- Modify: `packages/db/src/schema.ts` (bloques de `documentoPendiente`, `aplicacionDocumento`, `cuentasBancarias`, `gastos`; tablas nuevas después de `export type NewGasto`)
- Test: `apps/backend/scripts/finanzas/test-fase1-tablas.ts`

**Interfaces:**
- Produces: `schema.gastoLineas`, `schema.detraccionDocumento`; `schema.gastos` + `fechaVencimiento, tipoCambio, retencion, retencionTipo, percepcion, docModificaSerie, docModificaNumero, motivoNota`; `schema.aplicacionDocumento.asientoId` nullable + `origenTipo, origenId`; `schema.cuentasBancarias.tipo`; fila BN `codigo='00003354431'`.

- [ ] **Step 1: Save the type-check baseline**

```bash
mkdir -p .tmp && pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "error TS" | sort > .tmp/tsc-base-fase1.txt; wc -l .tmp/tsc-base-fase1.txt
```
Expected: un número (errores preexistentes). Los tasks siguientes comparan contra este archivo.

- [ ] **Step 2: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-fase1-tablas.ts
/**
 * Fase 1 · esquema: tablas/columnas nuevas, asiento_id nullable, cuenta BN y exports ORM.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-fase1-tablas.ts
 */
import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
import assert from 'node:assert/strict';
import { db, schema } from '@erp/db';
import { eq, sql } from 'drizzle-orm';

type Col = { table_name: string; column_name: string; is_nullable: string };
const cols = (await db.execute(sql`select table_name, column_name, is_nullable from information_schema.columns
  where table_name in ('gasto_lineas','detraccion_documento','gastos','aplicacion_documento','cuentas_bancarias')`)) as unknown as Col[];
const tiene = (t: string, c: string) => cols.find((x) => x.table_name === t && x.column_name === c);

for (const c of ['gasto_id', 'numero', 'descripcion', 'unidad', 'cantidad', 'valor_unitario', 'descuento', 'valor_venta', 'afectacion_igv', 'igv', 'cuenta_contable', 'partida_id', 'proyecto_id', 'a_inventario']) assert.ok(tiene('gasto_lineas', c), `gasto_lineas.${c}`);
for (const c of ['doc_origen_tipo', 'doc_origen_id', 'empresa_id', 'codigo', 'porcentaje', 'base_pen', 'monto', 'monto_declarado', 'cuenta_bn', 'npd', 'constancia_numero', 'fecha_deposito', 'estado']) assert.ok(tiene('detraccion_documento', c), `detraccion_documento.${c}`);
for (const c of ['fecha_vencimiento', 'tipo_cambio', 'retencion', 'retencion_tipo', 'percepcion', 'doc_modifica_serie', 'doc_modifica_numero', 'motivo_nota']) assert.ok(tiene('gastos', c), `gastos.${c}`);
assert.equal(tiene('aplicacion_documento', 'asiento_id')?.is_nullable, 'YES', 'aplicacion_documento.asiento_id nullable');
for (const c of ['origen_tipo', 'origen_id']) assert.ok(tiene('aplicacion_documento', c), `aplicacion_documento.${c}`);
assert.ok(tiene('cuentas_bancarias', 'tipo'), 'cuentas_bancarias.tipo');
// D1 · 'Recibo por Honorarios' son 21 caracteres: doc_tipo debe quedar en 40, no en 20
const docTipoLen = (await db.execute(sql`select character_maximum_length as len from information_schema.columns where table_name = 'documento_pendiente' and column_name = 'doc_tipo'`)) as unknown as { len: number }[];
assert.equal(docTipoLen[0]?.len, 40, 'documento_pendiente.doc_tipo ancho a 40');

const [bn] = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, '00003354431'));
assert.deepEqual([bn?.tipo, bn?.cuentaContable, bn?.activo], ['detracciones', '1071', true], 'cuenta BN de detracciones');
const [kely] = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, 'REND-KELY'));
assert.equal(kely?.tipo, 'caja', 'REND-* es caja');

type Idx = { indexdef: string };
const idx = (await db.execute(sql`select indexdef from pg_indexes where indexname = 'docpend_uq'`)) as unknown as Idx[];
assert.match(idx[0]?.indexdef ?? '', /tercero_ruc/, 'docpend_uq incluye tercero_ruc');

await db.select().from(schema.gastoLineas).limit(1);
await db.select().from(schema.detraccionDocumento).limit(1);
console.log('fase1-tablas VERDE');
process.exit(0);
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-fase1-tablas.ts`
Expected: FAIL `gasto_lineas.gasto_id`

- [ ] **Step 4: Check whether WS1 apertura depends on the docpend unique index columns**

Run: `grep -n "onConflict\|ON CONFLICT\|docpend_uq" apps/backend/scripts/ws1/apertura.ts apps/backend/scripts/ws1/regression.ts`
Expected: ninguna coincidencia que use las columnas de `docpend_uq` como target. Si aparece un `ON CONFLICT (empresa_id, tipo, doc_tipo, doc_serie, doc_numero)`, agregar `tercero_ruc` a ese target en el mismo commit.

- [ ] **Step 5: Write the migration SQL**

```sql
-- apps/backend/scripts/finanzas/2026-09-15-fase1-compras-pagos.sql
-- Fase 1: lineas de compra, datos de documento en gastos, detraccion por documento,
-- aplicaciones capturadas antes del asiento, tipo de cuenta de tesoreria. Idempotente.

CREATE TABLE IF NOT EXISTS gasto_lineas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gasto_id        uuid NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
  numero          integer NOT NULL,
  descripcion     text NOT NULL,
  unidad          varchar(10),
  cantidad        numeric(14,4) NOT NULL DEFAULT 1,
  valor_unitario  numeric(14,5) NOT NULL DEFAULT 0,
  descuento       numeric(14,2) NOT NULL DEFAULT 0,
  valor_venta     numeric(14,2) NOT NULL,
  afectacion_igv  varchar(2) NOT NULL DEFAULT '10',
  igv             numeric(14,2) NOT NULL DEFAULT 0,
  cuenta_contable varchar(10) REFERENCES plan_contable(codigo),
  partida_id      uuid REFERENCES partidas(id) ON DELETE SET NULL,
  proyecto_id     uuid REFERENCES proyectos(id) ON DELETE SET NULL,
  a_inventario    boolean NOT NULL DEFAULT false,
  CONSTRAINT gasto_lineas_montos_chk CHECK (cantidad > 0 AND valor_venta >= 0 AND igv >= 0 AND descuento >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS gasto_lineas_numero_uq ON gasto_lineas (gasto_id, numero);

ALTER TABLE gastos ADD COLUMN IF NOT EXISTS fecha_vencimiento   date;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tipo_cambio         numeric(8,4);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS retencion           numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS retencion_tipo      varchar(10);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS percepcion          numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS doc_modifica_serie  varchar(20);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS doc_modifica_numero varchar(40);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS motivo_nota         varchar(2);
DO $$ BEGIN
  ALTER TABLE gastos ADD CONSTRAINT gastos_retencion_tipo_chk CHECK (retencion_tipo IS NULL OR retencion_tipo IN ('igv3', 'renta4ta'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS detraccion_documento (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_origen_tipo   varchar(12) NOT NULL,
  doc_origen_id     uuid NOT NULL,
  empresa_id        integer NOT NULL REFERENCES empresa(id),
  codigo            varchar(3) NOT NULL,
  porcentaje        numeric(5,2) NOT NULL,
  base_pen          numeric(14,2) NOT NULL,
  monto             numeric(14,2) NOT NULL,
  monto_declarado   numeric(14,2),
  cuenta_bn         varchar(20),
  npd               varchar(20),
  constancia_numero varchar(30),
  fecha_deposito    date,
  estado            varchar(12) NOT NULL DEFAULT 'pendiente',
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now(),
  CONSTRAINT detrdoc_origen_chk CHECK (doc_origen_tipo IN ('gasto', 'valorizacion')),
  CONSTRAINT detrdoc_estado_chk CHECK (estado IN ('pendiente', 'depositada', 'no_aplica'))
);
CREATE UNIQUE INDEX IF NOT EXISTS detrdoc_origen_uq ON detraccion_documento (doc_origen_tipo, doc_origen_id);

-- D1: 'Recibo por Honorarios' son 21 caracteres; doc_tipo en 20 truncaba con error 22001.
ALTER TABLE documento_pendiente ALTER COLUMN doc_tipo TYPE varchar(40);

ALTER TABLE aplicacion_documento ALTER COLUMN asiento_id DROP NOT NULL;
ALTER TABLE aplicacion_documento ADD COLUMN IF NOT EXISTS origen_tipo varchar(12);
ALTER TABLE aplicacion_documento ADD COLUMN IF NOT EXISTS origen_id   uuid;
DO $$ BEGIN
  ALTER TABLE aplicacion_documento ADD CONSTRAINT aplic_origen_tipo_chk CHECK (origen_tipo IS NULL OR origen_tipo IN ('movimiento', 'nota'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS aplic_origen_doc_uq ON aplicacion_documento (origen_tipo, origen_id, documento_pendiente_id) WHERE origen_id IS NOT NULL;

DROP INDEX IF EXISTS docpend_uq;
CREATE UNIQUE INDEX docpend_uq ON documento_pendiente (empresa_id, tipo, tercero_ruc, doc_tipo, doc_serie, doc_numero);

ALTER TABLE cuentas_bancarias ADD COLUMN IF NOT EXISTS tipo varchar(15) NOT NULL DEFAULT 'banco';
DO $$ BEGIN
  ALTER TABLE cuentas_bancarias ADD CONSTRAINT cuentas_tipo_chk CHECK (tipo IN ('banco', 'caja', 'detracciones'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE cuentas_bancarias SET tipo = 'caja' WHERE codigo LIKE 'REND-%' AND tipo = 'banco';
INSERT INTO cuentas_bancarias (codigo, banco, moneda, descripcion, cuenta_contable, tipo, activo)
VALUES ('00003354431', 'BANCO DE LA NACION', 'PEN', 'Cuenta de detracciones MM', '1071', 'detracciones', true)
ON CONFLICT (codigo) DO NOTHING;
```

- [ ] **Step 6: Apply the migration**

Run (PowerShell):
```powershell
$env:PGPASSWORD='MiClave123'; & 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -d erp_mmh_test -v ON_ERROR_STOP=1 -f apps/backend/scripts/finanzas/2026-09-15-fase1-compras-pagos.sql
```
Expected: sin `ERROR`. Correrlo dos veces debe seguir sin error (idempotente).

- [ ] **Step 7: Update the ORM**

En `packages/db/src/schema.ts`:

(a) `documentoPendiente`, reemplazar la línea del índice único:
```ts
    uq: uniqueIndex('docpend_uq').on(t.empresaId, t.tipo, t.docTipo, t.docSerie, t.docNumero),
```
por:
```ts
    uq: uniqueIndex('docpend_uq').on(t.empresaId, t.tipo, t.terceroRuc, t.docTipo, t.docSerie, t.docNumero), // Fase 1 · + tercero (misma serie en 2 proveedores)
```

(a2) `documentoPendiente` (D1), reemplazar:
```ts
    docTipo: varchar('doc_tipo', { length: 20 }),
```
por:
```ts
    docTipo: varchar('doc_tipo', { length: 40 }), // Fase 1 · 'Recibo por Honorarios' son 21 caracteres
```

(b) `aplicacionDocumento`, reemplazar:
```ts
    asientoId: uuid('asiento_id').notNull().references(() => asientos.id, { onDelete: 'cascade' }),
```
por:
```ts
    asientoId: uuid('asiento_id').references(() => asientos.id, { onDelete: 'cascade' }), // Fase 1 · null hasta que el motor postea el pago
```
y después de `origenRef: varchar('origen_ref', { length: 80 }),` agregar:
```ts
    // Fase 1 · captura del pago antes del asiento: movimiento (pago/cobro) o nota (NC que reduce la factura)
    origenTipo: varchar('origen_tipo', { length: 12 }), // movimiento | nota (CHECK)
    origenId: uuid('origen_id'),
```

(c) `cuentasBancarias`, después de `cuentaContable: ...` agregar:
```ts
  tipo: varchar('tipo', { length: 15 }).notNull().default('banco'), // Fase 1 · banco | caja | detracciones (CHECK)
```

(d) `gastos` (schema.ts:820, justo antes de `lockedAt`), después de `observaciones: text('observaciones'),` agregar:
```ts
    // Fase 1 · documento: vencimiento (CxP), TC (USD), retención/percepción, referencia de nota de crédito
    fechaVencimiento: date('fecha_vencimiento'),
    tipoCambio: decimal('tipo_cambio', { precision: 8, scale: 4 }),
    retencion: decimal('retencion', { precision: 14, scale: 2 }).notNull().default('0'),
    retencionTipo: varchar('retencion_tipo', { length: 10 }), // igv3 | renta4ta (CHECK)
    percepcion: decimal('percepcion', { precision: 14, scale: 2 }).notNull().default('0'),
    docModificaSerie: varchar('doc_modifica_serie', { length: 20 }),
    docModificaNumero: varchar('doc_modifica_numero', { length: 40 }),
    motivoNota: varchar('motivo_nota', { length: 2 }), // catálogo SUNAT 09
```

(e) Después de `export type NewGasto = typeof gastos.$inferInsert;` agregar:
```ts
// Fase 1 · detalle opcional de una compra. Sin líneas = una línea implícita (comportamiento anterior).
export const gastoLineas = pgTable(
  'gasto_lineas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gastoId: uuid('gasto_id').notNull().references(() => gastos.id, { onDelete: 'cascade' }),
    numero: integer('numero').notNull(),
    descripcion: text('descripcion').notNull(),
    unidad: varchar('unidad', { length: 10 }),
    cantidad: decimal('cantidad', { precision: 14, scale: 4 }).notNull().default('1'),
    valorUnitario: decimal('valor_unitario', { precision: 14, scale: 5 }).notNull().default('0'),
    descuento: decimal('descuento', { precision: 14, scale: 2 }).notNull().default('0'),
    valorVenta: decimal('valor_venta', { precision: 14, scale: 2 }).notNull(), // cantidad × valorUnitario − descuento
    afectacionIgv: varchar('afectacion_igv', { length: 2 }).notNull().default('10'), // catálogo SUNAT 07
    igv: decimal('igv', { precision: 14, scale: 2 }).notNull().default('0'),
    cuentaContable: varchar('cuenta_contable', { length: 10 }).references(() => planContable.codigo),
    partidaId: uuid('partida_id').references(() => partidas.id, { onDelete: 'set null' }),
    proyectoId: uuid('proyecto_id').references(() => proyectos.id, { onDelete: 'set null' }),
    aInventario: boolean('a_inventario').notNull().default(false),
  },
  (t) => ({ numeroUq: uniqueIndex('gasto_lineas_numero_uq').on(t.gastoId, t.numero) }),
);
export type GastoLinea = typeof gastoLineas.$inferSelect;

// Fase 1 · detracción por documento (compra o venta): calculada, declarada y constancia de depósito.
export const detraccionDocumento = pgTable(
  'detraccion_documento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    docOrigenTipo: varchar('doc_origen_tipo', { length: 12 }).notNull(), // gasto | valorizacion (CHECK)
    docOrigenId: uuid('doc_origen_id').notNull(),
    empresaId: integer('empresa_id').notNull().references(() => empresas.id),
    codigo: varchar('codigo', { length: 3 }).notNull(),
    porcentaje: decimal('porcentaje', { precision: 5, scale: 2 }).notNull(),
    basePen: decimal('base_pen', { precision: 14, scale: 2 }).notNull(),
    monto: decimal('monto', { precision: 14, scale: 2 }).notNull(), // calculado (entero más cercano, PEN)
    montoDeclarado: decimal('monto_declarado', { precision: 14, scale: 2 }),
    cuentaBn: varchar('cuenta_bn', { length: 20 }),
    npd: varchar('npd', { length: 20 }),
    constanciaNumero: varchar('constancia_numero', { length: 30 }),
    fechaDeposito: date('fecha_deposito'),
    estado: varchar('estado', { length: 12 }).notNull().default('pendiente'), // pendiente | depositada | no_aplica (CHECK)
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({ origenUq: uniqueIndex('detrdoc_origen_uq').on(t.docOrigenTipo, t.docOrigenId) }),
);
export type DetraccionDocumento = typeof detraccionDocumento.$inferSelect;
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-fase1-tablas.ts`
Expected: `fase1-tablas VERDE`

- [ ] **Step 9: Regression (schema only touched)**

Run:
```bash
export "$(grep '^DATABASE_URL=' .env)"
for t in finanzas/test-fase0-tablas ws1/test-ws1-motor ws1/regression; do node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/$t.ts > /dev/null 2>&1 && echo "OK   $t" || echo "FAIL $t"; done
```
Expected: 3 `OK`. Si `ws1/regression` falla por el índice `docpend_uq`, aplicar el ajuste del Step 4.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/scripts/finanzas/2026-09-15-fase1-compras-pagos.sql apps/backend/scripts/finanzas/test-fase1-tablas.ts packages/db/src/schema.ts
git commit -m "feat(finanzas): esquema fase 1 (lineas de compra, detraccion por documento, aplicaciones capturadas, cuenta BN)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Lib de documentos pendientes y tasa de detracción

**Files:**
- Create: `apps/backend/src/lib/documentosPendientes.ts`
- Create: `apps/backend/src/lib/detraccionTasa.ts`
- Modify: `apps/backend/src/routes/cpe.ts` (usa `buscarTasaDetraccion`)
- Test: `apps/backend/scripts/finanzas/test-documentos-pendientes.ts`

**Interfaces:**
- Consumes: Task 1 (`schema.documentoPendiente`, `schema.aplicacionDocumento` con `origenTipo/origenId`).
- Produces:
```ts
// documentosPendientes.ts
export type DbLike = PgDatabase<PostgresJsQueryResultHKT, typeof schema>; // db o tx
export class DocumentoError extends Error { status: 400 | 404 | 409 }
export const esNotaCredito: (tipoComprobante: string | null | undefined) => boolean;
export function refrescarDocumento(q: DbLike, documentoId: string): Promise<DocumentoPendiente>;
export function crearDocumentoDesdeGasto(q: DbLike, gasto: Gasto, empresaId?: number): Promise<DocumentoPendiente | null>;
export type AplicacionIn = { documentoPendienteId: string; monto: number };
export function aplicar(q: DbLike, o: { origenTipo: 'movimiento' | 'nota'; origenId: string; fecha: string; userId?: string | null; aplicaciones: AplicacionIn[]; tipoEsperado?: 'cxp' | 'cxc'; moneda?: string }): Promise<void>;
export function anularAplicacionesDe(q: DbLike, origenTipo: 'movimiento' | 'nota', origenId: string): Promise<number>;
export function aplicarPagoAOrigen(q: DbLike, o: { docOrigenTipo: 'gasto' | 'valorizacion'; docOrigenId: string; movimientoId: string; monto: number; fecha: string; userId?: string | null }): Promise<string | null>;
// detraccionTasa.ts
export function buscarTasaDetraccion(codigo: string, fecha: string): Promise<{ codigo: string; porcentaje: number; montoMinimo: number } | null>;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-documentos-pendientes.ts
/**
 * Fase 1 · sub-mayor: crear documento desde compra, aplicar/anular pagos, saldo derivado, tasa vigente.
 * Todo corre dentro de una transacción que se revierte al final (no deja residuos).
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-documentos-pendientes.ts
 */
import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@erp/db';
import { DocumentoError, aplicar, aplicarPagoAOrigen, anularAplicacionesDe, crearDocumentoDesdeGasto, esNotaCredito, refrescarDocumento } from '../../src/lib/documentosPendientes.js';
import { buscarTasaDetraccion } from '../../src/lib/detraccionTasa.js';

class Rollback extends Error {}
const RUC = '20999999991';

async function rechaza(p: Promise<unknown>, status: number, msg: string) {
  await assert.rejects(p, (e) => e instanceof DocumentoError && e.status === status, msg);
}

try {
  await db.transaction(async (tx) => {
    const nuevoGasto = async (extra: Partial<typeof schema.gastos.$inferInsert>) =>
      (await tx.insert(schema.gastos).values({ fecha: '2099-01-10', proveedorRuc: RUC, proveedorRazon: 'PROVEEDOR TEST', tipoComprobante: 'Factura', serie: 'F999', numero: '1', moneda: 'PEN', subtotal: '1000.00', igv: '180.00', total: '1180.00', ...extra }).returning())[0]!;

    // documento desde compra · idempotente · duplicado por RUC+serie+numero
    const g1 = await nuevoGasto({});
    const d1 = await crearDocumentoDesdeGasto(tx, g1);
    assert.deepEqual([d1?.tipo, d1?.cuentaControl, d1?.montoOriginal, d1?.saldoPendiente, d1?.estado, d1?.docOrigenTipo], ['cxp', '4212', '1180.00', '1180.00', 'abierto', 'gasto']);
    assert.equal((await crearDocumentoDesdeGasto(tx, g1))?.id, d1!.id, 'misma compra → mismo documento');
    const gDup = await nuevoGasto({});
    await rechaza(crearDocumentoDesdeGasto(tx, gDup), 409, 'misma factura de otro gasto → 409');
    const gOtroProv = await nuevoGasto({ proveedorRuc: '20999999992' });
    assert.ok(await crearDocumentoDesdeGasto(tx, gOtroProv), 'misma serie-numero de otro proveedor es valida');

    // pagos parciales, exceso, cancelacion, anulacion
    const pago1 = randomUUID(), pago2 = randomUUID();
    await aplicar(tx, { origenTipo: 'movimiento', origenId: pago1, fecha: '2099-01-15', aplicaciones: [{ documentoPendienteId: d1!.id, monto: 600 }], tipoEsperado: 'cxp', moneda: 'PEN' });
    let d = await refrescarDocumento(tx, d1!.id);
    assert.deepEqual([d.saldoPendiente, d.estado], ['580.00', 'parcial']);
    await rechaza(aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: d1!.id, monto: 700 }] }), 400, 'exceso de saldo → 400');
    await rechaza(aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: d1!.id, monto: 580 }], tipoEsperado: 'cxc' }), 400, 'tipo equivocado → 400');
    await rechaza(aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: d1!.id, monto: 580 }], moneda: 'USD' }), 400, 'moneda distinta → 400');
    await rechaza(aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: randomUUID(), monto: 1 }] }), 404, 'documento inexistente → 404');
    await aplicar(tx, { origenTipo: 'movimiento', origenId: pago2, fecha: '2099-01-16', aplicaciones: [{ documentoPendienteId: d1!.id, monto: 580 }] });
    d = await refrescarDocumento(tx, d1!.id);
    assert.deepEqual([d.saldoPendiente, d.estado], ['0.00', 'cancelado']);
    assert.equal(await anularAplicacionesDe(tx, 'movimiento', pago2), 1, 'anula 1 aplicacion');
    d = await refrescarDocumento(tx, d1!.id);
    assert.deepEqual([d.saldoPendiente, d.estado], ['580.00', 'parcial'], 'anular recompone el saldo');

    // pago legacy por origen: aplica hasta el saldo
    const pago3 = randomUUID();
    assert.equal(await aplicarPagoAOrigen(tx, { docOrigenTipo: 'gasto', docOrigenId: g1.id, movimientoId: pago3, monto: 900, fecha: '2099-01-20' }), d1!.id);
    d = await refrescarDocumento(tx, d1!.id);
    assert.deepEqual([d.saldoPendiente, d.estado], ['0.00', 'cancelado'], 'aplica solo el saldo (580)');
    assert.equal(await aplicarPagoAOrigen(tx, { docOrigenTipo: 'gasto', docOrigenId: g1.id, movimientoId: randomUUID(), monto: 10, fecha: '2099-01-21' }), null, 'sin saldo → no aplica');

    // exclusiones y moneda extranjera
    assert.equal(esNotaCredito('Nota de Crédito'), true);
    assert.equal(esNotaCredito('07'), true);
    assert.equal(esNotaCredito('Factura'), false);
    assert.equal(await crearDocumentoDesdeGasto(tx, await nuevoGasto({ numero: '2', tipoComprobante: 'Nota de Crédito' })), null, 'NC no crea CxP');
    assert.equal(await crearDocumentoDesdeGasto(tx, await nuevoGasto({ numero: '3', tipoRegistro: 'Rendición' })), null, 'rendicion no crea CxP');
    await rechaza(crearDocumentoDesdeGasto(tx, await nuevoGasto({ numero: '4', moneda: 'USD' })), 400, 'USD sin TC → 400');
    const dUsd = await crearDocumentoDesdeGasto(tx, await nuevoGasto({ numero: '5', moneda: 'USD', tipoCambio: '3.7500', subtotal: '100.00', igv: '18.00', total: '118.00' }));
    assert.deepEqual([dUsd?.moneda, dUsd?.montoOriginal, dUsd?.montoPen, dUsd?.tipoCambio], ['USD', '118.00', '442.50', '3.7500']);

    // tasa vigente (datos de Fase 0)
    assert.deepEqual(await buscarTasaDetraccion('030', '2026-01-15'), { codigo: '030', porcentaje: 4, montoMinimo: 700 });
    assert.equal((await buscarTasaDetraccion('027', '2026-01-15'))?.montoMinimo, 400);
    assert.equal(await buscarTasaDetraccion('006', '2026-01-15'), null, '006 no vigente');
    assert.equal(await buscarTasaDetraccion('999', '2026-01-15'), null, 'codigo inexistente');

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) throw e;
}
console.log('documentos-pendientes VERDE');
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-documentos-pendientes.ts`
Expected: FAIL `Cannot find module '../../src/lib/documentosPendientes.js'`

- [ ] **Step 3: Write `detraccionTasa.ts`**

```ts
// apps/backend/src/lib/detraccionTasa.ts
// Tasa de detracción vigente a una fecha (catálogo cargado en Fase 0). null si no existe, no está vigente o no tiene %.
import { db, schema } from '@erp/db';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';

export async function buscarTasaDetraccion(codigo: string, fecha: string) {
  const t = schema.detraccionTasa;
  const [tasa] = await db.select().from(t)
    .where(and(eq(t.codigo, codigo), lte(t.vigenciaDesde, fecha), or(isNull(t.vigenciaHasta), gte(t.vigenciaHasta, fecha))))
    .orderBy(desc(t.vigenciaDesde))
    .limit(1);
  if (!tasa || tasa.porcentaje == null) return null;
  return { codigo: tasa.codigo, porcentaje: Number(tasa.porcentaje), montoMinimo: Number(tasa.montoMinimo) };
}
```

- [ ] **Step 4: Use it in `cpe.ts`**

En `apps/backend/src/routes/cpe.ts`:
- Reemplazar el import `import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';` por `import { eq } from 'drizzle-orm';`
- Agregar `import { buscarTasaDetraccion } from '../lib/detraccionTasa.js';`
- Reemplazar en `validarDetraccion` desde `const t = schema.detraccionTasa;` hasta la línea `if (!tasa || tasa.porcentaje == null) return { declarada, error: ... };` por:
```ts
  const tasa = await buscarTasaDetraccion(declarada.codigo, doc.fechaEmision);
  if (!tasa) return { declarada, error: `Código de detracción ${declarada.codigo} no vigente o sin % al ${doc.fechaEmision}` };
```
- Reemplazar `tasa: { codigo: tasa.codigo, porcentaje: Number(tasa.porcentaje), montoMinimo: Number(tasa.montoMinimo) }` por `tasa`.

- [ ] **Step 5: Write `documentosPendientes.ts`**

```ts
// apps/backend/src/lib/documentosPendientes.ts
/**
 * Fase 1 · sub-mayor CxP/CxC (modelo WS0): documento_pendiente + aplicacion_documento.
 * El saldo SIEMPRE se deriva de las aplicaciones activas; nunca se resta a ciegas.
 * Las funciones reciben db o una tx para componerse dentro de la transacción de la ruta.
 */
import { schema } from '@erp/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';

export type DbLike = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;
type Gasto = typeof schema.gastos.$inferSelect;
type Documento = typeof schema.documentoPendiente.$inferSelect;

export class DocumentoError extends Error {
  constructor(public status: 400 | 404 | 409, mensaje: string) {
    super(mensaje);
    this.name = 'DocumentoError';
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ref = (d: Pick<Documento, 'docSerie' | 'docNumero'>) => [d.docSerie, d.docNumero].filter(Boolean).join('-') || 's/n';

export const esNotaCredito = (tipoComprobante: string | null | undefined) => /^(07|nota de cr)/i.test((tipoComprobante ?? '').trim());

export async function refrescarDocumento(q: DbLike, documentoId: string): Promise<Documento> {
  const d = schema.documentoPendiente, a = schema.aplicacionDocumento;
  const [doc] = await q.select().from(d).where(eq(d.id, documentoId)).limit(1);
  if (!doc) throw new DocumentoError(404, `Documento pendiente ${documentoId} no existe`);
  const [agg] = await q.select({ aplicado: sql<string>`coalesce(sum(${a.montoAplicado}), 0)` }).from(a)
    .where(and(eq(a.documentoPendienteId, documentoId), eq(a.estado, 'activa')));
  const original = Number(doc.montoOriginal);
  const saldo = Math.max(0, r2(original - Number(agg?.aplicado ?? 0)));
  const estado = saldo <= 0.004 ? 'cancelado' : saldo < original - 0.004 ? 'parcial' : 'abierto';
  const [upd] = await q.update(d).set({ saldoPendiente: saldo.toFixed(2), estado, updatedAt: new Date() }).where(eq(d.id, documentoId)).returning();
  return upd!;
}

/** Cuenta por pagar de una compra. null si es nota de crédito, rendición o total ≤ 0. Idempotente por compra. */
export async function crearDocumentoDesdeGasto(q: DbLike, gasto: Gasto, empresaId = 1): Promise<Documento | null> {
  if (esNotaCredito(gasto.tipoComprobante) || gasto.tipoRegistro === 'Rendición' || Number(gasto.total) <= 0) return null;
  const d = schema.documentoPendiente;
  const [propio] = await q.select().from(d).where(and(eq(d.docOrigenTipo, 'gasto'), eq(d.docOrigenId, gasto.id))).limit(1);
  if (propio) return propio;
  if (gasto.proveedorRuc && gasto.serie && gasto.numero) {
    const [dup] = await q.select({ id: d.id }).from(d)
      .where(and(eq(d.empresaId, empresaId), eq(d.tipo, 'cxp'), eq(d.terceroRuc, gasto.proveedorRuc), eq(d.docSerie, gasto.serie), eq(d.docNumero, gasto.numero))).limit(1);
    if (dup) throw new DocumentoError(409, `La factura ${gasto.serie}-${gasto.numero} de ${gasto.proveedorRuc} ya está registrada`);
  }
  const tc = gasto.moneda === 'PEN' ? 1 : Number(gasto.tipoCambio ?? 0);
  if (!(tc > 0)) throw new DocumentoError(400, `Moneda ${gasto.moneda} requiere tipo de cambio para registrar la cuenta por pagar`);
  const total = Number(gasto.total);
  const [doc] = await q.insert(d).values({
    empresaId, tipo: 'cxp', cuentaControl: '4212',
    terceroRuc: gasto.proveedorRuc, terceroRazon: gasto.proveedorRazon,
    docTipo: gasto.tipoComprobante, docSerie: gasto.serie, docNumero: gasto.numero,
    fechaEmision: gasto.fecha, fechaVenc: gasto.fechaVencimiento ?? gasto.fecha,
    moneda: gasto.moneda, tipoCambio: gasto.moneda === 'PEN' ? null : tc.toFixed(4),
    montoOriginal: total.toFixed(2), montoPen: (total * tc).toFixed(2), saldoPendiente: total.toFixed(2),
    estado: 'abierto', obraId: gasto.proyectoId, docOrigenTipo: 'gasto', docOrigenId: gasto.id,
  }).returning();
  return doc!;
}

export type AplicacionIn = { documentoPendienteId: string; monto: number };

/** Registra aplicaciones de un pago/cobro (o nota) contra documentos. Valida saldo, tipo y moneda. */
export async function aplicar(q: DbLike, o: { origenTipo: 'movimiento' | 'nota'; origenId: string; fecha: string; userId?: string | null; aplicaciones: AplicacionIn[]; tipoEsperado?: 'cxp' | 'cxc'; moneda?: string }) {
  const porDoc = new Map<string, number>();
  for (const ap of o.aplicaciones) {
    if (!(ap.monto > 0)) throw new DocumentoError(400, 'Cada aplicación debe tener monto > 0');
    porDoc.set(ap.documentoPendienteId, r2((porDoc.get(ap.documentoPendienteId) ?? 0) + ap.monto));
  }
  const ids = [...porDoc.keys()];
  if (!ids.length) return;
  const docs = await q.select().from(schema.documentoPendiente).where(inArray(schema.documentoPendiente.id, ids)).for('update'); // D12 · lock de fila: 2 pagos concurrentes no pasan ambos
  for (const id of ids) {
    const doc = docs.find((x) => x.id === id);
    if (!doc) throw new DocumentoError(404, `Documento pendiente ${id} no existe`);
    if (o.tipoEsperado && doc.tipo !== o.tipoEsperado) throw new DocumentoError(400, `El documento ${ref(doc)} es ${doc.tipo}, se esperaba ${o.tipoEsperado}`);
    if (o.moneda && doc.moneda !== o.moneda) throw new DocumentoError(400, `El documento ${ref(doc)} está en ${doc.moneda}; el pago está en ${o.moneda}`);
    const actual = await refrescarDocumento(q, id);
    const monto = porDoc.get(id)!;
    if (monto > Number(actual.saldoPendiente) + 0.005) throw new DocumentoError(400, `La aplicación ${monto.toFixed(2)} excede el saldo ${actual.saldoPendiente} de ${ref(doc)}`);
    await q.insert(schema.aplicacionDocumento).values({
      documentoPendienteId: id, montoAplicado: monto.toFixed(2), moneda: doc.moneda, tipoCambio: doc.tipoCambio,
      fecha: o.fecha, estado: 'activa', createdBy: o.userId ?? null,
      origenTipo: o.origenTipo, origenId: o.origenId, origenRef: `${o.origenTipo}:${o.origenId}`,
    });
    await refrescarDocumento(q, id);
  }
}

/** Anula las aplicaciones activas de un origen (pago anulado) y recompone los saldos. */
export async function anularAplicacionesDe(q: DbLike, origenTipo: 'movimiento' | 'nota', origenId: string) {
  const a = schema.aplicacionDocumento;
  const filas = await q.update(a).set({ estado: 'anulada' })
    .where(and(eq(a.origenTipo, origenTipo), eq(a.origenId, origenId), eq(a.estado, 'activa')))
    .returning({ doc: a.documentoPendienteId });
  for (const id of new Set(filas.map((f) => f.doc))) await refrescarDocumento(q, id);
  return filas.length;
}

/** Pago ligado a un documento de origen (gastoId / valorizacionId): aplica hasta el saldo. null si no hay documento o saldo. */
export async function aplicarPagoAOrigen(q: DbLike, o: { docOrigenTipo: 'gasto' | 'valorizacion'; docOrigenId: string; movimientoId: string; monto: number; fecha: string; userId?: string | null }) {
  const d = schema.documentoPendiente;
  const [doc] = await q.select().from(d).where(and(eq(d.docOrigenTipo, o.docOrigenTipo), eq(d.docOrigenId, o.docOrigenId))).limit(1).for('update'); // D12
  if (!doc) return null;
  const actual = await refrescarDocumento(q, doc.id);
  const aplicable = r2(Math.min(o.monto, Number(actual.saldoPendiente)));
  if (aplicable <= 0.004) return null;
  await aplicar(q, { origenTipo: 'movimiento', origenId: o.movimientoId, fecha: o.fecha, userId: o.userId, aplicaciones: [{ documentoPendienteId: doc.id, monto: aplicable }] });
  return doc.id;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:
```bash
export "$(grep '^DATABASE_URL=' .env)"
node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-documentos-pendientes.ts
node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/cpe/test-cpe-endpoint.ts
```
Expected: `documentos-pendientes VERDE` y `cpe-endpoint VERDE`.

- [ ] **Step 7: Type check against the baseline**

Run: `pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "error TS" | sort > .tmp/tsc-t2.txt; comm -13 .tmp/tsc-base-fase1.txt .tmp/tsc-t2.txt`
Expected: sin salida (ningún error nuevo).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/lib/documentosPendientes.ts apps/backend/src/lib/detraccionTasa.ts apps/backend/src/routes/cpe.ts apps/backend/scripts/finanzas/test-documentos-pendientes.ts
git commit -m "feat(finanzas): sub-mayor CxP/CxC con aplicaciones y saldo derivado + tasa de detraccion compartida

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 3: Registrar compra completa (líneas, documento, detracción, NC, retención, inventario)

**Files:**
- Create: `apps/backend/src/lib/compras.ts`
- Modify: `apps/backend/src/routes/finanzas.ts` (POST `/gastos` y `/proyectos/:id/gastos` usan `registrarCompra`; `GET /gastos` agrega saldo; nuevo `GET /gastos/:id/detalle`; `DELETE /gastos/:id` protege pagos; se elimina `crearDraftInventario` local)
- Test: `apps/backend/scripts/finanzas/test-compras.ts`

**Interfaces:**
- Consumes: Task 2 (`crearDocumentoDesdeGasto`, `aplicar`, `anularAplicacionesDe`, `esNotaCredito`, `DocumentoError`, `DbLike`, `buscarTasaDetraccion`), Fase 0 (`calcularDetraccion`, `buscarTipoCambio`).
- Produces:
```ts
// compras.ts
export const extrasCompraSchema: z.ZodObject<...>; // fechaVencimiento, tipoCambio, lineas[], detraccion{codigo,montoDeclarado?}, retencion{tipo,monto}, percepcion, docModifica{serie,numero}, motivoNota
export type ExtrasCompra = z.infer<typeof extrasCompraSchema>;
export function calcularLineas(lineas: LineaCompraIn[]): LineaCalculada[]; // valorVenta, igv 18% si afectación 1x
export function registrarCompra(q: DbLike, input: { values: typeof schema.gastos.$inferInsert; extras: ExtrasCompra; inventariable?: boolean; userId?: string | null; empresaId?: number }):
  Promise<{ gasto: Gasto; lineas: number; documento: DocumentoPendiente | null; detraccion: DetraccionDocumento | null }>;
// HTTP
POST /api/gastos, POST /api/proyectos/:id/gastos → 200 { gasto, documento, detraccion } | 400/404/409 { error }
GET  /api/gastos → cada gasto + { saldoPendiente: number | null, estadoPago: 'pendiente' | 'parcial' | 'pagado' | null }
GET  /api/gastos/:id/detalle → { gasto, lineas, documento, aplicaciones, detraccion }
DELETE /api/gastos/:id → 409 si la compra tiene pagos aplicados
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-compras.ts
/**
 * Fase 1 · compra completa por HTTP (router real): líneas, documento, detracción, USD, retención, NC, borrado.
 * Usa fechas 2099 y RUC de prueba; limpia todo lo que crea.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-compras.ts
 */
import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
import assert from 'node:assert/strict';
import express from 'express';
import { db, schema } from '@erp/db';
import { inArray, or } from 'drizzle-orm';
import { authMiddleware } from '../../src/middleware/auth.js';
import { lucia } from '../../src/auth.js';
import finanzasRoutes from '../../src/routes/finanzas.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const RUC = '20999999993';
const creados: string[] = [];
const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api', finanzasRoutes);
const server = app.listen(0);
const base = `http://localhost:${(server.address() as { port: number }).port}`;
const session = await lucia.createSession(USER, {});
const headers = { cookie: lucia.createSessionCookie(session.id).serialize(), 'content-type': 'application/json' };
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as any };
};
const compra = async (extra: Record<string, unknown>) => {
  const r = await call('POST', '/api/gastos', { fecha: '2099-01-10', destino: 'corporativo', tipoGasto: 'Compra Materiales', proveedorRuc: RUC, proveedorRazon: 'PROVEEDOR FASE1', tipoComprobante: 'Factura', serie: 'F999', moneda: 'PEN', subtotal: 1000, igv: 180, total: 1180, ...extra });
  if (r.json.gasto?.id) creados.push(r.json.gasto.id);
  return r;
};

try {
  // A · compra simple → CxP abierta, vencimiento guardado (bug L869: no se pierde si queda pendiente)
  const A = await compra({ numero: '1', fechaVencimiento: '2099-02-10' });
  assert.equal(A.status, 200, JSON.stringify(A.json));
  assert.deepEqual([A.json.documento.tipo, A.json.documento.saldoPendiente, A.json.documento.fechaVenc, A.json.gasto.fechaVencimiento], ['cxp', '1180.00', '2099-02-10', '2099-02-10']);
  const detA = await call('GET', `/api/gastos/${A.json.gasto.id}/detalle`);
  assert.deepEqual([detA.json.lineas.length, detA.json.documento.estado, detA.json.aplicaciones.length], [0, 'abierto', 0]);
  const lista = await call('GET', '/api/gastos');
  const filaA = lista.json.gastos.find((g: any) => g.id === A.json.gasto.id);
  assert.deepEqual([filaA.saldoPendiente, filaA.estadoPago], [1180, 'pendiente'], 'GET /gastos trae saldo');
  console.log('  ✓ A simple');

  // B · líneas: totales derivados en servidor + inventario por línea
  const B = await compra({ numero: '2', subtotal: 0, igv: 0, total: 0, lineas: [
    { descripcion: 'Amoladora Bosch', unidad: 'UND', cantidad: 10, valorUnitario: 45, aInventario: true, cuentaContable: '6032' },
    { descripcion: 'Flete', cantidad: 1, valorUnitario: 100, afectacionIgv: '20' },
  ] });
  assert.equal(B.status, 200, JSON.stringify(B.json));
  assert.deepEqual([B.json.gasto.subtotal, B.json.gasto.igv, B.json.gasto.exonerado, B.json.gasto.total], ['450.00', '81.00', '100.00', '631.00']);
  const detB = await call('GET', `/api/gastos/${B.json.gasto.id}/detalle`);
  assert.deepEqual(detB.json.lineas.map((l: any) => [l.numero, l.valorVenta, l.igv, l.aInventario]), [[1, '450.00', '81.00', true], [2, '100.00', '0.00', false]]);
  const inv = await db.select().from(schema.inventarioItems).where(inArray(schema.inventarioItems.gastoId, [B.json.gasto.id]));
  assert.deepEqual(inv.map((i) => [Number(i.cantidad), Number(i.valorUnitario), i.estado]), [[10, 45, 'Por completar']], 'un item por linea a inventario con cantidad real');
  console.log('  ✓ B lineas');

  // C · USD: sin TC cargado → 400; con TC → monto PEN
  const C1 = await compra({ numero: '3', moneda: 'USD', subtotal: 100, igv: 18, total: 118 });
  assert.equal(C1.status, 400);
  assert.match(C1.json.error, /tipo de cambio/i);
  const C2 = await compra({ numero: '3', moneda: 'USD', tipoCambio: 3.75, subtotal: 100, igv: 18, total: 118 });
  assert.deepEqual([C2.status, C2.json.gasto.tipoCambio, C2.json.documento.montoPen], [200, '3.7500', '442.50']);
  console.log('  ✓ C USD');

  // D · detraccion 030: aplica sobre S/ 1,180 (47) · no aplica bajo el minimo
  const D1 = await compra({ numero: '4', detraccion: { codigo: '030', montoDeclarado: 47 } });
  assert.deepEqual([D1.status, D1.json.detraccion.monto, D1.json.detraccion.montoDeclarado, D1.json.detraccion.estado], [200, '47.00', '47.00', 'pendiente']);
  const D2 = await compra({ numero: '5', subtotal: 400, igv: 72, total: 472, detraccion: { codigo: '030' } });
  assert.deepEqual([D2.status, D2.json.detraccion.monto, D2.json.detraccion.estado], [200, '0.00', 'no_aplica']);
  assert.equal((await compra({ numero: '6', detraccion: { codigo: '006' } })).status, 400, 'codigo no vigente');
  console.log('  ✓ D detraccion');

  // E · retencion: IGV 3% requiere agente de retencion · 4ta si
  assert.equal((await compra({ numero: '7', retencion: { tipo: 'igv3', monto: 35.4 } })).status, 400);
  const E = await compra({ numero: '8', tipoComprobante: 'Recibo por Honorarios', subtotal: 1500, igv: 0, total: 1500, retencion: { tipo: 'renta4ta', monto: 120 } });
  assert.deepEqual([E.status, E.json.gasto.retencion, E.json.gasto.retencionTipo], [200, '120.00', 'renta4ta']);
  console.log('  ✓ E retencion');

  // F · nota de credito reduce la factura referida; validaciones
  const F = await compra({ numero: '10' });
  const NC = await compra({ numero: '11', serie: 'FC99', tipoComprobante: 'Nota de Crédito', subtotal: 152.54, igv: 27.46, total: 180, docModifica: { serie: 'F999', numero: '10' }, motivoNota: '07' });
  assert.equal(NC.status, 200, JSON.stringify(NC.json));
  assert.equal(NC.json.documento, null, 'la NC no crea CxP propia');
  const detF = await call('GET', `/api/gastos/${F.json.gasto.id}/detalle`);
  assert.deepEqual([detF.json.documento.saldoPendiente, detF.json.documento.estado, detF.json.aplicaciones[0].origenTipo], ['1000.00', 'parcial', 'nota']);
  assert.equal((await compra({ numero: '12', tipoComprobante: 'Nota de Crédito', total: 10 })).status, 400, 'NC sin factura referida');
  assert.equal((await compra({ numero: '13', tipoComprobante: 'Nota de Crédito', total: 10, docModifica: { serie: 'F999', numero: '999' } })).status, 404, 'NC a factura inexistente');
  console.log('  ✓ F nota de credito');

  // G · factura duplicada del mismo proveedor
  assert.equal((await compra({ numero: '1' })).status, 409);
  console.log('  ✓ G duplicado');

  // I · borrado: con NC aplicada la factura no se borra; borrando la NC primero, si
  assert.equal((await call('DELETE', `/api/gastos/${F.json.gasto.id}`)).status, 409, 'factura con aplicacion activa');
  assert.equal((await call('DELETE', `/api/gastos/${NC.json.gasto.id}`)).status, 200);
  const detF2 = await call('GET', `/api/gastos/${F.json.gasto.id}/detalle`);
  assert.equal(detF2.json.documento.saldoPendiente, '1180.00', 'borrar la NC recompone el saldo');
  assert.equal((await call('DELETE', `/api/gastos/${F.json.gasto.id}`)).status, 200);
  const quedan = await db.select().from(schema.documentoPendiente).where(inArray(schema.documentoPendiente.docOrigenId, [F.json.gasto.id]));
  assert.equal(quedan.length, 0, 'borrar la compra borra su CxP');
  console.log('  ✓ I borrado');

  // J · PUT protegida: si la compra tiene CxP, editar sus datos de documento se rechaza (D13)
  const J1 = await call('PUT', `/api/gastos/${A.json.gasto.id}`, { total: 1200 });
  assert.equal(J1.status, 409, JSON.stringify(J1.json));
  assert.match(J1.json.error, /cuenta por pagar/i);
  const J2 = await call('PUT', `/api/gastos/${A.json.gasto.id}`, { observaciones: 'nota de prueba' });
  assert.equal(J2.status, 200, JSON.stringify(J2.json));
  console.log('  ✓ J PUT protegida');

  console.log('compras VERDE');
} finally {
  if (creados.length) {
    const docs = await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente).where(inArray(schema.documentoPendiente.docOrigenId, creados));
    const docIds = docs.map((d) => d.id);
    await db.delete(schema.aplicacionDocumento).where(or(inArray(schema.aplicacionDocumento.origenId, creados), docIds.length ? inArray(schema.aplicacionDocumento.documentoPendienteId, docIds) : undefined));
    if (docIds.length) await db.delete(schema.documentoPendiente).where(inArray(schema.documentoPendiente.id, docIds));
    await db.delete(schema.detraccionDocumento).where(inArray(schema.detraccionDocumento.docOrigenId, creados));
    await db.delete(schema.inventarioItems).where(inArray(schema.inventarioItems.gastoId, creados));
    await db.delete(schema.gastos).where(inArray(schema.gastos.id, creados));
  }
  await lucia.invalidateSession(session.id);
  server.close();
}
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-compras.ts`
Expected: FAIL en `A simple` (la respuesta no trae `documento`).

- [ ] **Step 3: Write `compras.ts`**

```ts
// apps/backend/src/lib/compras.ts
/**
 * Fase 1 · registrar una compra completa en una transacción: gasto + líneas (opcionales) + cuenta por pagar
 * (o aplicación de nota de crédito) + detracción calculada + inventario por línea.
 * Sin líneas se comporta como antes (una línea implícita con los totales de cabecera).
 */
import { schema } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { calcularDetraccion } from './detraccionCalc.js';
import { buscarTasaDetraccion } from './detraccionTasa.js';
import { buscarTipoCambio } from './tipoCambio.js';
import { type DbLike, DocumentoError, aplicar, crearDocumentoDesdeGasto, esNotaCredito } from './documentosPendientes.js';

const IGV = 0.18;
const r2 = (n: number) => Math.round(n * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const lineaCompraSchema = z.object({
  descripcion: z.string().min(1),
  unidad: z.string().max(10).optional().nullable(),
  cantidad: z.number().positive(),
  valorUnitario: z.number().min(0),
  descuento: z.number().min(0).default(0),
  afectacionIgv: z.string().regex(/^\d{2}$/).default('10'), // catálogo SUNAT 07 · 1x gravado
  cuentaContable: z.string().max(10).optional().nullable(),
  partidaId: z.string().uuid().optional().nullable(),
  proyectoId: z.string().uuid().optional().nullable(),
  aInventario: z.boolean().default(false),
});
export type LineaCompraIn = z.infer<typeof lineaCompraSchema>;

export const extrasCompraSchema = z.object({
  fechaVencimiento: z.string().regex(FECHA).optional().nullable(),
  tipoCambio: z.number().positive().optional().nullable(),
  lineas: z.array(lineaCompraSchema).max(200).optional(),
  detraccion: z.object({ codigo: z.string().regex(/^\d{3}$/), montoDeclarado: z.number().min(0).optional().nullable() }).optional().nullable(),
  retencion: z.object({ tipo: z.enum(['igv3', 'renta4ta']), monto: z.number().positive() }).optional().nullable(),
  percepcion: z.number().min(0).optional().nullable(),
  docModifica: z.object({ serie: z.string().min(1), numero: z.string().min(1) }).optional().nullable(),
  motivoNota: z.string().regex(/^\d{2}$/).optional().nullable(),
});
export type ExtrasCompra = z.infer<typeof extrasCompraSchema>;

export function calcularLineas(lineas: LineaCompraIn[]) {
  return lineas.map((l, i) => {
    const valorVenta = r2(l.cantidad * l.valorUnitario - l.descuento);
    if (valorVenta < 0) throw new DocumentoError(400, `Línea ${i + 1}: el descuento supera el importe`);
    const gravada = l.afectacionIgv.startsWith('1');
    return { ...l, numero: i + 1, valorVenta, igv: gravada ? r2(valorVenta * IGV) : 0, gravada };
  });
}

export async function registrarCompra(q: DbLike, input: { values: typeof schema.gastos.$inferInsert; extras: ExtrasCompra; inventariable?: boolean; userId?: string | null; empresaId?: number }) {
  const { extras } = input;
  const empresaId = input.empresaId ?? 1;
  const values = { ...input.values };
  const moneda = values.moneda ?? 'PEN';
  const esNota = esNotaCredito(values.tipoComprobante);

  let tc: number | null = null;
  if (moneda !== 'PEN') {
    tc = extras.tipoCambio ?? (await buscarTipoCambio(values.fecha, moneda))?.venta ?? null;
    if (!tc) throw new DocumentoError(400, `Falta tipo de cambio ${moneda} del ${values.fecha}: cárgalo en Catálogos o envía tipoCambio`);
  }

  const lineas = extras.lineas?.length ? calcularLineas(extras.lineas) : [];
  if (lineas.length) {
    const subtotal = r2(lineas.filter((l) => l.gravada).reduce((s, l) => s + l.valorVenta, 0));
    const exonerado = r2(lineas.filter((l) => !l.gravada).reduce((s, l) => s + l.valorVenta, 0));
    const igv = r2(lineas.reduce((s, l) => s + l.igv, 0));
    Object.assign(values, { subtotal: subtotal.toFixed(2), exonerado: exonerado.toFixed(2), igv: igv.toFixed(2), total: r2(subtotal + exonerado + igv).toFixed(2) });
  }

  if (extras.retencion?.tipo === 'igv3') {
    const [emp] = await q.select({ config: schema.empresas.config }).from(schema.empresas).where(eq(schema.empresas.id, empresaId)).limit(1);
    if ((emp?.config as Record<string, unknown> | null)?.agenteRetencion !== true) throw new DocumentoError(400, 'La empresa no está configurada como agente de retención del IGV');
  }
  if (esNota && !extras.docModifica) throw new DocumentoError(400, 'La nota de crédito debe indicar la factura que modifica (serie y número)');

  const [gasto] = await q.insert(schema.gastos).values({
    ...values,
    fechaVencimiento: extras.fechaVencimiento ?? null,
    tipoCambio: tc != null ? tc.toFixed(4) : null,
    retencion: (extras.retencion?.monto ?? 0).toFixed(2),
    retencionTipo: extras.retencion?.tipo ?? null,
    percepcion: (extras.percepcion ?? 0).toFixed(2),
    docModificaSerie: extras.docModifica?.serie ?? null,
    docModificaNumero: extras.docModifica?.numero ?? null,
    motivoNota: extras.motivoNota ?? null,
  }).returning();
  const g = gasto!;

  if (lineas.length) {
    await q.insert(schema.gastoLineas).values(lineas.map((l) => ({
      gastoId: g.id, numero: l.numero, descripcion: l.descripcion, unidad: l.unidad ?? null,
      cantidad: String(l.cantidad), valorUnitario: String(l.valorUnitario), descuento: l.descuento.toFixed(2),
      valorVenta: l.valorVenta.toFixed(2), afectacionIgv: l.afectacionIgv, igv: l.igv.toFixed(2),
      cuentaContable: l.cuentaContable ?? null, partidaId: l.partidaId ?? null, proyectoId: l.proyectoId ?? null, aInventario: l.aInventario,
    })));
  }

  let documento: typeof schema.documentoPendiente.$inferSelect | null = null;
  if (esNota) {
    const d = schema.documentoPendiente;
    const { serie, numero } = extras.docModifica!;
    const [orig] = await q.select().from(d)
      .where(and(eq(d.empresaId, empresaId), eq(d.tipo, 'cxp'), eq(d.terceroRuc, g.proveedorRuc ?? ''), eq(d.docSerie, serie), eq(d.docNumero, numero))).limit(1);
    if (!orig) throw new DocumentoError(404, `No existe la factura ${serie}-${numero} de ${g.proveedorRuc ?? 's/RUC'} para aplicar la nota de crédito`);
    await aplicar(q, { origenTipo: 'nota', origenId: g.id, fecha: g.fecha, userId: input.userId, aplicaciones: [{ documentoPendienteId: orig.id, monto: Number(g.total) }], tipoEsperado: 'cxp', moneda: g.moneda });
  } else {
    documento = await crearDocumentoDesdeGasto(q, g, empresaId);
  }

  let detraccion: typeof schema.detraccionDocumento.$inferSelect | null = null;
  if (extras.detraccion && !esNota) {
    const tasa = await buscarTasaDetraccion(extras.detraccion.codigo, g.fecha);
    if (!tasa) throw new DocumentoError(400, `Código de detracción ${extras.detraccion.codigo} no vigente o sin % al ${g.fecha}`);
    const calc = calcularDetraccion({ total: Number(g.total), moneda: g.moneda, tipoCambio: tc, tasa });
    const declarado = extras.detraccion.montoDeclarado;
    // D2 · noUncheckedIndexedAccess: returning()[0] es `X | undefined`, no se puede asignar por destructuring a `X | null`
    detraccion = (await q.insert(schema.detraccionDocumento).values({
      docOrigenTipo: 'gasto', docOrigenId: g.id, empresaId, codigo: tasa.codigo, porcentaje: tasa.porcentaje.toFixed(2),
      basePen: calc.basePen.toFixed(2), monto: calc.monto.toFixed(2), montoDeclarado: declarado != null ? declarado.toFixed(2) : null,
      estado: calc.aplica ? 'pendiente' : 'no_aplica',
    }).returning())[0] ?? null;
  }

  const aInventario = lineas.filter((l) => l.aInventario);
  const comun = { fecha: g.fecha, proveedorRuc: g.proveedorRuc, proveedorRazon: g.proveedorRazon, tipoComprobante: g.tipoComprobante, serie: g.serie, numero: g.numero, categoria: g.tipoGasto, estado: 'Por completar', gastoId: g.id };
  if (aInventario.length) {
    await q.insert(schema.inventarioItems).values(aInventario.map((l) => ({ ...comun, proyectoId: l.proyectoId ?? g.proyectoId ?? null, cantidad: String(l.cantidad), descripcionItem: l.descripcion, valorUnitario: String(l.valorUnitario) })));
  } else if (input.inventariable) {
    // sin líneas: borrador único como antes (el usuario completa cantidad/código en Inventario)
    await q.insert(schema.inventarioItems).values({ ...comun, proyectoId: g.proyectoId ?? null, cantidad: '1', descripcionItem: g.descripcionItem ?? g.tipoGasto ?? 'Ítem', valorUnitario: g.total ?? '0' });
  }

  return { gasto: g, lineas: lineas.length, documento, detraccion };
}
```

- [ ] **Step 4: Wire the routes in `finanzas.ts`**

(a) Imports: agregar
```ts
import { inArray } from 'drizzle-orm';
import { extrasCompraSchema, registrarCompra } from '../lib/compras.js';
import { DocumentoError, anularAplicacionesDe } from '../lib/documentosPendientes.js';
```
(fusionar `inArray` en el import existente de `drizzle-orm`).

(b) Eliminar la función local `crearDraftInventario` (líneas 111-129 actuales, con su comentario): ahora vive en `registrarCompra`.

(c) Debajo de `const gastoSchema = z.object({...});` agregar:
```ts
// Fase 1 · el alta de compra acepta los datos de documento; el PUT sigue usando gastoSchema (edición de cabecera)
const gastoCompraSchema = gastoSchema.extend(extrasCompraSchema.shape);

async function validarCuentasCompra(cabecera: string | null | undefined, lineas: { cuentaContable?: string | null }[] | undefined) {
  for (const c of [cabecera, ...(lineas ?? []).map((l) => l.cuentaContable)]) {
    const err = await validarCuentaContable(c);
    if (err) return err;
  }
  return null;
}

function separarExtras<T extends z.infer<typeof gastoCompraSchema>>(d: T) {
  const { fechaVencimiento, tipoCambio, lineas, detraccion, retencion, percepcion, docModifica, motivoNota, ...resto } = d;
  return { extras: { fechaVencimiento, tipoCambio, lineas, detraccion, retencion, percepcion, docModifica, motivoNota }, resto };
}

function responderErrorCompra(e: unknown, res: import('express').Response) {
  if (e instanceof DocumentoError) { res.status(e.status).json({ error: e.message }); return true; }
  return false;
}
```

(d) Reemplazar el handler `router.post('/proyectos/:id/gastos', ...)` completo por:
```ts
router.post('/proyectos/:id/gastos', async (req, res, next) => {
  const parse = gastoCompraSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { extras, resto } = separarExtras(parse.data);
  const errCuenta = await validarCuentasCompra(resto.cuentaContable, extras.lineas); // WS1
  if (errCuenta) return res.status(400).json({ error: errCuenta });
  const values = { proyectoId: req.params.id!, ...toValues(resto) };
  // FINDING 2: ruta de proyecto → siempre destino='proyecto' (ignorar lo que diga el cliente)
  const cls = await resolverClase({ proyectoId: values.proyectoId, tipoGasto: values.tipoGasto, destino: 'proyecto', clasificacion: resto.clasificacion });
  try {
    const r = await db.transaction((tx) => registrarCompra(tx, { values: { ...values, ...cls }, extras, inventariable: resto.inventariable, userId: req.user!.id }));
    res.json({ gasto: r.gasto, documento: r.documento, detraccion: r.detraccion });
  } catch (e) {
    if (!responderErrorCompra(e, res)) return next(e); // D5 · Express 4 no atrapa el throw async: el request se cuelga sin next
  }
});
```

(e) Reemplazar el handler `router.post('/gastos', ...)` completo por:
```ts
router.post('/gastos', async (req, res, next) => {
  const parse = gastoCompraSchema.extend({ proyectoId: z.string().uuid().optional().nullable() }).safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { proyectoId, ...data } = parse.data;
  const { extras, resto } = separarExtras(data);
  const errCuenta = await validarCuentasCompra(resto.cuentaContable, extras.lineas); // WS1
  if (errCuenta) return res.status(400).json({ error: errCuenta });
  if (await bloqueoPeriodo(resto.fecha, res)) return;
  const values = { proyectoId: proyectoId ?? null, ...toValues(resto) };
  const cls = await resolverClase({ proyectoId: values.proyectoId, tipoGasto: values.tipoGasto, destino: resto.destino, clasificacion: resto.clasificacion });
  try {
    const r = await db.transaction((tx) => registrarCompra(tx, { values: { ...values, ...cls }, extras, inventariable: resto.inventariable, userId: req.user!.id }));
    await audit(req, { action: 'create', entityType: 'gasto', entityId: r.gasto.id, after: { total: r.gasto.total, tipo: r.gasto.tipoGasto, proveedor: r.gasto.proveedorRazon, lineas: r.lineas, documento: r.documento?.id ?? null } });
    res.json({ gasto: r.gasto, documento: r.documento, detraccion: r.detraccion });
  } catch (e) {
    if (!responderErrorCompra(e, res)) return next(e); // D5 · Express 4 no atrapa el throw async: el request se cuelga sin next
  }
});
```
La constante `gastoSchemaG` queda sin uso: eliminarla.

(f) En `router.get('/gastos', ...)`, reemplazar la línea `res.json({ gastos: list.map(...), stats: ... });` por:
```ts
  // Fase 1 · saldo de la CxP de cada compra (null = sin documento: histórico, NC o rendición)
  const docs = list.length
    ? await db.select({ origen: schema.documentoPendiente.docOrigenId, saldo: schema.documentoPendiente.saldoPendiente, estado: schema.documentoPendiente.estado })
      .from(schema.documentoPendiente)
      .where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), inArray(schema.documentoPendiente.docOrigenId, list.map((g) => g.id))))
    : [];
  const docPorGasto = new Map(docs.map((d) => [d.origen, d]));
  const estadoPago = (e: string) => (e === 'cancelado' ? 'pagado' : e === 'parcial' ? 'parcial' : 'pendiente');
  res.json({
    gastos: list.map((g) => {
      const d = docPorGasto.get(g.id);
      return { ...g, proyectoCodigo: g.proyectoId ? pm.get(g.proyectoId)?.codigo ?? null : null, saldoPendiente: d ? Number(d.saldo) : null, estadoPago: d ? estadoPago(d.estado) : null };
    }),
    stats: { count: list.length, totalGeneral, subtotalGeneral, porTipo },
  });
```

(g) Agregar, justo antes de `router.post('/gastos', ...)`:
```ts
// Fase 1 · detalle de una compra: líneas + CxP + aplicaciones (pagos/NC) + detracción
router.get('/gastos/:id/detalle', async (req, res) => {
  const id = req.params.id!;
  const [gasto] = await db.select().from(schema.gastos).where(eq(schema.gastos.id, id));
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
  const d = schema.documentoPendiente;
  const lineas = await db.select().from(schema.gastoLineas).where(eq(schema.gastoLineas.gastoId, id)).orderBy(asc(schema.gastoLineas.numero));
  const [documento] = await db.select().from(d).where(and(eq(d.docOrigenTipo, 'gasto'), eq(d.docOrigenId, id)));
  const aplicaciones = documento
    ? await db.select().from(schema.aplicacionDocumento).where(eq(schema.aplicacionDocumento.documentoPendienteId, documento.id)).orderBy(asc(schema.aplicacionDocumento.createdAt))
    : [];
  const [detraccion] = await db.select().from(schema.detraccionDocumento).where(and(eq(schema.detraccionDocumento.docOrigenTipo, 'gasto'), eq(schema.detraccionDocumento.docOrigenId, id)));
  res.json({ gasto, lineas, documento: documento ?? null, aplicaciones, detraccion: detraccion ?? null });
});
```

(h) Reemplazar el handler `router.delete('/gastos/:id', ...)` completo por:
```ts
router.delete('/gastos/:id', async (req, res) => {
  const id = req.params.id!;
  const [g] = await db.select({ lockedAt: schema.gastos.lockedAt }).from(schema.gastos).where(eq(schema.gastos.id, id));
  if (g?.lockedAt) return res.status(423).json({ error: 'Gasto congelado por cierre de periodo · reabrir el periodo primero' }); // H2.1
  const d = schema.documentoPendiente, a = schema.aplicacionDocumento;
  const [doc] = await db.select({ id: d.id }).from(d).where(and(eq(d.docOrigenTipo, 'gasto'), eq(d.docOrigenId, id)));
  if (doc) {
    const [activa] = await db.select({ id: a.id }).from(a).where(and(eq(a.documentoPendienteId, doc.id), eq(a.estado, 'activa'))).limit(1);
    if (activa) return res.status(409).json({ error: 'La compra tiene pagos o notas de crédito aplicados · anúlalos primero' });
  }
  await db.transaction(async (tx) => {
    await anularAplicacionesDe(tx, 'nota', id); // si es NC, devuelve el saldo a la factura referida
    if (doc) {
      await tx.delete(a).where(eq(a.documentoPendienteId, doc.id));
      await tx.delete(d).where(eq(d.id, doc.id));
    }
    await tx.delete(schema.detraccionDocumento).where(and(eq(schema.detraccionDocumento.docOrigenTipo, 'gasto'), eq(schema.detraccionDocumento.docOrigenId, id)));
    await tx.delete(schema.gastos).where(eq(schema.gastos.id, id));
  });
  await audit(req, { action: 'delete', entityType: 'gasto', entityId: id });
  res.json({ ok: true });
});
```

(i) D13 · `PUT /gastos/:id` (finanzas.ts:196-238) queda sin tocar y puede editar total/serie/RUC de una compra que ya tiene CxP, dejando `documento_pendiente` desincronizado. En `router.put('/gastos/:id', ...)`, reemplazar:
```ts
  const d = parse.data;
  const errCuenta = await validarCuentaContable(d.cuentaContable); // WS1
  if (errCuenta) return res.status(400).json({ error: errCuenta });
```
por:
```ts
  const d = parse.data;
  // Fase 1 · si la compra ya tiene cuenta por pagar, editar los datos del documento la deja desincronizada (D13)
  if (['total', 'subtotal', 'igv', 'exonerado', 'moneda', 'serie', 'numero', 'proveedorRuc', 'tipoComprobante'].some((k) => k in d)) {
    const [docExistente] = await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente)
      .where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), eq(schema.documentoPendiente.docOrigenId, req.params.id!))).limit(1);
    if (docExistente) return res.status(409).json({ error: 'La compra tiene cuenta por pagar · anula y registra de nuevo' });
  }
  const errCuenta = await validarCuentaContable(d.cuentaContable); // WS1
  if (errCuenta) return res.status(400).json({ error: errCuenta });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-compras.ts`
Expected: `✓ A simple` … `✓ I borrado`, `compras VERDE`.

- [ ] **Step 6: D4 · limpiar la CxP huérfana que ahora dejan los tests de WS1**

`POST /api/gastos` ahora también crea `documento_pendiente` (no hay FK de `documento_pendiente` a `gastos`). `ws1/test-ws1-motor.ts` y `ws1/test-ws1-endpoints.ts` crean gastos por esa ruta pero solo borran `gastos` en su `finally`, dejando CxP abiertas huérfanas en cada corrida.

En `apps/backend/scripts/ws1/test-ws1-motor.ts`, dentro del `finally`, reemplazar:
```ts
    for (const gid of creados) {
      await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, 'gasto'), eq(schema.asientos.origenId, gid))).catch(() => {});
      await db.delete(schema.gastos).where(eq(schema.gastos.id, gid)).catch(() => {});
    }
```
por:
```ts
    for (const gid of creados) {
      await db.delete(schema.asientos).where(and(eq(schema.asientos.origen, 'gasto'), eq(schema.asientos.origenId, gid))).catch(() => {});
      await db.delete(schema.documentoPendiente).where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), eq(schema.documentoPendiente.docOrigenId, gid))).catch(() => {}); // D4
      await db.delete(schema.gastos).where(eq(schema.gastos.id, gid)).catch(() => {});
    }
```

En `apps/backend/scripts/ws1/test-ws1-endpoints.ts`, el import de `drizzle-orm` pasa de:
```ts
import { eq } from 'drizzle-orm';
```
a:
```ts
import { and, eq } from 'drizzle-orm';
```
y dentro del `finally`, reemplazar:
```ts
    if (gastoId) await db.delete(schema.gastos).where(eq(schema.gastos.id, gastoId)).catch(() => {});
```
por:
```ts
    if (gastoId) await db.delete(schema.documentoPendiente).where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), eq(schema.documentoPendiente.docOrigenId, gastoId))).catch(() => {}); // D4
    if (gastoId) await db.delete(schema.gastos).where(eq(schema.gastos.id, gastoId)).catch(() => {});
```

- [ ] **Step 7: Regression + type check**

Run:
```bash
export "$(grep '^DATABASE_URL=' .env)"
for t in finanzas/test-documentos-pendientes ws1/test-ws1-motor ws1/test-ws1-endpoints ws1/regression cpe/test-cpe-endpoint; do node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/$t.ts > /dev/null 2>&1 && echo "OK   $t" || echo "FAIL $t"; done
pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "error TS" | sort > .tmp/tsc-t3.txt; comm -13 .tmp/tsc-base-fase1.txt .tmp/tsc-t3.txt
```
Expected: 5 `OK` y el `comm` sin salida. `ws1/test-ws1-motor` crea gastos por `POST /api/gastos`: si ahora falla por `409` de factura duplicada entre sus casos (mismo proveedor sin serie/número no choca), revisar que su limpieza borre también `documento_pendiente` con `docOrigenId` de sus gastos.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/lib/compras.ts apps/backend/src/routes/finanzas.ts apps/backend/scripts/finanzas/test-compras.ts apps/backend/scripts/ws1/test-ws1-motor.ts apps/backend/scripts/ws1/test-ws1-endpoints.ts
git commit -m "feat(finanzas): registrar compra con lineas, CxP, detraccion, nota de credito e inventario por linea

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 4: Pagos y cobros con aplicaciones (N:N, parciales, anulación, pago de OC)

**Files:**
- Modify: `apps/backend/src/routes/finanzas.ts` (`movSchema` + `aplicaciones`; POST de movimientos en transacción con aplicaciones; anular recompone saldos; nuevo `GET /documentos-pendientes`)
- Modify: `apps/backend/src/routes/logistica.ts` (pago de OC: TC en el gasto, CxP y aplicación del pago)
- Test: `apps/backend/scripts/finanzas/test-pagos.ts`

**Interfaces:**
- Consumes: Task 2 (`aplicar`, `aplicarPagoAOrigen`, `anularAplicacionesDe`, `crearDocumentoDesdeGasto`, `DocumentoError`), Task 3 (`POST /api/gastos` crea la CxP).
- Produces:
```
POST /api/movimientos, POST /api/proyectos/:id/movimientos
  body += aplicaciones?: { documentoPendienteId: uuid, monto: number }[]
  reglas: Σ aplicaciones = monto (±0.01) · Egreso aplica cxp · Ingreso aplica cxc · misma moneda · no en transferencias
  sin aplicaciones: gastoId (Egreso) o valorizacionId (Ingreso) aplican hasta el saldo del documento de origen
  error de aplicación → 400/404 y el movimiento NO se crea
POST /api/movimientos/:id/anular → además anula sus aplicaciones (saldo se recompone)
GET  /api/documentos-pendientes?tipo=cxp|cxc&terceroRuc=&proyectoId=&estado=todos
  → { documentos: DocumentoPendiente[] con montoOriginal/montoPen/saldoPendiente numéricos } (default: abierto + parcial)
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-pagos.ts
/**
 * Fase 1 · pagos con aplicaciones por HTTP: parcial, N:N, validaciones con rollback, anulación, pago legacy por gastoId.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-pagos.ts
 */
import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
import assert from 'node:assert/strict';
import express from 'express';
import { db, schema } from '@erp/db';
import { eq, inArray, or } from 'drizzle-orm';
import { authMiddleware } from '../../src/middleware/auth.js';
import { lucia } from '../../src/auth.js';
import finanzasRoutes from '../../src/routes/finanzas.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const RUC = '20999999994';
const MARCA = 'TEST-FASE1-PAGO';
const gastos: string[] = [];
const movs: string[] = [];
const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api', finanzasRoutes);
const server = app.listen(0);
const base = `http://localhost:${(server.address() as { port: number }).port}`;
const session = await lucia.createSession(USER, {});
const headers = { cookie: lucia.createSessionCookie(session.id).serialize(), 'content-type': 'application/json' };
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as any };
};
const [bcp] = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, '194-9927833-0-39'));
const compra = async (numero: string, total: number) => {
  const r = await call('POST', '/api/gastos', { fecha: '2099-03-05', destino: 'corporativo', tipoGasto: 'Compra Materiales', proveedorRuc: RUC, proveedorRazon: 'PROV PAGOS', tipoComprobante: 'Factura', serie: 'F998', numero, subtotal: +(total / 1.18).toFixed(2), igv: +(total - total / 1.18).toFixed(2), total });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  gastos.push(r.json.gasto.id);
  return r.json.documento.id as string;
};
const pago = async (body: Record<string, unknown>) => {
  const r = await call('POST', '/api/movimientos', { fecha: '2099-03-10', tipoMovimiento: 'Egreso', cuentaId: bcp!.id, moneda: 'PEN', descripcion: MARCA, naturalezaContable: 'PAGO_PROVEEDOR', ...body });
  if (r.json.movimiento?.id) movs.push(r.json.movimiento.id);
  return r;
};
const doc = async (id: string) => (await db.select().from(schema.documentoPendiente).where(eq(schema.documentoPendiente.id, id)))[0]!;
const cuantosMovs = async () => (await db.select({ id: schema.movimientos.id }).from(schema.movimientos).where(eq(schema.movimientos.descripcion, MARCA))).length;

try {
  const d1 = await compra('1', 1180);

  // A · pago parcial con aplicación explícita + listado de pendientes
  const A = await pago({ monto: 600, aplicaciones: [{ documentoPendienteId: d1, monto: 600 }] });
  assert.equal(A.status, 200, JSON.stringify(A.json));
  assert.deepEqual([(await doc(d1)).saldoPendiente, (await doc(d1)).estado], ['580.00', 'parcial']);
  const pend = await call('GET', `/api/documentos-pendientes?tipo=cxp&terceroRuc=${RUC}`);
  assert.deepEqual(pend.json.documentos.map((x: any) => [x.id, x.saldoPendiente]), [[d1, 580]]);
  console.log('  ✓ A parcial');

  // B · C · D · H · validaciones: el movimiento no se crea si la aplicación falla
  const antes = await cuantosMovs();
  assert.equal((await pago({ monto: 500, aplicaciones: [{ documentoPendienteId: d1, monto: 400 }] })).status, 400, 'suma distinta al monto');
  assert.equal((await pago({ monto: 700, aplicaciones: [{ documentoPendienteId: d1, monto: 700 }] })).status, 400, 'excede saldo');
  assert.equal((await pago({ tipoMovimiento: 'Ingreso', monto: 100, aplicaciones: [{ documentoPendienteId: d1, monto: 100 }] })).status, 400, 'ingreso no aplica cxp');
  const [otra] = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, 'REND-KELY'));
  assert.equal((await pago({ monto: 100, cuentaDestinoId: otra!.id, aplicaciones: [{ documentoPendienteId: d1, monto: 100 }] })).status, 400, 'transferencia con aplicaciones');
  assert.equal(await cuantosMovs(), antes, 'ningún movimiento creado por los rechazos');
  console.log('  ✓ B C D H validaciones');

  // E · un pago cubre dos facturas → ambas canceladas y fuera del listado por defecto
  const d2 = await compra('2', 500);
  const E = await pago({ monto: 1080, aplicaciones: [{ documentoPendienteId: d1, monto: 580 }, { documentoPendienteId: d2, monto: 500 }] });
  assert.equal(E.status, 200, JSON.stringify(E.json));
  assert.deepEqual([(await doc(d1)).estado, (await doc(d2)).estado], ['cancelado', 'cancelado']);
  assert.equal((await call('GET', `/api/documentos-pendientes?tipo=cxp&terceroRuc=${RUC}`)).json.documentos.length, 0);
  assert.equal((await call('GET', `/api/documentos-pendientes?tipo=cxp&terceroRuc=${RUC}&estado=todos`)).json.documentos.length, 2);
  console.log('  ✓ E N:N');

  // F · anular el primer pago devuelve 600 de saldo a la factura 1
  assert.equal((await call('POST', `/api/movimientos/${A.json.movimiento.id}/anular`, { motivo: 'test fase 1' })).status, 200);
  assert.deepEqual([(await doc(d1)).saldoPendiente, (await doc(d1)).estado], ['600.00', 'parcial']);
  console.log('  ✓ F anular');

  // G · pago legacy por gastoId (flujo actual del modal "pagado") aplica solo
  const d3 = await compra('3', 1180);
  const G = await pago({ monto: 1180, gastoId: gastos[2] });
  assert.equal(G.status, 200, JSON.stringify(G.json));
  assert.equal((await doc(d3)).estado, 'cancelado');
  console.log('  ✓ G legacy gastoId');

  console.log('pagos VERDE');
} finally {
  const docs = gastos.length ? await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente).where(inArray(schema.documentoPendiente.docOrigenId, gastos)) : [];
  const docIds = docs.map((d) => d.id);
  const condAplic = [movs.length ? inArray(schema.aplicacionDocumento.origenId, movs) : undefined, docIds.length ? inArray(schema.aplicacionDocumento.documentoPendienteId, docIds) : undefined].filter(Boolean);
  if (condAplic.length) await db.delete(schema.aplicacionDocumento).where(or(...(condAplic as never[])));
  await db.delete(schema.movimientos).where(eq(schema.movimientos.descripcion, MARCA));
  if (docIds.length) await db.delete(schema.documentoPendiente).where(inArray(schema.documentoPendiente.id, docIds));
  if (gastos.length) await db.delete(schema.gastos).where(inArray(schema.gastos.id, gastos));
  await lucia.invalidateSession(session.id);
  server.close();
}
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-pagos.ts`
Expected: FAIL en `A parcial` (el saldo sigue en `1180.00`).

- [ ] **Step 3: `finanzas.ts` — schema, helper and routes**

(a) Reemplazar el import agregado en el Task 3:
```ts
import { DocumentoError, anularAplicacionesDe } from '../lib/documentosPendientes.js';
```
por:
```ts
import { DocumentoError, anularAplicacionesDe, aplicar, aplicarPagoAOrigen } from '../lib/documentosPendientes.js';
```

(b) En `movSchema`, después de `cuentaContableOrigen: z.enum(['USUARIO', 'SUGERIDO']).optional().nullable(),` agregar:
```ts
  // Fase 1 · a qué documentos pendientes aplica este pago/cobro (N:N · parcial)
  aplicaciones: z.array(z.object({ documentoPendienteId: z.string().uuid(), monto: z.number().positive() })).max(100).optional(),
```

(c) Debajo de `const validarMonedaTC = ...;` agregar:
```ts
// Fase 1 · movimiento + aplicaciones en una sola transacción. Si la aplicación falla, el movimiento no existe.
type MovIn = z.infer<typeof movSchema>;
function validarAplicaciones(d: MovIn): string | null {
  if (!d.aplicaciones?.length) return null;
  if (d.cuentaDestinoId) return 'Una transferencia entre cuentas no puede aplicarse a documentos';
  const suma = d.aplicaciones.reduce((s, a) => s + a.monto, 0);
  if (Math.abs(suma - d.monto) > 0.01) return `La suma aplicada (${suma.toFixed(2)}) debe igualar el monto del movimiento (${d.monto.toFixed(2)})`;
  return null;
}
async function insertarMovimientoConAplicaciones(values: typeof schema.movimientos.$inferInsert, d: MovIn, userId: string) {
  return db.transaction(async (tx) => {
    const [mov] = await tx.insert(schema.movimientos).values(values).returning();
    const m = mov!;
    if (d.aplicaciones?.length) {
      await aplicar(tx, { origenTipo: 'movimiento', origenId: m.id, fecha: d.fecha, userId, aplicaciones: d.aplicaciones, tipoEsperado: d.tipoMovimiento === 'Egreso' ? 'cxp' : 'cxc', moneda: d.moneda ?? 'PEN' });
    } else if (d.gastoId && d.tipoMovimiento === 'Egreso') {
      await aplicarPagoAOrigen(tx, { docOrigenTipo: 'gasto', docOrigenId: d.gastoId, movimientoId: m.id, monto: d.monto, fecha: d.fecha, userId });
    } else if (d.valorizacionId && d.tipoMovimiento === 'Ingreso') {
      await aplicarPagoAOrigen(tx, { docOrigenTipo: 'valorizacion', docOrigenId: d.valorizacionId, movimientoId: m.id, monto: d.monto, fecha: d.fecha, userId });
    }
    return m;
  });
}
```

(d0) D5 · reemplazar la firma del handler:
```ts
router.post('/proyectos/:id/movimientos', async (req, res) => {
```
por:
```ts
router.post('/proyectos/:id/movimientos', async (req, res, next) => {
```

(d) En `router.post('/proyectos/:id/movimientos', ...)`, reemplazar:
```ts
  const [mov] = await db.insert(schema.movimientos).values({ proyectoId: req.params.id!, ...movValues(parse.data), userId: req.user!.id }).returning();
```
por:
```ts
  { const aErr = validarAplicaciones(parse.data); if (aErr) return res.status(400).json({ error: aErr }); }
  let mov: typeof schema.movimientos.$inferSelect;
  try {
    mov = await insertarMovimientoConAplicaciones({ proyectoId: req.params.id!, ...movValues(parse.data), userId: req.user!.id }, parse.data, req.user!.id);
  } catch (e) {
    if (e instanceof DocumentoError) return res.status(e.status).json({ error: e.message });
    return next(e); // D5 · Express 4 no atrapa el throw async
  }
```
(las líneas siguientes usan `mov!` y siguen válidas).

(e0) D5 · reemplazar la firma del handler:
```ts
router.post('/movimientos', async (req, res) => {
```
por:
```ts
router.post('/movimientos', async (req, res, next) => {
```

(e) En `router.post('/movimientos', ...)`: justo después de `if (await bloqueoPeriodo(rest.fecha, res)) return;` agregar:
```ts
  { const aErr = validarAplicaciones(parse.data); if (aErr) return res.status(400).json({ error: aErr }); }
```
y reemplazar:
```ts
  const [mov] = await db.insert(schema.movimientos).values({ proyectoId: proyectoId ?? null, ...base, userId: uid }).returning();
```
por:
```ts
  let mov: typeof schema.movimientos.$inferSelect;
  try {
    mov = await insertarMovimientoConAplicaciones({ proyectoId: proyectoId ?? null, ...base, userId: uid }, parse.data, uid);
  } catch (e) {
    if (e instanceof DocumentoError) return res.status(e.status).json({ error: e.message });
    return next(e); // D5 · Express 4 no atrapa el throw async
  }
```

(f) En `router.post('/movimientos/:id/anular', ...)`, reemplazar el bloque desde `const [mov] = await db.update(schema.movimientos)` hasta el cierre del `if (prev.transferenciaId) { ... }` por:
```ts
  const mov = await db.transaction(async (tx) => {
    const [m] = await tx.update(schema.movimientos)
      .set({ anulado: true, anuladoPor: req.user!.id, anuladoEn: new Date(), anuladoMotivo: motivo })
      .where(eq(schema.movimientos.id, req.params.id!)).returning();
    // si es una transferencia, anular también la fila espejo
    if (prev.transferenciaId) {
      await tx.update(schema.movimientos)
        .set({ anulado: true, anuladoPor: req.user!.id, anuladoEn: new Date(), anuladoMotivo: motivo })
        .where(and(eq(schema.movimientos.transferenciaId, prev.transferenciaId), eq(schema.movimientos.anulado, false)));
    }
    await anularAplicacionesDe(tx, 'movimiento', req.params.id!); // Fase 1 · el saldo de los documentos se recompone
    return m;
  });
```
(la línea `await audit(...)` siguiente sigue usando `mov!`).

(g) Agregar, después del handler de anular:
```ts
// Fase 1 · documentos pendientes (CxP/CxC) para elegir a qué aplicar un pago/cobro. Default: abiertos y parciales.
router.get('/documentos-pendientes', async (req, res) => {
  const { tipo, terceroRuc, proyectoId, estado } = req.query as Record<string, string | undefined>;
  const d = schema.documentoPendiente;
  const conds = [eq(d.empresaId, 1)];
  if (tipo === 'cxp' || tipo === 'cxc') conds.push(eq(d.tipo, tipo));
  if (terceroRuc) conds.push(eq(d.terceroRuc, terceroRuc));
  if (proyectoId) conds.push(eq(d.obraId, proyectoId));
  if (estado !== 'todos') conds.push(inArray(d.estado, ['abierto', 'parcial']));
  const rows = await db.select().from(d).where(and(...conds)).orderBy(asc(d.fechaVenc), asc(d.fechaEmision));
  res.json({ documentos: rows.map((r) => ({ ...r, montoOriginal: Number(r.montoOriginal), montoPen: Number(r.montoPen), saldoPendiente: Number(r.saldoPendiente) })) });
});
```

- [ ] **Step 4: `logistica.ts` — pago de OC crea la CxP y la cancela**

(a) Agregar a los imports: `import { aplicarPagoAOrigen, crearDocumentoDesdeGasto } from '../lib/documentosPendientes.js';`

(b) En el `tx.insert(schema.gastos).values({ ... })` del pago de OC, después de `total: oc.total,` agregar:
```ts
        tipoCambio: oc.moneda === 'PEN' ? null : ocTc.toFixed(4), // Fase 1 · la CxP en USD necesita TC
```

(c) Reemplazar:
```ts
      if (!movPrev) {
        await tx.insert(schema.movimientos).values({
```
por:
```ts
      if (gasto) await crearDocumentoDesdeGasto(tx, gasto); // Fase 1 · CxP de la OC
      if (!movPrev) {
        const [movOc] = await tx.insert(schema.movimientos).values({
```
y reemplazar el cierre de ese insert:
```ts
          tipoCambio: ocTc.toFixed(4), montoBase: (Number(oc.total) * ocTc).toFixed(2), // H3.1
        });
      }
```
por:
```ts
          tipoCambio: ocTc.toFixed(4), montoBase: (Number(oc.total) * ocTc).toFixed(2), // H3.1
        }).returning({ id: schema.movimientos.id });
        if (gasto && movOc) await aplicarPagoAOrigen(tx, { docOrigenTipo: 'gasto', docOrigenId: gasto.id, movimientoId: movOc.id, monto: Number(oc.total), fecha, userId: req.user!.id });
      }
```

(d) D5 · `aplicarPagoAOrigen` puede lanzar `DocumentoError` (por ejemplo si la CxP ya está cancelada) dentro de este handler; hoy cualquier error cae en el 502 genérico. En `router.post('/ordenes-compra/:id/pagar', ...)`, reemplazar:
```ts
    await audit(req, { action: 'pago_oc', entityType: 'orden_compra', entityId: oc.id, after: { numero: oc.numero, total: oc.total, cuentaId, fechaPago: fechaPagoEff } });
    res.json({ oc: result.updated, gastoId: result.gastoId, comprobantePath });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});
```
por:
```ts
    await audit(req, { action: 'pago_oc', entityType: 'orden_compra', entityId: oc.id, after: { numero: oc.numero, total: oc.total, cuentaId, fechaPago: fechaPagoEff } });
    res.json({ oc: result.updated, gastoId: result.gastoId, comprobantePath });
  } catch (e) {
    if (e instanceof DocumentoError) return res.status(e.status).json({ error: e.message }); // D5 · no todo error de esta ruta es un 502 de archivo/NAS
    res.status(502).json({ error: (e as Error).message });
  }
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-pagos.ts`
Expected: `✓ A parcial` … `✓ G legacy gastoId`, `pagos VERDE`.

- [ ] **Step 6: Regression + type check**

Run:
```bash
export "$(grep '^DATABASE_URL=' .env)"
for t in finanzas/test-compras finanzas/test-documentos-pendientes ws1/test-ws1-motor ws1/regression cpe/test-cpe-endpoint; do node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/$t.ts > /dev/null 2>&1 && echo "OK   $t" || echo "FAIL $t"; done
pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "error TS" | sort > .tmp/tsc-t4.txt; comm -13 .tmp/tsc-base-fase1.txt .tmp/tsc-t4.txt
```
Expected: 5 `OK` y sin errores nuevos. El pago de OC no tiene test HTTP propio (requiere OC emitida y comprobante en NAS); su lógica usa `crearDocumentoDesdeGasto` y `aplicarPagoAOrigen`, cubiertas en `test-documentos-pendientes`.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/routes/finanzas.ts apps/backend/src/routes/logistica.ts apps/backend/scripts/finanzas/test-pagos.ts
git commit -m "feat(finanzas): pagos y cobros aplicados a documentos (parcial, N:N, anulacion) y CxP en pago de OC

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 5: Motor de asientos — líneas, notas de crédito, moneda y aplicaciones

**Files:**
- Modify: `apps/backend/src/routes/contabilidad.ts` (bloque 1 · GASTOS y bloque 5 · MOVIMIENTOS de `router.post('/generar')`)
- Test: `apps/backend/scripts/finanzas/test-motor-cxp.ts`

**Interfaces:**
- Consumes: Task 1 (`schema.gastoLineas`, columnas de `gastos`, `aplicacionDocumento.origenTipo/origenId`), Task 2 (`esNotaCredito`), Tasks 3-4 (documentos y aplicaciones creados al capturar).
- Produces (reglas del motor):
  - Compra **con líneas** → una línea de costo por `(cuenta de la línea ?? cuenta de cabecera, obra de la línea ?? obra de cabecera)` con Σ `valor_venta`; IGV Σ; 4212 total.
  - Compra **sin líneas** → igual que antes.
  - **Nota de crédito** → el asiento de compra con debe/haber invertidos.
  - **Moneda ≠ PEN con `tipo_cambio`** → montos del asiento en PEN (`× tipo_cambio`) y `moneda`/`tipoCambio` en la cabecera; sin TC (histórico) se comporta como antes.
  - Al postear una compra → `documento_pendiente.asiento_origen_id` = asiento.
  - **Movimiento con aplicaciones activas** → contrapartida = cuenta control de cada documento (Σ en PEN con el TC del documento), ignora `cuentaContable` manual y naturaleza; al postear → `aplicacion_documento.asiento_id` = asiento.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-motor-cxp.ts
/**
 * Fase 1 · motor: compra con líneas agrupadas, NC invertida, pago aplicado → 4212/banco, enlaces de asiento, idempotencia.
 * Periodo aislado 2099-04 (nada más vive ahí). Limpia todo lo que crea.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-motor-cxp.ts
 */
import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
import assert from 'node:assert/strict';
import express from 'express';
import { db, schema } from '@erp/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { authMiddleware } from '../../src/middleware/auth.js';
import { lucia } from '../../src/auth.js';
import finanzasRoutes from '../../src/routes/finanzas.js';
import contabilidadRoutes from '../../src/routes/contabilidad.js';

const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';
const RUC = '20999999995';
const PERIODO = '2099-04';
const gastos: string[] = [];
const movs: string[] = [];
const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api', finanzasRoutes);
app.use('/api/contabilidad', contabilidadRoutes);
const server = app.listen(0);
const base = `http://localhost:${(server.address() as { port: number }).port}`;
const session = await lucia.createSession(USER, {});
const headers = { cookie: lucia.createSessionCookie(session.id).serialize(), 'content-type': 'application/json' };
const call = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as any };
};
const lineasDe = async (origen: string, origenId: string) => {
  const [a] = await db.select().from(schema.asientos).where(and(eq(schema.asientos.origen, origen), eq(schema.asientos.origenId, origenId)));
  if (!a) return null;
  const ls = await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, a.id));
  const suma = (c: string) => ls.filter((l) => l.cuenta === c).reduce((s, l) => [s[0] + Number(l.debe), s[1] + Number(l.haber)], [0, 0]);
  return { asiento: a, suma };
};
const [bcp] = await db.select().from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.codigo, '194-9927833-0-39'));

try {
  // compra con 2 líneas en cuentas distintas
  const C = await call('POST', '/api/gastos', { fecha: '2099-04-05', destino: 'corporativo', tipoGasto: 'Compra Materiales', proveedorRuc: RUC, proveedorRazon: 'PROV MOTOR', tipoComprobante: 'Factura', serie: 'F997', numero: '1', subtotal: 0, igv: 0, total: 0,
    lineas: [{ descripcion: 'Material', cantidad: 10, valorUnitario: 45, cuentaContable: '6032' }, { descripcion: 'Mantenimiento', cantidad: 1, valorUnitario: 200, cuentaContable: '634' }] });
  assert.equal(C.status, 200, JSON.stringify(C.json));
  gastos.push(C.json.gasto.id);
  // nota de crédito 118 sobre esa factura
  const N = await call('POST', '/api/gastos', { fecha: '2099-04-06', destino: 'corporativo', tipoGasto: 'Compra Materiales', cuentaContable: '6032', proveedorRuc: RUC, proveedorRazon: 'PROV MOTOR', tipoComprobante: 'Nota de Crédito', serie: 'FC97', numero: '1', subtotal: 100, igv: 18, total: 118, docModifica: { serie: 'F997', numero: '1' } });
  assert.equal(N.status, 200, JSON.stringify(N.json));
  gastos.push(N.json.gasto.id);
  // pago del saldo (767 − 118 = 649)
  const P = await call('POST', '/api/movimientos', { fecha: '2099-04-10', tipoMovimiento: 'Egreso', cuentaId: bcp!.id, moneda: 'PEN', monto: 649, descripcion: 'TEST-FASE1-MOTOR', naturalezaContable: 'PAGO_PROVEEDOR', cuentaContable: '659', aplicaciones: [{ documentoPendienteId: C.json.documento.id, monto: 649 }] });
  assert.equal(P.status, 200, JSON.stringify(P.json));
  movs.push(P.json.movimiento.id);

  // K · D3: pago legacy por gastoId MAYOR que el saldo (580) no debe descuadrar el asiento; el residual (320) va a anticipos
  const K = await call('POST', '/api/gastos', { fecha: '2099-04-07', destino: 'corporativo', tipoGasto: 'Compra Materiales', proveedorRuc: RUC, proveedorRazon: 'PROV MOTOR', tipoComprobante: 'Factura', serie: 'F996', numero: '1', subtotal: 491.53, igv: 88.47, total: 580 });
  assert.equal(K.status, 200, JSON.stringify(K.json));
  gastos.push(K.json.gasto.id);
  const PK = await call('POST', '/api/movimientos', { fecha: '2099-04-11', tipoMovimiento: 'Egreso', cuentaId: bcp!.id, moneda: 'PEN', monto: 900, descripcion: 'TEST-FASE1-MOTOR-LEGACY', gastoId: K.json.gasto.id });
  assert.equal(PK.status, 200, JSON.stringify(PK.json));
  movs.push(PK.json.movimiento.id);

  const G1 = await call('POST', '/api/contabilidad/generar', { periodo: PERIODO });
  assert.equal(G1.status, 200, JSON.stringify(G1.json));
  assert.deepEqual(G1.json.detalle.errores, [], 'sin errores de motor');

  const lc = await lineasDe('gasto', C.json.gasto.id);
  assert.deepEqual([lc!.suma('6032'), lc!.suma('634'), lc!.suma('40111'), lc!.suma('4212')], [[450, 0], [200, 0], [117, 0], [0, 767]], 'compra: una línea por cuenta + IGV + 4212');
  const [docC] = await db.select().from(schema.documentoPendiente).where(eq(schema.documentoPendiente.id, C.json.documento.id));
  assert.equal(docC!.asientoOrigenId, lc!.asiento.id, 'documento enlazado a su asiento');
  console.log('  ✓ compra con líneas');

  const ln = await lineasDe('gasto', N.json.gasto.id);
  assert.deepEqual([ln!.suma('4212'), ln!.suma('6032'), ln!.suma('40111')], [[118, 0], [0, 100], [0, 18]], 'NC invierte la provisión');
  console.log('  ✓ nota de crédito');

  const lp = await lineasDe('movimiento', P.json.movimiento.id);
  assert.deepEqual([lp!.suma('4212'), lp!.suma('10411'), lp!.suma('659')], [[649, 0], [0, 649], [0, 0]], 'pago aplicado: 4212 contra banco, ignora la cuenta manual');
  const aplic = await db.select().from(schema.aplicacionDocumento).where(and(eq(schema.aplicacionDocumento.origenTipo, 'movimiento'), eq(schema.aplicacionDocumento.origenId, P.json.movimiento.id)));
  assert.deepEqual(aplic.map((a) => a.asientoId), [lp!.asiento.id], 'aplicación enlazada al asiento del pago');
  console.log('  ✓ pago aplicado');

  // K · D3: el residual (320 = 900 - 580) no descuadra el asiento; va de debe a la cuenta de anticipo
  const CTA_ANTICIPO_PROVEEDOR = '42121'; // D3 · debe coincidir con el valor confirmado en la Task 5 Step 4 (a-1)
  const [ak] = await db.select().from(schema.asientos).where(and(eq(schema.asientos.origen, 'movimiento'), eq(schema.asientos.origenId, PK.json.movimiento.id)));
  assert.ok(ak, 'el pago legacy de 900 sobre un saldo de 580 SI postea (D3)');
  const lsk = await db.select().from(schema.asientosLineas).where(eq(schema.asientosLineas.asientoId, ak!.id));
  const totalDebeK = lsk.reduce((s, l) => s + Number(l.debe), 0);
  const totalHaberK = lsk.reduce((s, l) => s + Number(l.haber), 0);
  assert.ok(Math.abs(totalDebeK - totalHaberK) < 0.01, `asiento cuadrado: debe ${totalDebeK} haber ${totalHaberK}`);
  const anticipoLinea = lsk.find((l) => l.cuenta === CTA_ANTICIPO_PROVEEDOR);
  assert.equal(Number(anticipoLinea?.debe ?? 0), 320, 'residual 320 (900 - 580) va de debe a la cuenta de anticipo (D3)');
  console.log('  ✓ K pago legacy mayor al saldo no descuadra (D3)');

  const G2 = await call('POST', '/api/contabilidad/generar', { periodo: PERIODO });
  assert.equal(G2.json.generados, 0, 'segunda corrida no duplica');
  console.log('motor-cxp VERDE');
} finally {
  const ids = [...gastos, ...movs];
  const asientos = ids.length ? await db.select({ id: schema.asientos.id }).from(schema.asientos).where(inArray(schema.asientos.origenId, ids)) : [];
  if (asientos.length) await db.delete(schema.asientos).where(inArray(schema.asientos.id, asientos.map((a) => a.id))); // líneas y aplicaciones con asiento caen en cascada
  const docs = gastos.length ? await db.select({ id: schema.documentoPendiente.id }).from(schema.documentoPendiente).where(inArray(schema.documentoPendiente.docOrigenId, gastos)) : [];
  if (docs.length) await db.delete(schema.aplicacionDocumento).where(inArray(schema.aplicacionDocumento.documentoPendienteId, docs.map((d) => d.id)));
  if (movs.length) await db.delete(schema.movimientos).where(inArray(schema.movimientos.id, movs));
  if (docs.length) await db.delete(schema.documentoPendiente).where(inArray(schema.documentoPendiente.id, docs.map((d) => d.id)));
  if (gastos.length) await db.delete(schema.gastos).where(inArray(schema.gastos.id, gastos));
  // D11 · '/generar' abre el periodo 2099-04 (periodos_contables); nada mas vive ahi, asi que se borra
  await db.delete(schema.periodosContables).where(and(eq(schema.periodosContables.anio, 2099), eq(schema.periodosContables.mes, 4), isNull(schema.periodosContables.proyectoId)));
  await lucia.invalidateSession(session.id);
  server.close();
}
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-motor-cxp.ts`
Expected: FAIL en `compra: una línea por cuenta + IGV + 4212` (hoy postea una sola línea 6032 por 650).

- [ ] **Step 3: Motor — bloque de compras**

(a) Imports de `contabilidad.ts`: agregar `import { esNotaCredito } from '../lib/documentosPendientes.js';`

(b) Reemplazar desde:
```ts
  const cuentaMap = new Map((await db.select().from(schema.gastoCuentaMap)).map((m) => [m.tipoGasto, m]));
```
hasta el cierre del `try { ... }` de ese loop (la línea `      resultado.gastos++;`) por:
```ts
  const cuentaMap = new Map((await db.select().from(schema.gastoCuentaMap)).map((m) => [m.tipoGasto, m]));
  // Fase 1 · detalle opcional por compra (1 query para todo el periodo)
  const lineasPorGasto = new Map<string, (typeof schema.gastoLineas.$inferSelect)[]>();
  if (gastosList.length) {
    for (const l of await db.select().from(schema.gastoLineas).where(inArray(schema.gastoLineas.gastoId, gastosList.map((g) => g.id)))) {
      lineasPorGasto.set(l.gastoId, [...(lineasPorGasto.get(l.gastoId) ?? []), l]);
    }
  }
  for (const g of gastosList) {
    if (yaSet.has(`gasto:${g.id}`)) continue;
    const cm = cuentaMap.get(g.tipoGasto ?? '');
    if (cm && !cm.esGasto) continue; // no es gasto (financiamiento/CxC) → no se provisiona como compra
    try {
      // Fase 1 · moneda: con TC el asiento va en PEN; sin TC (histórico) igual que antes
      const tc = g.moneda !== 'PEN' && Number(g.tipoCambio) > 0 ? Number(g.tipoCambio) : 1;
      const subtotal = (Number(g.subtotal) + Number(g.exonerado)) * tc;
      const igv = Number(g.igv) * tc;
      const total = Number(g.total) * tc;
      if (total <= 0) continue;
      // WS1 · cuenta del gasto: la manual (Kelly) si la eligió, si no la inferida (mapa/fallback). obra en la línea.
      const cuentaCab = g.cuentaContable ?? cm?.cuenta ?? cuentaGasto(g.tipoGasto);
      const origenCab = g.cuentaContable ? ((g.cuentaContableOrigen as 'USUARIO' | 'SUGERIDO' | 'AUTOMATICO' | null) ?? 'AUTOMATICO') : 'AUTOMATICO';
      const detalle = lineasPorGasto.get(g.id);
      let costo: LineaIn[];
      if (detalle?.length) {
        const grupos = new Map<string, LineaIn>();
        for (const l of detalle) {
          const cuenta = l.cuentaContable ?? cuentaCab;
          const obraId = l.proyectoId ?? g.proyectoId;
          const k = `${cuenta}|${obraId ?? ''}`;
          const prev = grupos.get(k);
          if (prev) prev.debe += Number(l.valorVenta) * tc;
          else grupos.set(k, { cuenta, descripcion: g.tipoGasto ?? 'Gasto', debe: Number(l.valorVenta) * tc, haber: 0, obraId, cuentaOrigen: l.cuentaContable ? 'USUARIO' : origenCab });
        }
        costo = [...grupos.values()];
      } else {
        costo = [{ cuenta: cuentaCab, descripcion: g.tipoGasto ?? 'Gasto', debe: subtotal, haber: 0, obraId: g.proyectoId, cuentaOrigen: origenCab }];
      }
      let lineas: LineaIn[] = [
        ...costo,
        { cuenta: '40111', descripcion: 'IGV crédito fiscal', debe: igv, haber: 0, obraId: null },
        { cuenta: '4212', descripcion: 'Por pagar', debe: 0, haber: total, obraId: null },
      ];
      if (esNotaCredito(g.tipoComprobante)) lineas = lineas.map((l) => ({ ...l, debe: l.haber, haber: l.debe })); // Fase 1 · NC revierte la provisión
      const asiento = await gen({
        fecha: g.fecha,
        glosa: `${esNotaCredito(g.tipoComprobante) ? 'Nota de crédito' : 'Compra'} · ${g.proveedorRazon ?? 's/proveedor'} · ${g.descripcionItem ?? g.codigo ?? ''}`.slice(0, 250),
        origen: 'gasto',
        origenId: g.id,
        proyectoId: g.proyectoId,
        moneda: g.moneda,
        tipoCambio: tc !== 1 ? tc : null,
        docOrigen: [g.serie, g.numero].filter(Boolean).join('-') || null,
        tipoDoc: g.tipoComprobante,
        contraparteRuc: g.proveedorRuc,
        contraparteRazon: g.proveedorRazon,
        lineas,
      });
      // Fase 1 · sub-mayor ↔ mayor: la CxP apunta al asiento que la provisionó
      await db.update(schema.documentoPendiente).set({ asientoOrigenId: asiento.id, updatedAt: new Date() })
        .where(and(eq(schema.documentoPendiente.docOrigenTipo, 'gasto'), eq(schema.documentoPendiente.docOrigenId, g.id)));
      // D16 · la NC tambien mueve 4212: enlazar su aplicacion (origenTipo='nota') al asiento que la postea
      if (esNotaCredito(g.tipoComprobante)) {
        await db.update(schema.aplicacionDocumento).set({ asientoId: asiento.id })
          .where(and(eq(schema.aplicacionDocumento.origenTipo, 'nota'), eq(schema.aplicacionDocumento.origenId, g.id), eq(schema.aplicacionDocumento.estado, 'activa'), isNull(schema.aplicacionDocumento.asientoId)));
      }
      resultado.gastos++;
```
(el `} catch (e) { resultado.errores.push(...) }` y el cierre del loop quedan como están).

- [ ] **Step 4: Motor — bloque de movimientos**

(a-1) D3 · confirmar las cuentas de anticipo (cuando el pago/cobro no se aplica del todo a un documento) y de diferencia de cambio (cuando sí se aplica del todo pero en otra moneda/TC). Correr:
```powershell
$env:PGPASSWORD='MiClave123'; & 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -d erp_mmh_test -c "SELECT codigo FROM plan_contable WHERE codigo LIKE '422%' OR codigo LIKE '122%' OR codigo IN ('676','776') ORDER BY codigo;"
```
Expected: al menos una fila `422...` (anticipos a proveedores), una `122...` (anticipos de clientes) y las cuentas `676` y `776` (diferencia de cambio, pérdida/ganancia). Si `676`/`776` no existen, detenerse y escalar (D3 asume que ya están en el PCGE cargado). Usar la divisionaria MÁS PROFUNDA (el código más largo) de `422` y de `122` como `CTA_ANTICIPO_PROVEEDOR` / `CTA_ANTICIPO_CLIENTE` en el paso (a) siguiente — reemplazar los valores de ejemplo `'42121'` / `'12211'` por los códigos reales que devuelva esta consulta.

(a) Justo después de la definición de `cuentas104` (contabilidad.ts:989-991, antes de `for (const m of movs) {`) agregar:
```ts
  // Fase 1 · cuentas de anticipo cuando el residual no se aplico a ningun documento (D3). Confirmadas en el paso (a-1).
  const CTA_ANTICIPO_PROVEEDOR = '42121'; // TODO (a-1): reemplazar por la divisionaria mas profunda de 422 en erp_mmh_test
  const CTA_ANTICIPO_CLIENTE = '12211'; // TODO (a-1): reemplazar por la divisionaria mas profunda de 122 en erp_mmh_test
  // Fase 1 · aplicaciones activas de cada movimiento → cuenta control, monto en PEN (TC del documento) y monto en la moneda del documento
  const aplicPorMov = new Map<string, { cuenta: string; monto: number; montoDoc: number }[]>();
  if (movs.length) {
    const a = schema.aplicacionDocumento, dp = schema.documentoPendiente;
    const filas = await db.select({ origenId: a.origenId, monto: a.montoAplicado, tc: dp.tipoCambio, cuenta: dp.cuentaControl })
      .from(a).innerJoin(dp, eq(a.documentoPendienteId, dp.id))
      .where(and(eq(a.origenTipo, 'movimiento'), eq(a.estado, 'activa'), inArray(a.origenId, movs.map((m) => m.id))));
    for (const f of filas) {
      if (!f.origenId) continue;
      aplicPorMov.set(f.origenId, [...(aplicPorMov.get(f.origenId) ?? []), { cuenta: f.cuenta, monto: Number(f.monto) * (Number(f.tc) > 0 ? Number(f.tc) : 1), montoDoc: Number(f.monto) }]);
    }
  }
```

(b) Reemplazar:
```ts
    } else {
      const nat = (m.naturalezaContable ?? '') as NaturalezaContable;
```
por:
```ts
    } else if (aplicPorMov.get(m.id)?.length) {
      // Fase 1 · pago/cobro aplicado a documentos: la contra es la cuenta control de cada documento (sub-mayor = mayor)
      const porCuenta = new Map<string, number>();
      for (const ap of aplicPorMov.get(m.id)!) porCuenta.set(ap.cuenta, (porCuenta.get(ap.cuenta) ?? 0) + ap.monto);
      const controles: LineaIn[] = [...porCuenta.entries()].map(([cuenta, monto]) =>
        m.tipoMovimiento === 'Ingreso' ? { cuenta, descripcion: 'Cobro aplicado', debe: 0, haber: monto } : { cuenta, descripcion: 'Pago aplicado', debe: monto, haber: 0 });
      // D3 · el banco (total) y la suma de aplicaciones (PEN) no siempre calzan: pago > saldo (legacy), cobro < saldo (CxC parcial),
      // o USD a un TC distinto del documento. El residual va a diferencia de cambio (si sí se aplicó todo en su propia moneda) o a una
      // cuenta de anticipo (si de verdad quedó sin aplicar).
      const aplicadoPen = [...porCuenta.values()].reduce((s, v) => s + v, 0);
      const resto = Math.round((total - aplicadoPen) * 100) / 100;
      if (Math.abs(resto) > 0.01) {
        const aplicadoDoc = aplicPorMov.get(m.id)!.reduce((s, ap) => s + ap.montoDoc, 0);
        const esFx = Math.abs(aplicadoDoc - Number(m.monto)) <= 0.01;
        const ing = m.tipoMovimiento === 'Ingreso';
        const cuentaResto = esFx
          ? ((ing ? resto > 0 : resto < 0) ? '776' : '676')
          : (m.cuentaContable && !['4212', '1212'].includes(m.cuentaContable) ? m.cuentaContable : (ing ? CTA_ANTICIPO_CLIENTE : CTA_ANTICIPO_PROVEEDOR));
        const descripcionResto = esFx ? 'Diferencia de cambio' : 'No aplicado a documentos';
        if (!ing) controles.push(resto > 0 ? { cuenta: cuentaResto, descripcion: descripcionResto, debe: resto, haber: 0 } : { cuenta: cuentaResto, descripcion: descripcionResto, debe: 0, haber: Math.abs(resto) });
        else controles.push(resto > 0 ? { cuenta: cuentaResto, descripcion: descripcionResto, debe: 0, haber: resto } : { cuenta: cuentaResto, descripcion: descripcionResto, debe: Math.abs(resto), haber: 0 });
      }
      lineas = m.tipoMovimiento === 'Ingreso'
        ? [{ cuenta: banco, descripcion: m.descripcion, debe: total, haber: 0 }, ...controles]
        : [...controles, { cuenta: banco, descripcion: m.descripcion, debe: 0, haber: total }];
    } else {
      const nat = (m.naturalezaContable ?? '') as NaturalezaContable;
```

(c) Reemplazar:
```ts
      await gen({ fecha: fmov, glosa: m.descripcion ?? `Movimiento ${m.tipoMovimiento}`, origen: 'movimiento', origenId: m.id, proyectoId: m.proyectoId, lineas });
      resultado.movimientos++;
```
por:
```ts
      const asiento = await gen({ fecha: fmov, glosa: m.descripcion ?? `Movimiento ${m.tipoMovimiento}`, origen: 'movimiento', origenId: m.id, proyectoId: m.proyectoId, lineas });
      if (aplicPorMov.has(m.id)) {
        await db.update(schema.aplicacionDocumento).set({ asientoId: asiento.id })
          .where(and(eq(schema.aplicacionDocumento.origenTipo, 'movimiento'), eq(schema.aplicacionDocumento.origenId, m.id), eq(schema.aplicacionDocumento.estado, 'activa'), isNull(schema.aplicacionDocumento.asientoId)));
      }
      resultado.movimientos++;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-motor-cxp.ts`
Expected: `✓ compra con líneas`, `✓ nota de crédito`, `✓ pago aplicado`, `motor-cxp VERDE`.

- [ ] **Step 6: Regression + type check**

Run:
```bash
export "$(grep '^DATABASE_URL=' .env)"
for t in finanzas/test-compras finanzas/test-pagos ws1/test-ws1-motor ws1/test-ws1-valo-planilla ws1/regression; do node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/$t.ts > /dev/null 2>&1 && echo "OK   $t" || echo "FAIL $t"; done
pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "error TS" | sort > .tmp/tsc-t5.txt; comm -13 .tmp/tsc-base-fase1.txt .tmp/tsc-t5.txt
```
Expected: 5 `OK`, sin errores nuevos. `ws1/test-ws1-motor` verifica que la compra sin líneas y la regeneración sin pisar la cuenta manual siguen igual.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/routes/contabilidad.ts apps/backend/scripts/finanzas/test-motor-cxp.ts
git commit -m "feat(contabilidad): motor postea lineas por cuenta, NC invertida, compras en USD y pagos aplicados a la cuenta control

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Ventas — factura real de valorización, CxC y detracción

**Files:**
- Create: `apps/backend/src/lib/ventas.ts`
- Modify: `apps/backend/src/routes/proyectos.ts` (handler `PATCH /:id/valorizaciones/:valId/estado`, D5: agrega `next` a su firma)
- Test: `apps/backend/scripts/finanzas/test-ventas.ts`

**Interfaces:**
- Consumes: Task 2 (`aplicarPagoAOrigen`, `refrescarDocumento`, `DocumentoError`, `DbLike`, `buscarTasaDetraccion`), Fase 0 (`calcularDetraccion`).
- Produces:
```ts
export function crearDocumentoVenta(q: DbLike, valo: Valorizacion, o?: { detraccionCodigo?: string; empresaId?: number }):
  Promise<{ documento: DocumentoPendiente; detraccion: DetraccionDocumento | null }>;
// PATCH .../estado 'facturada' sin comprobante previo: exige comprobante.serie y comprobante.numero (400 si faltan);
//   body.comprobante += detraccionCodigo? (default '030'); crea CxC 1212 + detracción de la venta.
// PATCH .../estado 'cobrada': el movimiento de cobro aplica a la CxC hasta su saldo.
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/scripts/finanzas/test-ventas.ts
/**
 * Fase 1 · ventas: CxC de la factura de valorización, detracción de la venta, cobro aplicado, número obligatorio.
 * La parte de lib corre en una transacción revertida sobre una valorización existente.
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-ventas.ts
 */
import '../../src/env.js'; // carga .env (erp_mmh_test) antes de que @erp/db abra la conexion
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { db, schema } from '@erp/db';
import { eq, isNull } from 'drizzle-orm';
import { authMiddleware } from '../../src/middleware/auth.js';
import { lucia } from '../../src/auth.js';
import proyectosRoutes from '../../src/routes/proyectos.js';
import { crearDocumentoVenta } from '../../src/lib/ventas.js';
import { DocumentoError, aplicarPagoAOrigen, refrescarDocumento } from '../../src/lib/documentosPendientes.js';

class Rollback extends Error {}
const USER = 'af36a9b1-3b8e-4471-99d0-d08cf271187d';

// A · lib dentro de una transacción revertida
try {
  await db.transaction(async (tx) => {
    const [v0] = await tx.select().from(schema.valorizaciones).limit(1);
    assert.ok(v0, 'hay al menos una valorización en erp_mmh_test');
    const [v] = await tx.update(schema.valorizaciones).set({ comprobanteTipo: 'factura', comprobanteSerie: 'E999', comprobanteNumero: '99901', comprobanteFecha: '2099-05-02', comprobanteFechaVenc: '2099-06-01', comprobanteDetraccion: '10000.00', montoTotalConIgv: '250000.00' })
      .where(eq(schema.valorizaciones.id, v0!.id)).returning();
    const r = await crearDocumentoVenta(tx, v!, { detraccionCodigo: '030' });
    assert.deepEqual([r.documento.tipo, r.documento.cuentaControl, r.documento.montoOriginal, r.documento.docSerie, r.documento.docNumero, r.documento.docOrigenTipo], ['cxc', '1212', '250000.00', 'E999', '99901', 'valorizacion']);
    assert.deepEqual([r.detraccion?.codigo, r.detraccion?.monto, r.detraccion?.montoDeclarado, r.detraccion?.cuentaBn], ['030', '10000.00', '10000.00', '00003354431']);
    assert.equal((await crearDocumentoVenta(tx, v!, { detraccionCodigo: '030' })).documento.id, r.documento.id, 'idempotente');
    // cobro del neto (240,000) + depósito de detracción (10,000)
    await aplicarPagoAOrigen(tx, { docOrigenTipo: 'valorizacion', docOrigenId: v!.id, movimientoId: randomUUID(), monto: 240000, fecha: '2099-05-10' });
    let d = await refrescarDocumento(tx, r.documento.id);
    assert.deepEqual([d.saldoPendiente, d.estado], ['10000.00', 'parcial']);
    await aplicarPagoAOrigen(tx, { docOrigenTipo: 'valorizacion', docOrigenId: v!.id, movimientoId: randomUUID(), monto: 10000, fecha: '2099-05-12' });
    d = await refrescarDocumento(tx, r.documento.id);
    assert.equal(d.estado, 'cancelado');
    // sin número real no se crea CxC
    const [sinNum] = await tx.update(schema.valorizaciones).set({ comprobanteNumero: null }).where(eq(schema.valorizaciones.id, v0!.id)).returning();
    await tx.delete(schema.documentoPendiente).where(eq(schema.documentoPendiente.id, r.documento.id));
    await assert.rejects(crearDocumentoVenta(tx, sinNum!), (e) => e instanceof DocumentoError && e.status === 400);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) throw e;
}
console.log('  ✓ A lib ventas');

// B · ruta: marcar facturada sin número real → 400 y la valorización no cambia
const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/proyectos', proyectosRoutes);
const server = app.listen(0);
const base = `http://localhost:${(server.address() as { port: number }).port}`;
const session = await lucia.createSession(USER, {});
const headers = { cookie: lucia.createSessionCookie(session.id).serialize(), 'content-type': 'application/json' };
try {
  const [sinComprobante] = await db.select().from(schema.valorizaciones).where(isNull(schema.valorizaciones.comprobanteNumero)).limit(1);
  if (sinComprobante) {
    const r = await fetch(`${base}/api/proyectos/${sinComprobante.proyectoId}/valorizaciones/${sinComprobante.id}/estado`, { method: 'PATCH', headers, body: JSON.stringify({ estado: 'facturada', comprobante: { serie: 'E001' } }) });
    assert.equal(r.status, 400);
    const [igual] = await db.select().from(schema.valorizaciones).where(eq(schema.valorizaciones.id, sinComprobante.id));
    assert.deepEqual([igual!.status, igual!.comprobanteNumero], [sinComprobante.status, null], 'no se modificó');
    console.log('  ✓ B número obligatorio');
  } else console.log('  ⏭  no hay valorización sin comprobante para probar la ruta');
  console.log('ventas VERDE');
} finally {
  await lucia.invalidateSession(session.id);
  server.close();
}
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-ventas.ts`
Expected: FAIL `Cannot find module '../../src/lib/ventas.js'`

- [ ] **Step 3: Write `ventas.ts`**

```ts
// apps/backend/src/lib/ventas.ts
/**
 * Fase 1 · cuenta por cobrar de la factura de una valorización (sub-mayor 1212) + detracción de la venta.
 * Requiere número real de comprobante: el mock correlativo quedó eliminado.
 */
import { schema } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { calcularDetraccion } from './detraccionCalc.js';
import { buscarTasaDetraccion } from './detraccionTasa.js';
import { type DbLike, DocumentoError } from './documentosPendientes.js';

type Valorizacion = typeof schema.valorizaciones.$inferSelect;

export async function crearDocumentoVenta(q: DbLike, v: Valorizacion, o: { detraccionCodigo?: string; empresaId?: number } = {}) {
  const empresaId = o.empresaId ?? 1;
  if (!v.comprobanteSerie?.trim() || !v.comprobanteNumero?.trim()) throw new DocumentoError(400, `La valorización N°${v.numero} no tiene serie y número reales de factura`);
  const d = schema.documentoPendiente;
  const [cliente] = await q.select({ ruc: schema.clientes.ruc, razon: schema.clientes.razonSocial })
    .from(schema.proyectos).leftJoin(schema.clientes, eq(schema.proyectos.clienteId, schema.clientes.id))
    .where(eq(schema.proyectos.id, v.proyectoId)).limit(1);
  const fecha = v.comprobanteFecha ?? v.fechaEmision;
  const total = Number(v.montoTotalConIgv ?? v.montoTotal);

  let [documento] = await q.select().from(d).where(and(eq(d.docOrigenTipo, 'valorizacion'), eq(d.docOrigenId, v.id))).limit(1);
  if (!documento) {
    const [dup] = await q.select({ id: d.id }).from(d)
      .where(and(eq(d.empresaId, empresaId), eq(d.tipo, 'cxc'), eq(d.docSerie, v.comprobanteSerie), eq(d.docNumero, v.comprobanteNumero))).limit(1);
    if (dup) throw new DocumentoError(409, `La factura ${v.comprobanteSerie}-${v.comprobanteNumero} ya está registrada en otra venta`);
    const [asientoVenta] = await q.select({ id: schema.asientos.id }).from(schema.asientos)
      .where(and(eq(schema.asientos.origen, 'valorizacion'), eq(schema.asientos.origenId, v.id))).limit(1);
    [documento] = await q.insert(d).values({
      empresaId, tipo: 'cxc', cuentaControl: '1212',
      terceroRuc: cliente?.ruc?.trim() || null, terceroRazon: cliente?.razon ?? null,
      docTipo: v.comprobanteTipo ?? 'factura', docSerie: v.comprobanteSerie, docNumero: v.comprobanteNumero,
      fechaEmision: fecha, fechaVenc: v.comprobanteFechaVenc ?? fecha,
      moneda: 'PEN', montoOriginal: total.toFixed(2), montoPen: total.toFixed(2), saldoPendiente: total.toFixed(2),
      estado: 'abierto', obraId: v.proyectoId, asientoOrigenId: asientoVenta?.id ?? null,
      docOrigenTipo: 'valorizacion', docOrigenId: v.id,
    }).returning();
  }

  let [detraccion] = await q.select().from(schema.detraccionDocumento)
    .where(and(eq(schema.detraccionDocumento.docOrigenTipo, 'valorizacion'), eq(schema.detraccionDocumento.docOrigenId, v.id))).limit(1);
  const declarado = Number(v.comprobanteDetraccion ?? 0);
  if (!detraccion && (declarado > 0 || o.detraccionCodigo)) {
    const codigo = o.detraccionCodigo ?? '030';
    const tasa = await buscarTasaDetraccion(codigo, fecha);
    if (!tasa) throw new DocumentoError(400, `Código de detracción ${codigo} no vigente o sin % al ${fecha}`);
    const calc = calcularDetraccion({ total, moneda: 'PEN', tasa });
    const [bn] = await q.select({ codigo: schema.cuentasBancarias.codigo }).from(schema.cuentasBancarias).where(eq(schema.cuentasBancarias.tipo, 'detracciones')).limit(1);
    [detraccion] = await q.insert(schema.detraccionDocumento).values({
      docOrigenTipo: 'valorizacion', docOrigenId: v.id, empresaId, codigo: tasa.codigo, porcentaje: tasa.porcentaje.toFixed(2),
      basePen: calc.basePen.toFixed(2), monto: calc.monto.toFixed(2), montoDeclarado: declarado > 0 ? declarado.toFixed(2) : null,
      cuentaBn: bn?.codigo ?? null, estado: calc.aplica ? 'pendiente' : 'no_aplica',
    }).returning();
  }
  return { documento: documento!, detraccion: detraccion ?? null };
}
```

- [ ] **Step 4: `proyectos.ts` — sin mock, CxC al facturar, cobro aplicado**

(a) Imports: agregar
```ts
import { crearDocumentoVenta } from '../lib/ventas.js';
import { DocumentoError, aplicarPagoAOrigen } from '../lib/documentosPendientes.js';
```

(a0) D5 · reemplazar la firma del handler:
```ts
router.patch('/:id/valorizaciones/:valId/estado', async (req, res) => {
```
por:
```ts
router.patch('/:id/valorizaciones/:valId/estado', async (req, res, next) => {
```

(b) Reemplazar el bloque desde el comentario `// Al marcar FACTURADA se captura el comprobante electrónico (serie/número reales · o mock auto-correlativo si no se envían).` hasta el cierre del `if (estado === 'facturada') { ... }` por:
```ts
  // Al marcar FACTURADA se captura el comprobante electrónico REAL (Fase 1: sin número mock).
  // Alimenta Registro de Ventas (14.1), SIRE RVIE y la CxC 1212. Idempotente: no re-numera si ya tiene comprobante.
  let comprobante: Partial<typeof schema.valorizaciones.$inferInsert> | undefined;
  const c = (body as { comprobante?: { tipo?: string; serie?: string; numero?: string; fecha?: string; fechaVenc?: string; detraccion?: number; detraccionCodigo?: string } }).comprobante ?? {};
  if (estado === 'facturada') {
    const [cur] = await db.select({ n: schema.valorizaciones.comprobanteNumero }).from(schema.valorizaciones).where(eq(schema.valorizaciones.id, req.params.valId!)).limit(1);
    if (!cur?.n) {
      const serie = c.serie?.trim();
      const numero = c.numero?.trim();
      if (!serie || !numero) return res.status(400).json({ error: 'Ingresa la serie y el número reales de la factura emitida' });
      const fechaEmi = c.fecha?.trim() || new Date().toISOString().slice(0, 10);
      comprobante = {
        comprobanteTipo: c.tipo?.trim() || 'factura', comprobanteSerie: serie, comprobanteNumero: numero, comprobanteFecha: fechaEmi,
        comprobanteFechaVenc: c.fechaVenc?.trim() || fechaEmi,
        comprobanteDetraccion: Number(c.detraccion) > 0 ? String(c.detraccion) : null,
      };
    }
  }
```

(c) Reemplazar la apertura de la transacción:
```ts
  const val = await db.transaction(async (tx) => {
```
por:
```ts
  let val: typeof schema.valorizaciones.$inferSelect | null;
  try {
  val = await db.transaction(async (tx) => {
```
y, dentro de la transacción, justo después de `if (!v) return null;` agregar:
```ts
    if (estado === 'facturada') await crearDocumentoVenta(tx, v, { detraccionCodigo: c.detraccionCodigo }); // Fase 1 · CxC + detracción
```

(d) Dentro del bloque de cobro, reemplazar:
```ts
        await tx.insert(schema.movimientos).values({
```
por:
```ts
        const [movCobro] = await tx.insert(schema.movimientos).values({
```
y el cierre de ese insert:
```ts
          tipoCambio: '1', montoBase: String(v.totalContratista ?? v.montoTotalConIgv ?? v.montoTotal), // H3.1 · valos en PEN
        });
```
por:
```ts
          tipoCambio: '1', montoBase: String(v.totalContratista ?? v.montoTotalConIgv ?? v.montoTotal), // H3.1 · valos en PEN
        }).returning({ id: schema.movimientos.id });
        if (movCobro) await aplicarPagoAOrigen(tx, { docOrigenTipo: 'valorizacion', docOrigenId: v.id, movimientoId: movCobro.id, monto: Number(v.totalContratista ?? v.montoTotalConIgv ?? v.montoTotal), fecha, userId: req.user!.id }); // Fase 1 · cobro aplicado a la CxC
```

(e) Reemplazar el cierre de la transacción:
```ts
    return v;
  });
  if (!val) return res.status(404).json({ error: 'Valorización no encontrada' });
```
por:
```ts
    return v;
  });
  } catch (e) {
    if (e instanceof DocumentoError) return res.status(e.status).json({ error: e.message });
    return next(e); // D5 · Express 4 no atrapa el throw async
  }
  if (!val) return res.status(404).json({ error: 'Valorización no encontrada' });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-ventas.ts`
Expected: `✓ A lib ventas`, `✓ B número obligatorio` (o el aviso de que no hay valorización sin comprobante), `ventas VERDE`.

- [ ] **Step 6: Regression + type check**

Run:
```bash
export "$(grep '^DATABASE_URL=' .env)"
for t in finanzas/test-motor-cxp finanzas/test-pagos ws1/test-ws1-valo-planilla ws1/regression; do node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/$t.ts > /dev/null 2>&1 && echo "OK   $t" || echo "FAIL $t"; done
pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "error TS" | sort > .tmp/tsc-t6.txt; comm -13 .tmp/tsc-base-fase1.txt .tmp/tsc-t6.txt
```
Expected: 4 `OK`, sin errores nuevos.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/lib/ventas.ts apps/backend/src/routes/proyectos.ts apps/backend/scripts/finanzas/test-ventas.ts
git commit -m "feat(finanzas): factura real de valorizacion con CxC 1212, detraccion de venta y cobro aplicado

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 7: Frontend mínimo — la compra pendiente ya no pierde datos y la factura de valorización exige número real

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` (tipos `GastoInput`, `setValorizacionEstado`; cliente `catalogos.detracciones` antes de `  contabilidad: {`)
- Modify: `apps/frontend/src/pages/FinanzasPage.tsx` (`MovModal`: catálogo de detracciones, payload de compra con vencimiento/detracción/retención, prorrateo sin factura duplicada)
- Modify: `apps/frontend/src/components/proyectos/tabs/ValorizacionesTab.tsx` (`FacturaValoModal`: serie y número obligatorios, código de detracción, error visible)

**Interfaces:**
- Consumes: Task 3 (`POST /api/gastos` acepta `fechaVencimiento`, `detraccion{codigo,montoDeclarado?}`, `retencion{tipo,monto}`; 409 factura duplicada; 400 retención IGV sin agente), Task 4 (movimiento con `gastoId` aplica solo a la CxP), Task 6 (`comprobante.detraccionCodigo`; 400 sin serie/número), Fase 0 (`GET /api/catalogos/detracciones?fecha=` → `{ fecha, tasas: { codigo, descripcion, anexo, porcentaje, montoMinimo }[] }`).
- Produces: `api.catalogos.detracciones(fecha?: string)`; tipo `DetraccionTasa`. Nada del backend depende de esta task.

**Nota de diseño (prorrateo):** el prorrateo actual crea N gastos con la misma serie-número. Con la CxP de Task 3 el segundo gasto recibe `409 factura duplicada`. En esta fase **solo la primera fila lleva serie y número**; las demás van sin serie/número y con la referencia en la descripción. Cada fila crea su propia CxP por su monto (Σ = total de la factura). El prorrateo pasa a líneas con obra por línea en la Fase 4, cuando `costos-obra` lea `gasto_lineas`. D17 · el prorrateo tampoco envía detracción ni retención en ninguna fila (igual que hoy): se corrige en la Fase 4 cuando el prorrateo pase a líneas por obra.

No hay framework de tests de frontend: la verificación es `tsc` + prueba manual guiada (Step 5).

- [ ] **Step 1: `api.ts` — tipos y cliente de catálogo**

(a) En `export type GastoInput = {`, reemplazar:
```ts
  cuentaContableOrigen?: 'USUARIO' | 'SUGERIDO' | null;
};
// WS1 · fila del autocomplete de plan contable (GET /contabilidad/plan?q=)
```
por:
```ts
  cuentaContableOrigen?: 'USUARIO' | 'SUGERIDO' | null;
  // Fase 1 · compra como documento (CxP): se guardan aunque la compra quede pendiente
  fechaVencimiento?: string | null;
  tipoCambio?: number | null;
  detraccion?: { codigo: string; montoDeclarado?: number | null } | null;
  retencion?: { tipo: 'igv3' | 'renta4ta'; monto: number } | null;
  docModifica?: { serie: string; numero: string } | null;
  motivoNota?: string | null;
};
// Fase 0 · tasa de detracción vigente (GET /api/catalogos/detracciones?fecha=)
export type DetraccionTasa = { codigo: string; descripcion: string; anexo: string | null; porcentaje: number; montoMinimo: number };
// WS1 · fila del autocomplete de plan contable (GET /contabilidad/plan?q=)
```

(b) En `setValorizacionEstado`, reemplazar el tipo de `comprobante`:
```ts
comprobante?: { tipo?: string; serie?: string; numero?: string; fecha?: string; fechaVenc?: string; detraccion?: number } }) =>
```
por:
```ts
comprobante?: { tipo?: string; serie?: string; numero?: string; fecha?: string; fechaVenc?: string; detraccion?: number; detraccionCodigo?: string } }) =>
```

(c) Justo antes de la línea `  // Contabilidad · PCGE 2020 (contador interno)` insertar:
```ts
  // Fase 0 · catálogos SUNAT de solo lectura
  catalogos: {
    detracciones: (fecha?: string) => req<{ fecha: string; tasas: DetraccionTasa[] }>(`/api/catalogos/detracciones${fecha ? `?fecha=${fecha}` : ''}`),
  },

```

- [ ] **Step 2: `FinanzasPage.tsx` — `MovModal`**

(a) Import: en la línea `import { type FinanzasResumen, type MovimientoInput, type GastoInput, ... api } from '@/lib/api.js';` agregar `type DetraccionTasa,` antes de `api`. Borrar la línea:
```ts
const DETRAC_PCT = [{ v: '4', l: '4% · Construcción' }, { v: '10', l: '10% · Servicios diversos' }, { v: '12', l: '12% · Intermediación' }, { v: '1.5', l: '1.5% · Comisión mercantil' }];
```

(b) Borrar el comentario obsoleto:
```ts
  // ponytail: UI-only por ahora — esGasto/estadoPago/clasificación aún no se envían al backend
```

(c) En el estado `f`, reemplazar:
```ts
    aplicaDetraccion: false, detraccionPct: '4',
```
por:
```ts
    aplicaDetraccion: false, detraccionCodigo: '030',
```

(c2) D14 · el 3% IGV siempre lo rechaza el backend (`empresa.config` es `{}` hoy, sin agente de retención): tildar "Retención" sin cambiar el % daba 400. En el mismo estado `f`, reemplazar:
```ts
    aplicaRetencion: false, retencionPct: '3',
```
por:
```ts
    aplicaRetencion: false, retencionPct: '8',
```

(d) Reemplazar:
```ts
  const detrac = !isBanc && f.aplicaDetraccion ? totalComp * (parseFloat(f.detraccionPct) / 100) : 0;
```
por:
```ts
  // Fase 1 · % y mínimo desde el catálogo vigente a la fecha de emisión. Vista previa en PEN; el backend recalcula (USD con TC).
  const tasasQ = useQuery({ queryKey: ['detracciones', f.fecha], queryFn: () => api.catalogos.detracciones(f.fecha), enabled: !isBanc && f.aplicaDetraccion });
  const tasas: DetraccionTasa[] = tasasQ.data?.tasas ?? [];
  const tasaSel = tasas.find((t) => t.codigo === f.detraccionCodigo);
  const detrac = !isBanc && f.aplicaDetraccion && tasaSel && f.moneda === 'PEN' && totalComp > tasaSel.montoMinimo ? Math.round(totalComp * tasaSel.porcentaje / 100) : 0;
```

(e) Justo antes del `const create = useMutation({` de `MovModal` (el que sigue a `const buildMov`, ~L823; NO el de `CuentaModal`, ~L688, donde `f`/`retenc` no existen — D9) agregar:
```ts
  // Fase 1 · datos tributarios que la compra guarda aunque quede pendiente (antes se perdían: bug L869)
  const extrasCompra = (): Pick<GastoInput, 'fechaVencimiento' | 'detraccion' | 'retencion'> => ({
    fechaVencimiento: f.fechaVencimiento || null,
    detraccion: f.aplicaDetraccion ? { codigo: f.detraccionCodigo } : null,
    retencion: f.aplicaRetencion && retenc > 0 ? { tipo: f.retencionPct === '8' ? 'renta4ta' : 'igv3', monto: Math.round(retenc * 100) / 100 } : null,
  });
```

(f) En el bucle del prorrateo, reemplazar:
```ts
          for (const row of rows) {
            const totalRow = parseFloat(row.monto);
            const baseRow = f.aplicaIgv ? totalRow / 1.18 : totalRow;
            const igvRow = totalRow - baseRow;
            const { gasto: gp } = await api.finanzas.createGastoGlobal({
              fecha: f.fecha, proyectoId: row.proyectoId, proveedorRuc: f.docNumero || null, proveedorRazon: f.contraparte || null,
              tipoComprobante: f.tipoComprobante, serie: f.serie || null, numero: f.numero || null, moneda: f.moneda, cuentaId: f.cuentaId || null,
              descripcionItem: `${f.descripcion || f.subtipo || ''} · prorrateo ${opRef}`.trim(), subtotal: baseRow, igv: igvRow, total: totalRow,
```
por:
```ts
          for (const [i, row] of rows.entries()) {
            const totalRow = parseFloat(row.monto);
            const baseRow = f.aplicaIgv ? totalRow / 1.18 : totalRow;
            const igvRow = totalRow - baseRow;
            // ponytail: solo la 1ª fila lleva serie-número (la CxP rechaza la misma factura dos veces); Fase 4 → una compra con obra por línea
            const docRef = f.serie || f.numero ? ` · ${f.serie}-${f.numero}` : '';
            const { gasto: gp } = await api.finanzas.createGastoGlobal({
              fecha: f.fecha, proyectoId: row.proyectoId, proveedorRuc: f.docNumero || null, proveedorRazon: f.contraparte || null,
              tipoComprobante: f.tipoComprobante, serie: i === 0 ? f.serie || null : null, numero: i === 0 ? f.numero || null : null, moneda: f.moneda, cuentaId: f.cuentaId || null,
              fechaVencimiento: f.fechaVencimiento || null,
              descripcionItem: `${f.descripcion || f.subtipo || ''} · prorrateo ${opRef}${i > 0 ? docRef : ''} (${i + 1}/${rows.length})`.trim(), subtotal: baseRow, igv: igvRow, total: totalRow,
```

(g) En `gastoPayload`, reemplazar:
```ts
          cuentaContableOrigen: cuentaContable ? (cuentaSugerida ? 'SUGERIDO' : 'USUARIO') : null,
        };
        const { gasto } = await api.finanzas.createGastoGlobal(gastoPayload);
        // pendiente = solo gasto (cuenta por pagar); pagado = además movimiento de caja linkeado
```
por:
```ts
          cuentaContableOrigen: cuentaContable ? (cuentaSugerida ? 'SUGERIDO' : 'USUARIO') : null,
          ...extrasCompra(),
        };
        const { gasto } = await api.finanzas.createGastoGlobal(gastoPayload);
        // pendiente = compra con su CxP (vencimiento/detracción/retención guardados); pagado = además el pago, que se aplica a la CxP
```

(h) Reemplazar el `<select>` de detracción:
```tsx
                    {f.aplicaDetraccion && <select className={cn(inputCls, 'mt-1.5')} value={f.detraccionPct} onChange={(e) => set({ detraccionPct: e.target.value })}>{DETRAC_PCT.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}</select>}
```
por:
```tsx
                    {f.aplicaDetraccion && (
                      <>
                        <select className={cn(inputCls, 'mt-1.5')} value={f.detraccionCodigo} onChange={(e) => set({ detraccionCodigo: e.target.value })}>
                          {tasas.length === 0 && <option value={f.detraccionCodigo}>{tasasQ.isLoading ? 'Cargando…' : 'Sin catálogo'}</option>}
                          {tasas.map((t) => <option key={t.codigo} value={t.codigo}>{t.codigo} · {t.porcentaje}% · {t.descripcion.slice(0, 40)}</option>)}
                        </select>
                        {tasaSel && detrac === 0 && totalComp > 0 && <div className="mt-1 text-[10px] text-ink-4">{f.moneda !== 'PEN' ? 'En USD se calcula al guardar con el tipo de cambio' : `No supera el mínimo S/ ${tasaSel.montoMinimo.toFixed(2)}`}</div>}
                      </>
                    )}
```

(i) D14 · el 3% IGV requiere agente de retención (hoy ninguna empresa lo tiene configurado): sacar esa opción del `<select>` de retención hasta que exista la Fase 2. Reemplazar:
```tsx
                    {f.aplicaRetencion && <select className={cn(inputCls, 'mt-1.5')} value={f.retencionPct} onChange={(e) => set({ retencionPct: e.target.value })}><option value="3">3% · Retención IGV</option><option value="8">8% · Honorarios 4ta</option></select>}
```
por:
```tsx
                    {/* ponytail: 3% IGV vuelve cuando empresa.config.agenteRetencion exista (Fase 2) */}
                    {f.aplicaRetencion && <select className={cn(inputCls, 'mt-1.5')} value={f.retencionPct} onChange={(e) => set({ retencionPct: e.target.value })}><option value="8">8% · Honorarios 4ta</option></select>}
```

- [ ] **Step 3: `ValorizacionesTab.tsx` — `FacturaValoModal`**

(a) En `cambiarEstado`, reemplazar el tipo de `comprobante`:
```ts
comprobante?: { tipo?: string; serie?: string; numero?: string; fecha?: string; fechaVenc?: string; detraccion?: number } }) =>
```
por:
```ts
comprobante?: { tipo?: string; serie?: string; numero?: string; fecha?: string; fechaVenc?: string; detraccion?: number; detraccionCodigo?: string } }) =>
```

(b) En el uso del modal, reemplazar:
```tsx
        <FacturaValoModal
          pending={cambiarEstado.isPending}
          onClose={() => setFactura(null)}
```
por:
```tsx
        <FacturaValoModal
          pending={cambiarEstado.isPending}
          error={cambiarEstado.error?.message ?? null}
          onClose={() => { cambiarEstado.reset(); setFactura(null); }}
```

(c) Reemplazar la cabecera del componente, desde el comentario hasta `const [detraccion, setDetraccion] = useState('');`:
```tsx
// Mini-modal · al marcar valo facturada captura el comprobante electrónico (Registro de Ventas / RVIE).
// Dejar en blanco = número mock auto-correlativo; llenar cuando exista la factura real.
function FacturaValoModal({ pending, onClose, onConfirm }: {
  pending: boolean;
  onClose: () => void;
  onConfirm: (comprobante: { tipo: string; serie: string; numero: string; fecha: string; fechaVenc: string; detraccion: number }) => void;
}) {
  const [tipo, setTipo] = useState('factura');
  const [serie, setSerie] = useState('F001');
  const [numero, setNumero] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [fechaVenc, setFechaVenc] = useState('');
  const [detraccion, setDetraccion] = useState('');
```
por:
```tsx
// Mini-modal · al marcar valo facturada captura el comprobante electrónico REAL (Registro de Ventas / RVIE / CxC 1212).
// Fase 1 · serie y número obligatorios: ya no hay número mock.
function FacturaValoModal({ pending, error, onClose, onConfirm }: {
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (comprobante: { tipo: string; serie: string; numero: string; fecha: string; fechaVenc: string; detraccion: number; detraccionCodigo?: string }) => void;
}) {
  const [tipo, setTipo] = useState('factura');
  const [serie, setSerie] = useState('F001');
  const [numero, setNumero] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [fechaVenc, setFechaVenc] = useState('');
  const [detraccion, setDetraccion] = useState('');
  const [detraccionCodigo, setDetraccionCodigo] = useState('030');
  const tasasQ = useQuery({ queryKey: ['detracciones', fecha], queryFn: () => api.catalogos.detracciones(fecha), enabled: Number(detraccion) > 0 });
  const completo = serie.trim() !== '' && numero.trim() !== '';
```
(`useQuery` y `api` ya están importados en este archivo; si `useQuery` no está en el import de `@tanstack/react-query`, agregarlo.)

(d) Reemplazar el texto de ayuda:
```tsx
Factura emitida por la valorización · alimenta el Registro de Ventas y el SIRE. Deja el número en blanco para asignar uno correlativo automático.</p>
```
por:
```tsx
Factura emitida por la valorización · alimenta el Registro de Ventas, el SIRE y la cuenta por cobrar. Ingresa la serie y el número tal como figuran en la factura electrónica.</p>
```

(e) Reemplazar el input de número:
```tsx
              <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="auto" className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full font-mono" />
```
por:
```tsx
              <input value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))} placeholder="00000123" required className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full font-mono" />
```

(f) Reemplazar el bloque de botones:
```tsx
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={pending} onClick={() => onConfirm({ tipo, serie: serie.trim(), numero: numero.trim(), fecha, fechaVenc: fechaVenc || fecha, detraccion: Number(detraccion) || 0 })} className="h-8 px-3 rounded-md bg-indigo-600 text-white text-[12px] font-medium disabled:opacity-50">
```
por:
```tsx
          {Number(detraccion) > 0 && (
            <label className="block">
              <span className="text-[10.5px] font-mono uppercase tracking-wider text-ink-4">Código de detracción</span>
              <select value={detraccionCodigo} onChange={(e) => setDetraccionCodigo(e.target.value)} className="mt-1 h-8 px-2 rounded-md border border-line bg-bg-elev text-[12px] w-full">
                {(tasasQ.data?.tasas ?? []).length === 0 && <option value={detraccionCodigo}>{tasasQ.isLoading ? 'Cargando…' : detraccionCodigo}</option>}
                {(tasasQ.data?.tasas ?? []).map((t) => <option key={t.codigo} value={t.codigo}>{t.codigo} · {t.porcentaje}% · {t.descripcion.slice(0, 36)}</option>)}
              </select>
            </label>
          )}
          {error && <div className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11.5px] text-rose-700 dark:bg-rose-950/40">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-sunken">Cancelar</button>
            <button disabled={pending || !completo} title={completo ? undefined : 'Ingresa serie y número'} onClick={() => onConfirm({ tipo, serie: serie.trim(), numero: numero.trim(), fecha, fechaVenc: fechaVenc || fecha, detraccion: Number(detraccion) || 0, ...(Number(detraccion) > 0 ? { detraccionCodigo } : {}) })} className="h-8 px-3 rounded-md bg-indigo-600 text-white text-[12px] font-medium disabled:opacity-50">
```

- [ ] **Step 4: Type check y búsqueda de restos**

Run:
```bash
pnpm --filter @erp/frontend exec tsc --noEmit
grep -n "DETRAC_PCT\|detraccionPct\|placeholder=\"auto\"\|correlativo automático" apps/frontend/src/pages/FinanzasPage.tsx apps/frontend/src/components/proyectos/tabs/ValorizacionesTab.tsx
```
Expected: `tsc` sin salida (exit 0); `grep` sin coincidencias.

- [ ] **Step 5: Prueba manual guiada (backend + frontend en `erp_mmh_test`)**

Con `pnpm dev` levantado y sesión de admin en MM:
1. Finanzas → Nuevo movimiento → Egreso → Gasto o compra → **pendiente**, RUC `20999999995`, Factura `F999-7001`, subtotal 1000, vencimiento a 30 días, detracción `030`. Guardar.
2. Verificar en psql:
```sql
SELECT g.fecha_vencimiento, d.estado, d.saldo_pendiente, dd.codigo, dd.monto
FROM gastos g
JOIN documento_pendiente d ON d.doc_origen_tipo = 'gasto' AND d.doc_origen_id = g.id
LEFT JOIN detraccion_documento dd ON dd.doc_origen_tipo = 'gasto' AND dd.doc_origen_id = g.id
WHERE g.proveedor_ruc = '20999999995' AND g.numero = '7001';
```
Expected: vencimiento guardado, `abierto`, `1180.00`, `030`, `47.00` (1180 × 4% = 47.2, redondeado a 47.00).
3. Repetir la misma factura → el modal muestra el error `ya está registrada` (409).
4. Proyecto con valorización aprobada → Marcar facturada: el botón queda deshabilitado sin número; con número `E001-99001` y detracción 500 + código → guarda y crea la CxC.
5. Limpiar: `DELETE` de los gastos/documentos/detracciones de RUC `20999999995` y revertir la valorización de prueba (`status`, `comprobante_*` a como estaban), o anular desde la UI.

Si no hay navegador disponible, dejar el Step 5 anotado como pendiente de verificación manual en el reporte (no bloquea el commit: `tsc` y los tests de backend cubren el contrato).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/lib/api.ts apps/frontend/src/pages/FinanzasPage.tsx apps/frontend/src/components/proyectos/tabs/ValorizacionesTab.tsx
git commit -m "fix(finanzas): la compra pendiente guarda vencimiento, detraccion y retencion; factura de valorizacion exige numero real

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Cierre de la Fase 1

- [ ] Correr la batería completa en un solo shell:
```bash
export "$(grep '^DATABASE_URL=' .env)"
for t in apps/backend/scripts/finanzas/test-*.ts apps/backend/scripts/cpe/test-*.ts apps/backend/scripts/ws1/test-ws1-motor.ts apps/backend/scripts/ws1/test-ws1-valo-planilla.ts apps/backend/scripts/ws1/regression.ts; do node apps/backend/node_modules/tsx/dist/cli.mjs $t > /dev/null 2>&1 && echo "OK   $t" || echo "FAIL $t"; done
pnpm --filter @erp/backend exec tsc --noEmit 2>&1 | grep -E "error TS" | sort > .tmp/tsc-fin.txt; comm -13 .tmp/tsc-base-fase1.txt .tmp/tsc-fin.txt
pnpm --filter @erp/frontend exec tsc --noEmit
```
Expected: todo `OK`, `comm` sin salida, `tsc` frontend exit 0.
- [ ] Verificar que no quedaron residuos de prueba: `SELECT count(*) FROM gastos WHERE proveedor_ruc LIKE '209999999%' OR fecha >= '2099-01-01';` → 0.
- [ ] D4 · verificar que no quedaron CxP huérfanas (sin su gasto) de las corridas de test: `SELECT count(*) FROM documento_pendiente d WHERE d.doc_origen_tipo='gasto' AND NOT EXISTS (SELECT 1 FROM gastos g WHERE g.id=d.doc_origen_id);` → 0.
- [ ] Actualizar memoria del proyecto (estado Fase 1 en `erp_mmh_test`, desviaciones WS0, limitación del prorrateo) y dejar la Fase 2 lista para planificar: reglas de validación ampliadas, percepción aplicada, diferencia de cambio, pago de detracción desde la cuenta BN.
