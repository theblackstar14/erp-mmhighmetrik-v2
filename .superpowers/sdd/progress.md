# SDD Progress — clasificación gastos CD/GG
Plan: docs/superpowers/plans/2026-07-21-clasificacion-gastos-cd-gg.md
Base commit: c1899ca
Workspace: main (no worktree · sistema vivo)

## Ledger
Task 1: complete (commit a969200, schema+backfill). FIX aplicado: 146 filas proyecto+GG_CORP → GG_OBRA (invariante: proyecto solo CD|GG_OBRA). Final erp_mmh: CD 862, GG_OBRA 606, GG_CORP(corp) 106.
  ↳ CARRY a Task 3: resolverClase debe CLAMPEAR proyecto+config.clase=GG_CORP → GG_OBRA (GG_CORP solo si destino=corporativo).
Task 2: complete (commit 24284d7, clase en GET/PUT cuentas-tipo, verificado curl)
  ↳ FIX: borrada fila basura 'Guardiánía' (curl mal-encodeado en test Task 2). Map limpio: 33 filas.
Task 3: complete (commit fee1493). resolverClase en lib/clasificacion.ts + clamp proyecto+GG_CORP→GG_OBRA. Cableado en 4 flujos (finanzas x2, logistica OC, oficina rendicion). Curl A/B/C OK; logistica/oficina verificados por diff.
Task 4: complete (commit 40723c2). GET /proyectos/:id/costos-obra; JSON=DB verificado; respeta ggUtModo (ggPres=null si no separado). Nota: float en resultadoObra → redondear en front.
Task 5: complete (commit 3992142). api.ts: GastoInput+destino/clasificacion/prorrateable, GastoCuentaMapRow+clase, updateCuentaTipo+clase, CostosObra+getCostosObra. tsc 0. Sin tipos viejos.
Task 6: complete (commit d6d9301). Selector CD/GG_OBRA (2 botones) en GastoForm + pre-fill desde config. tsc 0.
Task 7: complete (commit a167839). Columna clase editable en CuentasTipoTab, 3 mutate calls propagan clase. tsc 0.
Task 8: complete (commit 11f3b1f). Bloque 'Resultado de obra (sin gastos de oficina)' en EconomicoTab, fmtPEN redondea float. tsc 0.
Task 9: complete (CASE B, no commit). No existe form global de gasto en UI → corporativo sin punto de entrada UI. FOLLOW-UP: agregar botón 'Registrar gasto corporativo'. tsc 0.

## Review final (opus): sin Critical. 1 Important + 1 Minor → fix d2f42fc
- PUT /gastos/:id ahora re-clampea al editar (carga fila previa + resolverClase). Verificado: PATCH GG_CORP→GG_OBRA.
- POST /proyectos/:id/gastos fuerza destino='proyecto'.
FEATURE COMPLETA. 9 commits: a969200 24284d7 fee1493 40723c2 3992142 d6d9301 a167839 11f3b1f d2f42fc
Follow-ups documentados: (1) UI "Registrar gasto corporativo" (Task 9 CASE B), (2) fase 2: Resultado empresarial + reconciliación con Estado de Resultados.

## Integración Tier 1 + checklist (2026-07-21)
- Montado "Registrar gasto" en Finanzas (commit 281cda5) reusando GastoForm (destino toggle + obra selector + CD/GG). tsc 0. Verificado en navegador (botón + modal completo).
- FIX clasifTouched (commit a557a93): form manda clasificacion solo si el usuario la cambió → origen AUTOMATICO (acepta sugerencia) vs USUARIO (cambia).
- Checklist 1-10: 1 CD/AUTO ✓ · 2 GG_OBRA/AUTO ✓ · 3 corp/GG_CORP/AUTO ✓ · 4 cambio→USUARIO ✓ · 7 clamp crear+editar→GG_OBRA ✓ · 8 reporte=DB ✓ · 9 separado→GG presup 125,316.59 ✓ · 10 embebido/simple→null (no inventa) ✓. Items 5/6 (OC/rendición): wire+lógica validados (resolverClase idéntico a items 1/2), live no ejecutado (efectos colaterales).
- OBS: coexiste hero pre-existente "Utilidad al cierre proyectada" (base EAC, distinta del devengado) — usa palabra "utilidad"; fuera de scope Tier 1, candidato a unificar en fase 2 reconciliación.
