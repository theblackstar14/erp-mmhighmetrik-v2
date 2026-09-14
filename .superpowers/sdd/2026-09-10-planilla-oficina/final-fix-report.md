# Final-Fix Report — planillaOficina.ts

## Fix 1 — Period check before cuota transaction (Important, blocking)

**Location:** `POST /planilla/:mesId/cerrar` — inserted immediately after the `estado !== 'calculada'` guard, **before** the `db.transaction(...)` that applies advance cuotas.

**What changed:**
```ts
const periodo = mesRow.mes; // already 'YYYY-MM' — period = month, same as reabrir
if (await periodoCerrado(periodo)) {
  return res.status(423).json({ error: `Periodo contable ${periodo} cerrado; reabrelo primero` });
}
```

**Period helper reused:** `periodoCerrado(periodo)` — imported from `../lib/periodos.js`, identical to the call already in `reabrir`. The `periodo` value is `mesRow.mes` (the `YYYY-MM` string), which equals the last day's `YYYY-MM` because they share the same month.

**Effect:** If the accounting period is closed, the handler returns 423 before the cuota-application transaction runs. No advance ledger changes occur. The happy-path test (2026-07, open period) is unaffected.

---

## Fix 2 — AFP tasa map keyed by stripped name (Minor, robustness)

**Location:** `POST /planilla/:mesId/calcular` — line building `afpTasasMap`.

**What changed (one-liner):**
```ts
// Before:
const afpTasasMap = new Map(afpTasasList.map((t) => [t.afp, t]));
// After:
const afpTasasMap = new Map(afpTasasList.map((t) => [afpKey(t.afp), t]));
```

`afpKey` strips the `(F)`/`(M)` commission suffix. The lookup at line 253 (`afpTasasMap.get(afpKey(afpName))`) already strips before lookup; now the map is keyed the same way, so a suffixed `afp_tasas.afp` value (e.g. `AFP Integra(M)`) will still match.

---

## Fix 3 — Empty-month cerrar guard (Minor, tidy)

**Location:** `POST /planilla/:mesId/cerrar` — inserted right after loading `detalleRows`, before any computation.

**What changed:**
```ts
if (detalleRows.length === 0) {
  return res.status(400).json({ error: 'La planilla no tiene detalle; calcula primero' });
}
```

Prevents `crearAsiento` from receiving an empty `lineas` array (which throws "necesita al menos 2 lineas", causing a 500).

---

## Test output (verbatim)

```
════ cierre · Task 6 ════
  setup: empleado TEST CIERRE EMP id=78c8482c-c8e4-4b16-a22e-b5ca1e417021
  setup: adelanto id=86baa896-aaee-4177-aae0-26c8321ed2a3 montoTotal=900 numCuotas=3
  ✓ 1. POST /planilla → mesId=cd260144-010a-405d-b05a-810e4b97a48e estado=borrador
  ✓ 2. calcular → estado=calculada, adelantoCuota=300
  ✓ 3. cerrar → estado=cerrada asientoId=25651462-b571-42e5-8762-f0b480a9ea1a
  ✓ 4. asiento Σdebe=13080 Σhaber=13080 delta=0
  ✓ 5. adelanto_cuota_aplicada: 1 row, monto=300.00
  ✓ 6. adelanto saldoPendiente=600 (was 900, cuota 300 applied)
  ✓ 6b. idempotency retry → 1 asiento (no duplicate), reused id=25651462-b571-42e5-8762-f0b480a9ea1a
  ✓ 7. reabrir → estado=calculada asientoId=null
  ✓ 8. asiento id=25651462-b571-42e5-8762-f0b480a9ea1a deleted
  ✓ 9. after reabrir: cuota_aplicada=0, saldoPendiente=900

  cierre VERDE
```

All 10 steps (including idempotency step 6b) passed. Exit 0.

---

## Commit

`4512b6c` on `feat/rbac-multiempresa`
