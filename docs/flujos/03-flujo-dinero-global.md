# 03 · Flujo dinero global

Vista 360° de cómo entra y sale plata durante la obra.

## Flujo entradas / salidas

```mermaid
flowchart TB
    subgraph ENTIDAD["ENTIDAD CONTRATANTE<br/>(Municipalidad Surco)"]
        E1[Adelanto directo 10%]
        E2[Adelanto materiales 20%]
        E3[Adelanto avance 10%]
        E4[Pago Valorización N]
        E5[Devolución retenciones]
        E6[Pago liquidación final]
    end

    subgraph CONSORCIO["CONSORCIO LIMA<br/>RUC 20609286360 · DORATTA factura"]
        C1[Cuenta bancaria<br/>consorcio]
    end

    subgraph SALIDAS["GASTOS OBRA"]
        S1[Compras materiales]
        S2[Planilla obreros]
        S3[Subcontratos]
        S4[Alquiler equipos]
        S5[GG reales<br/>oficina/seguros/cartas fianza]
        S6[Detracción 12% SUNAT]
        S7[IGV mensual SUNAT]
        S8[Penalidades aplicadas]
    end

    subgraph REPARTO["REPARTO INTERNO 50/50"]
        R1[DORATTA 50%]
        R2[LCL 50%]
    end

    E1 --> C1
    E2 --> C1
    E3 --> C1
    E4 -->|neto post amortización| C1
    E5 --> C1
    E6 --> C1

    C1 --> S1
    C1 --> S2
    C1 --> S3
    C1 --> S4
    C1 --> S5

    E4 -.descuento automático.-> S6
    E4 -.descuento automático.-> S8
    C1 -.mes siguiente.-> S7

    C1 -->|liquidación final| REPARTO
    REPARTO --> R1
    REPARTO --> R2

    style E1 fill:#d4edda
    style E2 fill:#d4edda
    style E3 fill:#d4edda
    style E4 fill:#d4edda
    style E5 fill:#d4edda
    style E6 fill:#d4edda
    style S1 fill:#f8d7da
    style S2 fill:#f8d7da
    style S3 fill:#f8d7da
    style S4 fill:#f8d7da
    style S5 fill:#f8d7da
```

## Timeline movimientos típicos

```mermaid
gantt
    title Timeline plata · Obra 120 días
    dateFormat YYYY-MM-DD
    axisFormat %m-%d

    section Entradas
    Adelanto directo 10%       :milestone, m1, 2025-10-15, 0d
    Adelanto materiales 20%    :milestone, m2, 2025-10-20, 0d
    Cobro Val 01               :milestone, v1, 2025-12-05, 0d
    Cobro Val 02               :milestone, v2, 2026-01-05, 0d
    Cobro Val 03               :milestone, v3, 2026-02-05, 0d
    Cobro Val 04 final         :milestone, v4, 2026-03-05, 0d
    Devolución retención       :milestone, dev, 2026-04-15, 0d

    section Salidas
    Compras pesadas inicio     :a1, 2025-10-20, 30d
    Planilla mensual           :a2, 2025-10-15, 120d
    Subcontrato horno          :a3, 2025-11-15, 60d
    Detracción + IGV           :a4, 2025-11-01, 120d
```

## Cálculo neto valorización

```mermaid
flowchart TB
    INI[Monto valorización<br/>contractual + IGV] --> R1[+ Reajuste FP]
    R1 --> NETO_BRUTO[Total a valorizar]

    NETO_BRUTO --> D1[− Amort adelanto directo]
    D1 --> D2[− Amort adelanto materiales]
    D2 --> D3[− Amort adelanto avance]
    D3 --> D4[− Retención 10%]
    D4 --> D5[− Penalidades aplicadas]
    D5 --> NETO[NETO A PAGAR<br/>contratista]

    NETO --> DET[− Detracción 12%<br/>SPOT BN]
    DET --> CAJA[Plata efectiva<br/>cuenta consorcio]

    style INI fill:#fff4cc
    style NETO fill:#cce5ff
    style CAJA fill:#d4edda
```

## Costo financiero oculto

ERP debe trackear lo que NO se ve en presupuesto:

```
Carta fianza FC retención    0% (sustituida por retención)
Carta fianza adelanto dir.   3-5% anual × 173,012 × duración
Carta fianza adelanto mat.   3-5% anual × 346,024 × duración
Capital inmovilizado retenc. costo oportunidad × 173,012 × 60 días
Detracción SPOT              12% inmovilizado en BN hasta libre disposición
```

Sin trackear → utility ERP infla el verdadero margen.
