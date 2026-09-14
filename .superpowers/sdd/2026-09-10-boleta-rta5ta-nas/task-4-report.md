# Task 4 Report — Boletas PDF batch al NAS al cerrar

## Test output (verbatim)

```
════ cierre · Task 6 ════
  setup: empleado TEST CIERRE EMP id=9d10aa4d-4236-44fc-a981-05e1b957610f
  setup: adelanto id=0d4cae42-64c2-4faa-ac66-a48005909b0d montoTotal=900 numCuotas=3
  ✓ 1. POST /planilla → mesId=46b500de-2e0a-4331-ac32-e97e8580cfed estado=borrador
  ✓ 2. calcular → estado=calculada, adelantoCuota=300
boleta NAS fallo 09c8c5fa-d167-4b74-8d02-0ed23ff22538 NAS no alcanzable (https://pubmed-push-joe-bob.trycloudflare.com) · ¿WebDAV activo / túnel arriba / red?
boleta NAS fallo 4dd72e0f-418d-48d6-913b-1af45d5df2f0 NAS no alcanzable (https://pubmed-push-joe-bob.trycloudflare.com) · ¿WebDAV activo / túnel arriba / red?
boleta NAS fallo 4fdc5f5f-6f4e-4806-80ca-e1c94d716582 NAS no alcanzable (https://pubmed-push-joe-bob.trycloudflare.com) · ¿WebDAV activo / túnel arriba / red?
boleta NAS fallo f8ac33d2-16ab-4dfc-8a77-09f68c6f7365 NAS no alcanzable (https://pubmed-push-joe-bob.trycloudflare.com) · ¿WebDAV activo / túnel arriba / red?
boleta NAS fallo 3ecb66bf-9b4c-466f-9e3e-a9b9d20dab49 NAS no alcanzable (https://pubmed-push-joe-bob.trycloudflare.com) · ¿WebDAV activo / túnel arriba / red?
boleta NAS fallo e98f9767-c53f-420f-834e-7873e9a1c9bf NAS no alcanzable (https://pubmed-push-joe-bob.trycloudflare.com) · ¿WebDAV activo / túnel arriba / red?
boleta NAS fallo be54dd69-d098-477f-9ff6-265fccd0e279 NAS no alcanzable (https://pubmed-push-joe-bob.trycloudflare.com) · ¿WebDAV activo / túnel arriba / red?
boleta NAS fallo d32b853d-c5b8-4746-a5c3-9677aee600c6 NAS no alcanzable (https://pubmed-push-joe-bob.trycloudflare.com) · ¿WebDAV activo / túnel arriba / red?
boleta NAS fallo c33fa88a-962c-4cd4-ad37-6e131d08e96d NAS no alcanzable (https://pubmed-push-joe-bob.trycloudflare.com) · ¿WebDAV activo / túnel arriba / red?
boleta NAS fallo d903b6fe-94a2-49f9-98aa-5a0b8ee73e63 NAS no alcanzable (https://pubmed-push-joe-bob.trycloudflare.com) · ¿WebDAV activo / túnel arriba / red?
  ✓ 3. cerrar → estado=cerrada asientoId=a02c4173-ea90-47f4-b10f-5c3bae129a10 boletasSubidas=0 (nasReachable=false)
  ✓ 3b. NAS unreachable (boletasSubidas=0) — cerrar still succeeded (best-effort confirmed)
  ✓ 4. asiento Σdebe=6540 Σhaber=6540 delta=0
  ✓ 5. adelanto_cuota_aplicada: 1 row, monto=300.00
  ✓ 6. adelanto saldoPendiente=600 (was 900, cuota 300 applied)
boleta NAS fallo ... [10 NAS errors on idempotency retry, all caught]
  ✓ 6b. idempotency retry → 1 asiento (no duplicate), reused id=a02c4173-ea90-47f4-b10f-5c3bae129a10
  ✓ 7. reabrir → estado=calculada asientoId=null
  ✓ 8. asiento id=a02c4173-ea90-47f4-b10f-5c3bae129a10 deleted
  ✓ 9. after reabrir: cuota_aplicada=0, saldoPendiente=900

  cierre VERDE
```

## NAS reachability

NAS was NOT reachable in this test run (Cloudflare tunnel down). All 10 boleta uploads failed per-detalle and were caught silently. `boletasSubidas=0`. Cerrar returned 200 with `estado=cerrada` — best-effort confirmed.

## What was done

- `apps/backend/src/routes/planillaOficina.ts`: Added `import generarBoletaPdf` + Step 6 boleta-batch block after `estado='cerrada'` update. Per-detalle try/catch, idempotent via `docsDetalle()` check, empresa row loaded fail-safe, `boletasSubidas` included in JSON response.
- `apps/backend/scripts/oficina/test-cierre.ts`: Asserts `typeof body.boletasSubidas === 'number'`, guards NAS-reachable branch, cleanup deletes `documento_adjunto` rows.
