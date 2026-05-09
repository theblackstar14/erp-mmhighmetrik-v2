# 11 · Cronograma + Curva S · Programado vs Real

3 cronogramas distintos que viven simultáneo en el ERP.

## 3 cronogramas a manejar

```mermaid
flowchart TB
    BASE_ORIG[Cronograma ORIGINAL<br/>línea base contractual<br/>versión 1] --> BASE_REPRO

    BASE_REPRO[Cronograma REPROGRAMADO<br/>línea base vigente<br/>versión 2..N<br/>actualiza con modifs] --> EJEC

    EJEC[Cronograma REAL<br/>avance físico ejecutado<br/>data viva mes a mes]

    BASE_ORIG --> CMP{Comparación<br/>3 vías}
    BASE_REPRO --> CMP
    EJEC --> CMP

    CMP --> R1[Variance<br/>real vs original]
    CMP --> R2[Variance<br/>real vs reprogramado<br/>= cumplimiento actual]
    CMP --> R3[Justificación<br/>ampliaciones plazo]

    style BASE_ORIG fill:#fff4cc
    style BASE_REPRO fill:#cce5ff
    style EJEC fill:#d4edda
```

## Cuándo se reprograma

```mermaid
flowchart LR
    EVT[Evento disparador] --> AMP[Ampliación plazo aprobada]
    EVT --> ADIC[Adicional aprobado<br/>nuevas partidas]
    EVT --> RED[Reducción aprobada<br/>partidas eliminadas]
    EVT --> PAR[Paralización<br/>congela cronograma]

    AMP --> NEW_VER[Nueva versión<br/>cronograma_baseline]
    ADIC --> NEW_VER
    RED --> NEW_VER
    PAR --> NEW_VER

    NEW_VER --> SNAP[Snapshot inmutable<br/>versión anterior preservada]
    SNAP --> ACTIVA[Versión nueva = activa]

    style ACTIVA fill:#d4edda
```

## Generación Curva S

Curva S = avance acumulado en el tiempo.

```mermaid
flowchart TB
    PART[Por cada partida] --> DUR[Duración días]
    PART --> COSTO[Costo CD]
    PART --> INI[Fecha inicio Gantt]

    DUR --> DIST[Distribución diaria<br/>= costo / duración]
    INI --> DIST
    COSTO --> DIST

    DIST --> SUMA[Suma día a día<br/>todas las partidas activas]
    SUMA --> ACUM[Acumulado mes 1, 2, 3...]
    ACUM --> CURVA[Curva S programada<br/>línea verde]

    AVAS[Tabla avances] --> AGRUP[Agrupa por mes]
    AGRUP --> ACUM_R[Acumulado real mes 1, 2, 3...]
    ACUM_R --> CURVA_R[Curva S real<br/>línea azul]

    CURVA --> COMP[Comparación visual]
    CURVA_R --> COMP
    COMP --> SPI[SPI = real / programado]

    style CURVA fill:#fff4cc
    style CURVA_R fill:#cce5ff
    style SPI fill:#d4edda
```

## Ejemplo numérico Curva S programada PG0005

```
Total CD: S/ 1,319,122.00 · Plazo 120 días

Distribución acumulada según Gantt (estimada):
                 % programado    Monto programado acum
Mes 1 (30 d)          18%        S/   237,442
Mes 2 (60 d)          42%        S/   554,031
Mes 3 (90 d)          70%        S/   923,385
Mes 4 (120 d)        100%        S/ 1,319,122
```

Fórmula clásica curva S = sigmoide. Distribución típica obras públicas:
```
Mes 1: ~15-20%  (preliminares + estructuras inicio)
Mes 2: ~40-45%  (estructuras + arquitectura inicio · pico productivo)
Mes 3: ~70-75%  (arquitectura + IISS + IIEE)
Mes 4: 100%     (acabados + entregables)
```

## Curva S real · 3 variantes

```mermaid
flowchart TB
    REAL[Avance real registrado] --> V1[Curva S Físico<br/>% metrado ejecutado]
    REAL --> V2[Curva S Financiero<br/>S/ valorizado]
    REAL --> V3[Curva S Costo<br/>S/ costo real ejecutado]

    V1 --> CMP[Comparación con programa]
    V2 --> CMP
    V3 --> CMP

    style V1 fill:#cce5ff
    style V2 fill:#fff4cc
    style V3 fill:#d4edda
```

| Variante | Mide | Útil para |
|---|---|---|
| Físico | % metrado real / metrado total | Entidad supervisión |
| Financiero | S/ valorizado / S/ contractual | Cobranza / cash flow |
| Costo | S/ costo real / S/ presupuesto | Utility análisis |

## Indicadores EVM (Earned Value)

```
PV (Planned Value)      = costo programado al fecha de corte
EV (Earned Value)       = costo presupuestado del trabajo realizado
AC (Actual Cost)        = costo real del trabajo realizado

SPI = EV / PV            (Schedule Performance Index)
  > 1: adelantado
  = 1: en tiempo
  < 1: atrasado

CPI = EV / AC            (Cost Performance Index)
  > 1: bajo presupuesto
  = 1: en presupuesto
  < 1: sobre presupuesto

ETC (Estimate To Complete) = (Total presupuesto − EV) / CPI
EAC (Estimate At Completion) = AC + ETC
```

## Schema cronograma + Curva S

```sql
cronograma_baseline (                      -- líneas base versionadas
  id, proyecto_id,
  version integer,                         -- 1=original, 2..N=reprog
  fecha_corte date,                        -- desde cuando aplica
  motivo text,                              -- "Adicional 01" / "Amp.plazo 30d"
  status ENUM ('historica','vigente'),
  modificacion_id REFERENCES modificaciones_contractuales,
  created_at, created_by
)

cronograma_partidas (                      -- snapshot por versión × partida
  id, baseline_id, partida_id,
  duracion_dias integer,
  fecha_inicio date,
  fecha_fin date,
  predecesoras text[],                     -- ["01.01.01","01.01.02"]
  costo_planificado decimal(14,2),
  is_critical boolean,
  is_milestone boolean
)

curva_s_planificada (                      -- agregado mensual programado
  id, baseline_id,
  anio, mes,
  monto_periodo decimal(14,2),
  monto_acumulado decimal(14,2),
  pct_acumulado decimal(5,2)
)

curva_s_real (                              -- agregado mensual ejecutado
  id, proyecto_id,
  anio, mes,
  fisico_acumulado_pct decimal(5,2),
  financiero_acumulado_monto decimal(14,2),
  costo_real_acumulado decimal(14,2)
)
```

## Reglas críticas

1. **Solo 1 baseline vigente** por proyecto en un momento dado
2. **Snapshots inmutables** de baselines anteriores (no editables)
3. **Reprogramación requiere modificación contractual** asociada (excepto reprogramación interna sin cambio de plazo)
4. **Curva S real** se actualiza al cierre de cada valorización (no diario)
5. **Σ mensual programado = monto contractual CD** (1,319,122 en PG0005)

## Herramientas/visualización

```
Tab Cronograma (proyecto detail)
  ├─ Vista Gantt (diagrama barras + dependencias)
  ├─ Vista lista jerárquica (EDT)
  ├─ Vista Curva S (línea programada vs real)
  ├─ Versionado: dropdown selector baseline
  └─ Export: MS Project XML / Excel / PDF
```

Librerías candidatas:
- **frappe-gantt** o **dhtmlx-gantt** (web)
- **vis-timeline** (timeline simple)
- **recharts** o **echarts** (curva S)
