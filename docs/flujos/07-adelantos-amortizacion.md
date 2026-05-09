# 07 · Adelantos + amortización

Plata que entidad da al contratista ANTES de ejecutar. Se devuelve descontando cada valorización.

## Tipos en este contrato

```mermaid
flowchart LR
    CONT[Contrato 037] --> AD1[Adelanto Directo<br/>10% = 173,012.08<br/>uso libre obra]
    CONT --> AD2[Adelanto Materiales<br/>20% = 346,024.17<br/>compra materiales específicos]
    CONT --> AD3[Adelanto Avance<br/>10% = 173,012.08<br/>opcional · post avance]

    style AD1 fill:#cce5ff
    style AD2 fill:#fff4cc
    style AD3 fill:#d4edda
```

## Flujo solicitud → cobro → amortización

```mermaid
flowchart TB
    SOL[Contratista solicita<br/>adelanto X] --> FIA[Banco emite<br/>carta fianza<br/>monto + IGV]
    FIA --> ENT_FIA[Entrega fianza a entidad<br/>tabla garantias]
    ENT_FIA --> APROB[Entidad aprueba]
    APROB --> PAGO_AD[Entidad transfiere adelanto<br/>tabla adelantos status=pagado]
    PAGO_AD --> CAJA[Plata cuenta consorcio]

    CAJA --> EJEC[Contratista ejecuta obra]
    EJEC --> VAL_N[Valorización mes N]

    VAL_N --> CALC_AMORT[Calcula amortización<br/>= monto_adelanto × monto_val / monto_contractual]
    CALC_AMORT --> DESC[Descuenta de neto a pagar]
    DESC --> ACUM[Suma a monto_amortizado<br/>tabla adelantos]

    ACUM --> CHECK{¿Amortización<br/>completa?}
    CHECK -->|monto_amortizado<br/>= monto_adelanto| LIB[Status: amortizado<br/>Devolución carta fianza<br/>al contratista]
    CHECK -->|aún no| VAL_N

    LIB --> BANCO_LIB[Banco libera fianza<br/>recupera comisión]

    style PAGO_AD fill:#d4edda
    style DESC fill:#f8d7da
    style LIB fill:#28a745,color:#fff
```

## Fórmula amortización

```
Para cada adelanto y cada valorización:

amortización = (monto_adelanto / monto_contractual) × monto_valorizacion

donde:
  monto_valorizacion = bruto pre-descuentos (incluye IGV + reajuste)
```

## Ejemplo numérico PG0005

Adelanto directo 10% = S/ 173,012.08 sobre contrato S/ 1,730,120.84.

**Tasa amortización fija** = 173,012.08 / 1,730,120.84 = **10%**

| Val | Monto val (bruto) | Amort directo (10%) | Amort acumulada |
|---|---|---|---|
| V01 | 437,720.58 | 43,772.06 | 43,772.06 |
| V02 | 510,500.00 | 51,050.00 | 94,822.06 |
| V03 | 480,200.00 | 48,020.00 | 142,842.06 |
| V04 | 301,700.00 | 30,170.00 | **173,012.06** ✓ |

V04 cierra la amortización (saldo casi cero por redondeos).

**Si entidad para de pagar** después de V01 con S/ 43,772.06 amortizado, banco devuelve solo (173,012.08 − 43,772.06) = **129,240.02** vía carta fianza ejecutada.

## Adelanto materiales · regla extra

A diferencia del directo, el de materiales requiere **sustento previo**:

```mermaid
flowchart TB
    SOL_AM[Solicitud adelanto materiales 20%] --> SUST[Sustento:<br/>relación materiales<br/>+ proformas + cronograma compras]
    SUST --> ENT_REV[Entidad revisa sustento]
    ENT_REV -->|aprobado| FIA_AM[Carta fianza]
    ENT_REV -->|observa| SUST

    FIA_AM --> PAGO_AM[Pago adelanto]
    PAGO_AM --> COMPRA[OBLIGATORIO:<br/>contratista compra<br/>materiales del sustento]

    COMPRA --> SUNAT[SUNAT verifica<br/>facturas materiales = sustento]
    SUNAT -->|coincide| OK[OK]
    SUNAT -->|desvío| RIESGO[Riesgo penalidad<br/>+ devolución parcial]

    style PAGO_AM fill:#d4edda
    style RIESGO fill:#dc3545,color:#fff
```

## Adelanto avance 10% · opcional + condicional

```mermaid
flowchart TB
    AV[Avance físico ≥ 50%] --> SOL_AV[Solicitud adelanto avance 10%]
    SOL_AV --> COND{Cumple<br/>art 178.5 RLGCP?}
    COND -->|sí| FIA_AV[Carta fianza]
    COND -->|no| RECH[Rechazo]

    FIA_AV --> PAGO_AV[Pago 10% sobre monto vigente]
    PAGO_AV --> AMORT_RAP[Amortización rápida<br/>en valorizaciones restantes]

    style PAGO_AV fill:#d4edda
```

Suele NO usarse en obras cortas (< 6 meses). En PG0005 (120 días) probablemente no aplique.

## Garantías relacionadas

Cada adelanto requiere su carta fianza:

| Adelanto | Monto adelanto | Monto fianza | Vigencia |
|---|---|---|---|
| Directo | 173,012.08 | 173,012.08 + IGV | hasta amortización completa |
| Materiales | 346,024.17 | 346,024.17 + IGV | hasta amortización completa |
| Avance (si) | 173,012.08 | 173,012.08 + IGV | hasta amortización completa |

Costo banco: 3-6% anual sobre monto fianza × tiempo. Ej:
```
Carta fianza adelanto materiales:
  346,024.17 × 4% × (4 meses / 12) = S/ 4,613.66 comisión banco
```

★ Esto es **costo financiero real** que NO está en presupuesto pero pega utility.

## Schema impacto

```sql
adelantos (
  ... existente
  carta_fianza_garantia_id REFERENCES garantias,
  fecha_solicitud, fecha_aprobacion, fecha_pago,
  monto_solicitado, monto_aprobado, monto_amortizado,
  saldo_pendiente GENERATED AS (monto_aprobado - monto_amortizado),
  costo_financiero_estimado decimal(14,2)  -- comisión banco
)

amortizaciones_movimientos (              -- vincula valoriz × adelanto
  id, adelanto_id, valorizacion_id,
  monto_amortizado decimal(14,2),
  fecha
)
```

## Reglas críticas

1. **Tasa amortización = constante** = monto_adelanto / monto_contractual
2. **Aplica a bruto valorización** (post IGV, post reajuste FP)
3. **Suma amortizaciones = monto_adelanto** al final (cuadre exacto)
4. **Carta fianza vigente hasta amortización 100%**
5. **Costo banco** se aprovisiona al solicitar, se devenga mensual
