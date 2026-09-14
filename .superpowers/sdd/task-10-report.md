# Task 10 Report — Registrar gasto modal integration

## Status: DONE

## Files changed
- `apps/frontend/src/components/proyectos/tabs/FinanzasTab.tsx`
- `apps/frontend/src/pages/FinanzasPage.tsx`

## Key findings

### Gastos GlobalLedger query key
`GlobalLedger` uses `queryKey: ['gas-global', proyectoId]` (line 504 of FinanzasPage.tsx).
The `onDone` callback invalidates `['gas-global']` (prefix match covers all proyecto variants).

### proyectos shape
`{ id: string; codigo: string; nombre: string }` — confirmed from `GlobalLedger` and `MovModal` prop types in FinanzasPage.tsx. `GastoForm.proyectos` prop uses this exact shape.

### GastoForm changes (STEP 1)
- Made `export function GastoForm` with new optional-props signature
- Added `obraId` state tracking (`useState<string>(proyectoId ?? '')`)
- Added destino toggle (shown only when `proyectos` prop present and `!proyectoId`)
- Added obra selector (shown when `destino === 'proyecto'` and global mode)
- CD/GG_OBRA selector wrapped to only show when `f.destino === 'proyecto'`
- Submit uses `createGastoGlobal` with `proyectoId: resolvedProyectoId`
- `canSubmit` requires obra when `destino === 'proyecto'`
- Fixed-project call site at line ~92 (`<GastoForm proyectoId={proyectoId} cuentas={...} onDone={...}/>`) unchanged — `proyectos` omitted, no toggle/selector shown, destino always 'proyecto'. Type-checks cleanly.

### FinanzasPage changes (STEP 2)
- Added `gastoOpen` state
- Added `cuentasQ` query: `useQuery({ queryKey: ['cuentas'], queryFn: () => api.finanzas.listCuentas() })`
- Added top-level `qc = useQueryClient()` in `FinanzasPage`
- Added "Registrar gasto" button next to "Registrar movimiento"
- Added thin modal wrapper rendering `<GastoForm proyectos={proyectos} cuentas={...} onDone={...}/>`
- `onDone` invalidates: `['gas-global']`, `['finanzas-resumen']`, `['costos-obra']`
- Imported `GastoForm` from existing `FinanzasTab.js` import

## TSC exit code: 0

## Commit hash
281cda5
