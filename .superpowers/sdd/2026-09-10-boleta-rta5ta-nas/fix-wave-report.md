# Fix-wave report — 2026-09-10

## FIX A — PDF right column prints 0.00 (not blank)
`apps/backend/src/lib/boletaOficinaPdf.ts`: Removed the `empl > 0` and `trab > 0` guards on the APORTES Y DESCUENTOS loop. Both columns now call `fmt(empl)` / `fmt(trab)` unconditionally, producing `0.00` for every zero-value rubro (O.N.P., Impto. Renta, Retenc. Judic., AFP pension/Seguro/Com.%, Adelantos, Descuentos, Essalud Vida, Reg. Salud).

## FIX B — remove dead `montoFeriado` from BoletaDetalle type
`apps/backend/src/lib/boletaOficinaPdf.ts`: Removed the `montoFeriado: string | number` field from the `BoletaDetalle` local type. The PDF has no Feriado row (matches the Excel image). The field is still stored in `planilla_oficina_detalle` and used by the calc engine — it was only dead in the PDF type.

## FIX C — surface `boletasFallidas` in cerrar response
`apps/backend/src/routes/planillaOficina.ts` line ~959: Added `boletasFallidas: boletaErrores.length` to the `res.json(...)` call. The variable was already built; it was simply not returned.

## FIX D — wire real empresa data into BoletaOficina
**Source used:** `api.admin.empresas.list()` (via `useQuery` with `staleTime: 5 min`) in `PlanillaOficinaTab`, filtered by `empresaActiva.id` from `useAuthStore`. This provides `ruc` and `direccion` from `EmpresaRow`. `razonSocial` is resolved from `EmpresaRow` first, falling back to `EmpresaMembresia` from the auth store's `empresas` list (which already has `razonSocial` but not `ruc`/`direccion`).

Changes:
- `apps/frontend/src/components/oficina/BoletaOficina.tsx`: Added `direccion?: string` prop alongside existing `razonSocial`/`ruc`. Removed the hardcoded `const direccion: string | undefined = undefined` line.
- `apps/frontend/src/components/oficina/PlanillaOficinaTab.tsx`: Added `useAuthStore` import + `useQuery` for `api.admin.empresas.list()`. Resolved `empresaRazonSocial`, `empresaRuc`, `empresaDireccion`. Passed all three to `<BoletaOficina>`.

## FIX E — always show correlativo label
`apps/frontend/src/components/oficina/BoletaOficina.tsx`: Removed `{d.boletaCorrelativo && (...)}` wrapper. The block is now unconditional; when `boletaCorrelativo` is null it renders an empty string, keeping the header layout stable.

## Test results

### Backend: `test-cierre.ts`
```
cierre VERDE
```
All 9 steps passed. NAS unreachable (boletasSubidas=0) — best-effort confirmed. Asiento Σdebe=41943.20 Σhaber=41943.20 (delta=0).

### Frontend: `npx tsc --noEmit`
```
0 errors
```

## Files changed
- `apps/backend/src/lib/boletaOficinaPdf.ts`
- `apps/backend/src/routes/planillaOficina.ts`
- `apps/frontend/src/components/oficina/BoletaOficina.tsx`
- `apps/frontend/src/components/oficina/PlanillaOficinaTab.tsx`
