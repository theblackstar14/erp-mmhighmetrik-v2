# Task 5 Report — adelantos como préstamo con saldo derivado

## STATUS: VERDE

## Files changed
- `apps/backend/src/routes/planillaOficina.ts` — added `desc` import, `saldoAdelanto` helper, `POST /adelantos`, `GET /adelantos?empleadoId=`
- `apps/backend/scripts/oficina/test-adelantos.ts` — new test (3 assertions)

## Test output (verbatim)

```
════ adelantos · Task 5 ════
  setup: empleado TEST ADELANTO EMP creado id=e4ae0bf4-7e22-4c78-970d-7ccea51efaca
  ✓ 1. POST /adelantos → id=820085d2-6b5c-4421-8988-94d3f2eaf474 montoCuota=300 saldoPendiente=900
  ✓ 2. GET /adelantos → count=1 montoCuota=300 saldoPendiente=900
  ✓ 3. saldo derivado tras cuota 300 → saldoPendiente=600

  adelantos VERDE
```

## Regression (planilla-flow Task 4)

```
════ planilla-flow · Task 4 (C-2 real data) ════
  DB rates for 'AFP Profuturo': pctSeguro=0.0184, pctComision=0.0169
  config: pctEssalud=0.09, horasMesBase=240, topeSeguroAfp=12786.4
  expected (engine): afpSeguro=110.4, netoPago=5188.2
  setup: empleado TEST LEVANO creado id=ce1ed848-b1b3-42af-8472-d246222f50e3 sistemaPension='AFP Profuturo(F)'
  ✓ 1. POST /planilla → borrador mesId=00b8cd66-c700-4994-9532-479c2aed91d4
  ✓ 1b. POST /planilla idempotente
  ✓ 2. calcular → detalle encontrado id=2a3d460b-8c25-47c4-aa14-75483f312623
       totalBruto=6000 essalud=540 afpAporte=600 afpSeguro=110.4 netoPago=5188.2
       boletaCorrelativo=BOL-100010
       (expected afpSeguro=110.4, expected netoPago=5188.2)
  ✓ 3. PATCH detalle imptoRenta5ta=95 → netoPago=5093.2 (prev 5188.2 - 95 = 5093.2)

  planilla-flow VERDE
```

## Concerns
- `adelantoCuotaAplicada` has a unique index on `(adelantoId, planillaDetalleId)` — two cuotas of the same adelanto cannot be applied to the same detalle row (by design). No issue here, just worth noting for the `/calcular` integration.
- The saldoAdelanto helper was NOT extracted into /calcular's inline loop (kept minimal as instructed — the logic there is a summing loop over multiple adelantos per empleado, different shape).
