# 17 · Adelanto a proveedor · Anticipo · Canje

Flujo crítico construcción. Concreto premezclado, acero, equipos especiales requieren adelanto.

## Casos típicos

```
Concreto premezclado UNICON/MIXERCON:
  50% adelanto al ordenar · 50% contra entrega

Acero SIDERPERU/Aceros Arequipa:
  70% adelanto pedido · 30% al embarcar

Horno cremación importado:
  40% adelanto fabricación · 30% embarque · 30% entrega obra

Equipos especiales:
  50% al firmar OC · 50% recepción funcional
```

## Flujo completo · 6 fases

```mermaid
flowchart TB
    F1[FASE 1<br/>OC con condiciones] --> F2[FASE 2<br/>Solicitud anticipo]
    F2 --> F3[FASE 3<br/>Factura anticipo + pago]
    F3 --> F4[FASE 4<br/>Entrega material/servicio]
    F4 --> F5[FASE 5<br/>Factura final + canje]
    F5 --> F6[FASE 6<br/>Pago saldo o ajuste]

    style F1 fill:#fff4cc
    style F2 fill:#cce5ff
    style F3 fill:#fd7e14,color:#fff
    style F4 fill:#d4edda
    style F5 fill:#cce5ff
    style F6 fill:#7c4dff,color:#fff
```

### Fase 1 · OC con condiciones de pago

```mermaid
flowchart LR
    OC[Orden de compra] --> COND[Condiciones pago]
    COND --> P1[40% adelanto firma OC]
    COND --> P2[30% al embarcar]
    COND --> P3[30% recepción obra]

    OC --> FIA{¿Anticipo<br/>> 30%?}
    FIA -->|sí| REQ_FIA[Requiere<br/>carta fianza<br/>proveedor]
    FIA -->|no| OK_OC[OC liberada]
    REQ_FIA --> OK_OC

    OK_OC --> ENV[Envía OC al proveedor<br/>+ condiciones explícitas]
```

### Fase 2 · Solicitud anticipo

```mermaid
flowchart TB
    SOL[Proveedor solicita<br/>anticipo OC firmada] --> VAL[Logística valida:<br/>− OC vigente<br/>− proveedor habido SUNAT<br/>− condiciones cumplidas]

    VAL --> Q_FIA{¿Requería<br/>fianza?}
    Q_FIA -->|sí| FIA_REC{¿Recibió<br/>carta fianza<br/>proveedor?}
    Q_FIA -->|no| APROB

    FIA_REC -->|no| BLOQ[BLOQUEO<br/>esperar fianza]
    FIA_REC -->|sí| REG_FIA[Registrar garantía<br/>tipo: proveedor_anticipo]

    REG_FIA --> APROB[Aprobación admin<br/>+ gerencia si > umbral]
    APROB --> COMP[Compromete monto anticipo<br/>presupuesto cuenta orden]

    style BLOQ fill:#dc3545,color:#fff
    style APROB fill:#d4edda
```

### Fase 3 · Factura anticipo + pago

```mermaid
flowchart TB
    FAC_AD[Proveedor emite<br/>factura ADELANTO<br/>SUNAT tipo 01<br/>+ glosa "ANTICIPO"] --> VAL_FAC[Validación<br/>XML SUNAT]

    VAL_FAC --> CONT_REG[Asiento contable:<br/>Dr 422 Anticipos otorgados<br/>Dr 401 IGV crédito fiscal<br/>Cr 421 Facturas pagar]

    CONT_REG --> APL_DET[Aplicar detracción<br/>si corresponde]
    APL_DET --> PAGO_AD[Pago vía banco<br/>− detracción<br/>− retención si aplica]

    PAGO_AD --> CONT_PAG[Asiento pago:<br/>Dr 421 Facturas pagar<br/>Cr 104 Bancos]
    CONT_PAG --> NOTIF_PROV[Notificar proveedor<br/>pago realizado]

    NOTIF_PROV --> ESPERA[Espera entrega]

    style FAC_AD fill:#cce5ff
    style CONT_REG fill:#7c4dff,color:#fff
    style PAGO_AD fill:#fd7e14,color:#fff
```

### Fase 4 · Entrega material

```mermaid
flowchart TB
    LLEG[Material/servicio<br/>llega obra] --> GUIA[Guía remisión<br/>cantidad correcta?]

    GUIA --> Q_OK{¿Cantidad y calidad<br/>conforme OC?}
    Q_OK -->|sí| ING[Ingreso almacén<br/>provisional o definitivo<br/>según factura final]
    Q_OK -->|no| OBS[Observación<br/>al proveedor]

    OBS --> Q_FIX{¿Corrige?}
    Q_FIX -->|sí| GUIA
    Q_FIX -->|no plazo| EJ_FIA[Ejecutar carta fianza<br/>proveedor]

    style EJ_FIA fill:#dc3545,color:#fff
```

### Fase 5 · Factura final + canje

```mermaid
flowchart TB
    FAC_FIN[Proveedor emite<br/>factura FINAL<br/>monto total OC] --> CHK[Sistema match:<br/>OC + anticipos previos]

    CHK --> CALC_SALDO[Calcular saldo:<br/>= total OC<br/>− anticipos pagados]

    CALC_SALDO --> CANJE[CANJE contable<br/>asiento crítico]

    CANJE --> AS_CANJE[Asiento canje:<br/>Dr 60 Compras suministros (TOTAL OC)<br/>Cr 422 Anticipos otorgados (anticipos)<br/>Cr 421 Facturas pagar (saldo)<br/>Dr/Cr 401 IGV ajuste]

    AS_CANJE --> Q_SALDO{¿Saldo > 0?}
    Q_SALDO -->|sí| FASE6[Pasa a fase 6<br/>pago saldo]
    Q_SALDO -->|= 0| CIERRE_OC[OC cerrada<br/>todo liquidado en anticipos]
    Q_SALDO -->|< 0 sobrepago| NOTA_CR[Solicitar NOTA CRÉDITO<br/>al proveedor]

    NOTA_CR --> AS_NC[Asiento NC:<br/>Dr 421 Facturas pagar<br/>Cr 60 Compras<br/>Cr 401 IGV]

    AS_NC --> DEV[Devolución proveedor<br/>o aplica próxima OC]

    style CANJE fill:#7c4dff,color:#fff
    style AS_CANJE fill:#7c4dff,color:#fff
    style NOTA_CR fill:#ffc107
```

### Fase 6 · Pago saldo

```mermaid
flowchart LR
    SALDO[Saldo CxP pendiente] --> VAL_FIN[Validaciones SUNAT<br/>+ cuenta SPOT proveedor]
    VAL_FIN --> CALC_NETO[Neto = saldo<br/>− detracción saldo<br/>− retención si aplica]
    CALC_NETO --> PAGO_FIN[Pago saldo banco]
    PAGO_FIN --> CIER[Cierre OC<br/>liberación garantía proveedor]

    CIER --> LIB_FIA[Si tenía carta fianza<br/>libera al proveedor]

    style PAGO_FIN fill:#d4edda
    style LIB_FIA fill:#d4edda
```

## Schema completo

```sql
-- Anticipos a proveedores
anticipos_proveedores (
  id uuid PRIMARY KEY,
  oc_id uuid REFERENCES ordenes_compra,
  proveedor_ruc varchar(11),
  proveedor_razon varchar,

  -- Monto
  monto_anticipo decimal(14,2),
  pct_anticipo decimal(5,4),                 -- 0.40 = 40%
  monto_oc_total decimal(14,2),              -- snapshot
  moneda char(3) DEFAULT 'PEN',
  tipo_cambio decimal(7,4),

  -- Fechas
  fecha_solicitud date,
  fecha_aprobacion date,
  fecha_pago date,
  fecha_canje_completo date,

  -- Documentos
  factura_anticipo_id uuid REFERENCES facturas_recibidas,
  factura_canje_id uuid REFERENCES facturas_recibidas,

  -- Garantía si aplica
  carta_fianza_proveedor_id uuid REFERENCES garantias,

  -- Estado
  estado ENUM (
    'borrador',
    'solicitado',
    'aprobado',
    'pagado',
    'parcialmente_canjeado',
    'totalmente_canjeado',
    'reclamo_devolucion',                    -- proveedor no entregó
    'cancelado'
  ),

  -- Tributario
  detraccion_codigo varchar(3),
  detraccion_monto decimal(14,2),
  detraccion_pagada boolean,

  -- Audit
  created_at, updated_at,
  aprobado_por uuid,
  observaciones text
)

-- Movimientos canje
canjes_anticipo (
  id uuid PRIMARY KEY,
  anticipo_id uuid REFERENCES anticipos_proveedores,
  factura_canje_id uuid REFERENCES facturas_recibidas,
  fecha_canje date,
  monto_canjeado decimal(14,2),
  saldo_post_canje decimal(14,2),
  asiento_canje_id uuid
)

-- Tipos factura SUNAT extendido
ALTER TABLE facturas_recibidas ADD COLUMN
  tipo_factura ENUM (
    'comercial',
    'adelanto',
    'saldo_canje',
    'nota_credito',
    'nota_debito'
  ) DEFAULT 'comercial',
  factura_relacionada_id uuid REFERENCES facturas_recibidas,
  anticipo_id uuid REFERENCES anticipos_proveedores;
```

## Reglas críticas

```sql
-- Reglas de negocio
CREATE FUNCTION validar_anticipo_proveedor(p_anticipo_id uuid)
RETURNS TABLE (puede boolean, motivos text[]) AS $$
DECLARE motivos text[] := '{}';
BEGIN
  -- 1. Anticipo > 30% requiere carta fianza proveedor
  IF (anticipo.pct_anticipo > 0.30) AND (anticipo.carta_fianza_proveedor_id IS NULL) THEN
    motivos := array_append(motivos, 'Anticipo > 30% requiere carta fianza');
  END IF;

  -- 2. OC vigente
  IF NOT (oc.estado IN ('aprobada','en_ejecucion')) THEN
    motivos := array_append(motivos, 'OC no vigente');
  END IF;

  -- 3. Proveedor habido SUNAT
  IF NOT proveedor_habido_sunat(anticipo.proveedor_ruc) THEN
    motivos := array_append(motivos, 'Proveedor no habido SUNAT');
  END IF;

  -- 4. Sumatoria anticipos no excede 100% OC
  IF (SUM(anticipos_pagados) + nuevo_monto > monto_oc) THEN
    motivos := array_append(motivos, 'Σ anticipos > monto OC');
  END IF;

  RETURN QUERY SELECT array_length(motivos,1) IS NULL, motivos;
END $$;
```

## Alertas tiempo

```
Anticipo pagado · sin entrega:
  +30 días → alerta admin
  +60 días → alerta gerencia
  +90 días → ESCALAMIENTO LEGAL · ejecución carta fianza
```

## Reportes

```
1. Anticipos vigentes
   Lista anticipos pagados sin canjear
   Días desde pago
   Riesgo (no entrega)

2. Top proveedores con anticipos
   Volumen, % default, días promedio entrega

3. Costo financiero anticipos
   Capital inmovilizado × tiempo
   Costo oportunidad

4. Variance OC final vs anticipos
   Cuántos casos requirieron NC
   Sobrepagos detectados
```

## KPIs

| KPI | Fórmula | Target |
|---|---|---|
| Anticipos pendientes canje | count anticipos pagados sin canje completo | dashboard |
| Tiempo medio entrega | avg(fecha_entrega − fecha_pago_anticipo) | < 30 días |
| % anticipos con fianza | with_fianza / total >30% | 100% |
| Capital inmovilizado | Σ anticipos pendientes × días | < S/ 200K mes |
| Default rate proveedores | proveedores que no entregaron / total | < 2% |

## Prioridad: **ALTA**
