# SDD ledger — plan: docs/superpowers/plans/2026-09-10-boleta-rta5ta-nas.md

Workspace: current tree (branch feat/rbac-multiempresa) · NO worktree (depende del feature planilla-oficina sin mergear).
Base HEAD: 4512b6c. Pre-flight: sin conflictos plan<->constraints.

Tasks:
Task 1: complete (commits 4512b6c..4fc9cfe, review clean · motor rta5ta puro, 3 casos SUNAT verdes: retencion 1625.50/2478/0).
Task 2: complete (commits 4fc9cfe..0a47162, review clean · snapshot fechas + rta5ta auto overridable via flag renta5ta_manual · override sobrevive re-calcular · imptoRenta5ta sacado del blanket-preserve). Minor v1 diferido (rta5ta acumulado ignora gratis/extras + retencionesPrevias=0 · el seed Task 6 lo calibra).
Task 3: complete (commits 0a47162..b3df88c, review clean · generarBoletaPdf pdfkit layout completo + stub email, %PDF valido). Minors PARA FIX-WAVE FINAL (fidelidad "exacta"): columna derecha suprime ceros -> debe mostrar 0.00 como la imagen; montoFeriado tipado sin render (quitar o mostrar Feriado).
Task 4: complete (commits b3df88c..06193d7, review clean · boletas PDF batch al NAS en cerrar, best-effort per-detalle try/catch fuera de la tx contable, idempotente por docsDetalle.boleta, boletasSubidas en response · NAS caido en test -> cerrar sigue 200/cerrada). Minor fix-wave: surfacear boletaErrores en la respuesta.
Task 5: complete (commits 06193d7..3d21f41, review clean · boleta FE layout exacto, 0.00 visible, fechaIngreso/cese en api.ts, tsc=0). Fix-wave: direccion no cableada (renders —, falta prop + data empresa); correlativo oculto si null; PDF zeros; montoFeriado.
Task 6: complete (commits 3d21f41..3367ff9, review clean · seed Julio 2026 + verificacion 71 OK/48 DIFF; los 48 DIFF = 3 items conocidos (tasa afp_tasas 1.84 vs 1.37, rta5ta v1 aprox, bruto Yangari estructural) · SIN bugs de mapeo · base aporte/ONP/EsSalud/bruto validada). Limpieza --limpiar verificada (0 SEED, 0 planilla). Minors: dead-code fallbacks, --limpiar no restaura sueldo de preexistentes (documentado).
TODAS LAS 6 TAREAS COMPLETAS.
Fix-wave (commit 8f18f44): A PDF 0.00 · B montoFeriado dead · C boletasFallidas en response · D empresa real (api.admin.empresas.list) en boleta · E correlativo siempre. Re-review: A-E ADDRESSED, sin breakage. Minor nit diferido: api.ts cerrarPlanillaOficina no tipa boletasFallidas (benigno).
FEATURE COMPLETO (commits 4512b6c..8f18f44). SHIP.
Decisiones de calibracion que el SEED expuso (para el usuario):
 1) afp_seguro: afp_tasas=1.84% pero boletas reales de julio usaron ~1.37% -> Kelly confirma tasa SPP vigente y edita afp_tasas (dato editable, no bug).
 2) rta5ta v1: proyeccion lineal desde enero (Levano 632.90 vs real 95) -> exacto solo con YTD real + fecha ingreso + retenciones previas. Hoy Kelly sobrescribe manual; mejora v2 = proyeccion fecha-ingreso-aware.
Pendiente no-codigo: confirmar carpeta NAS, go-ahead email.
Post-feature: boleta reestilizada como documento formal (estilo OC · logo/bordes/bandas · commit ca5f214) + fix CARGO heredado (9cfab4e). Review limpio (solo BoletaOficina.tsx, tsc=0, call-site cablea empresa). BROWSER SMOKE HECHO: se ve como OC (BOL-100010 Challco · logo MM, emisor RUC 20610639764, N° BOLETA bordeado, bandas grises, dos columnas 0.00, Total Bruto/Dscto, Neto verde, Lima 30/09/2026, firmas). Nit diferido: printSheet hardcodea .oc-print-sheet -> fitHeightMm no-op para .bol-print-sheet (print OK, zoom-to-fit no).