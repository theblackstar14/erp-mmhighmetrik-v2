# Task 3 Report — Office-payroll router + config endpoints

## Status: DONE

## Files created/modified
- **Created**: `apps/backend/src/routes/planillaOficina.ts`
- **Modified**: `apps/backend/src/server.ts` (import + mount at `/api/oficina`)

## Step-3 verify output (verbatim)
```
status 200 config {
  pctEssalud: 0.09,
  pctOnp: 0.13,
  pctAfpAporte: 0.1,
  rmv: 1025,
  uit: 5350,
  topeSeguroAfp: 12786.4,
  horasMesBase: 240
}
PUT status 200 updated {
  pctEssalud: 0.09,
  pctOnp: 0.13,
  pctAfpAporte: 0.1,
  rmv: 1025,
  uit: 5350,
  topeSeguroAfp: 12786.4,
  horasMesBase: 240
}
```

Exit code 9 with `UV_HANDLE_CLOSING` assertion on Windows — a known tsx/libuv issue when calling `process.exit()` after `server.close()`. Not a functional failure; both endpoints returned HTTP 200 with correct payloads.

## Concerns
- None functional. The UV exit assertion is cosmetic and only affects the test harness, not runtime behavior.
- `pctAfpAporte: 0.10` is hardcoded as a constant (not persisted). Future tasks that add AFP calculation logic will use this value from the GET response.
