# Planilla de oficina · F2 — Destino del costo, cuentas configurables y pago desde banco

Fecha: 2026-09-29 · Rama: `feat/rbac-multiempresa` · Depende de: F1 (motor v2, `2026-09-29-planilla-oficina-motor-v2-design.md`)

---

## 1. Problema

Hoy `POST /oficina/planilla/:mesId/cerrar` postea un asiento correcto en importes pero ciego en dimensiones y rígido en cuentas:

- **Todas** las líneas llevan `obraId: null` → el costo de la planilla administrativa no llega a ningún proyecto. Los reportes de costo por obra y el "Resultado de obra" no ven este gasto.
- Las cuentas de contrapartida (`6271/4031/407/4032/40173/469/411`) están **hardcodeadas** en la ruta. Kelly no puede cambiarlas sin un deploy, a diferencia de los gastos, que ya usan el mapa editable `gasto_cuenta_map`.
- El neto queda **siempre** como pasivo en `411`. En la operación real Kelly paga la planilla desde una cuenta bancaria concreta el mismo día del cierre; ese egreso no existe en tesorería, así que el saldo de banco del ERP queda alto y la conciliación no cuadra.

F2 cierra las tres.

## 2. Intención acordada

- El costo de la planilla de oficina debe poder **repartirse entre obras**, con porcentajes que Kelly define: **por empleado** (una persona dedicada 100% a una obra) y con un **modo global** (reparto por defecto aplicable a todos), elegible desde un selector.
- La planilla administrativa **nunca es costo directo**: es gasto general. Con obra → `GG_OBRA`; sin obra → `GG_CORP`.
- La planilla **es un gasto que se paga**: Kelly elige **de qué cuenta bancaria sale el dinero**, y el egreso aparece en tesorería como cualquier gasto pagado.
- Las cuentas por concepto deben ser **editables por Kelly**, como el resto de la configuración del motor.
- Kelly debe poder **ver el asiento antes de cerrar**.

Fuera de alcance (F4): lote de pago 1 comprobante → N empleados, subida del comprobante bancario, envío de boletas por correo.

## 3. Decisiones de diseño

### 3.1 Solo las líneas de costo se reparten

Se reparten por obra **únicamente las líneas de gasto** (elemento 6): sueldos y EsSalud empleador. Las líneas de pasivo/control (`4031`, `407`, `4032`, `40173`, `469`, `411`) y la de banco (`104x`) quedan **agregadas con `obraId: null`**.

Por qué: es el mismo patrón que ya usa el motor para los gastos — la línea de gasto lleva obra, el IGV y la CxP no. La deuda con la AFP no es de una obra; el costo del sueldo sí.

### 3.2 Cuentas propias para el costo de oficina (`6211`, `62711`)

La clase CD/GG se deriva de `mapa_cuenta_clase[cuenta] + obraId` (`derivarClaseCore`); **no se puede forzar por línea**. Hoy `621 → CD` porque la planilla de **obreros** sí es costo directo, y `6271` no está mapeada (default `CD`). Si la oficina reusara esas cuentas, su costo se clasificaría CD, que es exactamente lo que el usuario descartó.

Solución: la oficina usa cuentas **distintas de las de obreros**, mapeadas a `GG_OBRA`:

| Concepto | Cuenta oficina | Cuenta obreros (sin tocar) | `mapa_cuenta_clase` |
|---|---|---|---|
| Sueldos | `6211` *Sueldos y salarios* (ya existe, nivel 3, clasificable) | `621` | `6211 → GG_OBRA` (nueva fila) |
| EsSalud empleador | `62711` *EsSalud – personal administrativo* (divisionaria nueva, padre `6271`) | `6271` | `62711 → GG_OBRA` (nueva fila) |

Sembrar la divisionaria sigue el patrón ya presente en `/generar` (`12122`, `4811`). `621` y `6271` no se modifican, así que el asiento de obreros no cambia.

Consecuencia: con obra → `GG_OBRA`; sin obra → `GG_CORP` (la cuenta es clasificable y `obraId` es null). Sale del propio motor, sin caso especial.

### 3.3 Pago desde banco — opción A, con el 411 visible

Al cerrar, Kelly puede elegir una cuenta bancaria. El asiento se arma en dos tramos dentro de **un solo asiento**:

```
devengo:  6211 / 62711            debe   (repartido por obra)
          4031 407 4032 40173 469 haber  (agregado, obraId null)
          411                     haber  (neto, obraId null)
pago:     411                     debe   (neto)
          104x (cuenta elegida)   haber  (neto)
```

El `411` neteo a cero, pero **queda escrito en el asiento**: se lee qué se devengó y qué se pagó sin inferirlo. Además se crea un **movimiento de tesorería** `Egreso` por el neto, en la cuenta elegida.

Si Kelly **no** elige cuenta bancaria, el comportamiento es el de hoy: el neto queda como pasivo en `411` y se pagará después (F4). Esto mantiene la compatibilidad y no fuerza una decisión en el cierre.

### 3.4 El pass de movimientos de `/generar` debe ignorar este movimiento

Riesgo real: el pass 5 de `POST /contabilidad/generar` asienta cada movimiento con `cuentaId` (104x) cuando `CUTOVER` está activo. Si ese pass viera el movimiento de la planilla, **acreditaría el banco dos veces** (una en el asiento de planilla, otra en el del movimiento). Hoy el pass es inerte (`CUTOVER = null`), así que el bug quedaría latente hasta el cutover.

Solución: `movimientos.planilla_oficina_mes_id` (uuid, FK → `planilla_oficina_mes`, `ON DELETE SET NULL`). El pass 5 hace `if (m.planillaOficinaMesId) { resultado.movSkip.planillaOficina++; continue; }`. La columna también da la clave de idempotencia del movimiento y el enlace para reabrir.

## 4. Modelo de datos

### 4.1 `planilla_oficina_distribucion`

```
id           uuid pk default random
empresa_id   integer not null                         -- multi-empresa
empleado_id  uuid null → empleados(id) on delete cascade  -- null = regla GLOBAL
obra_id      uuid not null → proyectos(id) on delete cascade
pct          decimal(5,2) not null                    -- 0 < pct <= 100
actualizado_en timestamp not null default now()
unique (empresa_id, empleado_id, obra_id)             -- nulls not distinct
```

`UNIQUE NULLS NOT DISTINCT` para que la fila global (`empleado_id IS NULL`) sea única por obra.

**Resolución por empleado** (función pura `resolverDistribucion`):

1. ¿Hay filas con `empleado_id = <empleado>`? → se usan **solo** esas.
2. Si no, ¿hay filas globales (`empleado_id IS NULL`)? → se usan esas.
3. Si no hay ninguna → 100% oficina (`obraId: null` → `GG_CORP`).

Regla: dentro de un scope, `Σ pct ≤ 100`; **el resto va a oficina** (`obraId: null`). Un empleado con una sola fila al 60% genera 60% a esa obra y 40% a `GG_CORP`. Validación al escribir: rechaza con 400 si `Σ pct > 100` en el scope.

El empleado **gana** al global por completo (no se mezclan): si Kelly define algo para una persona, eso es su verdad.

### 4.2 `planilla_oficina_concepto_cuenta`

Espejo de `gasto_cuenta_map`:

```
concepto       varchar(40) pk
cuenta         varchar(10) not null → plan_contable(codigo)
actualizado_en timestamp not null default now()
```

Semilla (idempotente, `ON CONFLICT DO NOTHING` — no pisa lo que Kelly ya cambió):

| `concepto` | cuenta | lado | reparte obra |
|---|---|---|---|
| `sueldos` | `6211` | debe | sí |
| `essalud_empleador` | `62711` | debe | sí |
| `essalud_por_pagar` | `4031` | haber | no |
| `afp_por_pagar` | `407` | haber | no |
| `onp_por_pagar` | `4032` | haber | no |
| `renta5ta_por_pagar` | `40173` | haber | no |
| `otros_por_pagar` | `469` | haber | no |
| `neto_por_pagar` | `411` | haber + debe (pago) | no |

El conjunto de conceptos es **cerrado** (lo define el código). Kelly edita la cuenta, no la lista.

Precedencia de la cuenta de sueldo: `detalle.cuentaContable` (manual de Kelly, por trabajador) **manda** sobre `concepto_cuenta['sueldos']`, que a su vez manda sobre el default `6211`. Es la misma precedencia que ya aplica el resto del motor (WS1).

### 4.3 Migración

`apps/backend/scripts/oficina/alter-planilla-oficina-f2.ts`, aditiva e idempotente:

1. `CREATE TABLE IF NOT EXISTS` de las dos tablas.
2. `ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS planilla_oficina_mes_id uuid` + FK `ON DELETE SET NULL` (`IF NOT EXISTS` vía `DO $$`).
3. `INSERT ... ON CONFLICT DO NOTHING` de la divisionaria `62711` en `plan_contable` (padre `6271`, nivel 4, `es_divisionaria = true`, `clasificable = true`).
4. `INSERT ... ON CONFLICT DO NOTHING` en `mapa_cuenta_clase`: `6211 → GG_OBRA`, `62711 → GG_OBRA`.
5. Semilla de `planilla_oficina_concepto_cuenta`.

Nada que backfillar: los meses ya cerrados conservan su asiento tal cual.

## 5. Reparto de importes (sin descuadre)

`repartir(total, slices)` — función pura:

- Orden determinista de slices: por `obra_id` ascendente, la porción de oficina al final.
- Cada slice = `round2(total × pct / 100)`.
- El **último** slice absorbe la diferencia: `total − Σ(anteriores)`.

Garantiza `Σ slices = total` al céntimo, sin depender del umbral de redondeo de `crearAsiento`.

El reparto se aplica **por empleado** (cada uno con su distribución resuelta) y luego se **agrega por (cuenta, obra)** antes de armar las líneas: 17 empleados y 2 obras dan 4 líneas de costo, no 34.

## 6. API

### 6.1 Distribución

- `GET /oficina/planilla/distribucion` → `{ global: [{obraId, obraCodigo, obraNombre, pct}], porEmpleado: [{empleadoId, empleadoNombre, filas: [...]}] }`
- `PUT /oficina/planilla/distribucion` — body `{ empleadoId: string | null, filas: [{obraId, pct}] }`. Reemplaza **el scope completo** (borra + inserta en una transacción). `empleadoId: null` = scope global. 400 si `Σ pct > 100`, si algún `pct <= 0`, o si hay `obraId` repetido.

Reemplazar el scope entero (en vez de PATCH por fila) hace la operación idempotente y deja imposible un estado intermedio con `Σ > 100`.

### 6.2 Mapa de cuentas

- `GET /oficina/planilla/concepto-cuenta` → filas + descripción legible de cada concepto.
- `PUT /oficina/planilla/concepto-cuenta/:concepto` — body `{ cuenta }`. 400 si el concepto no está en el conjunto cerrado o si la cuenta no existe / está inactiva en `plan_contable`.

### 6.3 Vista previa del asiento

`GET /oficina/planilla/:mesId/asiento-preview` → `{ lineas: [{cuenta, descripcion, debe, haber, obraId, obraCodigo, clase}], totales: {debe, haber}, cuadra: boolean }`, con `?cuentaBancariaId=` opcional para ver también las dos líneas del pago.

Se construye con **la misma función** que usa `cerrar` (`armarLineasCierre`), no con una copia. Un test verifica que preview y cerrar producen líneas idénticas.

### 6.4 Cierre

`POST /oficina/planilla/:mesId/cerrar` — body opcional `{ cuentaBancariaId?: string }`.

Si viene `cuentaBancariaId`:
1. Valida que exista y que su `cuentaContable` (104x) exista y esté activa en `plan_contable` → 400 si no.
2. Añade al asiento `411 debe = neto` y `<104x> haber = neto`.
3. Crea el movimiento de tesorería (idempotente: solo si no existe uno con `planillaOficinaMesId = mesId` y `anulado = false`):

```
tipoMovimiento  'Egreso'
fecha           último día del mes (misma que el asiento)
cuentaId        la elegida
monto           neto
moneda          'PEN'
descripcion     'Planilla oficina <YYYY-MM>'
subtipo         'Planilla'
proyectoId      null            -- el reparto vive en las líneas del asiento, no en el movimiento
planillaOficinaMesId  mesId
userId          req.user.id
estado          'Pagada'
```

`proyectoId: null` a propósito: un movimiento tiene un solo proyecto y el costo puede estar repartido entre varias obras. La dimensión obra vive en las líneas del asiento, que es donde la leen los reportes.

### 6.5 Reapertura

`reabrir` hoy borra el asiento. Se extiende para borrar también el movimiento ligado, con un guardarraíl:

- Si el movimiento está **conciliado** (existe una línea de `extracto_lineas` con `movimiento_id = <mov>` en estado `conciliado`) → **409** con el detalle. Borrarlo desharía silenciosamente una conciliación cerrada.
- Si no, se borra dentro de la misma transacción.

## 7. UI

`PlanillaOficinaTab.tsx`, sobre el revamp de F3:

**Sub-tab Configuración** — dos bloques nuevos:

- *Destino del costo*: selector `Global · Por empleado`. En `Global`, una tabla obra + % con fila "Oficina (GG corporativo)" calculada = `100 − Σ`. En `Por empleado`, selector de trabajador y la misma tabla; los trabajadores sin filas propias muestran "hereda el global" con la distribución global en gris.
- *Cuentas por concepto*: tabla concepto / cuenta con edición en línea, mismo patrón `EditNum` (variante texto con validación contra el plan).

**Toolbar** — el botón `Cerrar mes` abre un diálogo con:
- selector de cuenta bancaria (opcional, con un "Dejar como pasivo en 411" explícito),
- el asiento que se va a postear (desde `asiento-preview`), con la clase por línea,
- el aviso de cuánto va a cada obra.

Kelly ve el asiento **antes** de firmar el cierre. Es el momento en que su criterio importa y el único punto donde el error es caro.

## 8. Pruebas de aceptación

`apps/backend/scripts/oficina/test-planilla-f2.ts` (tsx + `node:assert/strict`, imprime `test-planilla-f2 VERDE`):

1. **Resolución** — empleado con filas propias ignora el global; empleado sin filas hereda el global; sin ninguna regla → 100% oficina (`obraId: null`).
2. **Reparto exacto** — 60/40 sobre un total con céntimos: `Σ slices = total`, sin depender del ajuste por redondeo.
3. **Resto a oficina** — una sola fila al 60% deja 40% en `obraId: null`.
4. **Asiento cuadra** — tras repartir 17 empleados entre 2 obras, `Σ debe = Σ haber` y las líneas de costo con obra derivan `GG_OBRA`, las sin obra `GG_CORP`.
5. **Pasivos agregados** — ninguna línea `4031/407/4032/40173/469/411/104x` lleva `obraId`.
6. **Mapa editable** — cambiar `afp_por_pagar` a otra cuenta cambia la cuenta de la línea; el resto no se mueve.
7. **Preview == cerrar** — las líneas de `asiento-preview` son idénticas a las que postea `cerrar`.
8. **Pago desde banco** — con `cuentaBancariaId`: aparecen `411 debe` y `104x haber` por el neto, y se crea exactamente **un** movimiento `Egreso` con `planillaOficinaMesId`.
9. **Idempotencia** — cerrar dos veces (reintento) no duplica asiento ni movimiento; reabrir + recerrar deja el mismo estado.
10. **`/generar` no duplica** — el pass de movimientos salta el movimiento de planilla (verificado con `dryRun=1` y un cutover simulado ≤ la fecha).
11. **Validación** — `Σ pct > 100` → 400; `pct <= 0` → 400; cuenta inexistente en el mapa → 400; cuenta bancaria sin `cuentaContable` válida → 400.
12. **Guardarraíl de reapertura** — movimiento conciliado → 409, el movimiento sobrevive.

Regresión: `test-planilla-julio17`, `test-calc`, `test-cierre` y `test-config-oficina` siguen verdes. El asiento de **obreros** no cambia (usa `621`/`6271`, que F2 no toca).

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Doble crédito al banco tras el cutover | `planilla_oficina_mes_id` + skip explícito en el pass 5, con test |
| Alguien mapea un gasto de obreros a `6211` y se clasifica GG_OBRA | `6211` queda documentada como cuenta de oficina; el default de obreros sigue en `621` |
| Borrar el movimiento al reabrir desharía una conciliación | 409 si está conciliado |
| Distribución apuntando a una obra cerrada | El reparto solo etiqueta la línea; el guard de periodo contable ya bloquea el asiento. No se añade validación de estado de obra |
