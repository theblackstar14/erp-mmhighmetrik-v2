# 20 · Cashflow predictivo + Línea bancaria

Sin esto reventas caja antes de darte cuenta.

## Modelo cash flow 360°

```mermaid
flowchart TB
    HOY[ESTADO HOY] --> ENT[Entradas proyectadas]
    HOY --> SAL[Salidas proyectadas]

    ENT --> E1[Cobranza valorizaciones<br/>programadas mensual]
    ENT --> E2[Adelantos por solicitar]
    ENT --> E3[Devolución retenciones<br/>al final obra]
    ENT --> E4[Devolución detracciones BN<br/>cada 4 meses]
    ENT --> E5[Adicionales aprobados]

    SAL --> S1[Pagos OC pendientes]
    SAL --> S2[Planilla obreros recurrente]
    SAL --> S3[SC pagos programados]
    SAL --> S4[Alquileres mensuales]
    SAL --> S5[GG plantel + oficina]
    SAL --> S6[Detracción + IGV mensual]
    SAL --> S7[Costo financiero garantías]
    SAL --> S8[Anticipos proveedores futuros]

    ENT --> PROY[Proyección 90 días<br/>day-by-day]
    SAL --> PROY

    PROY --> DAILY[Calendario diario<br/>caja proyectada]

    DAILY --> ALERT{¿Saldo < umbral<br/>algún día?}
    ALERT -->|sí| WARN[Alerta tesorería<br/>+ escenarios mitigación]
    ALERT -->|no| OK[OK · monitoreo continuo]

    WARN --> SCEN[Simulador escenarios]
    SCEN --> SC1[Adelantar cobro entidad]
    SCEN --> SC2[Postponer pago SC]
    SCEN --> SC3[Factoring valorización]
    SCEN --> SC4[Solicitar línea crédito banco]
    SCEN --> SC5[Préstamo intra-consorcio]

    style WARN fill:#fd7e14,color:#fff
    style OK fill:#d4edda
```

## Flujo cálculo cashflow

```mermaid
sequenceDiagram
    participant CRON as Cron diario 22:00
    participant ENG as Forecast Engine
    participant DB as PostgreSQL
    participant ML as ML Model
    participant ALERT as Alertas

    CRON->>ENG: Trigger forecast 90d
    ENG->>DB: Query estado actual
    DB-->>ENG: Saldo bancario · CxC · CxP

    par Entradas
        ENG->>DB: Valorizaciones programadas
        DB-->>ENG: Schedule cobranza
        ENG->>ML: Predicción atraso pago entidad
        ML-->>ENG: Días atraso esperados
    and Salidas
        ENG->>DB: OCs pendientes pagar
        ENG->>DB: Planilla próximo mes
        ENG->>DB: SC programados
    end

    ENG->>ENG: Calcula caja day-by-day
    ENG->>DB: Persistir cashflow_proyeccion

    ENG->>ALERT: Detecta días saldo < umbral
    ALERT->>ALERT: Genera notificaciones
    ALERT-->>CRON: OK
```

## Schema

```sql
-- Forecast cash flow
cashflow_proyecciones (
  id uuid PRIMARY KEY,
  proyecto_id uuid,                              -- NULL = consolidado empresa
  fecha_proyeccion date,                         -- día específico
  fecha_calculo timestamp,

  -- Entradas
  cobranza_valorizaciones decimal(14,2),
  cobranza_adelantos decimal(14,2),
  cobranza_otros decimal(14,2),
  total_entradas decimal(14,2),

  -- Salidas
  pago_oc decimal(14,2),
  pago_planilla decimal(14,2),
  pago_sc decimal(14,2),
  pago_alquileres decimal(14,2),
  pago_gg decimal(14,2),
  pago_tributos decimal(14,2),
  pago_costo_financiero decimal(14,2),
  total_salidas decimal(14,2),

  -- Saldo
  saldo_apertura decimal(14,2),
  flujo_neto decimal(14,2),
  saldo_cierre decimal(14,2),

  -- Detalle items
  detalle_entradas jsonb,                        -- lista items
  detalle_salidas jsonb,

  -- Confianza
  nivel_confianza decimal(3,2),                  -- 0..1 (más cercano más alto)

  -- Alertas
  alerta_saldo_negativo boolean,
  alerta_proximidad_umbral boolean
)

cashflow_eventos_programados (
  id uuid PRIMARY KEY,
  proyecto_id uuid,
  tipo ENUM ('cobro_valorizacion','pago_oc','pago_sc','pago_planilla',
             'pago_alquiler','pago_tributo','pago_costo_financiero',
             'cobro_adelanto','cobro_devolucion','prestamo_intercompany'),
  monto decimal(14,2),
  fecha_programada date,
  fecha_real date,
  origen_tabla varchar,
  origen_id uuid,
  estado ENUM ('proyectado','confirmado','realizado','cancelado','postpuesto'),
  observaciones text
)

-- Umbrales alertas
cashflow_umbrales (
  empresa_id uuid,
  umbral_alerta decimal(14,2),                   -- saldo mínimo
  umbral_critico decimal(14,2),                  -- saldo emergencia
  dias_horizonte integer DEFAULT 90,
  notificar_emails text[]
)
```

## Visualización dashboard

```mermaid
xychart-beta
    title "Cashflow proyectado 90 días"
    x-axis [D1, D7, D14, D21, D28, D35, D42, D49, D56, D63, D70, D77, D84]
    y-axis "S/ miles" -100 --> 1500
    line [800, 750, 700, 850, 1200, 1100, 950, 900, 750, 600, 450, 800, 1000]
```

Línea verde = saldo proyectado · línea roja = umbral mínimo · línea amarilla = umbral alerta

## Escenarios simulación

```mermaid
flowchart TB
    BASE[Escenario base<br/>sin acción] --> RIESGO[Día 56<br/>saldo S/ 50K · CRÍTICO]

    BASE --> SIM[Simulador escenarios]

    SIM --> E1[Escenario 1:<br/>Adelantar Val 03 entidad]
    E1 --> R1[Saldo día 56:<br/>S/ 380K ✓]

    SIM --> E2[Escenario 2:<br/>Postponer SC pago 15d]
    E2 --> R2[Saldo día 56:<br/>S/ 200K ✓<br/>riesgo SC default]

    SIM --> E3[Escenario 3:<br/>Factoring 30% Val 02<br/>tasa 1.8% mes]
    E3 --> R3[Saldo día 56:<br/>S/ 290K ✓<br/>costo factoring −S/ 2.5K]

    SIM --> E4[Escenario 4:<br/>Línea capital trabajo<br/>S/ 150K · 8% TEA]
    E4 --> R4[Saldo día 56:<br/>S/ 195K ✓<br/>costo intereses −S/ 4K]

    R1 --> COMP[Comparación]
    R2 --> COMP
    R3 --> COMP
    R4 --> COMP

    COMP --> DEC[Decisión gerencia]

    style RIESGO fill:#dc3545,color:#fff
    style R1 fill:#d4edda
    style R2 fill:#ffc107
    style R3 fill:#cce5ff
    style R4 fill:#cce5ff
```

## Línea bancaria capital trabajo

```mermaid
flowchart TB
    NEC[Necesidad capital trabajo] --> CHK_LIN{¿Tiene línea<br/>aprobada?}
    CHK_LIN -->|sí cupo disponible| USE[Usar línea]
    CHK_LIN -->|sí sin cupo| AMP[Solicitar ampliación]
    CHK_LIN -->|no línea| SOL_NEW[Solicitar nueva línea]

    USE --> DESEM[Desembolso<br/>banco transfiere]
    AMP --> EVAL[Banco evalúa]
    SOL_NEW --> EVAL

    EVAL --> Q_AP{¿Aprobada?}
    Q_AP -->|sí| LINEA_NEW[Línea ajustada]
    Q_AP -->|no| RECH[Rechazo<br/>buscar otra fuente]

    LINEA_NEW --> DESEM
    DESEM --> CRON_INT[Cron mensual<br/>devenga intereses]
    CRON_INT --> ASI_INT[Asiento:<br/>Dr 6792 Intereses préstamos<br/>Cr 469 Intereses por pagar]

    DESEM --> COBR[Eventualmente:<br/>obra cobra valorizaciones]
    COBR --> AMORT[Amortización<br/>capital + intereses]
    AMORT --> ASI_AM[Asiento:<br/>Dr 451 Préstamo banco<br/>Dr 469 Intereses<br/>Cr 104 Bancos]

    AMORT --> Q_TOTAL{¿Liquidado?}
    Q_TOTAL -->|sí| LIB[Línea liberada<br/>cupo disponible]
    Q_TOTAL -->|no| CRON_INT

    style RECH fill:#dc3545,color:#fff
    style LINEA_NEW fill:#d4edda
    style LIB fill:#d4edda
```

## Schema línea bancaria capital

```sql
-- (Extensión a lineas_bancarias del flujo 15)
prestamos_capital_trabajo (
  id uuid PRIMARY KEY,
  linea_id uuid REFERENCES lineas_bancarias,
  empresa_id uuid,
  proyecto_id uuid,                              -- NULL si general empresa

  monto_solicitado decimal(14,2),
  monto_desembolsado decimal(14,2),
  monto_amortizado decimal(14,2),
  saldo_capital decimal(14,2)
    GENERATED AS (monto_desembolsado - monto_amortizado) STORED,

  tasa_anual decimal(5,4),                       -- 0.08 = 8% TEA
  plazo_meses integer,
  cuota_mensual decimal(14,2),

  fecha_desembolso date,
  fecha_vencimiento date,

  estado ENUM ('solicitado','aprobado','desembolsado','en_pago','liquidado','default'),

  proposito text,                                 -- "Adelantar pagos SC HORNO mes 3"
  contrato_pdf_nas text,

  intereses_devengados_acumulado decimal(14,2),
  intereses_pagados_acumulado decimal(14,2)
)

prestamo_pagos (
  id uuid PRIMARY KEY,
  prestamo_id uuid REFERENCES prestamos_capital_trabajo,
  fecha_pago date,
  monto_capital decimal(14,2),
  monto_intereses decimal(14,2),
  monto_total decimal(14,2),
  saldo_post decimal(14,2),
  asiento_id uuid
)
```

## ML forecasting · predicción atraso pago entidad

```python
# Pseudo-código modelo

features = [
    'tipo_entidad',          # municipalidad / regional / ministerio
    'monto_valorizacion',
    'numero_valorizacion',   # primera, segunda, etc
    'mes_calendario',        # diciembre tarda más
    'dias_obra_total',
    'dias_atraso_val_anterior',
    'avance_fisico_pct',
    'observaciones_supervisor',  # boolean
    'reajuste_aplicado',
    'historial_atraso_entidad',  # promedio
]

target = 'dias_atraso_pago'

# Modelo: Random Forest o XGBoost
# Features importance esperada:
#   1. historial_atraso_entidad (0.35)
#   2. mes_calendario (0.20)
#   3. observaciones_supervisor (0.15)
#   4. monto_valorizacion (0.12)
#   ...
```

## Reportes cashflow

```
1. Calendario 90 días
   Vista day-by-day · saldo proyectado
   Color zonas · alertas

2. Heatmap riesgos
   Días críticos resaltados
   Eventos disparadores

3. Sensibilidad escenarios
   Slider parámetros (atraso pago entidad ±10 días, etc)
   Recálculo en vivo

4. Detalle entradas/salidas día específico
   Click día → drilldown items

5. Comparativo proyectado vs real
   Histórico precisión forecast
   Mejora modelo ML
```

## KPIs

| KPI | Fórmula | Target |
|---|---|---|
| Días caja positiva próx 90d | count días saldo > 0 | 90 ideal |
| Precisión forecast 30d | |proyectado − real| / real | < 10% |
| Saldo mínimo proyectado | min(saldo 90d) | > umbral_alerta |
| Línea bancaria utilizada | consumido / aprobado | < 70% saludable |
| Capital atrapado anticipos | Σ anticipos sin canje | < 5% caja |
| Costo financiero / utility | costo_fin / utility | < 5% |

## Prioridad: **ALTA**
