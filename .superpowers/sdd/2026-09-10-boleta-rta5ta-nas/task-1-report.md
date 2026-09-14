# Task 1 — Motor Renta 5ta: Report

## STATUS: DONE

**Commit:** 4fc9cfe  
**Branch:** feat/rbac-multiempresa

## Test output (verbatim)

```
Case A: {
  retencionMes: 1625.5,
  impuestoAnual: 13004,
  proyeccionAnual: 141800,
  rentaNeta: 104350
}
Case B: {
  retencionMes: 0,
  impuestoAnual: 0,
  proyeccionAnual: 28360,
  rentaNeta: -9090
}
Case C: {
  retencionMes: 2478,
  impuestoAnual: 11478,
  proyeccionAnual: 130900,
  rentaNeta: 93450
}
rta5ta VERDE
```

## Files committed

- `apps/backend/src/lib/rta5taCalc.ts` — función pura `calcularRta5ta` (proyección anual SUNAT, escala progresiva 5 tramos, divisores por mes, Ley 30334 bonif. extraordinaria 9%)
- `apps/backend/scripts/oficina/test-rta5ta.ts` — 3 casos assert con node:assert/strict

## Concerns

None. All 3 cases match algorithm-expected values exactly (within tolerance).
