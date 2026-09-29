# Planilla de Oficina · Motor de Cálculo v2 (F1) — Diseño

**Fecha:** 2026-09-29
**Estado:** Propuesta (pendiente de revisión)
**Fase:** F1 de 5 (ver [plan por fases](#anexo-plan-por-fases))
**Referencia de verdad:** `07.PERSONAL PLANILLA JULIO 2026OFICINA .xlsx` (17 empleados reales, MM HIGH METRIK ENGINEERS SAC)

---

## 1. Intención y criterio de éxito

Reescribir el motor de cálculo de planilla de oficina para que **cuadre exactamente** con la planilla real que hoy lleva la contadora en Excel, y para que soporte los casos de uso reales de la empresa sin dejar nada suelto.

**Criterio de éxito (medible):** dados los inputs de los 17 empleados de julio 2026, el motor produce — con tolerancia de **S/ 0.01** — los mismos: total bruto, AFP aporte, AFP seguro, AFP comisión, ONP, EsSalud, impuesto renta 5ta (cuando no es override) y neto, que las boletas del Excel.

**No-objetivo de F1 (diferido):** distribución de costo a obras (F2), mapeo de cuentas y asiento (F2), pago/comprobante/email (F4), auto-login Zlink y HE desde huellero (F5), y funciones de planilla que la empresa hoy **no** usa (CTS, liquidaciones, vacaciones truncas, EPS, no domiciliados, sindicato) — ver [alcance](#3-alcance-incluido-ahora-vs-diferido).

**Decisión de gobierno:** Renta 5ta es **híbrida** — el motor sugiere, pero **Kelly tiene el último voto** (override manual que se preserva). Todo parámetro legal es editable en configuración, no hardcodeado.

**Principio arquitectónico:** el Excel **valida** el motor, pero **no es la fuente de verdad** del ERP. La fuente de verdad es: `inputs mensuales + parámetros vigentes + reglas del motor + snapshot del cálculo`. El motor debe poder reproducir cualquier boleta pasada solo con su snapshot, sin depender de que la configuración actual siga igual.

---

## 2. Reglas de cálculo (reverse-engineered y validadas)

Cada regla fue verificada contra las cifras reales del Excel.

| Concepto | Regla | Validación |
|----------|-------|-----------|
| Prorrateo | `sueldoBase = sueldoMensual × diasTrab / diasMes` | Yangari (cese 31/07): 3,100 × 29/31 = **2,900** ✓ |
| AFP aporte | `10% × bruto` | García 1,285 = 10% × 12,850 ✓ |
| AFP seguro | `pctSeguro × min(bruto, topeRMA)`; pctSeguro=**1.37%**, topeRMA=**S/ 12,599.27** | Rivera 137 = 1.37% × 10k; García 172.61 (topeado, no 176.05) ✓ |
| AFP comisión | **por empleado**: `flujo` → pctComisiónFlujo del AFP · `mixta` → pctComisiónMixta · `saldo` → 0 | Huerta (Profuturo, flujo) 19.10 = 1.69%; García/Rivera (Profuturo, saldo) = 0 ✓ |
| ONP | `13% × bruto` | Bautista 650 = 13% × 5k; Yangari 377 = 13% × 2,900 ✓ |
| EsSalud (empleador) | `9% × max(bruto, RMV)` (piso RMV) | todos ✓; piso no exigido en julio (mín = RMV) |
| Asig. familiar | `10% × RMV`, prorrateado por días | 0 en julio (nadie con hijos registrados) |
| Renta 5ta | híbrido: sugerencia SUNAT (proyección anual) + override de Kelly | hoja "Calculo Rta 5ta" separada |
| Costo total | `bruto + EsSalud` | García 14,006.50 = 12,850 + 1,156.50 ✓ |
| Neto | `bruto − totalDescuento` | todos ✓ |

### Montos legales 2026 (a parametrizar, con vigencia)

| Parámetro | Valor | Vigencia | Fuente |
|-----------|-------|----------|--------|
| RMV | S/ **1,130** | hasta 30/09/2026 | vigente desde 2025 |
| RMV | S/ **1,300** | desde **01/10/2026** | DS 015-2026-TR |
| Asig. familiar | 10% RMV (113 → 130) | sigue a RMV | — |
| AFP aporte obligatorio | 10% | — | SBS |
| AFP seguro (prima) | 1.37% | trimestral | SBS |
| Tope RMA (seguro) | S/ 12,599.27 | trimestral | derivado del Excel |
| AFP comisión flujo | Habitat 1.47 · Integra 1.55 · Prima 1.60 · Profuturo 1.69 (%) | — | SBS 2026 |
| ONP | 13% | — | — |
| EsSalud | 9% | — | — |
| UIT | S/ 5,350 | 2026 (a confirmar) | SUNAT |

> Todo esto vive en tablas **con fecha de vigencia**. Regla del resolver, general y explícita:
> ```
> valor_vigente(fecha_aplicación) = última fila con fecha_vigencia <= fecha_aplicación
> ```
> **Fecha de aplicación** en F1 = primer día del **mes de remuneración** (concepto mensual). El resolver recibe una *fecha*, no un mes, así que si en el futuro una norma entra a mitad de mes se puede prorratear día a día sin rediseñar (prorrateo intra-mes queda **fuera de F1**). Ejemplo RMV: `2026-09-01 → 1130`, `2026-10-01 → 1300` resuelve limpio.

### Renta 5ta — método (según su hoja "Calculo Rta 5ta")

Proyección anual SUNAT, por empleado:

```
Renta bruta anual = acumulado percibido (ene→mes−1, REAL)
                  + sueldo actual × meses restantes (mes→dic)
                  + gratificaciones proyectadas (jul + dic, 1 sueldo c/u)
                  + bonif. extraordinaria 9% × cada gratificación (Ley 30334)
Renta neta        = renta bruta anual − 7 UIT
Impuesto anual    = escala progresiva 8/14/17/20/30% por tramos de UIT
Retención del mes = (impuesto anual − retenciones previas REALES) / divisor SUNAT(mes)
```

- **Acumulado y retenciones previas son reales, por empleado** — no se asume ingreso en enero. Se leen de la tabla de renta 5ta (sembrada por Kelly) y se actualizan cada mes al cerrar.
- **Fecha de ingreso** ajusta meses restantes y gratificaciones proporcionales para altas a mitad de año.
- **Override:** si Kelly teclea un valor, gana y se marca `renta5taManual` (ya existe).

---

## 3. Alcance: incluido ahora vs diferido

**Incluido en F1:**
- Régimen general (sueldo mensual), AFP y ONP.
- AFP comisión flujo / mixta / saldo por empleado.
- Prorrateo por días (altas, ceses, faltas).
- Piso RMV para EsSalud; tope RMA para seguro AFP.
- Asignación familiar (10% RMV) con vigencia.
- Horas extra 25% / 35% como **input manual** (el huellero las alimentará en F5).
- Gratificación / vacaciones / bonificación / comisiones como input manual, con **gratificación inafecta** (excluida de AFP/ONP/EsSalud + bonif. extraordinaria 9%) cuando se ingrese.
- Renta 5ta híbrida con acumulado real e import inicial.
- Practicantes **en planilla plena** (AFP+EsSalud) — es como la empresa los trata hoy.
- Parámetros legales con vigencia (RMV 1130→1300, tasas AFP, UIT, topes).

**Diferido (se agrega cuando un caso real lo exija):**
- CTS, gratificación semestral automática, vacaciones truncas, liquidación/cese, EPS, EsSalud Vida, renta de no domiciliados, retención judicial compleja, sindicato, quinta de 4ta-quinta.
- Distribución de costo a obras y contabilización (F2).
- Modalidad formativa **real** sin AFP/EsSalud — **pregunta abierta para Kelly** (hoy todos van a planilla plena). El modelo de datos deja el gancho (`modalidadFormativa`), apagado por defecto.

---

## 4. Modelo de datos (cambios)

### 4.1 `empleados` — nuevos campos
- `afpComisionTipo` varchar(8) — `'flujo' | 'mixta' | 'saldo'` (default `'saldo'`).
- `modalidadFormativa` boolean default false — gancho para practicante real (hoy false para todos).
- (ya existen: `sistemaPension`, `asignacionFamiliar`, `fechaIngreso`, `fechaCese`, `numDoc`, `cuspp`, `cargo`, `sueldoBaseMensual`).

### 4.2 `afp_tasas` — renombrar/ampliar comisión
- `pctAporte` (existe, 0.10), `pctSeguro` (existe → 0.0137).
- `pctComision` → renombrar a `pctComisionFlujo`; **añadir** `pctComisionMixta`.
- Seed 2026 (flujo): Habitat 1.47 · Integra 1.55 · Prima 1.60 · Profuturo 1.69. Los valores de comisión mixta se cargan al sembrar desde la tabla vigente de la SBS (dato operativo, no de diseño).

### 4.3 `param_legal_oficina` — NUEVA, con vigencia
```
id uuid, fecha_vigencia date,
rmv decimal, uit decimal, tope_rma decimal,
pct_essalud decimal, pct_onp decimal, pct_afp_aporte decimal, pct_asig_familiar decimal
```
El motor resuelve por `valor_vigente(primer día del mes de remuneración)` (ver regla del resolver en §2). Seed: fila 2025-01-01 (RMV 1130, tope 12,599.27, UIT 5350) y 2026-10-01 (RMV 1300).

### 4.4 Renta 5ta: baseline importado + ledger por mes (idempotente)

En vez de un único acumulado mutable con `+=`, se separa en dos tablas. Esto da idempotencia real, corrección de meses ya cerrados, y auditoría.

**`renta5ta_baseline`** — historia **anterior al ERP**, sembrada por Kelly (el "no arrancar en 0"):
```
empleado_id uuid, anio int,
acumulado_importado decimal,   -- remuneraciones computables pagadas antes del 1er mes en el ERP
retenciones_importadas decimal, -- quinta efectivamente retenida en ese mismo periodo
importado_por, importado_en,
unique(empleado_id, anio)
```

**`renta5ta_mes`** — aporte de cada mes calculado **en** el ERP (upsert al cerrar):
```
empleado_id uuid, planilla_mes_id uuid, anio int, mes_numero int,
remun_computable decimal,  -- base computable de quinta de ese mes
retencion decimal,          -- quinta retenida ese mes
unique(empleado_id, planilla_mes_id)   -- ← idempotencia del cierre
```

**Definiciones exactas (críticas para quinta):**
- `acumuladoPercibido(mes M)` = `acumulado_importado` + `SUM(renta5ta_mes.remun_computable)` de los meses del año con `mes_numero < M`. **No** es `SUM(planillas cerradas)` a secas: parte del baseline importado que no existe como planilla en el ERP.
- `retencionesPrevias(mes M)` = `retenciones_importadas` + `SUM(renta5ta_mes.retencion)` de los meses con `mes_numero < M`.
- **Corrección de un mes ya cerrado** (ej. corregir julio tras cerrar agosto): al reabrir+recerrar julio se **upsertea** su fila en `renta5ta_mes` (no se duplica, por el UNIQUE). El acumulado/retenciones de agosto se recalcula solo porque se derivan por SUM, no por `+=`. Recerrar el mismo mes N veces deja el mismo estado.

> `config_planilla` singleton se conserva para los parámetros de construcción civil; los legales de oficina migran a `param_legal_oficina` (con vigencia). El snapshot de `planilla_oficina_mes` (ver §5) congela **todo** lo necesario para reproducir el cálculo.

---

## 5. Cambios en el motor (código)

### 5.1 Bases independientes (no un `bruto` genérico)

El motor **no** deriva todas las bases de una sola cifra `bruto`. Separa ingresos por naturaleza y calcula cada base por separado, para que nadie pueda re-gravar la gratificación por accidente al tocar una fórmula:

```
remuneracionAfecta      = sueldoBase + HE + dominical + feriado + asigFamiliar + vacaciones + comisiones + bonificacion
gratificacionInafecta   = gratificacion                       // NO entra a AFP/ONP/EsSalud
bonificacionExtraord.   = 9% × gratificacion (Ley 30334)      // se paga al trabajador, tampoco es base

baseAFP     = remuneracionAfecta
baseONP     = remuneracionAfecta
baseEsSalud = max(remuneracionAfecta, RMV)                     // piso RMV
baseRenta5ta= remuneracionAfecta + gratificacion + bonifExtraord (proyectadas en rta5taCalc)

totalPagado = remuneracionAfecta + gratificacionInafecta + bonificacionExtraordinaria
```

### 5.2 Forma del resultado del motor (input / base / resultado)

`calcularDetalleOficina` retorna una estructura explícita (habilita F3: Kelly ve *por qué* salió el número):

```ts
{
  inputs:  { sueldoMensual, diasTrab, diasMes, he25, he35, dominical, feriado, gratificacion, bonificacion, comisiones, vacaciones },
  bases:   { remuneracionAfecta, baseAfp, baseOnp, baseEssalud, baseRenta5ta },
  descuentos: { afpAporte, afpSeguro, afpComision, onp, renta5ta, retencionJudicial, adelanto, otros },
  aportesEmpleador: { essalud },
  ingresos: { remuneracion, gratificacionInafecta, bonificacionExtraordinaria, otros },
  totales: { bruto, descuentos, neto, costoEmpleador }
}
```

### 5.3 Reglas dentro del motor puro (`planillaOficinaCalc.ts`)
- AFP comisión según `afpComisionTipo` (flujo → `pctComisionFlujo` · mixta → `pctComisionMixta` · saldo → 0), tasas desde el snapshot.
- AFP seguro: `pctSeguro × min(baseAFP, topeRMA)`, `topeRMA` desde `param_legal_oficina` (no `configPlanilla`).
- EsSalud con piso RMV (`baseEsSalud`).
- Gratificación inafecta + bonif. extraordinaria 9% (§5.1).
- Practicante: `modalidadFormativa` (no el cargo) decide la exoneración; default no exonera.

### 5.4 Renta 5ta (`rta5taCalc.ts`)
Recibe `acumuladoPercibido` y `retencionesPrevias` **reales** (derivados por SUM de baseline + ledger, §4.4) + `fechaIngreso`; ajusta meses restantes y gratificaciones proporcionales para altas a mitad de año.

### 5.5 Snapshot autosuficiente (`planilla_oficina_mes.calculoSnapshot`)
Al calcular se congela **todo lo necesario para reproducir la planilla** sin depender de la config actual:
```ts
{
  fechaVigencia, rmv, uit, topeRma, pctEssalud, pctOnp, pctAfpAporte, pctAsigFamiliar,
  afp: { habitat:{...}, integra:{...}, prima:{...}, profuturo:{...} },  // aporte/seguro/comisión flujo+mixta
  porTrabajador: { [empleadoId]: { sistemaPension, afpComisionTipo, asignacionFamiliar, modalidadFormativa,
                                   acumuladoPercibido, retencionesPrevias } }
}
```
Objetivo: en 2 años poder abrir julio 2026 y responder "¿por qué este trabajador recibió exactamente S/ X?".

### 5.6 Rutas
- **`calcular`**: resuelve `param_legal_oficina` efectivo + tasas AFP + `acumuladoPercibido/retencionesPrevias` (baseline+ledger) por empleado; escribe el `calculoSnapshot` (§5.5). Preserva override `renta5taManual`.
- **`cerrar`**: además de lo actual, **upsertea** `renta5ta_mes` (`remun_computable`, `retencion`) por `UNIQUE(empleado_id, planilla_mes_id)` — idempotente, sin `+=`. Reabrir+recerrar corrige el mes sin duplicar.

---

## 6. Configuración (lo que ve Kelly en F1)

- **Tasas legales con vigencia**: editor de `param_legal_oficina` (RMV, UIT, tope, %s) por fecha.
- **Tasas AFP**: editor de `afp_tasas` (aporte, seguro, comisión flujo/mixta).
- **Import de renta 5ta** (`renta5ta_baseline`): pantalla por empleado para cargar `acumulado_importado` y `retenciones_importadas` del año (desde su hoja) — el "no arrancar en 0". De ahí en adelante el ERP acumula solo vía `renta5ta_mes`.
- Por empleado (en su ficha): `sistemaPension`, `afpComisionTipo`, `asignacionFamiliar`, `modalidadFormativa`.

*(La presentación del grid y las boletas es F3; F1 solo asegura que el número que aparezca sea el correcto.)*

---

## 7. Pruebas (criterio de aceptación)

Dos tipos de prueba, porque un motor puede coincidir en un total por casualidad y tener la composición mal.

**A. Reproducción del Excel** — `test-planilla-oficina-julio2026`: los 17 empleados reales como inputs → assert de bruto, afpAporte, afpSeguro, afpComision, onp, essalud, renta5ta y neto contra las cifras exactas del Excel (tol. **S/ 0.01**).

**B. Integridad interna (reconciliación)** — para cada empleado y para el total de la planilla:
```
bruto − descuentos = neto
bruto + aportesEmpleador = costoEmpleador
afpAporte + afpSeguro + afpComision = descuento AFP total
SUM(líneas de empleados) = totales de la planilla
gratificacionInafecta ∉ baseAFP, baseONP, baseEsSalud   // la grati nunca grava
```

**C. Edge cases** (motor puro): cese con prorrateo, ONP, AFP flujo/mixta/saldo, piso RMV en EsSalud, tope RMA en seguro, gratificación inafecta + bonif. extraordinaria, alta a mitad de año, cambio de RMV set→oct.

**D. Renta 5ta**: acumulado real (baseline + ledger) + retenciones previas → cuadra con su hoja; **idempotencia**: recerrar el mismo mes 2× deja igual el YTD; corregir julio tras cerrar agosto recalcula agosto; override de Kelly gana sobre la sugerencia.

---

## 8. Migración

Script aditivo idempotente (patrón `alter-*.ts`): nuevas columnas en `empleados` (`afpComisionTipo`, `modalidadFormativa`), `afp_tasas` (`pctComisionFlujo`, `pctComisionMixta`); nuevas tablas `param_legal_oficina`, `renta5ta_baseline`, `renta5ta_mes`; ampliación del snapshot a `calculoSnapshot`. Seed de tasas AFP 2026 y filas de RMV/tope con vigencia. `renta5ta_baseline` arranca vacía (Kelly importa). Reversible.

---

## Anexo · Plan por fases

- **F1 (este spec):** motor v2 exacto al Excel + parámetros por empleado + config con import de renta 5ta.
- **F2:** distribución de costo a obras (prorrateo entre varias) + mapeo concepto→cuenta + preview del asiento.
- **F3:** presentación a Kelly (grid revamp, ver/descargar boletas).
- **F4:** pago (lote 1 voucher → N empleados + comprobante) + envío de boletas por email.
- **F5:** auto-login Zlink en VPS (token/refresh fallback) + horas trabajadas → sugerencia de HE.
