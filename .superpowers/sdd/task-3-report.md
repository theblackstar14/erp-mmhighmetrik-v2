# Task 3 Report — Auto-clasificacion CD/GG en los 4 flujos + clamp proyecto

## Status: DONE
## Commit: fee1493

## Files Changed
- `apps/backend/src/lib/clasificacion.ts` — NEW: shared helper `resolverClase`
- `apps/backend/src/routes/finanzas.ts` — import + gastoSchema extended + toValues prorrateable + 2 insert sites wired
- `apps/backend/src/routes/logistica.ts` — import + OC pago auto-gasto wired
- `apps/backend/src/routes/oficina.ts` — import + rendición→gasto wired

## Curl Results (verbatim)

### A) proyecto + tipo Alquileres (config GG_OBRA) sin clasificacion
```
"destino":"proyecto"
"clasificacion":"GG_OBRA"
"clasificacionOrigen":"AUTOMATICO"
```
RAW: `{"gasto":{"id":"52d40d0c-1408-4b21-b914-b6f2a442385a","proyectoId":"4bac3de9-6930-4b69-8e0c-a4e3502955b0","fecha":"2026-07-01","tipoGasto":"Alquileres","destino":"proyecto","clasificacion":"GG_OBRA","clasificacionOrigen":"AUTOMATICO","prorrateable":false,...}}`

### B) proyecto + usuario fuerza clasificacion GG_CORP → clamped GG_OBRA/USUARIO
```
"clasificacion":"GG_OBRA"
"clasificacionOrigen":"USUARIO"
```
RAW: `{"gasto":{"id":"c63fc46c-99e0-4cf5-9be8-a90096bb106a","proyectoId":"4bac3de9-6930-4b69-8e0c-a4e3502955b0","fecha":"2026-07-01","tipoGasto":"Combustible","destino":"proyecto","clasificacion":"GG_OBRA","clasificacionOrigen":"USUARIO","prorrateable":false,...}}`

### C) gasto corporativo (sin proyecto) → GG_CORP/corporativo
```
"destino":"corporativo"
"clasificacion":"GG_CORP"
```
RAW: `{"gasto":{"id":"7d78dc59-a30b-4ecd-9e6e-4ee786f6cf88","proyectoId":null,"fecha":"2026-07-01","tipoGasto":"Contabilidad","destino":"corporativo","clasificacion":"GG_CORP","clasificacionOrigen":"AUTOMATICO","prorrateable":false,...}}`

## Invariant Verification
- A PASSED: proyecto + lookup GG_OBRA → stored as GG_OBRA/AUTOMATICO
- B PASSED: usuario sent GG_CORP on proyecto → CLAMPED to GG_OBRA/USUARIO (invariant enforced)
- C PASSED: no proyectoId → corporativo/GG_CORP/AUTOMATICO

## Test data cleanup
`DELETE FROM gastos WHERE fecha='2026-07-01' AND total IN (118,59,236)` → DELETE 3

---

## Fix: edit-path clamp

**Edit route found:** `PUT /gastos/:id` (lines 172–185 of `apps/backend/src/routes/finanzas.ts`)

**Changes applied:**
1. **Finding 1 (PUT /gastos/:id):** When `destino` or `clasificacion` is present in the PATCH body, the handler now reads the existing gasto row first (fetching `proyectoId`, `tipoGasto`, `destino`), then calls `resolverClase` with the merged prev+patch values before writing to DB. Raw client-supplied `clasificacion`/`destino` never reach the DB unclamped.
2. **Finding 2 (POST /proyectos/:id/gastos):** Changed `destino: parse.data.destino` → `destino: 'proyecto'` in the `resolverClase` call, so the project-scoped route always enforces `destino='proyecto'` regardless of what the client sends.

**Curl PATCH result (PUT GG_CORP on a proyecto gasto):**
```
"destino":"proyecto","clasificacion":"GG_OBRA","clasificacionOrigen":"USUARIO"
```
RAW: `{"gasto":{"id":"fbe7397f-8119-4fd8-a628-d4840f8695d2",...,"destino":"proyecto","clasificacion":"GG_OBRA","clasificacionOrigen":"USUARIO",...}}`

**Result: GG_CORP clamped to GG_OBRA (invariant enforced on edit path).**

**Commit:** d2f42fc — `fix(gastos): re-clamp clasificacion al editar + forzar destino proyecto en ruta de obra`

**No concerns.** The fix correctly fetches prev row only when needed (destino/clasificacion present in body) and falls back gracefully if the gasto doesn't exist (prev guard). The `clasificacionOrigen` becomes `'USUARIO'` because `resolverClase` receives the explicit `clasificacion` from the patch body.
