# Task 8 Report — Resultado de obra block

## Status
DONE

## Commit hash
11f3b1f

## tsc exit code
0

## Money formatter used
`fmtPEN` — imported from `@/lib/utils.js` (already present in the file; no new import needed).

## What was done
1. Added `costosQ` useQuery call (queryKey `['costos-obra', proyectoId]`, queryFn `api.proyectos.getCostosObra(proyectoId)`) after the existing `cashflowQ` query.
2. Added the "Resultado de obra (sin gastos de oficina)" card block in the JSX between the hero RESULTADO card and the INGRESOS|COSTOS grid. The heading strictly uses the mandated copy (never "utilidad").
3. All numeric values routed through `fmtPEN(...)` — no raw numbers rendered. `fmtPEN` already rounds internally so float noise (e.g. 819168.98000…) is suppressed automatically.

## Concerns
None. tsc clean, single-file commit, heading copy compliant.
