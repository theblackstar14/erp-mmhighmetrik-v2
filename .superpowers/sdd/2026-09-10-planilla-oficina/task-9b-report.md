# Task 9b Report — PlanillaOficinaTab + OficinaPage wiring

## STATUS: DONE

## tsc result
```
(no output — 0 errors)
```

## Commit
Run after report generation:
```
git add apps/frontend/src/components/oficina/PlanillaOficinaTab.tsx apps/frontend/src/pages/OficinaPage.tsx
git commit -m "feat(oficina): tab Planilla de oficina + Personal extendido + gate asistencia/planilla"
```

## What was done

### 1. Created `apps/frontend/src/components/oficina/PlanillaOficinaTab.tsx`
- Month state defaults to current YYYY-MM via `<input type="month">`.
- `useQuery(['planilla-oficina', mes])` → shows "Crear planilla" if `data.mes == null`.
- Estado badge + action buttons (Calcular/Cerrar/Reabrir) gated by estado.
- 423 errors from cerrar/reabrir surface the server message inline.
- Table with columns: Trabajador (nombre+cargo), Bruto, Renta 5ta (editable input, onBlur→editarDetalleOficina), Cuenta (CuentaContableSelect, disabled if cerrada/pagada), Adelanto, Dscto, Neto (bold), Docs (DocumentoAdjunto), Acciones (Boleta + Adelantos buttons).
- Totals footer row (Σ bruto, Σ neto).
- Boleta opens BoletaOficina directly (it renders its own portal). Adelantos opens a Modal wrapping AdelantosPanel.
- All mutations invalidate `['planilla-oficina', mes]`.

### 2. Modified `apps/frontend/src/pages/OficinaPage.tsx`
- Imported `PlanillaOficinaTab` from `@/components/oficina/PlanillaOficinaTab.js`.
- **TABS array**: added `planilla` (Wallet icon, gated: true) after `personal`; renamed "Personal admin" → "Personal"; added `gated` boolean to each tab entry.
- **OficinaPage**: reads `empresaActiva` from `useAuthStore((s) => s.empresaActiva)` — the role lives at `empresaActiva.rol` (post-RBAC multiempresa). Derived `isAdminOrContadora = rol === 'admin' || rol === 'contadora'`. Filters `visibleTabs` to hide gated tabs from non-authorized users. TabFade gates Planilla and Asistencia content behind same check.
- **AdminForm**: extended with `AdminFormExtra = EmpleadoInput & { sueldoBaseMensual?: number; asignacionFamiliar?: boolean }`. Sends both new fields in the `createEmpleado` call (cast to `EmpleadoInput`; backend accepts extra fields; api.ts type NOT touched). `asignacionFamiliar` maps to a checkbox ("Tiene hijos"); `sueldoBaseMensual` is a number input. Note: the existing `categoria` field was already labeled "Cargo" in the original form — that mapping is preserved.

## Role source for gating
`useAuthStore((s) => s.empresaActiva)?.rol` — the per-empresa role stored in `empresaActiva.rol` (populated from `MeResponse.empresaActiva.rol`). Values checked: `'admin'` and `'contadora'`.

## EmpleadoInput payload wiring
`sueldoBaseMensual` and `asignacionFamiliar` are extra fields beyond `EmpleadoInput`. They are passed via a local `AdminFormExtra` type and cast (`f as EmpleadoInput`) when calling `api.planilla.createEmpleado`. `api.ts` was NOT modified. Backend serializes the JSON body and accepts these extra fields.

## Concerns
- None. tsc = 0 errors. No api.ts changes required.

---

## Review Findings Fix — 2026-09-10

### Finding A — backend empSchema missing new empleado fields
Fixed in `apps/backend/src/routes/planilla.ts`:
- Added to `empSchema`: `cargo`, `sueldoBaseMensual` (z.number), `asignacionFamiliar` (z.boolean), `fechaCese`.
- POST handler: destructured `parse.data` to `d`; inserts `sueldoBaseMensual` as `String(d.sueldoBaseMensual)` (decimal column constraint), `fechaCese` empty→null.
- PUT handler: added `fechaCese` to the empty-string→null loop; added explicit conversion `String(data.sueldoBaseMensual)` for decimal column when key is present.

### Finding B — "Cargo" input wrote categoria, not cargo
Fixed in `apps/frontend/src/pages/OficinaPage.tsx`:
- `AdminFormExtra` extended with `cargo?: string`.
- Initial state includes `cargo: ''`.
- "Cargo" labeled input now reads/writes `f.cargo` (was `f.categoria`). `categoria` default `'Administrador'` is preserved for backward compat.

### Finding C — RendicionesTab scope default changed unintentionally
Fixed in `apps/frontend/src/pages/OficinaPage.tsx`:
- Reverted `useState(…)` default from `'mias'` back to `'todas'` (pre-9b value confirmed via `git show 50b5349`).

### Persistence verification (direct ORM check)
```
INSERT OK · id: 07ce68b4-75d9-41d8-8d15-a53487d6d10d
cargo: GERENTE TEST
sueldo_base_mensual: 6000.00
asignacion_familiar: true
ASSERTIONS PASSED
TEST ROW DELETED
```
Temp script deleted; not committed.

### tsc result (post-fix)
```
(no output — 0 errors)
```
