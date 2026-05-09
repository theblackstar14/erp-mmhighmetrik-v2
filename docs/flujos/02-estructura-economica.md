# 02 · Estructura económica obra

Cómo se forma el monto contractual desde el costo directo.

## Composición monto

```mermaid
flowchart TB
    subgraph CD["COSTO DIRECTO · suma APUs"]
        MAT[Materiales]
        MO[Mano de obra]
        EQ[Equipos]
        HER[Herramientas]
        SC[Subcontratos<br/>constructivos]
    end

    CD --> SUB1[Σ Costo Directo<br/>S/ 1,319,122.00]
    SUB1 --> GG["+ Gastos Generales 10%<br/>S/ 131,912.20"]
    GG --> UT["+ Utilidad 7%<br/>S/ 92,338.54"]
    UT --> SUB2[Subtotal<br/>S/ 1,543,372.74]
    SUB2 --> IGV["+ IGV 18%<br/>S/ 277,807.09"]
    IGV --> REF["★ PRESUPUESTO REFERENCIAL<br/>S/ 1,821,179.83<br/>(expediente técnico)"]

    REF --> FACTOR{factor oferta<br/>0.95}
    FACTOR --> CONT["★ MONTO CONTRACTUAL<br/>S/ 1,730,120.84<br/>(contrato firmado)"]

    CONT --> RED["− Reducción Res 35-2026<br/>S/ 54,187.67"]
    RED --> VIG["MONTO VIGENTE<br/>S/ 1,675,933.17"]

    style REF fill:#fff4cc
    style CONT fill:#cce5ff
    style VIG fill:#d4edda
```

## Tres montos a manejar simultáneo

```mermaid
flowchart LR
    A[Presupuesto<br/>REFERENCIAL] -->|expediente técnico<br/>entidad| ERP
    B[Presupuesto<br/>CONTRACTUAL] -->|contrato firmado<br/>oferta ganadora| ERP
    C[Presupuesto<br/>META interno] -->|fija constructora<br/>objetivo utility real| ERP

    ERP[ERP MM] --> COMP{Comparación<br/>3 vías}
    COMP --> R1[Variance<br/>oferta vs referencial]
    COMP --> R2[Variance<br/>real vs contractual<br/>= utility ejecución]
    COMP --> R3[Variance<br/>real vs meta<br/>= cumplimiento interno]
```

## Schema impacto

```sql
proyectos
  costo_directo               -- CD referencial
  pct_gg, pct_utilidad        -- factores referenciales
  monto_referencial           -- 1,821,179.83
  monto_contractual           -- 1,730,120.84  ← cobranza
  factor_oferta               -- 0.95
  monto_vigente               -- 1,675,933.17 (post modifs)
  presupuesto_meta            -- objetivo interno

partidas
  precio_unitario_referencial -- del expediente
  precio_unitario_contractual -- × factor 0.95
  costo_meta_unitario         -- objetivo interno
  presupuesto                 -- referencial × cantidad
  presupuesto_contractual     -- contractual × cantidad
```

## Regla cálculos

```
SIEMPRE referencial × factor_oferta = contractual

Cobranza valorización  → usa contractual
Análisis variance      → usa referencial
Control interno        → usa meta
```
