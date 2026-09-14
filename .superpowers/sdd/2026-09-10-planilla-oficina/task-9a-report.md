# Task 9a Report — Componentes leaf oficina

## STATUS
DONE

## Commit
50b5349 — feat(oficina): componentes DocumentoAdjunto, BoletaOficina, AdelantosPanel

## Files created
- apps/frontend/src/components/oficina/DocumentoAdjunto.tsx
- apps/frontend/src/components/oficina/BoletaOficina.tsx
- apps/frontend/src/components/oficina/AdelantosPanel.tsx

## tsc result
```
(no output — 0 errors)
```

## Concerns
None. `montoCuota` and `saldoPendiente` on `AdelantoOficina` are already typed as `number` (not string), so no `Number()` cast needed for those two fields. All `PlanillaOficinaDetalle` money fields are strings and are wrapped with `Number()` before `fmtPEN`.
