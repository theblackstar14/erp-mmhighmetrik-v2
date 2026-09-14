# Liquidación de obra — diseño

Fecha: 2026-07-27 · Rama: feat/rbac-multiempresa · Estado: aprobado (Fase 1 a implementar)

## Problema

Al terminar una obra el contratista "practica la liquidación": consolida lo valorizado,
amortiza adelantos, libera retención/garantías y determina el saldo final a cobrar/pagar.
Hoy el ERP no tiene ese cierre: existe `proyectos.montoLiquidacion` (usado solo por la
inversión MEF), status `liquidacion`, hitos `liquidacion`/`consentimiento_liquidacion` y el
checklist de cierre — pero nada calcula ni congela el saldo final de la obra.

## Decisiones de dominio (fijadas con el usuario)

- **Salida principal:** saldo final calculado + (Fase 2) asientos de cierre. Sin acta PDF.
- **Composición del saldo:** rollup de las valorizaciones existentes. Sin líneas manuales
  (adicionales/deductivos/penalidades quedan fuera de alcance).
- **Ciclo de vida:** snapshot al practicar, reversible con reapertura auditada (patrón cierre H2).

## Hallazgo contable (verificado en datos, decidió el partido en fases)

El motor (`contabilidad.ts:790-828`) contabiliza el devengo de cada valo como
**Dr 1212 = total bruto (c/IGV)**, sin subcuenta de retención, y el cobro como
**Cr 1212 = totalContratista (neto)**. Consecuencias verificadas en `erp_mmh`:

| Concepto | Valor | Lectura |
|---|---|---|
| 1212 por cobrar (asientos) | 1,675,933.09 (todo DEBE) | = Σ total c/IGV; nada segregado |
| Σ retención (valos) | 144,176.73 | **mezclada dentro del 1212**, sin subcuenta garantía |
| Σ amortización | 0 | sin adelantos amortizados |
| Anticipos (122/104) | 0 líneas | el anticipo **nunca se contabilizó** |

Por eso los 3 asientos originalmente propuestos NO son implementables hoy sin ensuciar libros:
- **Liberación de retención** no tiene de dónde reclasificar (retención sin segregar).
- **Cierre de adelantos** no tiene contrapartida (anticipo nunca asentado).
- **Saldo final** ya vive en el 1212 → sería un asiento cero.

Regla de oro (consejo LLM): los asientos de liquidación **no deben mover la 70x**; si la mueven,
hay doble conteo de ingreso. La liquidación es reclasificación/cancelación de saldos, no
reconocimiento de ingreso nuevo.

## FASE 1 — MVP (esta spec, sin tocar el motor)

### Modelo de datos — tabla `liquidaciones`

```
liquidaciones
  id                    uuid pk
  proyectoId            uuid fk → proyectos
  fechaPractica         date
  practicadaPorUserId   uuid null
  estado                varchar(12) default 'practicada'   -- practicada | reabierta
  snapshot              jsonb        -- desglose congelado (cada componente, no solo el total)
  saldoFinal            decimal(16,2)
  hash                  text         -- integridad del snapshot (como cierre H2)
  reabiertaPorUserId    uuid null
  motivoReapertura      text null
  reabiertaAt           timestamp null
  createdAt / updatedAt
```

Un registro por obra (reversible). Sin cambios en `valorizaciones`/`garantias`/`adelantos`.
Sin `asientoIds` en Fase 1 (no hay asientos todavía; se añade en Fase 2).

### Cálculo del saldo final (rollup, congelado en snapshot)

```
obraEjecutada     = Σ valo.montoValorizacionBruta   (fallback montoCd)
+ reajustes       = Σ valo.montoReajuste
− deducciones     = Σ valo.montoDeducciones
− multas          = Σ valo.multa
= liquidacionBruta

− amortizAdelantos = MAX(Σ valo.montoAmortizaciones, Σ adelanto.montoAmortizado)   [pre-fix rollup]
− retencionAcum    = Σ valo.montoRetencion
= liquidacionNeta

yaCobrado          = Σ valo(status='cobrada').totalContratista
saldoFinal = liquidacionNeta + retencionAcum − yaCobrado   → (+) a favor contratista / (−) a favor entidad
```

El snapshot guarda cada componente para desglose y auditoría.

### Reporte de conciliación contable (el entregable que destapa el motor)

Compara el cálculo con la realidad del libro, resaltando el descuadre para presentarlo:
- `valorizadoBrutoIgv` (Σ total c/IGV) vs saldo real de la cuenta 1212 del proyecto.
- `retencionMezclada` = Σ montoRetencion (hoy dentro del 1212, debería ir a subcuenta garantía).
- `porCobrarNeto` = Σ totalContratista − yaCobrado.
- Bandera `motorSegregaRetencion: false` con nota de que Fase 2 lo corrige.

### Endpoints (en `contractual.ts` o nuevo `liquidaciones.ts`)

- `GET /proyectos/:id/liquidacion` → liquidación vigente (si existe) + **preview en vivo** del
  cálculo y la conciliación (para ver antes de practicar).
- `POST /proyectos/:id/liquidacion/practicar` → calcula, congela snapshot + hash, inserta
  (`estado='practicada'`), audita. Idempotente: si ya existe practicada, error salvo reapertura previa.
- `POST /liquidaciones/:id/reabrir` → `estado='reabierta'` + motivo + `reabiertaAt` + audit (patrón H2).

### UI mínima

Bloque/tab "Liquidación" en el detalle de proyecto: desglose del saldo final + tabla de
conciliación + botón Practicar / Reabrir (con motivo). Sin PDF.

## FASE 2 — fix contable (spec propio, después; NO en esta entrega)

Prerequisito para asientos limpios:
1. Partir el devengo (`contabilidad.ts:802`): `Dr 1212-corriente` + `Dr 12X-garantía-retención`
   / `Cr 70x` + `Cr 40x` — segregar retención desde el origen. Requiere regenerar/migrar asientos.
2. Contabilizar ciclo de anticipo: recepción (`Dr 104 / Cr 46X-anticipo`) y amortización
   (`Dr 46X-anticipo / Cr 1212`).

Con eso, la liquidación postea **2 asientos reclasificatorios** (liberar retención, cerrar
anticipo) — nunca el #3 saldo final — con **assert: no mover 70x**. Añadir `asientoIds` a la tabla.

### Códigos de cuenta — estado real del plan (verificado 2026-07-27, `plan_contable`)

El plan está **desnudo**: para Fase 2 hay que **CREAR 2 cuentas** (los códigos son candidatos
per PCGE 2020 · **confirmar con la contadora** antes de asentar):

| Necesidad | Existe hoy | Propuesto (confirmar) |
|---|---|---|
| Por cobrar cliente (corriente) | `1212` "Emitidas en cartera" ✓ | usar `1212` |
| Retención de garantía por cobrar | **NO existe** | crear `1213` o `12125` "Retención de garantía por cobrar" |
| Anticipos recibidos de clientes (pasivo) | **NO existe** (`422` es anticipos *a proveedores*, dirección contraria) | crear `46X` "Anticipos de clientes recibidos" |

Gap adicional detectado: el **cobro no asienta** (1212 sin haber; valos `status='cobrada'` pero
sin `Cr 1212`). Fase 2 debe confirmar si el motor genera el asiento de cobro — es parte de por
qué el 1212 no concilia. La conciliación de Fase 1 ya muestra este descuadre en la UI.

## Fuera de alcance (ambas fases)

Acta/documento PDF; adicionales/deductivos/penalidades como líneas manuales; intereses;
fecha-gatillo de liberación de garantía (upside anotado); conciliación total con el Estado de
Resultados (fase contable mayor).

## Riesgos / notas

- IGV y detracción de retención/adelanto ya se declararon a SUNAT; Fase 2 debe respetarlos.
- El reporte de conciliación es intencionalmente un "detector de descuadres" para ir documentando
  las mejoras del motor mientras el usuario ya usa el saldo final.
