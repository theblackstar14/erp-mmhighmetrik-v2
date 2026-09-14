# WS1 · Cuenta contable manual en formularios — spec CONGELADO

Fecha: 2026-08-14 · Depende de: WS0 v0.2.1 CONGELADO + WS-1 apertura (implementado en `erp_mmh_test`).
Trabaja SOBRE un libro que ya arranca cuadrado. DB de trabajo: `erp_mmh_test` (guard `WS1_ALLOW_DATABASE`).
Aprobado por el usuario con 6 ajustes (incorporados). **No reabrir decisiones salvo contradicción real con WS0/WS-1/schema.**

## Objetivo
La `cuenta_contable` deja de inferirse en el motor y pasa a ser un **dato de entrada manual** (Kelly) en los 4 formularios de captura. CD/GG deja de ser input: se **deriva** de (cuenta, obra). El motor lee la cuenta manual si existe (doble-lectura) y cae al mapa `tipoGasto` solo como fallback. Los asientos quedan con `cuenta_contable`, `obra_id`, `clase_derivada` por línea y `empresa_id` en el header.

---

## 1. Almacenamiento (cuenta manual en los orígenes)
Añadir a `gastos`, `movimientos`, `valorizaciones`, `planilla_detalle`:
- `cuenta_contable` **varchar(10)** · FK `plan_contable(codigo)` (NOT VALID · nullable).
- `cuenta_contable_origen` **varchar(10)** · CHECK `IN ('USUARIO','SUGERIDO','AUTOMATICO')` (nullable).
  - `USUARIO` = Kelly la escribió/cambió a mano.
  - `SUGERIDO` = tomada de la memoria por proveedor (§4) y aceptada sin cambio.
  - `AUTOMATICO` = derivada del mapa `tipoGasto→cuenta` (fallback / backfill).
  - El origen describe **cómo se obtuvo la cuenta actualmente almacenada** (no la clase).

`cuenta_contable_origen` es campo separado (espejo de `clasificacion_origen`). No se fusiona con la cuenta.

## 2. `derivarClase(cuenta, obraId)` — fuente de verdad de `clase_derivada`
Nueva función en `apps/backend/src/lib/clasificacion.ts` (junto a `resolverClase`, que se conserva legacy):
```
derivarClase(cuenta, obraId):
  row = plan_contable[cuenta]
  si !row o row.activa=false        → THROW error de dominio ("cuenta inexistente/inactiva")
  si !row.clasificable              → null            (activo/pasivo/patrimonio · elem ≠ 6,9)
  si obraId presente                → mapa_cuenta_clase[cuenta]?.clase_obra ?? 'CD'   (CD | GG_OBRA)
  si obraId ausente                 → 'GG_CORP'
```
- Es la **única** fuente de verdad de `asiento_linea.clase_derivada`.
- `resolverClase()` y `gastos.clasificacion` se mantienen **solo por compatibilidad legacy** (denormalizado/histórico); no gobiernan el asiento.
- Coherente con WS0 §6 (regla, no mapa) e invariante 12 (clase nunca es input).

## 3. Motor doble-lectura + líneas completas
`apps/backend/src/routes/contabilidad.ts`:
- **Gasto loop** (hoy `cm?.cuenta ?? cuentaGasto(...)`): pasa a
  `cuenta = g.cuentaContable ?? cm?.cuenta ?? cuentaGasto(g.tipoGasto)` (la manual gana).
- **`crearAsiento`** (hoy escribe línea solo con `{cuenta,descripcion,debe,haber}`) puebla además por línea:
  - `cuenta_contable = cuenta` (la misma cuenta; ya no solo el varchar legacy).
  - `obra_id` = obra de la línea (de `opts.proyectoId` del origen; por línea cuando aplique).
  - `clase_derivada = derivarClase(cuenta, obra_id)`.
- **`empresa_id` en el header del asiento**: regla = **empresa del origen**. Mientras los orígenes no la tengan explícita, se resuelve con un fallback transitorio `MM=1` (única empresa con obras hoy). NO es un `DEFAULT 1` conceptual: es compatibilidad temporal documentada; cuando los orígenes lleven empresa, se lee de ahí. `crearAsiento` acepta `empresaId` opcional y usa el fallback solo si no viene.
- Sin caminos paralelos: el motor sigue siendo la única vía de asiento (WS0 decisión 9).

## 4. Endpoints backend
- `GET /contabilidad/plan?q=<texto>` → autocomplete. Filtra `activa=true`, busca por `codigo` o `descripcion`, ~20 filas. Devuelve `{codigo, descripcion, tipo, clasificable}`.
- `GET /contabilidad/sugerir-cuenta?proveedorRuc=&tipoGasto=` → prefill:
  1. **cuenta válida más reciente usada con ESE proveedor** (join `gastos` por `proveedor_ruc`, `cuenta_contable` no null, ordenado por fecha desc), validada contra plan activo → `{cuenta, origen:'SUGERIDO'}`.
  2. si no existe, fallback `mapa tipoGasto→cuenta` (`gasto_cuenta_map`) → `{cuenta, origen:'AUTOMATICO'}`.
  3. **solo considerar cuentas existentes/activas** en el plan (descartar las que no lo estén, seguir buscando).
  Sin tabla nueva (la "memoria" es query sobre `gastos`).

## 5. Frontend `<CuentaContableSelect>`
Componente combobox async compartido (`apps/frontend/src/components/contabilidad/CuentaContableSelect.tsx`):
- Busca en `/contabilidad/plan?q=`; muestra `codigo · descripcion`.
- Prefill desde `/contabilidad/sugerir-cuenta` al abrir/cambiar proveedor+tipoGasto.
- Editable: si el usuario cambia el valor sugerido → `cuenta_contable_origen = 'USUARIO'`; si lo acepta tal cual → conserva `SUGERIDO`/`AUTOMATICO`.
- Se **inyecta** (no rehace) en los **4 forms**:
  - **MovModal** (FinanzasPage · path gasto + path movimiento).
  - **Form de valorización**.
  - **Form de planilla**.
- En **gasto/movimiento** es una decisión real (campo prominente). En **valorización/planilla** viene con **default fuerte** (cuentas estándar 1212/70x/40111 · 62x/41x) y funciona como confirmación/corrección. **No** se crea lógica especial de bloqueo para valo/planilla (mismo componente, distinto default).

## 6. Backfill (`erp_mmh_test`)
- **`gastos`**: `SET cuenta_contable = mapa[tipoGasto].cuenta, cuenta_contable_origen='AUTOMATICO' WHERE cuenta_contable IS NULL` **y** la cuenta del mapa exista y esté activa.
- **`movimientos`**: NO tienen `tipoGasto`. Backfill = la `cuenta_contable` del gasto ligado (`gasto_id → gastos.cuenta_contable`) cuando exista, `origen='AUTOMATICO'`. Los movimientos sin `gasto_id` (financieros puros) quedan sin cuenta_contable (su cuenta es el banco `cuentaId→cuentas_bancarias.cuentaContable`, ya disponible; no se inventa contra-cuenta).
- **`valorizaciones`/`planilla_detalle`**: sin backfill masivo (cuentas estándar; se pueblan al capturar/confirmar). Opcional: set del default estándar si se decide, con `origen='AUTOMATICO'`.
- **Estrictamente solo `WHERE cuenta_contable IS NULL`**: nunca sobrescribir una cuenta existente.
- **Verificación posterior**: contar registros que permanezcan `cuenta_contable IS NULL` (tipoGasto sin mapa, mapa inactivo, o mov sin gasto) y reportarlos — no se inventan cuentas.

## 7. Fases y verificación
- **Fase 1 (backend)**: migración cols (§1) + `derivarClase` (§2) + `crearAsiento` extendido + doble-lectura (§3) + endpoints (§4) + backfill (§6).
  Verificación: re-generar un periodo y comprobar que, para un gasto con `cuenta_contable` manual, el `asiento_linea` sale con esa cuenta y `clase_derivada = derivarClase(cuenta, obra)`; sin cuenta manual, cae al mapa como antes (no rompe históricos). Σdebe=Σhaber intacto.
- **Fase 2 (frontend)**: `<CuentaContableSelect>` + inyección en los 4 forms. `npx tsc --noEmit` frontend = **0**.
- Extender la prueba de regresión WS-1 (o añadir un check) que asevere: gasto con cuenta manual → línea con cuenta+clase correctas; endpoint `/plan` y `/sugerir-cuenta` responden; backfill deja 0 nulos inesperados (o los reporta).

## 8. Invariantes / compatibilidad (no romper)
- WS0: asiento única verdad · cuenta manual en línea · CD/GG derivado · obra en línea · empresa en header · Σ=Σ · sin caminos paralelos.
- WS-1: apertura intacta; `documento_pendiente`/`aplicacion_documento` no se tocan (pagos = WS4).
- Schema existente: `gastos.clasificacion`/`destino` y `resolverClase` permanecen (legacy). FK/CHECK nuevos como `NOT VALID` (no revalidar históricos).
- Guard de entorno: toda migración/backfill corre solo en `erp_mmh_test` en esta fase; `erp_mmh`/`f4d`/prod intactas.

## 9. Fuera de alcance (WS1)
- Pagos/aplicaciones (WS4). Tabla `ventas` propia / RVIE (WS3). SIRE/RCE (WS2). Reportes por cuenta / PLE (WS7).
- Migrar el motor a plantillas `asiento_plantilla` (sigue con lógica actual; solo se le añade cuenta manual + líneas completas).
- Denormalizar `empresa_id` a los orígenes (se hace cuando cada origen tenga empresa explícita).

---

## Decisiones CONGELADAS (WS1)
1. `cuenta_contable` varchar(10) + `cuenta_contable_origen` (USUARIO|SUGERIDO|AUTOMATICO) como **campo separado**.
2. `derivarClase(cuenta, obraId)` = única verdad de `clase_derivada`; inexistente/inactiva → error; no clasificable → null; con obra → mapa ?? 'CD'; sin obra → GG_CORP. `resolverClase`/`clasificacion` = legacy.
3. `/sugerir-cuenta`: reciente-por-proveedor → fallback mapa tipoGasto → solo cuentas activas.
4. `empresa_id` = empresa del origen; `MM=1` solo como fallback transitorio (no DEFAULT conceptual).
5. Backfill solo sobre `cuenta_contable IS NULL`, nunca sobrescribe; derivados del mapa = `AUTOMATICO`; verificar remanentes sin cuenta.
6. Selector en los 4 forms; decisión real en gasto/mov, confirmación con default fuerte en valo/planilla; sin lógica de bloqueo especial.
