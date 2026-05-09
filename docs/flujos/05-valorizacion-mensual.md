# 05 · Valorización mensual

Mecanismo cobranza obra pública. Mensual. Source of truth `valorizaciones`.

## Flujo completo

```mermaid
flowchart TB
    INI[Inicio mes N] --> AVA[Residente registra<br/>avance físico % por partida]
    AVA --> CALC[ERP calcula<br/>valorización referencial]

    CALC --> FACTOR[× factor oferta 0.95]
    FACTOR --> CONT[Valorización contractual]

    CONT --> IGV[+ IGV 18%]
    IGV --> FP{¿Aplica<br/>reajuste FP?}
    FP -->|sí| INDICES[Consulta índices INEI mes]
    INDICES --> REAJ[+ Reajuste FP]
    FP -->|no| BRUTO
    REAJ --> BRUTO[Bruto a valorizar]

    BRUTO --> AMORT[Calcula amortizaciones<br/>adelantos]
    AMORT --> RET[Retención 10%<br/>1ra mitad pagos]
    RET --> PEN[Penalidades aplicadas<br/>mes N]
    PEN --> NETO[NETO A PAGAR]

    NETO --> CHECK[Genera checklist<br/>14 docs requeridos]
    CHECK --> PDF[Genera PDF valorización<br/>+ planilla metrados<br/>+ panel fotográfico]

    PDF --> ENV[Mesa partes entidad<br/>status: emitida]
    ENV --> SUP{Supervisor<br/>aprueba?}
    SUP -->|sí| APROB[status: aprobada]
    SUP -->|observa| OBS[status: observada<br/>levantar obs]
    OBS --> ENV

    APROB --> PAGO[Entidad paga<br/>último día mes]
    PAGO --> COBR[status: cobrada<br/>conciliación banco]

    COBR --> SNAP[Snapshot inmutable<br/>guardado en jsonb]
    SNAP --> CONT_AC[Genera asiento<br/>contable]

    style AVA fill:#fff4cc
    style NETO fill:#cce5ff
    style APROB fill:#d4edda
    style COBR fill:#28a745,color:#fff
```

## Cálculo paso a paso · ejemplo VALO 01 (25% avance)

```mermaid
flowchart TB
    A1[Avance físico × CD<br/>0.25 × 1,319,122 = 329,780.50] --> A2
    A2[+ GG prorrateado 10%<br/>+ 32,978.05] --> A3
    A3[+ Util prorrateada 7%<br/>+ 23,084.64] --> A4
    A4[Subtotal referencial<br/>385,843.19]
    A4 --> A5[× factor oferta 0.95<br/>366,551.03]
    A5 --> A6[+ IGV 18%<br/>+ 65,979.19]
    A6 --> A7[Bruto<br/>432,530.22]
    A7 --> A8[+ Reajuste FP +1.2%<br/>+ 5,190.36]
    A8 --> A9[TOTAL VALORIZADO<br/>437,720.58]

    A9 --> D1[− Amort directo<br/>S/ 43,772.06]
    D1 --> D2[− Amort materiales<br/>S/ 87,544.12]
    D2 --> D3[− Retención 10%<br/>S/ 43,772.06]
    D3 --> D4[− Penalidades<br/>S/ 0]
    D4 --> NETO[NETO<br/>S/ 262,632.34]

    NETO --> DET[− Detracción 12%<br/>SPOT BN<br/>S/ 31,515.88]
    DET --> EFECT[Efectivo cuenta<br/>S/ 231,116.46]

    style A4 fill:#fff4cc
    style A9 fill:#cce5ff
    style NETO fill:#d4edda
    style EFECT fill:#28a745,color:#fff
```

## Estados valorización

```mermaid
stateDiagram-v2
    [*] --> borrador: residente arma
    borrador --> emitida: envía mesa partes
    emitida --> aprobada: supervisor OK
    emitida --> observada: supervisor observa
    observada --> emitida: levantar observ
    aprobada --> cobrada: pago entidad
    cobrada --> [*]: snapshot final
    emitida --> rechazada: rechazo formal
    rechazada --> borrador: nuevo intento
```

## Checklist 14 documentos (cláusula 5 contrato)

| # | Doc | Tabla `valorizacion_checklist.item` |
|---|---|---|
| 1 | Descripción trabajos ejecutados | `descripcion_trabajos` |
| 2 | Ocurrencias + protocolos calidad | `protocolos_calidad` |
| 3 | Estado situacional | `estado_situacional` |
| 4 | Avance físico/financiero | `avance_fisico_financiero` |
| 5 | Ampliaciones/adicionales | `modificaciones` |
| 6 | Amortización adelantos | `amortizaciones` |
| 7 | Reajustes FP | `reajustes` |
| 8 | Curva S programado vs ejecutado | `curva_s` |
| 9 | Cuadro programado vs ejecutado | `cuadro_comparativo` |
| 10 | Panel fotográfico ≥10 fotos | `panel_fotografico` |
| 11 | Planilla metrados | `planilla_metrados` |
| 12 | Cuaderno incidencias digital | `cuaderno_obra` |
| 13 | Voucher CONAFOVISER mes anterior | `conafoviser` |
| 14 | Voucher SENCICO mes anterior | `sencico` |
| 15 | Constancia SCTR + póliza CAR | `sctr_car` |

Si checklist incompleto → no se emite valorización.

## Schema impacto

```sql
valorizaciones (
  ... existentes
  monto_referencial decimal(14,2),
  factor_oferta decimal(7,6),
  monto_contractual_pre_igv decimal(14,2),
  monto_igv decimal(14,2),
  monto_reajuste decimal(14,2),
  amortizacion_directo decimal(14,2),
  amortizacion_materiales decimal(14,2),
  amortizacion_avance decimal(14,2),
  retencion decimal(14,2),
  penalidades_aplicadas decimal(14,2),
  monto_neto decimal(14,2),
  detraccion decimal(14,2),
  efectivo_caja decimal(14,2),
  fecha_envio_mesa_partes date,
  fecha_aprobacion date,
  fecha_pago date,
  fecha_cobranza_real date,
  observaciones_supervisor text
)

valorizacion_partidas (   -- snapshot avance × partida × valorización
  valorizacion_id, partida_id,
  avance_acumulado_pct,    -- 25.00
  avance_periodo_pct,      -- 25 - 0 = 25 si es V01
  metrado_acumulado decimal(14,4),
  monto_referencial decimal(14,2),
  monto_contractual decimal(14,2)
)
```

## Reglas críticas

1. **Inmutable post cobro**: `cobrada` → snapshot guardado, no editable
2. **Numeración secuencial**: Val 01, 02, 03... sin huecos
3. **Avance acumulado siempre crece**: V03 ≥ V02 ≥ V01
4. **Σ valorizaciones = monto contractual** al final (más reajustes y modifs)
5. **Retención solo primera mitad**: si proyecto = 4 valoriz, retiene en V01 y V02
