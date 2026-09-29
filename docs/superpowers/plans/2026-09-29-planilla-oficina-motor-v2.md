# Planilla de Oficina · Motor v2 (F1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescribir el motor de planilla de oficina para que cuadre exacto (S/ 0.01) con el Excel real de julio 2026 y soporte los casos reales de la empresa, sin obras/contabilidad/pagos/Zlink todavía.

**Architecture:** Motor puro (`planillaOficinaCalc.ts`, `rta5taCalc.ts`) que recibe tasas ya resueltas y devuelve un resultado estructurado; parámetros legales versionados por vigencia; renta 5ta con baseline importado + ledger por mes (idempotente); snapshot autosuficiente por mes. Las rutas `calcular`/`cerrar` arman el snapshot y persisten.

**Tech Stack:** TypeScript ESM (imports con `.js`), tsx (backend sin `tsc build`), Drizzle ORM + `postgres`, tests con `node:assert/strict` corridos por `npx tsx scripts/oficina/test-*.ts`.

**Spec:** `docs/superpowers/specs/2026-09-29-planilla-oficina-motor-v2-design.md`

## Global Constraints

- Backend corre con **tsx** (sin `tsc build`); typecheck aparte. Imports relativos con extensión `.js`.
- DB de trabajo: **erp_mmh_test** vía `DATABASE_URL` en `.env`. Scripts que tocan DB se corren con `DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx ...`. El motor puro NO toca DB.
- Tolerancia de aceptación: **S/ 0.01**.
- Parámetros legales **versionados por vigencia**, nunca hardcodeados en el motor.
- **Kelly override gana**: `renta5taManual` tiene prioridad sobre la sugerencia.
- El Excel **valida**, no es fuente de verdad. Fuente de verdad = inputs + params vigentes + reglas + snapshot.
- Migraciones **aditivas e idempotentes** (patrón `alter-*.ts`, `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
- Valores legales 2026 (verbatim del spec): RMV 1130 (desde 2025-01-01) → 1300 (desde 2026-10-01); AFP aporte 0.10; seguro 0.0137; tope RMA 12599.27; comisión flujo Habitat 0.0147 · Integra 0.0155 · Prima 0.0160 · Profuturo 0.0169; ONP 0.13; EsSalud 0.09; asig. familiar 0.10 × RMV; UIT 5350.

## Review Focus

- **Cambio de RMV set→oct (frontera de vigencia):** una planilla de octubre 2026 debe resolver RMV 1300 y una de setiembre 1130. Test en Task 5.
- **Gratificación nunca grava:** con `gratificacion > 0`, `baseAfp/baseOnp/baseEssalud` no cambian y se agrega bonif. extraordinaria 9%. Test en Task 2.
- **Idempotencia del cierre:** recerrar el mismo mes 2× deja el YTD igual (no `+=` duplicado). Test en Task 4 y Task 7.
- **Override de Kelly:** si `renta5taManual=true`, la sugerencia del motor se ignora. Test en Task 6.
- **Empleado sin baseline importado:** `getYtd` devuelve acumulado 0 y retenciones 0 (no error). Test en Task 4.

---

## Task 1: Migración de esquema v2 + seed

**Files:**
- Create: `packages/db/src/alter-planilla-oficina-v2.ts`
- Modify: `packages/db/src/schema.ts` (drizzle defs para los nuevos campos/tablas)

**Interfaces:**
- Produces (tablas/columnas): `empleados.afp_comision_tipo`, `empleados.modalidad_formativa`; `afp_tasas.pct_comision_flujo`, `afp_tasas.pct_comision_mixta`; tablas `param_legal_oficina`, `renta5ta_baseline`, `renta5ta_mes`; columna `planilla_oficina_mes.calculo_snapshot` (jsonb).

- [ ] **Step 1: Escribir el script de migración**

Create `packages/db/src/alter-planilla-oficina-v2.ts` (copia el encabezado de `alter-asistencia.ts` para dotenv + postgres):

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_mmh', { max: 1 });

const stmts = [
  `ALTER TABLE empleados ADD COLUMN IF NOT EXISTS afp_comision_tipo varchar(8) NOT NULL DEFAULT 'saldo';`,
  `ALTER TABLE empleados ADD COLUMN IF NOT EXISTS modalidad_formativa boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE afp_tasas ADD COLUMN IF NOT EXISTS pct_comision_flujo decimal(6,4) NOT NULL DEFAULT 0;`,
  `ALTER TABLE afp_tasas ADD COLUMN IF NOT EXISTS pct_comision_mixta decimal(6,4) NOT NULL DEFAULT 0;`,
  `ALTER TABLE planilla_oficina_mes ADD COLUMN IF NOT EXISTS calculo_snapshot jsonb;`,
  `CREATE TABLE IF NOT EXISTS param_legal_oficina (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     fecha_vigencia date NOT NULL UNIQUE,
     rmv decimal(14,2) NOT NULL, uit decimal(14,2) NOT NULL, tope_rma decimal(14,2) NOT NULL,
     pct_essalud decimal(6,4) NOT NULL, pct_onp decimal(6,4) NOT NULL,
     pct_afp_aporte decimal(6,4) NOT NULL, pct_asig_familiar decimal(6,4) NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS renta5ta_baseline (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     empleado_id uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
     anio int NOT NULL,
     acumulado_importado decimal(14,2) NOT NULL DEFAULT 0,
     retenciones_importadas decimal(14,2) NOT NULL DEFAULT 0,
     importado_por uuid, importado_en timestamp DEFAULT now(),
     UNIQUE(empleado_id, anio)
   );`,
  `CREATE TABLE IF NOT EXISTS renta5ta_mes (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     empleado_id uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
     planilla_mes_id uuid NOT NULL REFERENCES planilla_oficina_mes(id) ON DELETE CASCADE,
     anio int NOT NULL, mes_numero int NOT NULL,
     remun_computable decimal(14,2) NOT NULL DEFAULT 0,
     retencion decimal(14,2) NOT NULL DEFAULT 0,
     UNIQUE(empleado_id, planilla_mes_id)
   );`,
  `CREATE INDEX IF NOT EXISTS r5m_emp_anio_idx ON renta5ta_mes (empleado_id, anio, mes_numero);`,
  // seed param_legal (idempotente por UNIQUE fecha_vigencia)
  `INSERT INTO param_legal_oficina (fecha_vigencia, rmv, uit, tope_rma, pct_essalud, pct_onp, pct_afp_aporte, pct_asig_familiar)
     VALUES ('2025-01-01', 1130, 5350, 12599.27, 0.09, 0.13, 0.10, 0.10)
     ON CONFLICT (fecha_vigencia) DO NOTHING;`,
  `INSERT INTO param_legal_oficina (fecha_vigencia, rmv, uit, tope_rma, pct_essalud, pct_onp, pct_afp_aporte, pct_asig_familiar)
     VALUES ('2026-10-01', 1300, 5350, 12599.27, 0.09, 0.13, 0.10, 0.10)
     ON CONFLICT (fecha_vigencia) DO NOTHING;`,
  // seed comisión flujo por AFP (mixta a completar por Kelly después)
  `UPDATE afp_tasas SET pct_comision_flujo = 0.0147 WHERE afp ILIKE '%habitat%';`,
  `UPDATE afp_tasas SET pct_comision_flujo = 0.0155 WHERE afp ILIKE '%integra%';`,
  `UPDATE afp_tasas SET pct_comision_flujo = 0.0160 WHERE afp ILIKE '%prima%';`,
  `UPDATE afp_tasas SET pct_comision_flujo = 0.0169 WHERE afp ILIKE '%profuturo%';`,
  `UPDATE afp_tasas SET pct_seguro = 0.0137 WHERE pct_seguro IS NULL OR pct_seguro = 0;`,
];
for (const s of stmts) { await sql.unsafe(s); console.log('✓', s.slice(0, 60).replace(/\s+/g, ' ')); }
console.log('✅ planilla oficina v2 listo');
await sql.end();
process.exit(0);
```

- [ ] **Step 2: Correr la migración**

Run: `cd apps/backend && DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx ../../packages/db/src/alter-planilla-oficina-v2.ts`
Expected: imprime `✓` por cada statement y `✅ planilla oficina v2 listo`.

- [ ] **Step 3: Verificar columnas/tablas**

Run: `DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx -e "import postgres from 'postgres'; const s=postgres(process.env.DATABASE_URL); console.log(await s\`SELECT count(*) FROM param_legal_oficina\`); await s.end()"`
Expected: `[ { count: '2' } ]` (las 2 filas de RMV sembradas).

- [ ] **Step 4: Agregar defs Drizzle en `schema.ts`**

Añade a `packages/db/src/schema.ts`: columnas `afpComisionTipo`/`modalidadFormativa` en `empleados`; `pctComisionFlujo`/`pctComisionMixta` en `afpTasas`; `calculoSnapshot` (jsonb) en `planillaOficinaMes`; y las tablas `paramLegalOficina`, `renta5taBaseline`, `renta5taMes` con sus `$inferSelect` types (sigue el estilo de las tablas vecinas).

- [ ] **Step 5: Typecheck de los nuevos tipos**

Run: `cd apps/backend && npx tsc --noEmit 2>&1 | grep -E "schema.ts|planillaOficina" | head`
Expected: sin errores nuevos atribuibles a estas defs (la deuda de tipos preexistente se ignora).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/alter-planilla-oficina-v2.ts packages/db/src/schema.ts
git commit -m "feat(planilla-oficina): esquema v2 (params vigencia, renta5ta baseline+ledger, comision afp)"
```

---

## Task 2: Motor puro `planillaOficinaCalc.ts` v2

**Files:**
- Modify: `apps/backend/src/lib/planillaOficinaCalc.ts`
- Test: `apps/backend/scripts/oficina/test-calc.ts` (reescribir asserts al resultado estructurado + fixture 17 + reconciliación)

**Interfaces:**
- Consumes: nada (función pura).
- Produces:
```ts
export type ComisionTipo = 'flujo' | 'mixta' | 'saldo';
export type AfpTasa2 = { pctAporte: number; pctSeguro: number; pctComisionFlujo: number; pctComisionMixta: number };
export type TasasOficina = { rmv: number; uit: number; topeRma: number; pctEssalud: number; pctOnp: number; pctAfpAporte: number; pctAsigFamiliar: number; afp?: AfpTasa2 };
export type DetalleInput = { sueldoMensual: number; sistemaPension: 'AFP'|'ONP'; afpComisionTipo?: ComisionTipo; asignacionFamiliar?: boolean; modalidadFormativa?: boolean; cantHe25?: number; cantHe35?: number; dominical?: number; feriado?: number; gratificacion?: number; vacaciones?: number; comisiones?: number; bonificacion?: number; imptoRenta5ta?: number; retencionJudicial?: number; adelantoCuota?: number; otrosDescuentos?: number; diasTrab?: number; diasMes?: number };
export type ResultadoOficina = {
  bases: { remuneracionAfecta: number; baseAfp: number; baseOnp: number; baseEssalud: number; baseRenta5ta: number };
  descuentos: { afpAporte: number; afpSeguro: number; afpComision: number; onp: number; renta5ta: number; retencionJudicial: number; adelanto: number; otros: number };
  aportesEmpleador: { essalud: number };
  ingresos: { remuneracion: number; gratificacionInafecta: number; bonificacionExtraordinaria: number };
  totales: { bruto: number; descuentos: number; neto: number; costoEmpleador: number };
  // compat plano para el mapeo a detalle (mismos nombres que hoy):
  sueldoBase: number; valorHora: number; montoHe25: number; montoHe35: number; totalHe: number; asigFamiliar: number;
  totalBruto: number; onp: number; afpAporte: number; afpSeguro: number; afpComision: number;
  imptoRenta5ta: number; totalDescuento: number; essalud: number; netoPago: number; costoTotal: number;
  diasTrab: number; horasTrab: number;
};
export function calcularDetalleOficina(i: DetalleInput, t: TasasOficina): ResultadoOficina;
```

- [ ] **Step 1: Reescribir el test con el resultado estructurado, fixture y reconciliación**

Reemplaza `apps/backend/scripts/oficina/test-calc.ts`:

```ts
import assert from 'node:assert/strict';
import { calcularDetalleOficina, type TasasOficina, type DetalleInput } from '../../src/lib/planillaOficinaCalc.js';

const AFP = { pctAporte: 0.10, pctSeguro: 0.0137, pctComisionFlujo: 0.0169, pctComisionMixta: 0.0107 };
const T: TasasOficina = { rmv: 1130, uit: 5350, topeRma: 12599.27, pctEssalud: 0.09, pctOnp: 0.13, pctAfpAporte: 0.10, pctAsigFamiliar: 0.10, afp: AFP };
const near = (a: number, b: number, m = 0.01) => Math.abs(a - b) <= m;

// Fixture: 4 boletas reales de julio 2026 (subset representativo del Excel)
type Caso = { n: string; in: DetalleInput; bruto: number; afpAp: number; afpSeg: number; afpCom: number; onp: number; essalud: number; neto: number };
const casos: Caso[] = [
  // García: AFP saldo, seguro topeado, renta manual 1120
  { n: 'Garcia', in: { sueldoMensual: 12850, sistemaPension: 'AFP', afpComisionTipo: 'saldo', imptoRenta5ta: 1120 }, bruto: 12850, afpAp: 1285, afpSeg: 172.61, afpCom: 0, onp: 0, essalud: 1156.5, neto: 10272.39 },
  // Huerta: AFP flujo 1.69%, sueldo = RMV
  { n: 'Huerta', in: { sueldoMensual: 1130, sistemaPension: 'AFP', afpComisionTipo: 'flujo' }, bruto: 1130, afpAp: 113, afpSeg: 15.48, afpCom: 19.10, onp: 0, essalud: 101.70, neto: 982.42 },
  // Bautista: ONP 13%, renta manual 15
  { n: 'Bautista', in: { sueldoMensual: 5000, sistemaPension: 'ONP', imptoRenta5ta: 15 }, bruto: 5000, afpAp: 0, afpSeg: 0, afpCom: 0, onp: 650, essalud: 450, neto: 4335 },
  // Yangari: ONP, cese a 29 días (prorrateo), mes 31 días
  { n: 'Yangari', in: { sueldoMensual: 3100, sistemaPension: 'ONP', diasTrab: 29, diasMes: 31 }, bruto: 2900, afpAp: 0, afpSeg: 0, afpCom: 0, onp: 377, essalud: 261, neto: 2523 },
];

for (const c of casos) {
  const r = calcularDetalleOficina(c.in, T);
  assert.ok(near(r.totales.bruto, c.bruto), `${c.n} bruto ${r.totales.bruto}≠${c.bruto}`);
  assert.ok(near(r.descuentos.afpAporte, c.afpAp), `${c.n} afpAp ${r.descuentos.afpAporte}`);
  assert.ok(near(r.descuentos.afpSeguro, c.afpSeg), `${c.n} afpSeg ${r.descuentos.afpSeguro}`);
  assert.ok(near(r.descuentos.afpComision, c.afpCom), `${c.n} afpCom ${r.descuentos.afpComision}`);
  assert.ok(near(r.descuentos.onp, c.onp), `${c.n} onp ${r.descuentos.onp}`);
  assert.ok(near(r.aportesEmpleador.essalud, c.essalud), `${c.n} essalud ${r.aportesEmpleador.essalud}`);
  assert.ok(near(r.totales.neto, c.neto), `${c.n} neto ${r.totales.neto}`);
  // Reconciliación interna
  assert.ok(near(r.totales.bruto - r.totales.descuentos, r.totales.neto), `${c.n} bruto-dscto≠neto`);
  assert.ok(near(r.totales.bruto + r.aportesEmpleador.essalud, r.totales.costoEmpleador), `${c.n} costo`);
  assert.ok(near(r.descuentos.afpAporte + r.descuentos.afpSeguro + r.descuentos.afpComision + r.descuentos.onp + r.descuentos.renta5ta, r.totales.descuentos), `${c.n} suma dsctos`);
}

// Gratificación INAFECTA: bases no cambian, bonif extraordinaria 9%
const g = calcularDetalleOficina({ sueldoMensual: 5000, sistemaPension: 'AFP', afpComisionTipo: 'saldo', gratificacion: 5000 }, T);
assert.ok(near(g.bases.baseAfp, 5000), `grati grava AFP: ${g.bases.baseAfp}`);      // NO incluye la grati
assert.ok(near(g.bases.baseEssalud, 5000), `grati grava EsSalud: ${g.bases.baseEssalud}`);
assert.ok(near(g.ingresos.bonificacionExtraordinaria, 450), `bonif 9%: ${g.ingresos.bonificacionExtraordinaria}`);
assert.ok(near(g.descuentos.afpAporte, 500), `afp sobre afecta 5000: ${g.descuentos.afpAporte}`);
assert.ok(near(g.totales.bruto, 5000 + 5000 + 450), `bruto con grati+bonif: ${g.totales.bruto}`);

// Piso RMV en EsSalud: sueldo < RMV → base = RMV
const bajo = calcularDetalleOficina({ sueldoMensual: 800, sistemaPension: 'ONP', diasTrab: 20, diasMes: 30 }, T);
assert.ok(near(bajo.bases.baseEssalud, 1130), `piso RMV: ${bajo.bases.baseEssalud}`); // afecta 533.33 < RMV
assert.ok(near(bajo.aportesEmpleador.essalud, 101.70), `essalud piso: ${bajo.aportesEmpleador.essalud}`);

// Practicante en modalidad formativa: sin aportes
const prac = calcularDetalleOficina({ sueldoMensual: 1130, sistemaPension: 'AFP', modalidadFormativa: true }, T);
assert.equal(prac.descuentos.afpAporte, 0);
assert.equal(prac.aportesEmpleador.essalud, 0);

console.log('calc VERDE'); process.exit(0);
```

- [ ] **Step 2: Correr el test y verificar que FALLA**

Run: `cd apps/backend && npx tsx scripts/oficina/test-calc.ts`
Expected: FALLA (el motor viejo no expone `.bases`/`.totales`/`afpComisionTipo`).

- [ ] **Step 3: Reescribir `planillaOficinaCalc.ts`**

Reemplaza el cuerpo con la lógica de bases independientes:

```ts
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export function calcularDetalleOficina(i: DetalleInput, t: TasasOficina): ResultadoOficina {
  const n = (x?: number) => Number(x ?? 0);
  const diasMes = i.diasMes && i.diasMes > 0 ? i.diasMes : 30;
  const diasTrab = i.diasTrab != null ? Math.min(Math.max(n(i.diasTrab), 0), diasMes) : diasMes;
  const factor = diasTrab / diasMes;
  const sueldoBase = r2(i.sueldoMensual * factor);
  const vhRaw = diasMes > 0 ? (i.sueldoMensual * factor) / (diasMes * 8) : 0;
  const montoHe25 = r2(n(i.cantHe25) * vhRaw * 1.25);
  const montoHe35 = r2(n(i.cantHe35) * vhRaw * 1.35);
  const totalHe = r2(montoHe25 + montoHe35);
  const asigFamiliar = i.asignacionFamiliar ? r2(t.rmv * t.pctAsigFamiliar * factor) : 0;

  // Bases independientes — la gratificación NO grava
  const remuneracionAfecta = r2(sueldoBase + totalHe + n(i.dominical) + n(i.feriado) + asigFamiliar + n(i.vacaciones) + n(i.comisiones) + n(i.bonificacion));
  const gratificacionInafecta = r2(n(i.gratificacion));
  const bonificacionExtraordinaria = r2(gratificacionInafecta * 0.09);
  const baseAfp = remuneracionAfecta;
  const baseOnp = remuneracionAfecta;
  const baseEssalud = Math.max(remuneracionAfecta, remuneracionAfecta > 0 ? t.rmv : 0);
  const baseRenta5ta = r2(remuneracionAfecta + gratificacionInafecta + bonificacionExtraordinaria);

  let onp = 0, afpAporte = 0, afpSeguro = 0, afpComision = 0, essalud = 0;
  if (!i.modalidadFormativa) {
    if (i.sistemaPension === 'ONP') {
      onp = r2(baseOnp * t.pctOnp);
    } else {
      afpAporte = r2(baseAfp * t.pctAfpAporte);
      afpSeguro = r2(Math.min(baseAfp, t.topeRma) * (t.afp?.pctSeguro ?? 0));
      const pc = i.afpComisionTipo === 'flujo' ? (t.afp?.pctComisionFlujo ?? 0)
               : i.afpComisionTipo === 'mixta' ? (t.afp?.pctComisionMixta ?? 0) : 0;
      afpComision = r2(baseAfp * pc);
    }
    essalud = r2(baseEssalud * t.pctEssalud);
  }

  const renta = n(i.imptoRenta5ta), judicial = n(i.retencionJudicial), adel = n(i.adelantoCuota), otros = n(i.otrosDescuentos);
  const totalDescuento = r2(onp + afpAporte + afpSeguro + afpComision + renta + judicial + adel + otros);
  const bruto = r2(remuneracionAfecta + gratificacionInafecta + bonificacionExtraordinaria);
  const neto = r2(bruto - totalDescuento);
  const costo = r2(bruto + essalud);

  return {
    bases: { remuneracionAfecta, baseAfp, baseOnp, baseEssalud, baseRenta5ta },
    descuentos: { afpAporte, afpSeguro, afpComision, onp, renta5ta: renta, retencionJudicial: judicial, adelanto: adel, otros },
    aportesEmpleador: { essalud },
    ingresos: { remuneracion: remuneracionAfecta, gratificacionInafecta, bonificacionExtraordinaria },
    totales: { bruto, descuentos: totalDescuento, neto, costoEmpleador: costo },
    // compat plano
    sueldoBase, valorHora: r4(vhRaw), montoHe25, montoHe35, totalHe, asigFamiliar,
    totalBruto: bruto, onp, afpAporte, afpSeguro, afpComision,
    imptoRenta5ta: renta, totalDescuento, essalud, netoPago: neto, costoTotal: costo,
    diasTrab, horasTrab: diasTrab * 8,
  };
}
```

- [ ] **Step 4: Correr el test y verificar que PASA**

Run: `cd apps/backend && npx tsx scripts/oficina/test-calc.ts`
Expected: `calc VERDE`.

- [ ] **Step 5: Verificar que no rompí callers del tipo viejo**

Run: `cd apps/backend && npx tsc --noEmit 2>&1 | grep -E "planillaOficina.ts" | grep -iE "TasasOficina|calcularDetalle|topeSeguroAfp|pctComision\b" | head`
Expected: si aparece un error por el rename de tasas, se resuelve en Task 6 (ruta calcular). Anota los que salgan; no toques la ruta aún.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/lib/planillaOficinaCalc.ts apps/backend/scripts/oficina/test-calc.ts
git commit -m "feat(planilla-oficina): motor v2 con bases independientes, comision afp por tipo y piso RMV"
```

---

## Task 3: Motor puro `rta5taCalc.ts` v2 (acumulado real + fecha de ingreso)

**Files:**
- Modify: `apps/backend/src/lib/rta5taCalc.ts`
- Test: `apps/backend/scripts/oficina/test-rta5ta.ts`

**Interfaces:**
- Consumes: nada (puro).
- Produces: `Rta5taInput` gana `mesIngreso?: number` (1..12, default 1). El resto igual (`sueldoMensual`, `mesNumero`, `acumuladoPercibidoAntes`, `retencionesPrevias`, `uit`). `mesesRestantes` y `nGrati` se ajustan por `mesIngreso`.

- [ ] **Step 1: Escribir el test de alta a mitad de año**

Añade a `apps/backend/scripts/oficina/test-rta5ta.ts` un caso: empleado que ingresa en mayo (`mesIngreso: 5`), calculando julio, con `acumuladoPercibidoAntes` real de may+jun. Verifica que `proyeccionAnual` cuenta solo may→dic (8 meses) y las 2 gratis (jul, dic), no 12 meses.

```ts
import assert from 'node:assert/strict';
import { calcularRta5ta } from '../../src/lib/rta5taCalc.js';
const near = (a: number, b: number, m = 1) => Math.abs(a - b) <= m;

// Alta en mayo, sueldo 5000, calculando julio; acumulado may+jun = 10000
const r = calcularRta5ta({ sueldoMensual: 5000, mesNumero: 7, mesIngreso: 5, acumuladoPercibidoAntes: 10000, retencionesPrevias: 0, uit: 5350 });
// Proyección = 10000 (may+jun) + 5000×6 (jul..dic) + 2×5000 (gratis) + 2×450 (bonif 9%) = 51000+... 
assert.ok(near(r.proyeccionAnual, 10000 + 30000 + 10000 + 900), `proy ${r.proyeccionAnual}`);
assert.ok(r.rentaNeta <= 0 ? r.retencionMes === 0 : r.retencionMes >= 0, 'retencion no negativa');
console.log('rta5ta VERDE'); process.exit(0);
```

- [ ] **Step 2: Correr el test y verificar que FALLA**

Run: `cd apps/backend && npx tsx scripts/oficina/test-rta5ta.ts`
Expected: FALLA (`mesIngreso` no existe; proyección usa 12 meses).

- [ ] **Step 3: Ajustar `rta5taCalc.ts`**

Añade `mesIngreso?: number` al input y úsalo:

```ts
const mesIngreso = Math.min(Math.max(i.mesIngreso ?? 1, 1), 12);
const gratiMeses = [7, 12];
const nGrati = i.gratificacionesPorPercibir ?? gratiMeses.filter((m) => m >= mesNumero && m >= mesIngreso).length;
const mesesRestantes = 12 - mesNumero + 1; // meses aún por percibir desde el mes en curso
// (acumuladoPercibidoAntes ya trae solo lo percibido desde el ingreso — no se recalcula aquí)
```

El resto del algoritmo (proyección, 7 UIT, escala progresiva, divisor SUNAT) queda igual.

- [ ] **Step 4: Correr el test y verificar que PASA**

Run: `cd apps/backend && npx tsx scripts/oficina/test-rta5ta.ts`
Expected: `rta5ta VERDE`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/rta5taCalc.ts apps/backend/scripts/oficina/test-rta5ta.ts
git commit -m "feat(planilla-oficina): rta5ta considera mes de ingreso para altas a mitad de año"
```

---

## Task 4: Capa de datos de renta 5ta (baseline + ledger)

**Files:**
- Create: `apps/backend/src/lib/renta5taYtd.ts`
- Test: `apps/backend/scripts/oficina/test-renta5ta-ytd.ts`

**Interfaces:**
- Consumes: `db`, `schema` (`renta5taBaseline`, `renta5taMes`).
- Produces:
```ts
export async function getYtd(empleadoId: string, anio: number, mesNumero: number): Promise<{ acumuladoPercibido: number; retencionesPrevias: number }>;
export async function upsertLedgerMes(args: { empleadoId: string; planillaMesId: string; anio: number; mesNumero: number; remunComputable: number; retencion: number }): Promise<void>;
```
`getYtd` = baseline(anio) + SUM(renta5ta_mes con mes_numero < mesNumero). `upsertLedgerMes` = INSERT ON CONFLICT(empleado_id, planilla_mes_id) DO UPDATE.

- [ ] **Step 1: Escribir el test (DB): baseline vacío, upsert, idempotencia, corrección**

Create `apps/backend/scripts/oficina/test-renta5ta-ytd.ts`:

```ts
import assert from 'node:assert/strict';
import { db, schema } from '@erp/db';
import { eq, inArray } from 'drizzle-orm';
import { getYtd, upsertLedgerMes } from '../../src/lib/renta5taYtd.js';

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;
// empleado real de prueba
const [emp] = await db.select({ id: schema.empleados.id }).from(schema.empleados).limit(1);
const empId = emp!.id;
const [mes] = await db.select({ id: schema.planillaOficinaMes.id }).from(schema.planillaOficinaMes).limit(1);
const mesId = mes!.id;

// 1. Sin baseline ni ledger → 0/0 (no error)
await db.delete(schema.renta5taMes).where(eq(schema.renta5taMes.empleadoId, empId));
await db.delete(schema.renta5taBaseline).where(eq(schema.renta5taBaseline.empleadoId, empId));
let y = await getYtd(empId, 2026, 7);
assert.ok(near(y.acumuladoPercibido, 0) && near(y.retencionesPrevias, 0), 'sin datos → 0/0');

// 2. Con baseline (ene-jun importado)
await db.insert(schema.renta5taBaseline).values({ empleadoId: empId, anio: 2026, acumuladoImportado: '30000', retencionesImportadas: '500' });
y = await getYtd(empId, 2026, 7);
assert.ok(near(y.acumuladoPercibido, 30000) && near(y.retencionesPrevias, 500), 'baseline');

// 3. Upsert mes 6 → suma al YTD de julio; recerrar (2x) NO duplica
await upsertLedgerMes({ empleadoId: empId, planillaMesId: mesId, anio: 2026, mesNumero: 6, remunComputable: 5000, retencion: 100 });
await upsertLedgerMes({ empleadoId: empId, planillaMesId: mesId, anio: 2026, mesNumero: 6, remunComputable: 5000, retencion: 100 });
y = await getYtd(empId, 2026, 7);
assert.ok(near(y.acumuladoPercibido, 35000) && near(y.retencionesPrevias, 600), `idempotente ${y.acumuladoPercibido}/${y.retencionesPrevias}`);

// 4. Corrección del mes 6 (mismo planilla_mes_id) → recalcula, no acumula
await upsertLedgerMes({ empleadoId: empId, planillaMesId: mesId, anio: 2026, mesNumero: 6, remunComputable: 4000, retencion: 80 });
y = await getYtd(empId, 2026, 7);
assert.ok(near(y.acumuladoPercibido, 34000) && near(y.retencionesPrevias, 580), `correccion ${y.acumuladoPercibido}`);

// limpieza
await db.delete(schema.renta5taMes).where(eq(schema.renta5taMes.empleadoId, empId));
await db.delete(schema.renta5taBaseline).where(eq(schema.renta5taBaseline.empleadoId, empId));
console.log('renta5ta-ytd VERDE'); process.exit(0);
```

- [ ] **Step 2: Correr el test y verificar que FALLA**

Run: `cd apps/backend && DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx scripts/oficina/test-renta5ta-ytd.ts`
Expected: FALLA (módulo `renta5taYtd.js` no existe).

- [ ] **Step 3: Implementar `renta5taYtd.ts`**

```ts
import { db, schema } from '@erp/db';
import { and, eq, lt, sql } from 'drizzle-orm';

export async function getYtd(empleadoId: string, anio: number, mesNumero: number) {
  const [base] = await db.select().from(schema.renta5taBaseline)
    .where(and(eq(schema.renta5taBaseline.empleadoId, empleadoId), eq(schema.renta5taBaseline.anio, anio))).limit(1);
  const [agg] = await db.select({
    remun: sql<string>`coalesce(sum(${schema.renta5taMes.remunComputable}), 0)`,
    ret: sql<string>`coalesce(sum(${schema.renta5taMes.retencion}), 0)`,
  }).from(schema.renta5taMes)
    .where(and(eq(schema.renta5taMes.empleadoId, empleadoId), eq(schema.renta5taMes.anio, anio), lt(schema.renta5taMes.mesNumero, mesNumero)));
  return {
    acumuladoPercibido: Number(base?.acumuladoImportado ?? 0) + Number(agg?.remun ?? 0),
    retencionesPrevias: Number(base?.retencionesImportadas ?? 0) + Number(agg?.ret ?? 0),
  };
}

export async function upsertLedgerMes(a: { empleadoId: string; planillaMesId: string; anio: number; mesNumero: number; remunComputable: number; retencion: number }) {
  await db.insert(schema.renta5taMes).values({
    empleadoId: a.empleadoId, planillaMesId: a.planillaMesId, anio: a.anio, mesNumero: a.mesNumero,
    remunComputable: String(a.remunComputable), retencion: String(a.retencion),
  }).onConflictDoUpdate({
    target: [schema.renta5taMes.empleadoId, schema.renta5taMes.planillaMesId],
    set: { remunComputable: String(a.remunComputable), retencion: String(a.retencion), anio: a.anio, mesNumero: a.mesNumero },
  });
}
```

- [ ] **Step 4: Correr el test y verificar que PASA**

Run: `cd apps/backend && DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx scripts/oficina/test-renta5ta-ytd.ts`
Expected: `renta5ta-ytd VERDE`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/renta5taYtd.ts apps/backend/scripts/oficina/test-renta5ta-ytd.ts
git commit -m "feat(planilla-oficina): renta5ta YTD baseline+ledger idempotente"
```

---

## Task 5: Resolvers de parámetros legales y tasas AFP

**Files:**
- Create: `apps/backend/src/lib/paramLegalOficina.ts`
- Test: `apps/backend/scripts/oficina/test-param-legal.ts`

**Interfaces:**
- Produces:
```ts
export async function resolverParamLegal(fechaAplicacion: string): Promise<{ rmv: number; uit: number; topeRma: number; pctEssalud: number; pctOnp: number; pctAfpAporte: number; pctAsigFamiliar: number; fechaVigencia: string }>;
export async function cargarTasasAfp(): Promise<Record<string, { pctAporte: number; pctSeguro: number; pctComisionFlujo: number; pctComisionMixta: number }>>; // key = nombre AFP normalizado
```
`resolverParamLegal` = fila con `max(fecha_vigencia) <= fechaAplicacion`.

- [ ] **Step 1: Escribir el test de frontera de vigencia**

```ts
import assert from 'node:assert/strict';
import { resolverParamLegal } from '../../src/lib/paramLegalOficina.js';
const sep = await resolverParamLegal('2026-09-01');
assert.equal(Number(sep.rmv), 1130, `set RMV ${sep.rmv}`);
const oct = await resolverParamLegal('2026-10-01');
assert.equal(Number(oct.rmv), 1300, `oct RMV ${oct.rmv}`);
const nov = await resolverParamLegal('2026-11-01');
assert.equal(Number(nov.rmv), 1300, `nov RMV ${nov.rmv}`);
console.log('param-legal VERDE'); process.exit(0);
```

- [ ] **Step 2: Correr y verificar que FALLA**

Run: `cd apps/backend && DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx scripts/oficina/test-param-legal.ts`
Expected: FALLA (módulo no existe).

- [ ] **Step 3: Implementar `paramLegalOficina.ts`**

```ts
import { db, schema } from '@erp/db';
import { desc, lte } from 'drizzle-orm';

export async function resolverParamLegal(fechaAplicacion: string) {
  const [row] = await db.select().from(schema.paramLegalOficina)
    .where(lte(schema.paramLegalOficina.fechaVigencia, fechaAplicacion))
    .orderBy(desc(schema.paramLegalOficina.fechaVigencia)).limit(1);
  if (!row) throw new Error(`Sin parámetros legales vigentes para ${fechaAplicacion}`);
  return {
    rmv: Number(row.rmv), uit: Number(row.uit), topeRma: Number(row.topeRma),
    pctEssalud: Number(row.pctEssalud), pctOnp: Number(row.pctOnp),
    pctAfpAporte: Number(row.pctAfpAporte), pctAsigFamiliar: Number(row.pctAsigFamiliar),
    fechaVigencia: String(row.fechaVigencia),
  };
}

const normAfp = (s: string) => s.replace(/\s*\([FM]\)\s*$/i, '').trim().toUpperCase();
export async function cargarTasasAfp() {
  const rows = await db.select().from(schema.afpTasas);
  const out: Record<string, { pctAporte: number; pctSeguro: number; pctComisionFlujo: number; pctComisionMixta: number }> = {};
  for (const r of rows) out[normAfp(r.afp)] = {
    pctAporte: Number(r.pctAporte), pctSeguro: Number(r.pctSeguro),
    pctComisionFlujo: Number(r.pctComisionFlujo), pctComisionMixta: Number(r.pctComisionMixta),
  };
  return out;
}
```

- [ ] **Step 4: Correr y verificar que PASA**

Run: `cd apps/backend && DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx scripts/oficina/test-param-legal.ts`
Expected: `param-legal VERDE`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/paramLegalOficina.ts apps/backend/scripts/oficina/test-param-legal.ts
git commit -m "feat(planilla-oficina): resolver de params legales por vigencia + carga tasas AFP"
```

---

## Task 6: Ruta `calcular` v2 — arma snapshot, cuadra el Excel

**Files:**
- Modify: `apps/backend/src/routes/planillaOficina.ts` (endpoint `POST /planilla/:mesId/calcular` y helpers de tasas)
- Test: `apps/backend/scripts/oficina/test-planilla-flow.ts` (extender: calcular julio → detalle cuadra Excel)

**Interfaces:**
- Consumes: `calcularDetalleOficina` (Task 2), `resolverParamLegal`/`cargarTasasAfp` (Task 5), `getYtd`/`calcularRta5ta` (Tasks 3-4).
- Produces: `calcular` escribe `planilla_oficina_mes.calculo_snapshot` y `planilla_oficina_detalle` con las cifras v2; preserva `renta5taManual`.

- [ ] **Step 1: Escribir/extender el test de integración**

Extiende `test-planilla-flow.ts`: siembra los 17 empleados de julio (reusa `seed-julio-2026.ts` si aplica), crea el mes `2026-07`, llama al calcular, y compara al menos 4 detalles (García/Huerta/Bautista/Yangari) contra las cifras del Excel (tol. 0.01) y la reconciliación `SUM(neto detalles) = total`.

```ts
// ...setup: obtener mesId de 2026-07, correr calcular...
const dets = await db.select().from(schema.planillaOficinaDetalle).where(eq(schema.planillaOficinaDetalle.planillaMesId, mesId));
const byDni = Object.fromEntries(dets.map(d => [d.dni, d]));
assert.ok(Math.abs(Number(byDni['48448443'].netoPago) - 10272.39) <= 0.01, 'Garcia neto');
assert.ok(Math.abs(Number(byDni['43760364'].afpComision) - 19.10) <= 0.01, 'Huerta comision');
const totalNeto = dets.reduce((s, d) => s + Number(d.netoPago), 0);
assert.ok(totalNeto > 0, 'suma neto');
```

- [ ] **Step 2: Correr y verificar que FALLA**

Run: `cd apps/backend && DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx scripts/oficina/test-planilla-flow.ts`
Expected: FALLA (calcular usa el motor viejo / tasas viejas).

- [ ] **Step 3: Reescribir el armado de tasas + calcular**

En `planillaOficina.ts`, dentro de `calcular`: resuelve `param = await resolverParamLegal(mesRow.mes + '-01')` y `afps = await cargarTasasAfp()`; por empleado arma `TasasOficina` (con `param` + `afps[normAfp(emp.sistemaPension)]`), lee `ytd = await getYtd(emp.id, anio, mesNumero)`, calcula la **sugerencia** de renta 5ta con `calcularRta5ta({ sueldoMensual, mesNumero, mesIngreso, acumuladoPercibidoAntes: ytd.acumuladoPercibido, retencionesPrevias: ytd.retencionesPrevias, uit: param.uit })`, y si `prev.renta5taManual` usa `prev.imptoRenta5ta`. Llama `calcularDetalleOficina({ ...inputs, afpComisionTipo: emp.afpComisionTipo, modalidadFormativa: emp.modalidadFormativa, imptoRenta5ta })`. Mapea el resultado (campos compat planos) a las columnas de `planilla_oficina_detalle`. Escribe el `calculoSnapshot` (`param` + `afps` + `porTrabajador`) en el mes.

- [ ] **Step 4: Correr y verificar que PASA**

Run: `cd apps/backend && DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx scripts/oficina/test-planilla-flow.ts`
Expected: VERDE (los 4 detalles cuadran).

- [ ] **Step 5: Test de override de Kelly**

Añade al mismo test: haz PATCH del `imptoRenta5ta` de un detalle (marca `renta5taManual=true`), recalcula, y verifica que el valor manual se conserva (no lo pisa la sugerencia).

Run: mismo comando. Expected: VERDE.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/planillaOficina.ts apps/backend/scripts/oficina/test-planilla-flow.ts
git commit -m "feat(planilla-oficina): calcular v2 arma snapshot y cuadra el Excel de julio"
```

---

## Task 7: Ruta `cerrar` v2 — upsert del ledger de renta 5ta (idempotente)

**Files:**
- Modify: `apps/backend/src/routes/planillaOficina.ts` (endpoint `cerrar`)
- Test: `apps/backend/scripts/oficina/test-cierre.ts` (extender: cerrar escribe ledger; recerrar no duplica)

**Interfaces:**
- Consumes: `upsertLedgerMes` (Task 4).
- Produces: al cerrar, por cada detalle se hace `upsertLedgerMes({ empleadoId, planillaMesId, anio, mesNumero, remunComputable: baseRenta5ta_del_mes, retencion: imptoRenta5ta })`.

- [ ] **Step 1: Escribir el test de idempotencia del cierre**

Extiende `test-cierre.ts`: cerrar el mes; contar filas en `renta5ta_mes` para ese `planilla_mes_id` (debe = nº de empleados); reabrir y recerrar; volver a contar (mismo número, sin duplicados) y verificar que el YTD del mes siguiente no se dobla.

```ts
const antes = await db.select().from(schema.renta5taMes).where(eq(schema.renta5taMes.planillaMesId, mesId));
// ...reabrir + cerrar de nuevo...
const despues = await db.select().from(schema.renta5taMes).where(eq(schema.renta5taMes.planillaMesId, mesId));
assert.equal(antes.length, despues.length, 'cerrar 2x no duplica ledger');
```

- [ ] **Step 2: Correr y verificar que FALLA**

Run: `cd apps/backend && DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx scripts/oficina/test-cierre.ts`
Expected: FALLA (cerrar aún no escribe el ledger).

- [ ] **Step 3: Añadir el upsert del ledger en `cerrar`**

En `cerrar`, tras persistir el asiento/estado, itera los detalles y llama `upsertLedgerMes(...)` con `remunComputable = baseRenta5ta` (guardada en el snapshot/detalle del mes) y `retencion = det.imptoRenta5ta`. Debe correr dentro de la misma transacción/idempotencia del cierre.

- [ ] **Step 4: Correr y verificar que PASA**

Run: `cd apps/backend && DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx scripts/oficina/test-cierre.ts`
Expected: VERDE.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/planillaOficina.ts apps/backend/scripts/oficina/test-cierre.ts
git commit -m "feat(planilla-oficina): cerrar alimenta el ledger de renta5ta idempotente"
```

---

## Task 8: Config backend + UI mínima de import de renta 5ta

**Files:**
- Modify: `apps/backend/src/routes/planillaOficina.ts` (endpoints de config)
- Modify: `apps/frontend/src/lib/api.ts` (métodos)
- Modify: `apps/frontend/src/components/oficina/PlanillaOficinaTab.tsx` (panel mínimo de import + tasas)
- Test: `apps/backend/scripts/oficina/test-config-oficina.ts`

**Interfaces:**
- Produces (endpoints): `GET/PUT /oficina/param-legal`, `PUT /oficina/afp-tasas/:afp`, `GET/PUT /oficina/renta5ta-baseline` (por empleado/año). Todos gated con `requireAdminOContab`.

- [ ] **Step 1: Escribir el test de los endpoints de config**

`test-config-oficina.ts`: sembrar un baseline vía la función de servicio, leerlo, actualizarlo, y verificar que `getYtd` lo refleja. (Prueba la capa de servicio directamente; el HTTP se valida a mano en el paso 5.)

```ts
import assert from 'node:assert/strict';
import { db, schema } from '@erp/db';
import { eq } from 'drizzle-orm';
import { getYtd } from '../../src/lib/renta5taYtd.js';
const [emp] = await db.select({ id: schema.empleados.id }).from(schema.empleados).limit(1);
await db.delete(schema.renta5taBaseline).where(eq(schema.renta5taBaseline.empleadoId, emp!.id));
await db.insert(schema.renta5taBaseline).values({ empleadoId: emp!.id, anio: 2026, acumuladoImportado: '12000', retencionesImportadas: '340' });
const y = await getYtd(emp!.id, 2026, 2);
assert.ok(Math.abs(y.acumuladoPercibido - 12000) <= 0.01 && Math.abs(y.retencionesPrevias - 340) <= 0.01, 'import baseline refleja en YTD');
await db.delete(schema.renta5taBaseline).where(eq(schema.renta5taBaseline.empleadoId, emp!.id));
console.log('config-oficina VERDE'); process.exit(0);
```

- [ ] **Step 2: Correr y verificar (PASA con la capa actual, FALLA si falta seed helper)**

Run: `cd apps/backend && DATABASE_URL="postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test" npx tsx scripts/oficina/test-config-oficina.ts`
Expected: define el comportamiento esperado del baseline import.

- [ ] **Step 3: Implementar endpoints de config**

En `planillaOficina.ts` añade (con `requireOficinaEdit`): `GET/PUT /param-legal` (lista/upsert por `fecha_vigencia`), `PUT /afp-tasas/:afp` (aporte/seguro/comisión flujo+mixta), `GET/PUT /renta5ta-baseline?empleadoId=&anio=` (upsert de `acumulado_importado`/`retenciones_importadas`).

- [ ] **Step 4: Añadir métodos en `api.ts` + panel mínimo en `PlanillaOficinaTab.tsx`**

Un panel "Configuración del motor" (visible a admin/contab) con: editor de tasas legales por vigencia, tasas AFP, y una grilla de import de renta 5ta por empleado. Mínimo funcional (la presentación pulida es F3).

- [ ] **Step 5: Verificación en el navegador**

Run: `preview_start {name: "erp-dev"}` (si el puerto está ocupado por otra sesión, resolver con autoPort). Navegar a Oficina → Planilla → Configuración; cargar un baseline y confirmar que `GET /renta5ta-baseline` lo devuelve (leer network con `read_network_requests`). Captura de pantalla como prueba.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes/planillaOficina.ts apps/frontend/src/lib/api.ts apps/frontend/src/components/oficina/PlanillaOficinaTab.tsx apps/backend/scripts/oficina/test-config-oficina.ts
git commit -m "feat(planilla-oficina): config del motor (params vigencia, tasas AFP, import renta5ta)"
```

---

## Cierre de F1

- [ ] Correr toda la batería: `test-calc`, `test-rta5ta`, `test-renta5ta-ytd`, `test-param-legal`, `test-planilla-flow`, `test-cierre`, `test-config-oficina` — todas VERDE.
- [ ] Regenerar la planilla de julio 2026 completa (17 empleados) y confirmar cuadre S/ 0.01 contra el Excel en las 8 columnas de aceptación.
- [ ] Actualizar memoria: F1 IMPLEMENTADO.
