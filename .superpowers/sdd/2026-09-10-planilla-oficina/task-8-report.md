# Task 8 Report — API client planilla oficina

## STATUS: DONE

## Commit
`0b89ba4` feat(oficina): api client de planilla de oficina

## tsc --noEmit result
```
(no output — 0 errors)
```

## What was done
- Added 4 new exported types to `apps/frontend/src/lib/api.ts`:
  - `PlanillaOficinaMes`
  - `PlanillaOficinaDetalle`
  - `AdelantoOficina`
  - `ConfigOficina`
- Added 12 new client functions to the existing `api.oficina` namespace:
  - `getPlanillaOficina`, `crearPlanillaOficina`, `calcularPlanillaOficina`, `cerrarPlanillaOficina`, `reabrirPlanillaOficina`
  - `editarDetalleOficina`, `listAdelantosOficina`, `crearAdelantoOficina`, `docsDetalleOficina`
  - `getConfigOficina`, `putConfigOficina`
  - `subirDocumentoOficina` (multipart — uses raw `fetch` + `FormData`, mirrors existing upload pattern)

## Concerns
None. tsc = 0 errors. Only `apps/frontend/src/lib/api.ts` committed.
