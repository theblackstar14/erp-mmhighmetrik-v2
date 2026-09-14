# Task 2 Report — Motor puro de calculo planilla oficina

## Files created
- `apps/backend/src/lib/planillaOficinaCalc.ts` — pure calc engine (no DB)
- `apps/backend/scripts/oficina/test-calc.ts` — assert-based test against real boleta values

## Test output (verbatim)
```
calc VERDE
```

Exit code: 0. All 7 assertions passed:
- Levano: totalBruto=6000, essalud=540, afpAporte=600, afpSeguro≈82.20, netoPago≈5222.80
- Garcia: afpAporte=1285, afpSeguro≈172.61 (capped at tope 12599.27), netoPago≈10272.39
- ONP path: onp=650, afpAporte=0
- Asignacion familiar: asigFamiliar=102.50, totalBruto=3102.50

## Commit
- Hash: **4ad7611**
- Branch: feat/rbac-multiempresa
- Only the two specified files staged and committed.

## Status
DONE
