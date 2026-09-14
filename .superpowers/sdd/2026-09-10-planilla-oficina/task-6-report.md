# Task 6 Report: cerrar mes genera asiento WS1 + aplica cuotas; reabrir reversible

## STATUS: VERDE

## Files changed
- `apps/backend/src/routes/contabilidad.ts` — added `export` to `crearAsiento` function and `LineaIn` type
- `apps/backend/src/routes/planillaOficina.ts` — added imports + two new endpoints: `POST /planilla/:mesId/cerrar` and `POST /planilla/:mesId/reabrir`
- `apps/backend/scripts/oficina/test-cierre.ts` — new test file (Task 6)

## Test output (verbatim)

```
════ cierre · Task 6 ════
  setup: empleado TEST CIERRE EMP id=77b586e9-314f-477f-a6b0-cf5077544d85
  setup: adelanto id=28fd53e3-57fe-4289-ac31-f48563bf1915 montoTotal=900 numCuotas=3
  ✓ 1. POST /planilla → mesId=8debe3c1-f664-4f6b-b11a-54f0fc568937 estado=borrador
  ✓ 2. calcular → estado=calculada, adelantoCuota=300
  ✓ 3. cerrar → estado=cerrada asientoId=77c14656-6a70-4f0e-b9d7-c2453ec098f6
  ✓ 4. asiento Σdebe=6540 Σhaber=6540 delta=0
  ✓ 5. adelanto_cuota_aplicada: 1 row, monto=300.00
  ✓ 6. adelanto saldoPendiente=600 (was 900, cuota 300 applied)
  ✓ 7. reabrir → estado=calculada asientoId=null
  ✓ 8. asiento id=77c14656-6a70-4f0e-b9d7-c2453ec098f6 deleted
  ✓ 9. after reabrir: cuota_aplicada=0, saldoPendiente=900

  cierre VERDE

EXIT: 0
```

Σdebe=6540 Σhaber=6540 (sueldo 6000 + essalud 540 = 6540; haber: essalud 540 + afp(aporte+seguro+comision) + neto = matches)

## Regression
- test-calc.ts: VERDE (EXIT 0)
- test-planilla-flow.ts: VERDE (EXIT 0)

## Implementation notes
- `crearAsiento` uses `db` (global pool) internally, not a drizzle tx handle. Adelanto cuota application runs in its own `db.transaction(tx => ...)`, then `crearAsiento` is called outside that tx, then mes estado updated. This matches how other WS1 callers work throughout the codebase.
- `cargarDerivarCtx` was already exported from `apps/backend/src/lib/clasificacion.ts`; only `crearAsiento` and `LineaIn` needed export from `contabilidad.ts`.
- Reabrir: 423 gate uses `periodoCerrado(periodo)` from `periodos.ts`. Deletes `asientos` row (cascade deletes `asientos_lineas`). Restores 'cancelado' adelantos back to 'vigente' if they have saldo > 0 after cuota removal.

## Concerns
- None critical. Cosmetic: adelanto `469` lumps judicial+descuentos+adelanto together (per spec v1 note). Refinement to credit `141` for adelanto recovery is a deferred task.

---

## Review finding fix — commit 00892bf

### Finding addressed
`cerrar` could create a duplicate/orphaned asiento on retry: asiento created, then mes update fails → mes stays 'calculada' with asientoId=null, a retry calls `crearAsiento` again → second asiento for same month.

### Fix applied (planillaOficina.ts)
- Added `ne` to drizzle-orm imports.
- Before calling `crearAsiento`, query for an existing non-anulado asiento with `(origen='planilla_oficina', origenId=mesId)`. If found, reuse its id; otherwise create fresh. Updated Step 5 to use the resolved `asientoId` variable.

### Test extended (test-cierre.ts — step 6b)
1. After step 6 (cerrar verified), directly reset mes to `estado='calculada', asientoId=null` via db.update (leaving asiento in DB).
2. Retry POST cerrar → assert 200, mes back to cerrada.
3. Query asientos by `(origen, origenId)` → assert exactly 1 row, same id as original (no duplicate).
4. Added orphaned-asiento cleanup fallback in `finally` block.

### Test output (verbatim)

```
════ cierre · Task 6 ════
  setup: empleado TEST CIERRE EMP id=99d8b83b-a10f-4e38-b55a-4dfca3677fa4
  setup: adelanto id=eaea0824-d41c-4274-a04c-0ba79d5a3dea montoTotal=900 numCuotas=3
  ✓ 1. POST /planilla → mesId=757e2439-55c3-44d0-b94c-5ab04a32f061 estado=borrador
  ✓ 2. calcular → estado=calculada, adelantoCuota=300
  ✓ 3. cerrar → estado=cerrada asientoId=973b0ab2-d459-4147-8892-0caa7869f73f
  ✓ 4. asiento Σdebe=6540 Σhaber=6540 delta=0
  ✓ 5. adelanto_cuota_aplicada: 1 row, monto=300.00
  ✓ 6. adelanto saldoPendiente=600 (was 900, cuota 300 applied)
  ✓ 6b. idempotency retry → 1 asiento (no duplicate), reused id=973b0ab2-d459-4147-8892-0caa7869f73f
  ✓ 7. reabrir → estado=calculada asientoId=null
  ✓ 8. asiento id=973b0ab2-d459-4147-8892-0caa7869f73f deleted
  ✓ 9. after reabrir: cuota_aplicada=0, saldoPendiente=900

  cierre VERDE
```

### Regression
- test-calc.ts: VERDE
- test-cierre.ts: VERDE (all 10 steps including new 6b)

### Concerns
- None. Cuota application transaction's `onConflictDoNothing` was already idempotent; the asiento reuse completes the idempotency story. Single-transaction-across-crearAsiento remains a deferred WS1-wide refactor as noted in original task.
