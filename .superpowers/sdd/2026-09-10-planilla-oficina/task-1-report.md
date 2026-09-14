# Task 1 Report — Planilla de Oficina: Schema migration + ORM

**Date:** 2026-09-10  
**Branch:** feat/rbac-multiempresa  
**Commit:** b5efeab

---

## What was done

### Step 1 — Migration SQL created
File: `apps/backend/scripts/oficina/2026-09-10-planilla-oficina-schema.sql`

Verified that `configPlanilla = pgTable('config_planilla', ...)` in schema.ts (line 1047), confirming the correct table name `config_planilla` for ALTER TABLE statements.

### Step 2 — Migration applied to erp_mmh_test

```
BEGIN
ALTER TABLE  (empleados: cargo)
ALTER TABLE  (empleados: sueldo_base_mensual)
ALTER TABLE  (empleados: fecha_cese)
ALTER TABLE  (empleados: asignacion_familiar)
ALTER TABLE  (config_planilla: rmv)
NOTICE: la columna "uit" de la relacion "config_planilla" ya existe, omitiendo   <-- expected, idempotent
ALTER TABLE  (config_planilla: tope_seguro_afp)
ALTER TABLE  (config_planilla: horas_mes_base)
CREATE TABLE planilla_oficina_mes
CREATE INDEX pom_empresa_mes_uq
CREATE TABLE planilla_oficina_detalle
CREATE INDEX pod_mes_idx
CREATE TABLE adelanto_oficina
CREATE INDEX adel_empleado_idx
CREATE TABLE adelanto_cuota_aplicada
CREATE TABLE descuento_oficina
CREATE TABLE documento_adjunto
CREATE INDEX docadj_entidad_idx
COMMIT
```

Note: The NOTICE about `uit` already existing is expected — the column was already present in `config_planilla` from the original schema, and `IF NOT EXISTS` handled it gracefully. No errors.

### Step 3 — ORM additions to packages/db/src/schema.ts

Added to `empleados` table:
- `cargo: varchar('cargo', { length: 80 })`
- `sueldoBaseMensual: decimal('sueldo_base_mensual', { precision: 14, scale: 2 })`
- `fechaCese: date('fecha_cese')`
- `asignacionFamiliar: boolean('asignacion_familiar').notNull().default(false)`

Added to `configPlanilla` table (uit already existed; only added the new 3):
- `rmv: decimal('rmv', { precision: 14, scale: 2 }).notNull().default('1025')`
- `topeSeguroAfp: decimal('tope_seguro_afp', { precision: 14, scale: 2 }).notNull().default('12786.4')`
- `horasMesBase: integer('horas_mes_base').notNull().default(240)`

Added new tables after `planillaDetalle` block:
- `planillaOficinaMes` + type `PlanillaOficinaMes`
- `planillaOficinaDetalle` + type `PlanillaOficinaDetalle`
- `adelantoOficina` + type `AdelantoOficina`
- `adelantoCuotaAplicada` + type `AdelantoCuotaAplicada`
- `descuentoOficina` + type `DescuentoOficina`
- `documentoAdjunto` + type `DocumentoAdjunto`

### Step 4 — ORM verification (verbatim output)

```
planillaOficinaMes 0
planillaOficinaDetalle 0
adelantoOficina 0
adelantoCuotaAplicada 0
descuentoOficina 0
documentoAdjunto 0
```

All 6 tables queried successfully with no column-name mismatch errors.

### Step 5 — Commit

```
[feat/rbac-multiempresa b5efeab] feat(oficina): schema planilla de oficina + adelantos + documento_adjunto
 2 files changed, 398 insertions(+), 1 deletion(-)
 create mode 100644 apps/backend/scripts/oficina/2026-09-10-planilla-oficina-schema.sql
```

---

## Deviations

- `uit` column in `config_planilla` was already defined in the ORM (`configPlanilla.uit` line 1054 of original schema.ts). The SQL's `ALTER TABLE config_planilla ADD COLUMN IF NOT EXISTS uit` produced a NOTICE (not an error) and was skipped. The ORM was NOT re-added for `uit` since it was already present — this is correct behavior.
- The `configPlanilla` ORM received only 3 new columns (`rmv`, `topeSeguroAfp`, `horasMesBase`), not 4, because `uit` was pre-existing.

---

## Concerns

None. All steps clean.
