# Task 4 Report — endpoint costos-obra

## Status
DONE — endpoint added, verified, committed.

## SQL alias used
`sql` (imported directly from `drizzle-orm` — was not present in the file; added to the existing import on line 3).

## Curl JSON response (PG0001)
```json
{"cd":{"presupuesto":1253165.9,"ejecutado":583481.08},"ggObra":{"presupuesto":null,"ejecutado":17632.22,"separable":false},"costoTotal":601113.3,"valorizacion":1420282.28,"resultadoObra":819168.98,"compartidosSinDistribuir":0,"ggUtModo":"simple_pct"}
```

## DB cross-check (gastos WHERE destino='proyecto' GROUP BY clasificacion)
| clasificacion | sum(total) |
|---|---|
| CD | 583481.08 |
| GG_OBRA | 17632.22 |

**Match confirmed:** `cd.ejecutado` (583481.08) and `ggObra.ejecutado` (17632.22) match DB exactly.

## resultadoObra check
- valorizacion: 1420282.28
- costoTotal (CD + GG_OBRA): 583481.08 + 17632.22 = 601113.30
- resultadoObra = 1420282.28 − 601113.30 = **819168.98** ✓

## ggUtModo behavior
PG0001 has `ggUtModo = 'simple_pct'` (not 'separado') → `ggObra.presupuesto = null` correctly (no invented GG budget).

## Commit
See git log for commit hash — `feat(proyectos): endpoint costos-obra (CD/GG ejecutado vs presupuesto + resultado)`.

## File changed
- `apps/backend/src/routes/proyectos.ts` — added `sql` to drizzle-orm import; added `GET /:id/costos-obra` route at line 289 (before the generic `GET /:id`).
