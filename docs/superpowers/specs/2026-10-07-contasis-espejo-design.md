# Espejo CONTASIS · diseño

Fecha: 2026-10-07
Estado: propuesto
Decisiones tomadas por Gabriel: enfoque **A** (catálogo canónico + espejo por periodo), dueño del libro = **CONTASIS**, plan de cuentas canónico = **el de CONTASIS**, el **export chico entra en el alcance**.

## Propósito

El estudio contable de MM High Metrik lleva la contabilidad oficial en CONTASIS. Hoy el ERP
genera sus propios asientos, con lo que hay dos libros que nadie cruza: si Kelly registra algo
distinto de lo que calculó el ERP, nadie se enteraría.

Este trabajo hace que el ERP **reciba el libro diario de CONTASIS y lo adopte como la verdad
contable**, conservando como propio todo lo operativo (OC, caja, CxP, obra) y todo lo que el ERP
calcula y Kelly no puede reconstruir desde un documento (planilla, valorizaciones, provisiones).

Éxito es: al cerrar un mes, el diario/mayor/EEFF del ERP muestran **exactamente** lo que muestra
CONTASIS, y las diferencias entre lo que el ERP calculó y lo que Kelly registró aparecen como una
lista de hallazgos en vez de desaparecer.

### Lo que NO es

- No es una integración en vivo con CONTASIS. El intercambio es por archivo, manual, mensual.
- No reemplaza el motor de asientos del ERP. El motor sigue corriendo; en un periodo espejado sus
  asientos quedan desplazados a `borrador` en vez de borrados.
- No toca PLE. `ple.ts` lee `gastos`/`ventas` directo, no `asientos` (verificado: 0 referencias a
  asientos en el módulo PLE salvo el correlativo informativo).

## Insumos recibidos de Kelly

| Archivo | Qué es realmente |
|---|---|
| `LIBRO DIARIO CONTASIS.xlsx` | **Reporte de salida** del libro diario. 1 hoja `Reporte`, cabecera en filas 2-5, encabezados en fila 7, datos desde B8, fila `TOTALES` y pie `SISTEMAS CONTASIS` al final. Muestra con 1 asiento de prueba (5 líneas, 218/218). |
| `PLAN DE CUENTAS ESTANDAR_SQL.xlsx` | **Esquema + data de su tabla de plan de cuentas.** Fila 1 títulos, fila 2 tipos (`C (20,0)`, `N (1,0)`), fila 3 **nombres de columna de su DB**, datos desde fila 5. `(*) CODIGO` marca la PK. 3396 cuentas, `cper = 2026` en todas. |

Falta (pedido a Kelly, ver §9): su plan **ya personalizado**, el catálogo de **centros de costo**, y
la **plantilla de importación** del diario (lo recibido es el reporte, no la plantilla de carga).

## 1. Hallazgos que condicionan el diseño

### 1.1 El plan de CONTASIS casi calza con el nuestro

| | |
|---|---|
| Nuestras cuentas (`plan_contable`) | 1814, largo máx. 5 |
| Suyas | 3396, largo máx. **10** |
| Compartidas | 1328 |
| Solo nuestras | 487 |
| Solo suyas | 2068 |

`plan_contable.codigo` es `varchar(10)` y `asientos_lineas.cuenta_contable` también → **el largo
máximo de CONTASIS entra sin migrar tipos.**

De las **39 cuentas realmente usadas** en nuestros asientos, 35 existen en su plan. Las 4 huérfanas:

| Nuestra | CONTASIS estándar | Resolución |
|---|---|---|
| `10441`, `10451` | su 104 solo llega a `1041x`/`1042x` | Kelly las crea en su plan personalizado |
| `407` (AFP) | **no existe el 407** | Kelly lo crea, o mapeo a `403x` |
| `6279` | su 627 llega hasta `6277` | Kelly la crea |

Las 4 son casos de personalización pendiente, no de diseño. Hasta que Kelly responda, el
importador las **rechaza con mensaje claro**; no las inventa.

### 1.2 El doble juego 61x/20x es data, no lógica

`cdesdeb` / `cdeshab` = destino automático, poblado en **1369 cuentas**:

```
6011020  MERCADERÍAS - COMPRAS     →  debe 20111   haber 6111020
60322521 SUMINISTROS - COMBUSTIBLES →  debe 2521    haber 61320252
```

El asiento de prueba de 5 líneas son 2 líneas capturadas + 3 derivadas de esta tabla. Para el
**import** esto es informativo (las líneas ya vienen expandidas en el archivo). Importa para el
**export**: si entregamos un asiento tocando una cuenta con destino automático, CONTASIS puede
expandirlo por su cuenta y duplicar. Ver §6.3.

### 1.3 El destino CD/GG vive en el sufijo de la cuenta

```
6271093   RÉG. PRESTACIONES SALUD - CDS        → destino 9311 (costo directo de servicios)
6271094   RÉG. PRESTACIONES SALUD - ADM        → destino 9411 (gastos administrativos)
6271095   RÉG. PRESTACIONES SALUD - VTA        → destino 9511 (gastos de venta)
6271096   RÉG. PRESTACIONES SALUD - OTROS      → destino 9611
62719011  RÉG. PRESTACIONES SALUD - PROD DIR   → destino 9011
62719021  RÉG. PRESTACIONES SALUD - PROD IND   → destino 9021
                                       todas  → haber 7911
```

Es **nuestro `clase_derivada` (CD / GG_OBRA / GG_CORP) codificado en el número de cuenta**. Nosotros
lo derivamos de `mapa_cuenta_clase` + `obra_id`; ellos del sufijo. Misma información, dos formas,
traducible en ambos sentidos. Se aprovecha para poblar `mapa_cuenta_clase` al cargar el catálogo.

**Ambigüedad pendiente (pregunta 4 a Kelly):** no sabemos si para una constructora `093` cubre
costo directo de obra Y gastos generales de obra, o si usa `9011`/`9021` para separarlos. Si `093`
los junta, **perdemos la distinción CD vs GG_OBRA que hoy sí tenemos.** El diseño asume la tabla de
mapeo de §3.3 y se ajusta con su respuesta sin cambiar estructura.

### 1.4 El centro de costos está sin configurar — y es la dependencia dura

`nafecos` (CENTRO DE COSTOS) viene vacío en **3394 de 3396** cuentas, y en el asiento de prueba
`C.COSTOS` / `C.COSTOS 2` también vienen vacíos.

El resultado por obra del ERP (CD + GG por proyecto, saldo de obra, prorrateo) se alimenta de
`asientos_lineas.obra_id`. **Si los asientos de CONTASIS no traen centro de costos, el espejo deja
ciego todo el reporting por obra** — lo que más valor le da a Mario.

Esto no se resuelve con código. Es el punto 1 del pedido a Kelly y es **bloqueante para F2**.
Mitigación mientras no esté: el importador marca el periodo como `espejo_sin_obra` y los reportes
por obra siguen leyendo nuestros asientos (ver §4.3).

### 1.5 Los 8 reportes contables ya filtran por status — el espejo es un flip

Todas las superficies contables de `apps/backend/src/routes/contabilidad.ts` gatean en
`status = 'registrado'`:

| Endpoint | Línea |
|---|---|
| `GET /plan` (saldos) | `:238` |
| `GET /mayor` | `:444` |
| `GET /balance` | `:481` |
| `GET /fiscal` | `:524` |
| `GET /mayor-resumen` | `:630` |
| `GET /estados-financieros` | `:677` |
| `GET /reporte-sombra` | `:1449` |
| `GET /ple` (correlativo) | `:2434` |

Consecuencia de diseño, y es la razón por la que este trabajo es barato: **el espejo se implementa
desplazando el status de nuestros asientos, sin reescribir un solo reporte.** CONTASIS entra como
`registrado`; lo nuestro en ese periodo baja a `borrador`.

### 1.6 Distribución real de asientos — el 99.7% es espejo puro

| `origen` | n | ¿Kelly tiene el documento fuente? |
|---|---|---|
| `movimiento` | 2154 | sí (extracto, recibos) |
| `gasto` | 1582 | sí (la factura) |
| `valorizacion` | 5 | **no** |
| `planilla` | 2 | **no** |
| `planilla_oficina` | 1 | **no** |
| `extorno_provision` | 1 | **no** |
| `apertura` | 1 | **no** |

3736 de 3746 son espejo puro. Solo **10 asientos** son de origen ERP. El export chico, entonces, es
~10 asientos al mes, no 3700.

## 2. Las dos familias de asiento

Todo el diseño cuelga de esta partición.

### 2.1 Espejo puro — Kelly tiene el documento fuente

`origen ∈ {gasto, movimiento, venta}`. Compras, ventas, bancos, caja, detracciones.

Kelly produce su asiento desde la misma factura o el mismo extracto. Al importar el mes:
el asiento de CONTASIS entra `registrado`, el nuestro pasa a `borrador` y queda apuntando al que lo
desplazó. Trabajo manual extra: **cero**.

### 2.2 Origen ERP — el ERP es la única fuente del cálculo

`origen ∈ {planilla, planilla_oficina, valorizacion, extorno_provision, apertura}` + los
movimientos de provisión 48 y el prorrateo de GG.

Kelly no puede inventar el neto de planilla, la AFP ni la renta de 5ta: eso sale de nuestro motor
v2, calibrado contra su Excel de julio 2026. Para estos, **el espejo cambia el dueño del apunte, no
el dueño del cálculo**:

```
ERP calcula          →  asiento queda 'borrador' (propuesta, no entra al mayor)
export chico         →  Kelly recibe el archivo con el asiento ya armado
Kelly lo registra    →  en CONTASIS, pegando nuestro correlativo en GLOSA 2
import del mes       →  vuelve como 'registrado'
matching             →  el ERP casa su propuesta contra lo registrado
diferencia           →  hallazgo explícito, no silencio
```

El riesgo de doble conteo se convierte en una **verificación**.

### 2.3 Fuera del espejo por completo: la OC

La orden de compra **no es un hecho contable**, es un compromiso. CONTASIS no sabe qué es una OC y
no tiene por qué. Se queda 100% en el ERP: 3-way match, saldo comprometido por obra, prorrateo,
sobrecosto.

Lo único contable que nace de una OC es **el pago**, y ese pago aparece en el extracto bancario de
Kelly → entra como `movimiento`, familia espejo puro. **La OC no se toca en este trabajo.**

## 3. Modelo de datos

Criterio: extender lo existente, no crear un libro paralelo. Un libro paralelo obligaría a
reescribir los 8 reportes de §1.5.

### 3.1 `plan_contable` — columnas nuevas

```
contasis_nivel        integer      -- nnivcue (1|2|3)
contasis_tipo         integer      -- ntipcue (1..7)
contasis_analisis     integer      -- nanacue: 0 ninguno · 1 genérico · 2 tercero · 5 tributo
destino_debe          varchar(10)  -- cdesdeb · cuenta destino automático al debe
destino_haber         varchar(10)  -- cdeshab · cuenta destino automático al haber
exige_centro_costo    boolean      -- nafecos <> null · exige obra en la línea
cod_balance_1         varchar(4)   -- ccodbal1 · formulario EEFF (F115, F210…)
cod_balance_2         varchar(4)   -- ccodbal2 · (N215, N310…)
cuenta_cierre         varchar(10)  -- ccuecie
es_contasis           boolean      -- true si vino del catálogo de CONTASIS
```

No se migra `codigo` ni `parent_codigo`: ya son `varchar(10)`.

Las 487 cuentas que solo existen del lado nuestro **se conservan** (`activa = true`, `es_contasis =
false`): están usadas en el histórico y borrarlas rompe FKs validadas.

`cper` (2026) **no se modela.** El plan es un catálogo, no una serie temporal; si 2027 difiere se
recarga. Decisión deliberada, marcada con comentario `ponytail:` en el loader. Si alguna vez hay que
ver dos años a la vez, se agrega `periodo_plan` a la PK y se migra; no antes.

### 3.2 `asientos` — dos columnas

```
espejado_por_asiento_id  uuid     -- FK asientos.id · non-null ⇒ este asiento fue DESPLAZADO
                                  --   por el de CONTASIS que apunta. status pasa a 'borrador'.
contasis_key             varchar(20)  -- 'YYYYMM-SSS-NNNN' (periodo · subdiario · nº asiento)
                                      --   solo en asientos importados. UNIQUE por empresa.
```

Ojo con el año: la columna `MES` del archivo trae solo `'09'`, sin año. El `YYYY` de
`contasis_key` sale del periodo declarado al importar (validación §4.2.6, que garantiza un solo mes
por archivo), no de la columna. `correlativo` = `'CT-' || contasis_key` = 19 caracteres, entra en el
`varchar(20)` existente.

**No se agrega un valor al enum `asiento_status`.** `borrador` + `origen` + `espejado_por` alcanzan
para distinguir los tres casos:

| Caso | status | origen | espejado_por |
|---|---|---|---|
| asiento oficial de CONTASIS | `registrado` | `contasis` | null |
| nuestro, desplazado por el espejo | `borrador` | `gasto`/`movimiento`/… | **set** |
| propuesta pendiente de que Kelly registre | `borrador` | `planilla`/`valorizacion`/… | null |

`origen` suma el valor `'contasis'`.

### 3.3 `contasis_centro_costo` — mapeo centro de costo ↔ obra

```
codigo       varchar(20) PK   -- código de centro de costo de CONTASIS
proyecto_id  uuid             -- FK proyectos · null = corporativo (GG_CORP)
descripcion  text
empresa_id   integer NOT NULL
activo       boolean default true
```

Sin fila aquí, una línea con centro de costo desconocido **rechaza la importación**. No se adivina
la obra: una obra mal asignada corrompe el resultado del proyecto, que es el reporte que Mario mira.

### 3.4 `contasis_import` — lote, idempotencia y rollback

```
id            uuid PK
empresa_id    integer NOT NULL
periodo       varchar(7) NOT NULL   -- YYYY-MM
archivo       text                  -- nombre original
hash          varchar(64) NOT NULL  -- sha256 del archivo · UNIQUE(empresa_id, hash)
estado        varchar(12)           -- validado | aplicado | anulado
n_asientos    integer
n_lineas      integer
total_debe    numeric(14,2)
total_haber   numeric(14,2)
motivo        text                  -- requerido si el periodo ya estaba cerrado
user_id       uuid
created_at    timestamp
```

El estado de espejado de un periodo **se deriva**: un periodo está espejado si tiene un
`contasis_import` en estado `aplicado`. No hay flag nuevo en `periodos_contables`.

Reimportar un archivo corregido: se anula el lote anterior (revierte el flip de status) y se aplica
el nuevo. Reversible, auditado, sin borrado duro.

### 3.5 `contasis_staging_linea` — qué entró, tal cual

Las 22 columnas del archivo en texto crudo, más `import_id`, `fila_excel` y `error`. Sirve para
diagnosticar un rechazo sin volver a pedirle el archivo a Kelly, y para que la UI muestre el error
señalando la fila real del Excel.

## 4. Flujo de importación

### 4.1 Parseo

El archivo es un reporte, con lo que el parser tiene que tolerar su forma:

- Encabezados en la **fila 7**, datos desde **B8** (la columna A está vacía; `!ref` es `B2:Y15`).
- Mapear por **nombre de encabezado**, no por índice. Las posiciones cambian entre versiones de
  reporte; los nombres no.
- Descartar la fila `TOTALES` (reconocible por `FECHA` vacía) y el pie `SISTEMAS CONTASIS`.
- **Todo viene padded a ancho fijo**: `CUENTA` a 20, `RUC` a 15, `DESCRIPCIÓN` a 200+, `GLOSA` a 80.
  `trim()` en todo campo de texto.
- `SERIE` = `0000000000000000F002` y `NÚMERO` = `00000000000000000035`: quitar ceros a la izquierda.
  Ojo: una serie **puede ser numérica** (`001`) — se quitan los ceros de relleno, no los
  significativos. Regla: la serie es lo que queda tras quitar el prefijo de ceros hasta el primer
  carácter no-cero; el número se parsea como entero y se reformatea.
- `FECHA` llega como fecha con desfase de zona (`2026-09-16T05:00:36.000Z` = 16/09 en Lima −05).
  Leer la celda **como string** (`raw: false`) o normalizar con la zona `America/Lima`. No usar
  `new Date()` sobre el valor crudo: desplaza el día y mueve asientos de mes.
- El RUC y la razón social de la empresa salen de la **cabecera** (`RUC: 20000000000`, fila 3), no
  de las líneas.

El parseo sale a `contasis_staging_linea` sin validar. Validar y parsear por separado hace que un
error de validación no obligue a releer el Excel.

### 4.2 Validaciones — frontera de confianza, ninguna se simplifica

Un archivo que no pase **todas** no se aplica. Rechazo con la fila de Excel y el motivo.

1. **Cuadre por asiento.** Σ debe = Σ haber en cada `contasis_key`. Un asiento descuadrado no entra,
   ni aunque el total del archivo cuadre.
2. **Cuadre del archivo** contra la fila `TOTALES` del reporte, cuando viene.
3. **Toda cuenta existe** en `plan_contable`. No se auto-crea: una cuenta inventada con descripción
   adivinada contamina el catálogo canónico y el EEFF. Rechaza y nombra las faltantes.
4. **Centro de costos.** Si la cuenta tiene `exige_centro_costo`, la línea debe traer `C.COSTOS` y
   ese código debe existir en `contasis_centro_costo`. Si no, rechaza.
5. **Empresa.** El RUC de la cabecera debe coincidir con la `empresa_id` destino. Importar el diario
   de otra empresa al ERP de esta es el peor error posible y es silencioso.
6. **Periodo.** Todas las líneas del archivo caen en un solo `YYYY-MM`, y ese periodo es el que se
   declara al importar. Un archivo con dos meses se rechaza.
7. **Periodo cerrado.** Importar sobre un periodo con `cerrado_mes` **está permitido** —es el caso
   normal, Kelly cierra antes de mandar— pero exige `motivo` y queda en `audit_log`, igual que la
   reapertura de H2.
8. **Idempotencia.** `UNIQUE(empresa_id, hash)`: el mismo archivo no entra dos veces. Un archivo
   distinto para un periodo ya espejado exige anular el lote anterior explícitamente.
9. **Moneda.** El reporte **no trae moneda ni tipo de cambio**. Se asume PEN. Si aparece un archivo
   con montos en USD no hay forma de detectarlo → se declara explícitamente en el pedido a Kelly
   (§9) y, hasta tener respuesta, los asientos importados se graban `moneda = 'PEN'` sin TC. Riesgo
   conocido y documentado, no silencioso.

### 4.3 Aplicación del lote

En una transacción:

1. Agrupar las líneas por `contasis_key` = `MES` + `S/D` + `ASI.`.
2. Por grupo, insertar un `asiento` con `origen = 'contasis'`, `status = 'registrado'`,
   `correlativo = 'CT-' || contasis_key`, `contasis_key`, glosa de la columna `GLOSA`,
   `contraparte_ruc`/`contraparte_razon` de la primera línea que las traiga.
3. Insertar las líneas con `cuenta` y `cuenta_contable` = código CONTASIS, `obra_id` resuelto desde
   `C.COSTOS` vía `contasis_centro_costo`, y `clase_derivada` por `derivarClase()` existente.
4. **Desplazar los nuestros**: los asientos del periodo con `status = 'registrado'` y
   `origen <> 'contasis'` pasan a `borrador` con `espejado_por_asiento_id` apuntando al asiento de
   CONTASIS que los reemplaza (ver §5 para cómo se elige cuál).
5. Registrar el lote como `aplicado` y escribir `audit_log`.

Tras el paso 4, los 8 reportes de §1.5 muestran CONTASIS **sin un solo cambio en su código**.

**Degradación si el centro de costos no está configurado (§1.4):** no choca con la validación
§4.2.4, y conviene ver por qué: esa validación exige centro de costos solo en cuentas con
`exige_centro_costo`, y hoy ese campo viene vacío en 3394 de 3396 cuentas. Es decir, mientras Kelly
no configure `nafecos`, **ninguna cuenta exige obra y el archivo pasa la validación sin traer una
sola obra**. Ese es justamente el caso que hay que degradar en vez de aceptar en silencio.

Si ninguna línea del archivo trae
`C.COSTOS`, el lote se aplica igual pero se marca `espejo_sin_obra`, y los reportes **por obra**
(saldo de obra, resultado de obra, prorrateo) siguen leyendo nuestros asientos desplazados en vez de
los de CONTASIS. Es una inconsistencia deliberada y visible: mejor un reporte por obra correcto
construido con nuestros números que un reporte vacío. La UI lo dice con un aviso en el periodo, no
en silencio.

## 5. Matching

### 5.1 Token en GLOSA 2

`GLOSA 2` viene vacía en el reporte — columna libre. El export chico escribe ahí
`ERP:<correlativo>` (`ERP:AS-202609-0042`) y se le pide a Kelly que lo conserve. Al importar, un
token presente casa el asiento de CONTASIS con nuestra propuesta de forma exacta y sin heurística.

### 5.2 Fallback sin token

Si no hay token, se casa por `(periodo, conjunto de cuentas, total debe)`. Funciona para los
asientos de origen ERP, que son grandes, pocos y únicos en el mes (la planilla es un asiento de
muchas líneas y un total irrepetible). **No** se usa para la familia espejo puro: ahí hay cientos de
asientos de montos repetidos y un match equivocado sería peor que ninguno.

Para espejo puro el desplazamiento es **por periodo completo**, no por asiento: todo lo nuestro del
mes baja a `borrador`. `espejado_por_asiento_id` queda null en ese caso y se registra el
`import_id` del lote. No necesitamos saber qué asiento de CONTASIS reemplazó a cuál cuando los dos
libros describen los mismos documentos; necesitamos que el mayor no sume dos veces.

### 5.3 Bandeja de diferencias

Un endpoint y una vista que lista, para el periodo:

- **Propuestas sin registrar**: `origen` ∈ familia ERP, `status = 'borrador'`, sin casar → Kelly no
  cargó el asiento. Es lo que hay que reclamarle.
- **Casadas con diferencia**: casó por token o fallback pero el total o el juego de cuentas difiere →
  tabla comparativa línea a línea.
- **Registradas sin propuesta**: asiento de CONTASIS de una cuenta de la familia ERP sin propuesta
  nuestra → Kelly registró algo que el ERP no calculó. Vale revisarlo.

## 6. Export chico

### 6.1 Qué exporta

Los asientos de la familia ERP (§2.2) de un periodo, en `status = 'borrador'` y sin casar. ~10 al
mes. Un botón "Paquete para CONTASIS" en el periodo.

### 6.2 Formato — gap conocido

**Todavía no tenemos la plantilla de importación de CONTASIS** (lo recibido es el reporte de
salida). Mientras no llegue, el export escribe el **mismo layout de 22 columnas del reporte**, que
sabemos que su sistema entiende al menos para leer, con `GLOSA 2` = `ERP:<correlativo>`.

Esto está aislado en un único módulo (`contasisExport.ts`) con el layout en una constante, para que
cuando Kelly mande la plantilla real el cambio sea esa constante y el mapeo de campos, no el flujo.
Decisión deliberada: no inventamos un formato que después hay que rehacer.

### 6.3 Riesgo de destino automático

Si un asiento nuestro toca una cuenta con `destino_debe`/`destino_haber` poblado (§1.2), CONTASIS
puede expandirlo solo y duplicar las líneas de destino. Antes de exportar, el generador **revisa** si
alguna cuenta del asiento tiene destino automático y, si la tiene, avisa en el export y en la UI para
que Kelly confirme cómo cargarlo. No se exporta en silencio algo que su sistema va a expandir.

Las cuentas de planilla (`62x`, `40x`, `41x`) tienen destino automático en el catálogo, así que este
caso **no es hipotético**: es el primero que va a aparecer. Es, además, pregunta abierta para Kelly.

## 7. Impacto en lo existente

| Módulo | Cambio |
|---|---|
| 8 reportes contables | **ninguno** (gatean por status, §1.5) |
| `ple.ts` | **ninguno** (lee `gastos`/`ventas`, no asientos) |
| `POST /contabilidad/generar` | debe negarse a generar en un periodo espejado (sería un asiento muerto al nacer) |
| `POST /asientos/:id/anular` | un asiento `origen = 'contasis'` no se anula de a uno; se anula el lote |
| `derivarClase()` / `mapa_cuenta_clase` | se extiende con las cuentas nuevas, sembrando la clase desde el sufijo (§1.3) |
| Cierre de periodo (H2) | el freeze sigue igual; el import sobre periodo cerrado pasa por el mismo camino auditado de la reapertura |
| Saldo/resultado de obra | lee los asientos espejados **si** traen centro de costos; si no, los nuestros (§4.3) |

## 8. Fases

Cada fase deja algo verificable y nada rompe lo anterior.

**F1 · Catálogo canónico** — ✅ HECHO (2026-10-07, commits `9dec5f8..42ea436`)
Columnas nuevas de `plan_contable`, loader del Excel del plan, tabla `contasis_centro_costo` vacía.
*Check:* ✅ `scripts/contasis/test-regresion-plan.ts` verde · 3879 cuentas (3392 de CONTASIS +
487 nuestras intactas) · las 39 en uso resuelven su FK y siguen activas · `derivarClase()` idéntico ·
1368 destinos automáticos cargados. Regresión de WS1 verde.

Desvíos y hallazgos de F1:
- **`mapa_cuenta_clase` NO se sembró.** Sembrarlo desde los sufijos de destino reclasificaría gasto
  ya registrado, y el mapeo sufijo→clase depende de la pregunta 4 de §9. Se siembra en F2.
- **4 códigos repetidos en el export de Kelly** (`ccodcue` es su PK, así que el Excel no es un dump
  fiel): `30221`, `30224`, `6882` solo cambian la descripción; **`628095` trae `cdesdeb` distinto
  (`9511` VTA vs `9611` OTROS)**. El loader conserva la primera fila y lo imprime. Pregunta para
  Kelly; hoy ninguna de las 4 está usada en un asiento.
- **Para F5 (UI), no se arregla antes:** `contabilidad.ts:204` limita el selector de cuentas a 30 y
  `627%` ya matchea 52 — el usuario no ve la que busca y no hay aviso. `contabilidad.ts:236`
  (`GET /plan?periodo=`) no pagina: 290 ms y 1.55 MB de payload para 3879 cuentas.
- `contasis_centro_costo` queda vacía hasta que Kelly mande su catálogo (pregunta 1 de §9).

**F2 · Importador** — bloqueada por la respuesta de Kelly a los puntos 1 y 2 (§9)
Parser, staging, las 9 validaciones, aplicación del lote, desplazamiento de status, anulación de
lote.
*Check:* importar el archivo de prueba (1 asiento, 218/218) y ver el mayor mostrando CONTASIS;
anular el lote y ver el mayor volver a lo nuestro. Un archivo con un asiento descuadrado rechazado
con la fila correcta.

**F3 · Matching y bandeja de diferencias**
Token `GLOSA 2`, fallback por periodo+cuentas+monto, los tres grupos de §5.3.
*Check:* una propuesta de planilla casada por token; la misma con el monto alterado aparece como
diferencia.

**F4 · Export chico**
`contasisExport.ts`, botón del paquete mensual, aviso de destino automático.
*Check:* el paquete de un mes con el asiento de planilla, con el token en `GLOSA 2`, y el aviso
disparando en las cuentas `62x`.

**F5 · UI**
Tab "Espejo CONTASIS" en Contabilidad: estado del periodo, importar, lotes, bandeja de diferencias,
paquete. Aviso visible de `espejo_sin_obra`.

## 9. Bloqueantes y preguntas abiertas para Kelly

Bloquean F2:

1. **Centros de costo = nuestras obras.** Su lista, idealmente con el mismo código que nuestras
   obras. Sin esto el espejo no alimenta el reporting por obra (§1.4).
2. **¿Qué es `C.COSTOS 2`?** Si `C.COSTOS` es la obra: ¿fase/partida, o una segunda obra en
   prorrateo? **Nuestro modelo asume una obra por línea**; si una línea se reparte entre dos obras,
   `asientos_lineas` necesita cambio estructural y este diseño se revisa.

No bloquean, pero cambian decisiones:

3. **`nafecos` sin poblar** en 3394/3396 cuentas. Que lo marque en las de costo y gasto.
4. **Sufijos de destino**: ¿`093` cubre CD de obra y GG de obra juntos, o usa `9011`/`9021` para
   separarlos? Si los junta, perdemos la distinción CD/GG_OBRA (§1.3).
5. **Las 4 cuentas huérfanas** (`10441`, `10451`, `407`, `6279`): ¿las crea, o las mapeamos?
6. **Plantilla de importación del diario** — necesaria para cerrar §6.2.
7. **Token en `GLOSA 2`** — pedirle que lo conserve al registrar un asiento del paquete.
8. **Moneda.** El reporte no trae moneda ni TC. ¿Lleva todo en PEN, o existen asientos en USD? Si
   existen, ¿en qué columna vienen? Hasta la respuesta, todo importado se graba PEN (§4.2.9).
9. **Destino automático en planilla** (§6.3): al cargar nuestro asiento de planilla, ¿su sistema
   expande los destinos solo, o espera las líneas ya expandidas?
10. **`628095` viene dos veces con destino distinto** (`9511` VTA vs `9611` OTROS) en el export del
    plan. Cargamos la primera (`9511`); ¿cuál es la correcta? (Hallazgo de F1. Los otros tres
    repetidos — `30221`, `30224`, `6882` — solo cambian la descripción y no importan.)

## 10. Decisiones deliberadas (y cuándo revisarlas)

- **Sin libro paralelo.** El espejo vive en `asientos`. Revisar si alguna vez hace falta ver los dos
  libros simultáneamente, no antes.
- **Sin valor nuevo en `asiento_status`.** `borrador` + `origen` + `espejado_por` alcanzan (§3.2).
- **`cper` no modelado.** El plan es catálogo, no serie temporal (§3.1).
- **No se auto-crean cuentas** en la importación. Rechaza y nombra (§4.2.3).
- **No se adivina la obra.** Centro de costos desconocido rechaza (§4.2.4).
- **Desplazamiento por periodo, no por asiento**, para la familia espejo puro (§5.2).
- **`espejo_sin_obra` degrada visiblemente** en vez de dejar el reporte por obra vacío (§4.3).
