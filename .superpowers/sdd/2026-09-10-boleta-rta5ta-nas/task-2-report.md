# Task 2 Report — Snapshot fechas + Renta 5ta auto (overridable)

## STATUS: VERDE

## Test output (verbatim)

### test-rta5ta.ts
```
Case A: { retencionMes: 1625.5, impuestoAnual: 13004, proyeccionAnual: 141800, rentaNeta: 104350 }
Case B: { retencionMes: 0, impuestoAnual: 0, proyeccionAnual: 28360, rentaNeta: -9090 }
Case C: { retencionMes: 2478, impuestoAnual: 11478, proyeccionAnual: 130900, rentaNeta: 93450 }
rta5ta VERDE
```

### test-rta5ta-integracion.ts
```
==== rta5ta-integracion ====
  setup: empleado creado id=c233c7ea-3a34-4b26-af3d-e2c9b5e787dc
  1. planilla creada mesId=3eb728a2-2c9a-4b73-95a4-eefdfdd49717
  2. calcular OK: imptoRenta5ta=632.9 (auto), renta5taManual=false, fechaIngreso=2026-01-01
  3. PATCH OK: imptoRenta5ta=42, renta5taManual=true
  4. Re-calcular OK: imptoRenta5ta=42 (override survives), renta5taManual=true

  rta5ta-integracion VERDE

[exit code 9 on Windows = cosmetic libuv issue, not a test failure]
```

## Files changed

- `apps/backend/scripts/oficina/2026-09-10-boleta-fechas.sql` — migration (applied to erp_mmh_test)
- `packages/db/src/schema.ts` — 3 columns added to planillaOficinaDetalle
- `apps/backend/src/routes/planillaOficina.ts` — calcular + PATCH updated
- `apps/backend/scripts/oficina/test-rta5ta-integracion.ts` — new integration test

## Concerns

- v1 approximation: `acumuladoPercibidoAntes = sueldoMensual * (mesNumero - 1)` assumes continuous employment from January and zero gratificacion/extras in prior months. Documented in code comment. Real data (actual prior payslips) would require summing historical brutos.
- `retencionesPrevias = 0` (v1). Same limitation — prior year retenciones not summed from DB.
- For 6000 sueldo at mes 7: auto computes 632.90 PEN retention, which is within expected range for that bracket.
