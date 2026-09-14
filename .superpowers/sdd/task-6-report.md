# Task 6 Report — selector CD/GG_OBRA en form de gasto de obra

## Status
DONE

## tsc exit code
0 (no errors)

## cn import needed?
No. `cn` was already imported in the file via `import { cn, fmtPEN } from '@/lib/utils.js'`.

## Changes made to `apps/frontend/src/components/proyectos/tabs/FinanzasTab.tsx`

1. **Step 1** — Added `claseMapQ` query and `claseDe` helper inside `GastoForm` (before `empty`):
   - `useQuery` for `['cuentas-tipo']` calling `api.contabilidad.getCuentasTipo()`
   - `claseDe(tipo)` returns `'GG_OBRA'` if the map row says so, otherwise `'CD'` (GG_CORP collapses to CD default)

2. **Step 2** — Added `destino: 'proyecto'` and `clasificacion: 'CD'` to the `empty` GastoInput literal.

3. **Step 3** — Updated tipoGasto `Sel` onChange to also call `claseDe(v)` and patch `clasificacion`.

4. **Step 4** — Added 2-button CD / GG_OBRA selector (placed immediately before the "Registrar en inventario" checkbox). Uses `cn` with `border-primary bg-primary/5` for the active state.

## Commit hash
d6d9301
