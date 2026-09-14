# SDD ledger — plan: docs/superpowers/plans/2026-09-10-planilla-oficina.md

Workspace: current tree (branch feat/rbac-multiempresa) · NO worktree (depende de cambios WS1 sin commitear).
Base HEAD al inicio: a557a93.
Pre-flight scan: sin conflictos plan↔constraints (plan auto-revisado en writing-plans).

Tasks:
Task 1: complete (commits a557a93..b5efeab, review clean · finding empresa/empresas = falso positivo, FK `REFERENCES empresa(id)` verificado en DB)
Task 2: complete (commits b5efeab..4ad7611, review clean · motor puro, test verde contra boletas reales Levano/Garcia)
Task 3: complete (commits 4ad7611..79c9bbc, review clean · router planillaOficina + config GET/PUT montado en /api/oficina)
Nota Task 4: corregido plan — calcular fresco tiene Renta5ta=0 (neto Levano 5317.80); se anade PATCH detalle para ingresar manuales (renta/HE) → re-deriva (neto 5222.80).
Task 4: complete (commits 79c9bbc..3ccc548, fix round 1/5: C-1 AFP suffix strip + C-2 test data-real ADDRESSED, review clean). Minors diferidos: M-1 (PATCH usa adelanto_cuota congelado del calcular · aceptable), M-2 (N+1 en query de adelantos · bajo volumen), M-3 (correlativo BOL max lexicografico · ok por zero-pad 6 digitos).
Task 5: complete (commits 3ccc548..a509ae7, review clean · adelantos POST/GET + saldo derivado 900->600 probado).
Task 6: complete (commits a509ae7..00892bf, fix round 1/5: Important atomicidad/duplicado asiento ADDRESSED via guard de idempotencia · re-review clean). Diferido: single-transaction-wrap de crearAsiento (refactor WS1-wide, consistente con todos los callers actuales); Minor test-anulado-filter. Cierre Σ=Σ=6540 + reabrir reversible probados. crearAsiento/cargarDerivarCtx ahora exportados en contabilidad.ts.
Task 7: complete (commits 00892bf..aacf1e3, review · codigo correcto; finding NAS path adjudicado FALSO POSITIVO: codigo usa env.NAS_ROOT_ADMIN, .env=/ERP/Administracion es el valor app-wide consistente con todo el modulo · el 02_ era solo default de env.ts). Nota config p/usuario: confirmar carpeta NAS real. Minors diferidos (502 leak, ?? null). documentos VERDE (estado boleta/comprobante + path builder).
Task 8: complete (commits aacf1e3..0b89ba4, review clean · api client 4 tipos + 12 funciones en api.oficina, tsc=0, multipart con fetch/FormData).
Nota: Task 9 dividido en 9a (componentes hoja: DocumentoAdjunto, BoletaOficina, AdelantosPanel) + 9b (PlanillaOficinaTab + wiring OficinaPage). Browser smoke lo hace el controller (subagentes sin browser tools).
Task 9a: complete (commits 0b89ba4..50b5349, review clean · 3 componentes hoja, tsc=0, money con Number(), invalidacion ok). Minor diferido: DocumentoAdjunto chip siempre lee `comprobante` (latente si se reusa con docTipo=boleta).
Task 9b: complete (commits 50b5349..1e0da6b, fix round 1/5: A empSchema persiste cargo/sueldo/asig + B Cargo->cargo + C scope revertido, re-review clean, tsc=0). HALLAZGO PARA TASK 10: el gate de 9b usa rol {admin, contadora} pero los roles RBAC reales son admin/contabilidad/inventario/logistica (NO existe 'contadora') -> Task 10 debe corregir a {admin, contabilidad}.
Task 10: complete (commits 1e0da6b..1842d7a, review clean · front gate corregido a {admin,contabilidad} + backend requireOficinaEdit en 8 rutas mutantes (GET abiertos), admin pasa, tsc=0). Minors diferidos: async middleware sin try/catch (patron repo-wide, hay unhandledRejection global).

TODAS LAS 10 TAREAS COMPLETAS.
Final review (opus): FIX-FIRST · 1 bloqueante (cerrar aplicaba cuotas antes de validar periodo). Fix aplicado commit 4512b6c (423 pre-check + afp map por afpKey + guard mes vacio). Re-review final: 3 ADDRESSED, sin breakage. Contabilidad Σ=Σ por construccion, engine/endpoint consistentes, adelantos idempotentes, state machine bloquea cerrada, money typing ok. Deferred minors triados = OK diferir. Nota v1: estado 'pagada' existe pero ningun endpoint transiciona a el (pago/tesoreria = fase posterior); cerrada siempre reabrible. VEREDICTO: SHIP.
Pendiente NO-codigo: browser smoke UI (requiere login del usuario) + confirmar carpeta NAS real (/ERP/Administracion vs /02_).
