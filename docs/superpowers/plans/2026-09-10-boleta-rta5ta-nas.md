# Boleta exacta + Renta 5ta + PDF a NAS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Exact-format payslip + SUNAT Renta 5ta engine + payslip PDF archived to NAS on close + a July-2026 verification seed — on top of the completed office-payroll feature.

**Architecture:** A pure Renta-5ta engine feeds `calcular` (overridable by Kelly). Closing a month batch-generates payslip PDFs (pdfkit) and uploads them to NAS as `documento_adjunto(boleta_pago)`. A one-time seed loads the real July Excel and reports computed-vs-Excel diffs. Email is a deferred interface.

**Tech Stack:** Express+tsx (no tsc), Drizzle+Postgres (hand SQL migrations), React+Vite (tsc=0), pdfkit (already a backend dep — see `apps/backend/src/lib/ocPdf.ts`), `xlsx` (already used) for the seed. Tests = tsx `node:assert` scripts.

## Global Constraints
- DB **erp_mmh_test** only. `postgresql://postgres:MiClave123@localhost:5432/erp_mmh_test`. psql at `C:\Program Files\PostgreSQL\18\bin`. ASCII-only SQL. Windows → PowerShell (bash broken).
- Backend tsx; frontend `npx tsc --noEmit` MUST be 0. Commit only listed files (`git add <path>`), never `-A`. Branch feat/rbac-multiempresa.
- Money rounds to 2 decimals. Reuse existing helpers (`crearAsiento`, `registrarDocumento`, `calcularDetalleOficina`, ocPdf pattern).
- Real Excel: `C:\Users\gabri\Downloads\Gabriel\DOCUMENTOS PARA GABRIEL\07.PERSONAL PLANILLA JULIO 2026 OFICINA .xlsx` (note the space before `.xlsx`). Reference boleta values: Levano 6000→neto 5222.80 (Impto Renta 95); Garcia 12850→neto 10272.39 (Renta 1120). Rta5ta sheet: sueldo 10000 → RTA 5TA anual ≈ 7548.

---

## Task 1: Renta 5ta engine (pure) + test
**Files:** Create `apps/backend/src/lib/rta5taCalc.ts`; Test `apps/backend/scripts/oficina/test-rta5ta.ts`.
**Produces:** `calcularRta5ta(i: Rta5taInput): Rta5taResult`. `Rta5taInput = { sueldoMensual, mesNumero (1-12), acumuladoPercibidoAntes, retencionesPrevias, uit, gratificacionesPorPercibir? }`. `Rta5taResult = { retencionMes, impuestoAnual, proyeccionAnual, rentaNeta }`.
- [ ] Failing test with SUNAT reference cases: (a) sueldo 10000, mes 7, acumulado 60000 (6 prior months), retenciones 0, uit 5350 → assert `impuestoAnual` and `retencionMes` are positive and within a sane band (compute the expected by hand in the test: proyección = 60000 + 10000×6 + gratis(10000×2) + bonif(0.09×10000×2) = 141800; neta = 141800 − 7×5350(37450) = 104350; tax = 5UIT(26750)×.08 + (104350−26750)×.14 = 2140 + 10864 = 13004; may–jul divisor 8 → retencion ≈ (13004−0)/8 = 1625.5). Assert within ±2. (b) renta neta ≤ 0 → impuesto 0, retencion 0. (c) Dic (mes 12) → retencion = impuestoAnual − retencionesPrevias.
- [ ] Run → FAIL. Implement the engine (brackets 8/14/17/20/30% cumulative; per-month divisor Ene-Mar/12, Abr/9, May-Jul/8, Ago/5, Sep-Nov/4, Dic exact; `max(0,…)`; gratis+bonif 9%). Run → PASS.
- [ ] Commit (`feat(oficina): motor renta 5ta proyeccion anual sunat + test`).

## Task 2: Snapshot fechas + integrate Rta5ta into calcular
**Files:** Migration `apps/backend/scripts/oficina/2026-09-10-boleta-fechas.sql` (ALTER planilla_oficina_detalle ADD fecha_ingreso date, fecha_cese date); `packages/db/src/schema.ts` (add the 2 columns); `apps/backend/src/routes/planillaOficina.ts` (calcular).
**Consumes:** `calcularRta5ta` (Task 1).
- [ ] Apply migration; add ORM columns.
- [ ] In `calcular`: snapshot `fechaIngreso`/`fechaCese` from empleado into detalle. Compute Rta5ta per empleado: `acumuladoPercibidoAntes = sueldoMensual × (mesNumero − 1)`, `retencionesPrevias = 0` (v1 approx, documented), `mesNumero = Number(mes.slice(5,7))`, and set `imptoRenta5ta = calcularRta5ta(...).retencionMes` — BUT preserve a Kelly-overridden value: on re-calcular, if the existing detalle row had `imptoRenta5ta` set by a PATCH (manual), keep it; else use the auto value. (Reuse the existing "preserve manual inputs on re-calcular" logic already in calcular — add imptoRenta5ta to the auto-computed set, but if a manual flag/prior manual value exists, keep it. Simplest: auto-set on first calc; a subsequent PATCH overrides; a re-calcular preserves the PATCHed value if present — follow the existing preserve pattern for manual fields.)
- [ ] Extend the cierre/planilla test (or add a small check): after calcular of a fresh empleado (sueldo 6000, mes 7), `imptoRenta5ta > 0` (auto Rta5ta applied) and `fechaIngreso` snapshotted. Run green.
- [ ] Commit (`feat(oficina): snapshot fechas + renta 5ta auto en calcular`).

## Task 3: Boleta PDF generator (pdfkit) + email interface stub
**Files:** Create `apps/backend/src/lib/boletaOficinaPdf.ts`; Create `apps/backend/src/lib/boletaEmail.ts` (deferred stub).
**Consumes:** the detalle shape + empresa data. **Produces:** `generarBoletaPdf(detalle, empresa: {razonSocial,ruc,direccion}, mes): Promise<Buffer>`; `enviarBoletaEmail(detalle, pdf): Promise<void>` (throws "email no configurado").
- [ ] Read `apps/backend/src/lib/ocPdf.ts` for the pdfkit pattern (PDFDocument, buffers, fonts). Implement `generarBoletaPdf` rendering the EXACT boleta layout from the spec (cabecera + datos trabajador + two columns REMUNERACIONES/APORTES Y DESCUENTOS with all rubros, rubros-without-column shown 0.00 + Total Bruto/Aporte/Dscto + Neto + Lima fecha + firma lines). Money 2-decimals.
- [ ] `boletaEmail.ts`: `export async function enviarBoletaEmail(){ throw new Error('email de boletas no configurado (fase posterior)'); }`.
- [ ] Verify: a tiny tsx script builds a Buffer for a fake detalle and asserts `buffer.length > 1000` and starts with `%PDF`. Delete the temp script (don't commit).
- [ ] Commit (`feat(oficina): generador de boleta PDF (pdfkit) + stub email`).

## Task 4: Batch-generate boletas to NAS on cerrar
**Files:** `apps/backend/src/routes/planillaOficina.ts` (cerrar).
**Consumes:** `generarBoletaPdf` (Task 3), `registrarDocumento` + `docsDetalle` (existing), empresa lookup.
- [ ] In `POST /planilla/:mesId/cerrar`, AFTER the asiento is created + cuotas applied + estado set cerrada: load the empresa (razonSocial/ruc/direccion from `empresas` where id=mesRow.empresaId), and for each detalle: if `docsDetalle(detalle.id).boleta` is already true → skip (idempotent); else `generarBoletaPdf(...)` → `registrarDocumento({entidadTipo:'planilla_oficina_detalle', entidadId:detalle.id, docTipo:'boleta_pago', fileBuffer, nombreArchivo:'boleta.pdf', subPath:`${mes}/${dni}`})`. Wrap each in try/catch — a NAS failure logs + continues (does NOT abort the close; the asiento already committed). Count successes; include `boletasSubidas` in the response.
- [ ] Extend test: after cerrar (NAS may be unreachable in test → the count may be 0, that's OK; assert the endpoint still returns 200 and the mes is cerrada). If NAS is testable, assert `documento_adjunto(boleta_pago)` rows appear. At minimum assert cerrar doesn't throw when a boleta upload fails. Run green.
- [ ] Commit (`feat(oficina): boletas PDF batch al NAS al cerrar mes`).

## Task 5: Boleta FE modal — exact layout
**Files:** `apps/frontend/src/components/oficina/BoletaOficina.tsx` (rewrite render).
- [ ] Rewrite the modal body to match the exact Excel layout (same two-column structure + all rubros + rubros-without-data shown 0.00 + Total Bruto/Aporte/Dscto + Neto Recibido + "Lima, fecha" + firma lines). Keep the print button (`window.print()`) and props. Use `fecha_ingreso`/`fecha_cese` from the detalle (add to the `PlanillaOficinaDetalle` type in api.ts if missing — allowed; commit api.ts too if so).
- [ ] `cd apps/frontend; npx tsc --noEmit` → 0.
- [ ] Commit (`feat(oficina): boleta en pantalla con layout exacto del Excel`).

## Task 6: Seed Julio 2026 + verification report
**Files:** Create `apps/backend/scripts/oficina/seed-julio-2026.ts`.
**Consumes:** `xlsx`, the ORM, the live calcular logic (call the route in-process OR replicate the create+calcular via the endpoints with a lucia session — prefer hitting the endpoints in-process like the tests).
- [ ] Parse the Excel PLANILLA sheet (17 rows: nombre, cargo, DNI, sistema pension, cuenta, sueldo + manual amounts). Create/upsert the 17 empleados (tipoPlanilla='admin', activo, sueldoBaseMensual, cargo, cuspp, banco/numCuenta, fechaIngreso), marked with a recognizable flag (e.g. numDoc suffix or a note) for `--limpiar`. Create planilla_oficina_mes 2026-07 + calcular.
- [ ] Compare per person: computed detalle (total_bruto, afp_aporte, afp_seguro, essalud, impto_renta5ta, neto_pago) vs the Excel BOLETA/PLANILLA values (parse them from the sheet). Print a per-person table: field, computed, excel, Δ, OK/DIFF (tolerance 0.50). Print a summary count of diffs.
- [ ] `--limpiar` mode deletes the planilla + the 17 seeded empleados.
- [ ] Run the seed, capture the diff report (it is expected to surface AFP-seguro + Rta5ta differences vs the Excel — that's the point; document them). Commit ONLY the script (not the data — the seed is re-runnable).
- [ ] Commit (`feat(oficina): seed Julio 2026 + reporte de verificacion vs Excel`).

---

## Self-Review
- Spec coverage: A → Tasks 2 (fechas) + 5 (FE layout) + 3 (PDF layout); B → Tasks 1 (engine) + 2 (integration); C → Task 6 (seed); D → Tasks 3 (pdf) + 4 (batch cierre); E → Task 3 (email stub). All covered.
- Placeholders: engine algorithm + layout are concrete; the Rta5ta v1 approximation (acumulado from January) is explicit and calibrated by the seed (Task 6), not a placeholder.
- Type consistency: `calcularRta5ta(Rta5taInput):Rta5taResult` used in Tasks 1-2; `generarBoletaPdf`/`registrarDocumento` reused consistently Tasks 3-4.
