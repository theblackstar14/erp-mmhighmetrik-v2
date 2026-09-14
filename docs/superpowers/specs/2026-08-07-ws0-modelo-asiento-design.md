# WS0 · Modelo canónico del ASIENTO — spec v0.2.1 · **CONGELADO**.1 · CONGELADO

Fecha: 2026-08-07 · Estado: diseño (NO código). Cimiento de WS-1 y WS1-7.
Decisiones FIJADAS (roadmap v2, confirmadas por el usuario):
1. Unidad atómica = **asiento**. 2. `cuenta_contable` = eje, manual (Kelly). 3. CD/GG **derivado** (mapa cuenta→clase).
4. `obra_id` por **línea** cuando corresponda. 5. `empresa_id` desde ahora. 6. Σdebe=Σhaber. 7. Anular = contra-asiento.
8. Idempotencia. 9. Compras/ventas/bancos/planilla/cajas = **orígenes/plantillas** de asiento, no modelos aislados.

---

## 1. Auditoría del modelo actual

### Entidades hoy
| Entidad | Rol hoy | Veredicto |
|---|---|---|
| `asientos` (header) | correlativo, fecha, periodo, glosa, **origen+origenId (idempotencia)**, moneda, tipo_cambio, **proyectoId (obra en HEADER)**, contraparte, status, cerrado_mes, userId | **MANTENER + extender** (empresa_id; obra pasa a línea) |
| `asientos_lineas` | asiento_id, correlativo, **cuenta (varchar, NO FK)**, descripcion, debe, haber | **MANTENER + extender** (cuenta FK, obra_id, clase_derivada) |
| `gastos` | Fact de Compras · **clasificacion CD/GG**, clasificacionOrigen, destino, tipoGasto, cuentaId(banco) · SIN cuenta_contable | **MIGRAR de rol**: pasa a ser ORIGEN/documento, deja de ser fuente de verdad contable |
| `movimientos` | caja · cuentaId(banco), naturalezaContable, gastoId | **MIGRAR de rol**: ORIGEN caja |
| `valorizaciones` | obra · genera venta (12x/70x/40x) | ORIGEN venta (obra) |
| `planilla_detalle` | montos planilla | ORIGEN planilla |
| `cuentas_bancarias.cuentaContable` | mapeo banco→104x | MANTENER (feed del `cuenta_contable` de la línea de caja) |
| `gasto_cuenta_map` | **tipoGasto → cuenta + clase** | **MIGRAR** → semilla de `mapa_cuenta_clase` (invertir a cuenta→clase) |
| `plan_contable` | codigo, descripcion, tipo | **PROMOVER** a tabla canónica `cuenta_contable` (+ divisionarias, empresa) |
| `empresas` + `usuario_empresa` | multi-empresa (solo usuarios/params) | MANTENER · **falta cablear a lo contable** |
| `resolverClase` (lib) | deriva CD/GG por destino+tipoGasto+clamp | **RE-ORIENTAR**: derivar clase desde cuenta+obra (no tipoGasto) |

### Fuentes de verdad paralelas (el problema)
Hoy conviven 3 vistas del mismo hecho: `gasto` (devengo) · `movimiento` (caja) · `asiento` (derivado). La cuenta contable **se decide en el motor al generar**, no se persiste ni se elige. CD/GG vive en el gasto. **Contradice** decisiones 1,2,3: el asiento debe ser la unidad, la cuenta debe ser un dato de entrada manual, CD/GG debe derivarse.

### Qué mantener / migrar / eliminar
- **Mantener**: `asientos`/`asientos_lineas` (extendidos), idempotencia `origen+origenId`, status/cerrado_mes (H1/H2), `cuentas_bancarias.cuentaContable`.
- **Migrar de rol**: `gastos`/`movimientos`/`valorizaciones`/`planilla_detalle` → ORÍGENES (documentos fuente), NO fuente de verdad contable. Su `clasificacion` queda como histórico/denormalizado; la verdad pasa a `asiento_linea.clase_derivada`.
- **Eliminar como fuente de verdad**: `gastos.clasificacion` como dato primario (se deriva). `gasto_cuenta_map` como determinante único (se generaliza a plantilla + mapa cuenta→clase).

---

## 2. Modelo canónico propuesto

### `empresa` (existe · reusar)
`id, ruc, razon_social, activa`. Doratta + MM + otras.

### `cuenta_contable` (promover `plan_contable`)
`codigo (PK, PCGE + divisionarias), descripcion, tipo (activo/pasivo/…), nivel, parent_codigo, es_divisionaria, empresa_id (null = compartida; set = divisionaria propia), activa`.
Justificación: el plan base PCGE es compartido; Kelly crea **divisionarias** (10411-01…) que pueden ser propias por empresa.

### `asiento` (HEADER · extender `asientos`)
Campos del ENCABEZADO (atómicos del hecho, uno por asiento):
`id, empresa_id, correlativo, fecha, periodo, glosa, origen (compra/venta/banco/planilla/caja/apertura/anulacion/manual), origen_id, hash (idempotencia), moneda, tipo_cambio, contraparte_ruc, contraparte_razon, status (enum `asiento_status`: borrador/registrado/cerrado/anulado · **`registrado` = canónico** del ERP; `contabilizado` era solo vocabulario conceptual, nunca existió en enum/código/datos), cerrado_mes, anula_a_asiento_id (si es contra-asiento), user_id, created_at`.
- **`empresa_id` en el header**: un asiento es atómico DENTRO de una empresa (Σdebe=Σhaber se cumple por empresa; su balance de comprobación es por empresa). Un hecho inter-empresa = DOS asientos (uno por empresa), no uno cruzado.
- `origen_id`+`hash`: idempotencia (un documento fuente = un asiento).

### `asiento_linea` (LÍNEA · extender `asientos_lineas`)
Campos EXCLUSIVOS de la línea (varían por renglón del asiento):
`id, asiento_id, correlativo, cuenta_contable (FK), descripcion, debe, haber, obra_id (null = corporativo/oficina), clase_derivada (CD/GG_OBRA/GG_CORP · cacheada)`.
- **`cuenta_contable` en la línea**: cada renglón golpea una cuenta distinta (60x, 40x, 42x…). Es el EJE; se asigna a mano.
- **`obra_id` en la línea**: un mismo asiento puede repartirse entre obras (un pago que cubre 2 obras; oficina+obra). La obra es dimensión de la LÍNEA, no del asiento.
- **`clase_derivada` cacheada en la línea**: se calcula de (cuenta, obra_id) al guardar; se persiste para reportes rápidos, pero NO es fuente de verdad (recalculable). CD/GG nunca vuelve a ser dato de entrada.
- **SIN `empresa_id` en la línea** (v0.2): `asiento.empresa_id` es la ÚNICA fuente de verdad de empresa. En esta fase la línea NO lleva empresa_id — todo query por empresa hace join a `asientos` (índice barato). Si más adelante la performance lo exige, se agrega como copia PURAMENTE derivada mantenida por trigger, que **jamás se edita independientemente**. Regla congelada.

### `asiento_plantilla` (NUEVO)
Patrón débito/haber por tipo de operación → el formulario elige plantilla y precarga cuentas; Kelly corrige.
`id, codigo, nombre, origen (compra/venta/banco_pago/planilla/caja/apertura), lineas_patron (jsonb)`.
`lineas_patron` = `[{ rol: 'gasto'|'igv'|'cxp'|'caja'|'ventas'|'neto'…, cuenta_default, lado: 'debe'|'haber', fuente_monto: 'base'|'igv'|'total'|'formula' }]`.

### `mapa_cuenta_clase` (NUEVO · DATA de la regla de clasificación)
`cuenta (o prefijo), clase_obra (CD | GG_OBRA)`. Semilla desde `gasto_cuenta_map` (invertir cuenta→clase).
**v0.2 — precisión semántica**: este mapa NO es "el clasificador"; es la **DATA** que alimenta una **regla explícita** `derivarClase(cuenta, obra_id)`. La regla (no el mapa) es la fuente de la derivación (ver §6). Además `cuenta_contable` lleva la marca **`clasificable`** (verdadera solo para cuentas de gasto/costo — elementos 6 y 9); las demás (activo/pasivo/patrimonio) devuelven `clase = null`.

### `obra` (reusar `proyectos`)
`obra_id` nullable en la línea. **Nota (usuario)**: MM y otras empresas NO siempre tienen obra con cronograma valorizado — a veces algo menor vía cotización. → `obra_id` opcional + concepto "obra ligera/cotización" **diferido** (se verá después); el modelo ya lo soporta con obra_id null o un proyecto de tipo simple.

### `documento_pendiente` (NUEVO v0.2 · sub-mayor de CxC/CxP por tercero) — CRÍTICO para WS-1
El asiento golpea la cuenta CONTROL (1212 CxC / 4212 CxP) al nivel del **mayor**; el DETALLE por tercero y documento (para aging, pago parcial, migración de apertura) vive en un **sub-mayor de partidas abiertas**, NO en `asiento_linea` (mezclar mayor y auxiliar rompería el modelo).
`id, empresa_id, tipo (cxc|cxp), cuenta_control (FK · 1212/4212/45x/41x), tercero_ruc, tercero_razon, doc_tipo, doc_serie, doc_numero, fecha_emision, fecha_venc (opc), moneda, tipo_cambio, monto_original, saldo_pendiente (DERIVADO · cache), estado (abierto|parcial|cancelado · derivado), obra_id (opc), asiento_origen_id (FK · el asiento que la creó), doc_origen_tipo/id (gasto/venta/rendicion · opc)`.
- **Apertura**: cada factura pendiente = 1 `documento_pendiente`; el asiento de apertura lleva la línea CONTROL (total) — no una línea por tercero.
- **`saldo_pendiente` es DERIVADO** (v0.2.1): `= monto_original − Σ aplicacion_documento.monto_aplicado (activas)`. Se cachea, pero la verdad son las aplicaciones. `estado` deriva del saldo.
- **Invariante de conciliación**: `Σ saldo_pendiente (por empresa, cuenta_control) == saldo contable de la cuenta control`.
- Por qué NO en `asiento_linea`: el header ya tiene `contraparte` (un tercero) para operaciones de 1 tercero; pero apertura/CxP multi-tercero necesitan N documentos con vencimiento/saldo → sub-mayor. La línea contable NO debe llevar vencimiento/saldo pendiente (eso es sub-mayor, no mayor).

### `aplicacion_documento` (NUEVO v0.2.1 · trazabilidad pago↔documento)
Relación explícita entre un pago/cobro (asiento) y el `documento_pendiente` que aplica. Reemplaza el "restar saldo a ciegas": el saldo se DERIVA de las aplicaciones.
`id, documento_pendiente_id (FK), asiento_id (FK · el asiento de aplicación/pago), asiento_linea_id (opc · la línea de la cuenta control), monto_aplicado, moneda, tipo_cambio (opc), fecha, estado (activa|anulada), created_by, origen_ref/hash (idempotencia)`.
- Reconstrucción: `documento → aplicaciones → asiento(s) → banco/caja`.
- **Invariantes**: `Σ aplicaciones(documento) ≤ monto_original`; `saldo = monto_original − Σ aplicaciones activas`; `Σ aplicaciones(asiento, cuenta_control) == movimiento del asiento en esa cuenta control` (el sub-mayor y el mayor se mueven en lockstep).
- **Idempotencia**: único `(asiento_id, documento_pendiente_id)` — un asiento aplica una sola vez a un documento (un pago puede cubrir N documentos = N aplicaciones; un documento recibe M pagos parciales = M aplicaciones · relación N↔M).
- **Reversión/anulación**: si el asiento de pago se anula (contra-asiento), sus aplicaciones pasan a `estado=anulada` → se excluyen de Σ → el saldo se recompone solo. Sin editar históricos.
- Ejemplo: F001-123 original 1,180 → aplicación 1 (asiento X, 600) + aplicación 2 (asiento Y, 580) → saldo 0. Anular Y → aplicación 2 anulada → saldo 580.

### Relaciones mínimas
```
empresa 1─* cuenta_contable(divisionarias)   empresa 1─* asiento
asiento 1─* asiento_linea                    asiento_linea *─1 cuenta_contable
asiento_linea *─0..1 obra(proyecto)          asiento *─0..1 asiento(anula_a)
asiento.origen_id ─> documento origen (gasto/movimiento/valorizacion/planilla/rendicion)
plantilla ─(precarga)─> asiento_linea        mapa_cuenta_clase ─(deriva)─> asiento_linea.clase_derivada
```

---

## 3. Invariantes de dominio
1. **Σdebe = Σhaber** por asiento (tolerancia 0). Rechazo al guardar si no cuadra.
2. **No asiento sin líneas** (≥2).
3. **No línea sin cuenta_contable** (FK obligatoria).
4. **debe ≥ 0 y haber ≥ 0**; una línea usa debe XOR haber (no ambos > 0). Sin importes negativos.
5. **No modificación destructiva** de asiento `registrado`: no UPDATE de líneas ni DELETE.
6. **Anular = contra-asiento**: nuevo asiento espejo (debe↔haber) con `origen='anulacion'`, `anula_a_asiento_id`, y el original pasa a `status='anulado'`. Trazabilidad por FK + audit_log.
7. **Idempotencia**: `(origen, origen_id)` único entre asientos no anulados; `hash` del contenido evita doble registro del mismo hecho.
8. **Periodo cerrado** (`cerrado_mes`): sin altas/anulaciones salvo reapertura auditada (H2). Gate 423.
9. **Cambio de cuenta en periodo cerrado**: bloqueado; si abierto, se hace por anulación+re-emisión (no edición) y queda en audit_log (quién/antes/después).
10. **empresa consistente**: `asiento.empresa_id` única verdad; las líneas no llevan empresa_id (v0.2).
11. **Sub-mayor cuadra con el mayor**: `Σ documento_pendiente.saldo_pendiente (empresa, cuenta_control) == saldo de la cuenta control en el mayor`. Un pago nunca reduce solo el sub-mayor sin postear el asiento (y viceversa).
12. **clase_derivada nunca es input**: no existe campo de CD/GG en formularios; se calcula por `derivarClase()` y se cachea.
13. **Pago trazable (v0.2.1)**: aplicar un pago a un documento = crear `aplicacion_documento` (nunca restar saldo directo). `saldo = monto_original − Σ aplicaciones activas`; `Σ aplicaciones(asiento,cuenta_control) = movimiento del asiento en la control`. Anular pago → aplicaciones anuladas → saldo se recompone.

---

## 4. Flujo contable (una sola máquina)
`Formulario (origen) → elige plantilla → precarga cuentas (Kelly corrige) → construye asiento_linea[] → valida invariantes (Σ=, cuentas, empresa) → deriva clase por línea → persiste asiento (idempotente) → reportes/PLE leen del asiento`.
Compras, ventas, bancos, planilla, cajas y apertura **usan el mismo motor**; solo cambian la plantilla y el documento origen.

---

## 5. Ejemplos end-to-end (mismo motor)

**A · Compra S/1,180 (base 1000 + IGV 180)** · empresa=MM, plantilla=compra, origen=gasto:
| # | cuenta | obra | debe | haber | clase_deriv |
|---|---|---|---|---|---|
|1| 603/634 (Kelly elige) | PG0001 | 1000 | | CD |
|2| 40111 IGV crédito | — | 180 | | (no gasto) |
|3| 4212 CxP proveedor | — | | 1180 | |
Σdebe=1180=Σhaber ✓. Cuenta manual; CD derivada de (603, obra).

**B · Pago de esa compra desde banco** · plantilla=banco_pago, liga la compra (origen_id=gasto A):
|1| 4212 CxP proveedor | — | 1180 | | |
|2| 10411 BCP soles | — | | 1180 | |
Σ ✓. Idempotencia: un solo pago por compra.

**C · Apertura** · plantilla=apertura, origen=apertura:
|1| 10411 banco | — | 50000 | | |
|2| 1212 CxC | — | 30000 | | |
|3| 4212 CxP | — | | 20000 | |
|4| 591 resultados acumulados | — | | 60000 | |
Σdebe=80000=Σhaber ✓.

**D · Gasto de obra**: igual a A con `obra_id=PG0001` en la línea de gasto → clase CD/GG_OBRA según la cuenta. Mismo asiento, dimensión en la línea.

**E · Mismo concepto en 2 empresas**: DOS asientos: uno `empresa_id=MM`, otro `empresa_id=Doratta`. Misma plantilla/cuenta, header distinto. NUNCA un asiento cruzado.

**F · Reclasificación/anulación** (cuenta equivocada en asiento X):
1. Contra-asiento X' (espejo debe↔haber, `anula_a=X`, origen='anulacion'); X.status=anulado.
2. Nuevo asiento con la cuenta correcta.
Audit_log registra el cambio. Sin editar X.

---

## 6. Tratamiento de CD/GG — conclusión explícita (v0.2: regla, no mapa)
**`cuenta_contable` = fuente de verdad. CD/GG = atributo derivado por una REGLA explícita.**
```
        cuenta_contable  +  contexto de línea (obra_id)
                          ↓
                    derivarClase()   ← REGLA (función única, no un mapa suelto)
                          ↓
                    clase_derivada
```
Regla `derivarClase(cuenta, obra_id)`:
```
  si NO cuenta.clasificable (no es gasto/costo · elem ≠ 6,9)  → null
  si obra_id presente   → mapa_cuenta_clase[cuenta].clase_obra   (CD | GG_OBRA)
  si obra_id ausente    → GG_CORP
```
`mapa_cuenta_clase` es SOLO la data del primer factor; `clasificable` (en la cuenta) y `obra_id` (contexto de línea) completan la regla. **Prohibido** exponer CD/GG como campo de entrada del usuario: no hay input de clase en ningún formulario; la clase se calcula y se cachea.
**Caso NO determinístico detectado (documentado, NO revierte la decisión):** una MISMA cuenta de gasto (ej. 634 mantenimiento) puede ser **CD/GG_OBRA** (si es de obra) o **GG_CORP** (si es de oficina). → La clase depende de **(cuenta, obra_id)**, no de la cuenta sola. Se resuelve con `obra_id` en la línea: la cuenta sigue siendo primaria; `obra_id` desambigua obra vs corporativo. CD/GG **nunca** vuelve a ser dato de entrada. (Esto es exactamente el `destino`+clamp de `resolverClase`, ahora reorientado a cuenta+obra.)
Ejemplo de Kelly (EPPs): la 1ª vez a cuenta de materiales (→CD), la 2ª a cuenta de planilla (→según cuenta). **Cambia la CUENTA, no la clase de una misma cuenta** → confirma el determinismo cuenta→clase.

---

## 7. Plan de migración
- **Conservar columnas**: `gastos.clasificacion`/`destino` quedan como histórico (no fuente de verdad). `asientos`/`lineas` se extienden sin romper.
- **Dejar de ser fuente de verdad**: `gastos.clasificacion` (→ deriva). La cuenta ya no se infiere en el motor: se persiste en la línea.
- **Migraciones**:
  1. `ALTER asientos ADD empresa_id` (backfill = MM por defecto).
  2. `ALTER asientos_lineas ADD cuenta_contable FK, obra_id, clase_derivada, empresa_id`; backfill `obra_id` desde `asientos.proyecto_id` (header), `cuenta_contable` desde `cuenta`.
  3. `CREATE mapa_cuenta_clase`; seed invirtiendo `gasto_cuenta_map` (cuenta→clase).
  4. `CREATE asiento_plantilla`; seed patrones (compra/venta/banco/planilla/caja/apertura) desde la lógica actual del motor.
  5. Recalcular `clase_derivada` de líneas históricas con la fórmula §6.
- **Compatibilidad temporal**: el motor `/generar` sigue funcionando mientras se migra; se le añade "usar cuenta manual si viene, si no derivar como hoy". Doble-lectura hasta cortar.
- **CD/GG histórico**: se re-deriva desde la cuenta de la línea + obra_id (no se pierde; se recomputa).

---

## 8. Riesgos / contradicciones detectadas
- **3 fuentes de verdad** (gasto/movimiento/asiento) → hay que declarar el asiento como única verdad contable y a los otros como orígenes; riesgo de divergencia si algún flujo escribe asiento sin pasar por el motor.
- **`asientos_lineas.cuenta` varchar → FK**: cuentas históricas que no existan en el plan romperán la FK; sanear antes.
- **obra en header vs línea**: durante la transición ambos existen; declarar la línea como verdad y deprecar el header `proyecto_id`.
- **empresa_id backfill**: todo lo histórico se asume MM; si hay data Doratta mezclada, separar.
- **cuenta compartida obra/oficina** (§6): resuelto con obra_id, pero exige que el form capture obra_id por línea.
- **Plantillas vs realidad**: una plantilla rígida no cubre casos raros; debe permitir agregar/editar líneas a mano (Kelly).

## 9. Archivos/código a tocar (después, no ahora)
- `packages/db/src/schema.ts` — extender asientos/lineas, nuevas tablas, empresa_id.
- `apps/backend/src/routes/contabilidad.ts` — motor `/generar` → plantilla-driven; usar cuenta manual; derivar clase.
- `apps/backend/src/lib/clasificacion.ts` — `resolverClase` → `derivarClase(cuenta, obraId)`.
- `apps/backend/src/routes/{finanzas,logistica,oficina}.ts` — los 4 flujos que insertan gasto/movimiento → pasar cuenta_contable + obra por línea.
- `apps/backend/src/routes/proyectos.ts` — costos-obra lee `asiento_linea.clase_derivada` + obra_id (no gastos.clasificacion).
- Frontend — `<CuentaContableSelect>` en MovModal/GastoForm/etc (WS1).
- Migraciones psql (ambas DBs).

---

## Decisiones que deben quedar CONGELADAS antes de WS-1
1. **El asiento es la única fuente de verdad contable**; gasto/movimiento/valo/planilla son orígenes.
2. **`cuenta_contable` en la línea, manual, obligatoria**; `plan_contable` promovido a tabla canónica con divisionarias.
3. **CD/GG derivado por `mapa_cuenta_clase` + obra_id**; `gastos.clasificacion` deja de ser primario.
4. **`obra_id` en la línea** (dimensión de línea); header `proyecto_id` deprecado.
5. **`empresa_id` en el header** (un asiento = una empresa; inter-empresa = 2 asientos); denormalizado en línea para índice.
6. **Anulación = contra-asiento**; nunca edición/borrado de registrados; audit del cambio de cuenta.
7. **Idempotencia** por `(origen, origen_id)` + hash.
8. **Invariante Σdebe=Σhaber** al guardar.
9. **Orígenes usan plantillas** sobre el mismo motor; prohibido crear caminos contables paralelos.
10. **"Obra ligera/cotización"** (empresas sin cronograma valorizado) → soportada por obra_id null; diseño detallado DIFERIDO.

> Validación del modelo: `apertura → compra → CxP → pago → banco → obra → multiempresa` se representa con el MISMO motor y plantillas (ejemplos A-F). Sin caminos paralelos. ✅

---

## 10. Prueba de estrés conceptual (v0.2) — A–I
Formato: origen · asiento · líneas (cuenta/obra/debe/haber) · sub-mayor · CD/GG · trazabilidad.

**A · Apertura (banco + 3 CxC + 4 CxP + detracciones + patrimonio)** · origen=apertura · empresa=MM
Asiento (líneas CONTROL): Dr 10411 banco · Dr 1212 CxC (total 3) · Dr 1071 detracciones (BN) · Cr 4212 CxP (total 4) · Cr 591 resultados acum. Σ=Σ.
Sub-mayor: 3 `documento_pendiente` (cxc, por cliente, con venc/saldo/moneda) + 4 (cxp, por proveedor). Invariante: ΣCxC=1212, ΣCxP=4212.
CD/GG: null (cuentas de balance). Trazabilidad: asiento origen=apertura; cada documento_pendiente → asiento_origen_id.

**B · Compra S/1,180** · origen=gasto · plantilla=compra
Dr 603 (Kelly)/obra PG0001 1000 [CD] · Dr 40111 IGV 180 · Cr 4212 CxP 1180. + 1 documento_pendiente (cxp, proveedor, factura, venc). Trazab: asiento.origen_id=gasto; doc_pendiente.doc_origen=gasto.

**C · Pago PARCIAL de esa compra (S/600)** · origen=movimiento · plantilla=banco_pago
Dr 4212 CxP 600 · Cr 10411 banco 600. Aplicación: documento_pendiente.saldo 1180→580, estado=parcial. Trazab: asiento.origen_id=movimiento; aplicación liga doc_pendiente.

**D · Pago FINAL (S/580)** · igual a C. documento_pendiente.saldo→0, estado=cancelado.

**E · Factura en USD (100 USD, TC 3.75)** · origen=gasto
Asiento moneda=USD, tipo_cambio=3.75; importes en PEN (375 base…) en el mayor. documento_pendiente guarda moneda=USD, tipo_cambio, monto_original=100 USD, saldo en USD. Al pagar con TC distinto → línea extra **diferencia de cambio** (Dr/Cr 676/776). *(El detalle de dif. cambio queda DIFERIDO, pero el modelo lo soporta: moneda+TC en asiento y en sub-mayor.)*

**F · Gasto repartido entre 2 obras** · origen=gasto
1 asiento: Dr 603/obra A 600 [CD] · Dr 603/obra B 400 [CD] · Dr 40111 IGV 180 · Cr 4212 CxP 1180. Σ=Σ. Obra en cada línea; clase por línea.

**G · Gasto corporativo con la MISMA cuenta que una obra** · origen=gasto
Dr 634 mantenimiento / **obra_id=null** → `derivarClase(634, null)=GG_CORP`. La MISMA 634 con obra_id=PG0001 daría CD/GG_OBRA. La cuenta es igual; **obra_id desambigua**. Demuestra la regla §6.

**H · Doratta y MM** · dos asientos: uno empresa_id=MM, otro empresa_id=Doratta. Misma plantilla/cuenta, header distinto. Nunca un asiento cruzado. Balance de comprobación por empresa.

**I · Reclasificación (cuenta equivocada)** · Contra-asiento espejo (anula_a=X, origen=anulacion) + nuevo asiento con la cuenta correcta. X.status=anulado. Audit_log del cambio. Sin editar X. Si la línea creaba un documento_pendiente, se anula y se re-crea.

**Resultado**: los 9 casos se representan con `asiento`+`asiento_linea`+`documento_pendiente`+plantillas, un solo motor, Σ=Σ, CD/GG siempre derivada. No aparece ningún camino contable paralelo. ✅

---

## 11. Otros puntos que podrían romper WS-1 (revisados)
- **Duplicación de verdad**: gasto/movimiento/asiento → declarado: asiento = única verdad; los demás = orígenes. `contraparte` en header (1 tercero) vs `documento_pendiente` (N terceros) → resuelto (header conveniencia, sub-mayor para multi).
- **Datos en header que van en línea**: obra (movida a línea) ✅. **Datos en asiento que van en auxiliar**: tercero/venc/saldo de CxC-CxP → `documento_pendiente` ✅.
- **Moneda/TC**: en header (asiento) + en sub-mayor (partida) para FX; diferencia de cambio = línea extra. OK.
- **Terceros**: maestro proveedores/clientes ya existe; `documento_pendiente.tercero_ruc` lo referencia.
- **Documentos pendientes**: sub-mayor (nuevo) resuelve aging/pago parcial.
- **Periodos cerrados**: la apertura postea a un periodo "apertura" (día previo al go-live) que debe estar ABIERTO al migrar y luego se cierra (H2).
- **Idempotencia**: asiento `(origen,origen_id)`+hash; apertura origen=apertura, origen_id=empresa → 1 por empresa; `documento_pendiente` único `(empresa,tipo,doc_tipo,doc_serie,doc_numero)` para no duplicar partidas.
- **Históricos**: asientos actuales sin empresa_id/obra_id/cuenta_FK → backfill (empresa=MM, obra desde header, cuenta desde varchar, sanear cuentas fuera del plan). `gastos.clasificacion` histórico → re-derivar.

---

## CAMBIOS RESPECTO A v0.1
1. **empresa_id fuera de la línea**: solo en el header (única verdad). Denorm en línea DIFERIDO (y si se agrega, es copia por trigger, no editable).
2. **CD/GG = regla explícita** `derivarClase(cuenta, obra_id)` con `mapa_cuenta_clase` como DATA + marca `clasificable` (elem 6/9) en la cuenta. Diagrama `cuenta+contexto → clase`. Prohibido input de clase.
3. **Nueva entidad `documento_pendiente`** (sub-mayor CxC/CxP por tercero/documento) — el asiento queda a nivel cuenta control; el detalle (tercero, doc, venc, saldo, moneda) en el sub-mayor. Invariante Σsub-mayor=saldo control.
4. **Invariantes +2**: sub-mayor cuadra con mayor; clase nunca es input.
5. **Prueba de estrés A–I** añadida; todos los casos representables sin caminos paralelos.

## DECISIONES CONGELADAS
1. Asiento = única fuente de verdad contable; gasto/movimiento/valo/planilla = orígenes.
2. `cuenta_contable` en la LÍNEA, manual, obligatoria (FK a `cuenta_contable`/plan promovido).
3. CD/GG derivado por **regla** `derivarClase(cuenta, obra_id)` (+ `clasificable`); nunca input.
4. `obra_id` en la LÍNEA; header `proyecto_id` deprecado.
5. `empresa_id` SOLO en el header (un asiento = una empresa; inter-empresa = 2 asientos).
6. CxC/CxP por tercero/documento en **`documento_pendiente`** (sub-mayor); asiento a nivel cuenta control. **Pago = `aplicacion_documento`** (cruce explícito asiento↔documento); `saldo_pendiente` DERIVADO de las aplicaciones, nunca resta directa; anular pago → aplicación `estado=anulada`.
7. Anulación = contra-asiento; nunca edición/borrado de registrados; cambio de cuenta auditado.
8. Idempotencia `(origen, origen_id)` + hash; `documento_pendiente` único por documento.
9. Invariantes: Σdebe=Σhaber; sub-mayor=mayor.
10. Orígenes usan **plantillas** sobre el mismo motor; prohibido crear caminos contables paralelos.

## PUNTOS QUE WS-1 PUEDE ASUMIR COMO ESTABLES
- Tablas: `asiento`(+empresa_id), `asiento_linea`(+cuenta FK, obra_id, clase_derivada), `documento_pendiente`, `cuenta_contable`(+clasificable, divisionaria/empresa), `mapa_cuenta_clase`, `asiento_plantilla`, `empresa`, `obra`.
- Apertura = 1 asiento `origen=apertura` por empresa (líneas control) + N `documento_pendiente` (CxC/CxP por tercero) + saldos de banco/detracciones/patrimonio.
- Invariantes 1–12 aplican a la carga de apertura (Σ=Σ, sub-mayor=mayor, idempotencia por empresa).
- CD/GG de líneas de balance = null; no requiere mapa para apertura.

## RIESGOS QUE QUEDAN DIFERIDOS
- **Diferencia de cambio** (FX) en pagos con TC distinto: modelo lo soporta (moneda+TC en asiento y sub-mayor); el asiento de ajuste se detalla después.
- **Obra ligera / cotización** (empresas sin cronograma valorizado): `obra_id` null o proyecto simple; diseño detallado después.
- **Denorm `empresa_id` en línea** por performance: solo si los reportes lo exigen.
- **Plantillas parametrizables avanzadas** (fórmulas complejas): v1 con plantillas fijas + edición manual de líneas.
- **Backfill de históricos** (empresa=MM, re-derivar clase): se hace en su propia migración, no bloquea el modelo.

## Conclusión
**¿WS0 estable para empezar WS-1? → SÍ.** Con las 3 correcciones de v0.2 (empresa en header, CD/GG como regla, `documento_pendiente` para CxC/CxP), el modelo representa apertura/compra/CxP/pago/banco/obra/multiempresa con un solo motor y sin caminos paralelos.

### Migraciones que WS-1 consumirá (contrato para WS-1, sin implementar aún)
1. `empresa` — asegurar filas MM + Doratta.
2. `cuenta_contable` (promover `plan_contable`): + `clasificable` (bool, true si elem 6/9), `es_divisionaria`, `empresa_id` (null=compartida), `activa`.
3. `asiento` ALTER: + `empresa_id` (FK, not null tras backfill=MM), + `anula_a_asiento_id`, + `hash`.
4. `asiento_linea` ALTER: + `cuenta_contable` (FK), + `obra_id` (FK proyectos), + `clase_derivada` (varchar null). Backfill: cuenta_contable=cuenta, obra_id=asiento.proyecto_id.
5. `documento_pendiente` CREATE (campos §2). Índice único `(empresa_id, tipo, doc_tipo, doc_serie, doc_numero)`.
6. `aplicacion_documento` CREATE (campos §2). Índice único `(asiento_id, documento_pendiente_id)`.
7. `mapa_cuenta_clase` CREATE + seed (invertir `gasto_cuenta_map` → cuenta→clase_obra).
8. `asiento_plantilla` CREATE + seed (compra/venta/banco_pago/planilla/caja/apertura).
9. Todas en AMBAS DBs (erp_mmh + erp_mmh_f4d) y en la DB de trabajo (test).
> WS-1 (apertura) escribirá: 1 `asiento` origen=apertura/empresa + líneas control + N `documento_pendiente`. No toca formularios.

---

# ✅ WS0 CONGELADO — listo para implementar WS-1
v0.2.1 · aprobado por el usuario. 3 correcciones (v0.2) + `aplicacion_documento` (v0.2.1) congeladas.
Decisiones adicionales congeladas: asiento = única verdad · cuenta_contable manual y obligatoria en la línea · obra_id en la línea · Σdebe=Σhaber · anulación=contra-asiento · periodo cerrado no editable · plantillas = precarga, nunca sustituto de la decisión de Kelly · sin caminos contables paralelos. Ningún blocker estructural pendiente. El contrato de WS-1 está en `2026-08-07-ws1-contrato-apertura.md`.
