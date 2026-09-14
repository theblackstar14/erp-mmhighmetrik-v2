# Task 5 Report — frontend-types (api.ts)

## Status: COMPLETE

## tsc exit code
EXIT 0 — `npx tsc --noEmit` passed with no errors.

## Changes applied to `apps/frontend/src/lib/api.ts`

1. **`GastoInput`** — added optional fields `destino`, `clasificacion`, `prorrateable`.
2. **`GastoCuentaMapRow`** — added `clase: 'CD' | 'GG_OBRA' | 'GG_CORP'`.
3. **`contabilidad.updateCuentaTipo`** — added `clase?: string` to param type; updated return type to `{ ok: boolean; row: GastoCuentaMapRow }` (kept URL/method unchanged).
4. **`CostosObra`** type — added near `GgUtModo` (line ~879).
5. **`proyectos.getCostosObra`** — added method calling `GET /api/proyectos/:id/costos-obra`.

## Stale-type grep result
No stale or duplicate classification types found in `apps/frontend/src/**/*.{ts,tsx}`.
All matches for `clasificacion`, `GG_OBRA`, `GG_CORP`, `CostosObra`, `costos-obra` are exclusively in the new additions within `api.ts` — this is net-new, nothing to remove.

## Commit hash
`3992142` — `feat(api): tipos clase gasto + CostosObra + getCostosObra`

## Concerns
None. The `updateCuentaTipo` param for `clase` was typed as `string` (not the union literal) as specified; the return type was updated to include `row: GastoCuentaMapRow` per the task spec. This is a widening change consistent with the existing call sites.
