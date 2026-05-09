# 09 · Planilla + tareo · MO propia → costo partida

Mano obra propia · CAPECO. Cómo se llega del jornal al costo real de partida.

## Flujo diario → mensual

```mermaid
flowchart TB
    DIA[Día N de obra] --> RES[Residente registra tareo]
    RES --> ASIST[Por cada trabajador:<br/>asistencia + horas + partida]

    ASIST --> CONS[Consolida diario<br/>tabla tareos]
    CONS --> NEXT{¿Fin de mes?}
    NEXT -->|no| DIA
    NEXT -->|sí| CIERRE[Cierre planilla mensual]

    CIERRE --> CALC_PLAN[Calcula planilla<br/>= jornales + leyes sociales]
    CALC_PLAN --> COSTO_MO[Costo MO mensual<br/>distribuido por partida<br/>según tareos]
    COSTO_MO --> CONT[Asiento contable<br/>cuenta 621/627]
    COSTO_MO --> ACUM[Acumula costo MO<br/>por partida]

    ACUM --> COSTO_REAL[★ Costo MO real<br/>partida X mes Y]

    style RES fill:#fff4cc
    style COSTO_REAL fill:#d4edda
```

## Composición costo MO real (CAPECO)

```mermaid
flowchart LR
    JOR[Jornal diario base] --> BC[Costo básico<br/>jornal × días]
    BC --> BUC[+ BUC<br/>32% Operario<br/>30% Oficial<br/>30% Peón]
    BUC --> LS[+ Leyes sociales<br/>~12%]
    LS --> SCTR[+ SCTR<br/>~3-5%]
    SCTR --> CONA[+ CONAFOVISER 2%]
    CONA --> SEN[+ SENCICO 0.2%]
    SEN --> TOTAL[★ Costo MO total<br/>≈ jornal × 1.55-1.65]

    style JOR fill:#fff4cc
    style TOTAL fill:#d4edda
```

Ejemplo trabajador Operario jornal S/ 88.10:
```
Costo real día = 88.10 × 1.62 ≈ S/ 142.72
```
Eso va al costo real, NO el jornal puro.

## Tareo diario · estructura

```mermaid
flowchart TB
    TR[Trabajador<br/>Juan Pérez · Operario] --> DIA[Día 15/11/2025]
    DIA --> ACT[Actividades del día]

    ACT --> A1[8 hrs partida 02.01.03.02<br/>COLUMNAS · encofrado]
    ACT --> A2[2 hrs partida 02.01.03.04<br/>VIGAS · armado]

    A1 --> COSTO1[Costo: 8 hrs × tarifa hora]
    A2 --> COSTO2[Costo: 2 hrs × tarifa hora]

    COSTO1 --> ACUM[Costo MO total<br/>distribuido por partida]
    COSTO2 --> ACUM

    style TR fill:#fff4cc
    style ACUM fill:#d4edda
```

Permite:
- Partir el día de un peón entre 2-3 partidas
- Medir productividad: m³ vaciado / hh peón
- Variance vs APU: APU dice 0.8 hh peón / m³, real = 1.2 hh peón / m³ → +50% sobre

## Categorías CAPECO

```
Capataz   = ~1.45 × Operario
Operario  = base
Oficial   = ~0.85 × Operario
Peón      = ~0.75 × Operario
```

Tarifas CAPECO se actualizan cada año (junio). ERP debe importarlas anuales.

## Schema

```sql
planilla_periodos (
  id, proyecto_id, anio, mes,
  fecha_inicio, fecha_fin,
  status ENUM ('abierto','en_proceso','cerrado'),
  fecha_cierre, cerrado_por_user_id
)

tareos (
  id, periodo_id, trabajador_id, fecha,
  partida_id,                          -- a qué partida cargó horas
  horas_normales decimal(4,2),
  horas_extras decimal(4,2),           -- 25% o 35% recargo
  hizo_jornal_completo boolean,        -- pagó jornal completo o proporcional
  observaciones,
  registrado_por_user_id
)

planilla_calculos (                     -- snapshot al cerrar período
  id, periodo_id, trabajador_id,
  dias_trabajados, horas_totales,
  jornal_base, monto_jornales,
  buc_pct, monto_buc,
  leyes_sociales_pct, monto_ls,
  sctr_pct, monto_sctr,
  conafoviser_pct, monto_conafoviser,
  sencico_pct, monto_sencico,
  total_bruto, descuentos, neto_pagar
)

costo_mo_partidas (                     -- vista materializada o tabla
  partida_id, periodo_id,
  horas_totales decimal(8,2),
  costo_mo_total decimal(14,2),         -- prorrateado según tareos
  trabajadores_distintos integer
)
```

## Cálculo costo MO por partida

```sql
-- Para una partida X en mes Y:
SELECT
  t.partida_id,
  SUM(t.horas_normales + t.horas_extras) as total_horas,
  SUM(
    (t.horas_normales + t.horas_extras × 1.25)
    × (pc.total_bruto / pc.horas_totales)
  ) as costo_mo
FROM tareos t
JOIN planilla_calculos pc ON pc.trabajador_id = t.trabajador_id
                          AND pc.periodo_id = t.periodo_id
WHERE t.partida_id = X
  AND pc.periodo_id = Y
GROUP BY t.partida_id
```

## Productividad · ratio clave

```
Productividad partida = metrado_ejecutado / horas_hombre_invertidas

Comparar vs APU:
  APU: 0.8 hh peón / m³ concreto
  Real: 1.2 hh peón / m³
  → Productividad real = 0.83 m³/hh
  → Variance: −33% (se demora más de lo presupuestado)
```

Reporte ERP: variance productividad por partida × período. Detecta partidas que se están demorando más de lo APU.

## Plantel técnico vs obreros · separación

| Tipo | Pago | Cómo se contabiliza |
|---|---|---|
| **Plantel clave** (Residente, Asistente, Esp.) | Contrato fijo mensual | GG · gasto general |
| **Plantel apoyo** (capataces, almacenero) | Contrato fijo | GG · gasto general |
| **Obreros directos** (operario·oficial·peón) | Jornal × días | CD · costo directo · partida |

Tabla `trabajadores` ya separa por `categoria` enum. Falta diferenciar `plantel_clave` boolean.
