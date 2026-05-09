# 04 · Compra → Almacén → Consumo → Costo real

Cómo se llega del requerimiento al costo real partida.

## Flujo completo

```mermaid
flowchart TB
    REQ[Requerimiento<br/>residente obra] --> COT{Cotizaciones<br/>≥3?}
    COT -->|sí| OC[Orden de Compra<br/>aprobada]
    COT -->|no| REJ[Rechazo logística]
    REJ --> REQ

    OC -->|estado: comprometido| ALM_ESP[Esperando ingreso<br/>almacén]
    OC --> PROV[Proveedor entrega]

    PROV --> ING[Ingreso almacén<br/>guía remisión + factura]
    ING --> KAR_IN[Kardex: + Stock]
    KAR_IN --> ALM[Stock disponible<br/>en almacén obra]

    ING --> FAC[Factura recibida<br/>SUNAT válida]
    FAC --> CXP[Cuenta x pagar<br/>proveedor]
    FAC --> CRED_FISC[Crédito fiscal IGV]

    ALM --> SAL{Salida<br/>almacén}
    SAL -->|para partida X<br/>cantidad Y| KAR_OUT[Kardex: − Stock]
    KAR_OUT --> CONS[Consumo registrado<br/>partida X · cantidad Y · costo Z]
    CONS -->|estado: ejecutado| COSTO_REAL[★ COSTO REAL<br/>partida X<br/>actualizado]

    SAL -->|merma/desperdicio| MERM[Merma registrada]
    MERM --> COSTO_REAL

    SAL -->|transferencia<br/>otra obra| TRANSF[Transferencia<br/>kardex]
    TRANSF -.no afecta costo real.-> COSTO_REAL

    style OC fill:#fff4cc
    style ALM fill:#cce5ff
    style CONS fill:#d4edda
    style COSTO_REAL fill:#f8d7da
```

## 4 niveles control financiero

```mermaid
flowchart LR
    P[Presupuesto<br/>partida<br/>S/ 100,000] --> C[Comprometido<br/>OC emitidas<br/>S/ 60,000]
    C --> E[Ejecutado<br/>consumo real<br/>S/ 40,000]
    P --> S[Saldo disponible<br/>= 100,000 − 60,000<br/>= S/ 40,000]

    style P fill:#fff4cc
    style C fill:#ffc107
    style E fill:#dc3545,color:#fff
    style S fill:#28a745,color:#fff
```

| Nivel | Significado | Cuándo cambia |
|---|---|---|
| Presupuesto | Plata asignada partida | Carga inicial · adicional aprobado |
| Comprometido | OC emitida (aún no llegó) | Aprobación OC |
| Ejecutado | Consumo real almacén → partida | Salida almacén con destino partida |
| Saldo | Presupuesto − comprometido | Recalc en cada OC |

**Regla**: solo `ejecutado` cuenta para utility real. `comprometido` cuenta para alertas (¿voy a sobregirar?).

## Valuación kardex · promedio ponderado

```mermaid
flowchart TB
    A1[Ingreso 1<br/>100 bls cemento<br/>× S/ 28.50<br/>= 2,850] --> STOCK1[Stock: 100 bls<br/>Costo prom: 28.50]
    STOCK1 --> A2[Ingreso 2<br/>50 bls cemento<br/>× S/ 30.00<br/>= 1,500]
    A2 --> CALC[Stock total: 150 bls<br/>Costo total: 4,350<br/>Promedio: 4,350/150<br/>= S/ 29.00]
    CALC --> STOCK2[Stock: 150 bls<br/>Costo prom: 29.00]
    STOCK2 --> S1[Salida<br/>80 bls partida 02.01.02.02<br/>× S/ 29.00<br/>= consumo S/ 2,320]
    S1 --> STOCK3[Stock: 70 bls<br/>Costo prom: 29.00]
```

Cada salida usa el **costo promedio ponderado** del stock al momento.

## Diferencia OC vs factura

| Doc | Significado | Estado contable |
|---|---|---|
| OC | Compromiso compra | Comprometido (no contabiliza aún) |
| Guía remisión | Confirma entrega física | Ingreso almacén · stock + |
| Factura | Documento tributario | CxP + crédito fiscal IGV |
| Pago | Salida efectivo | CxP − · Caja − |

ERP debe permitir:
- OC sin factura (esperando entrega)
- Factura sin OC (compras menores · caja chica)
- Factura con detracción / retención IGV calculada auto

## Schema relevante

```sql
ordenes_compra (
  id, proyecto_id, numero, proveedor_ruc, proveedor_razon,
  fecha_emision, fecha_entrega_esperada, status, monto_total
)

oc_lineas (
  id, oc_id, recurso_id, partida_id,    -- vinculo partida
  cantidad, precio_unitario, parcial,
  cantidad_recibida                      -- delta = pendiente
)

facturas_recibidas (
  id, oc_id, serie, numero, fecha_emision,
  subtotal, igv, total,
  detraccion_pct, detraccion_monto,      -- 12% construcción
  retencion_igv_monto                    -- 3% si aplica
)

almacen_movimientos (
  id, proyecto_id, fecha,
  tipo,  -- ingreso | salida | merma | transferencia | ajuste
  recurso_id, cantidad, costo_unitario_promedio,
  partida_id,        -- solo si salida con destino partida
  oc_id,             -- solo si ingreso desde OC
  factura_id,        -- solo si ingreso con factura
  destino_obra_id,   -- solo si transferencia
  responsable_user_id
)

consumos_obra (
  id, partida_id, fecha,
  recurso_id, cantidad, costo_unitario, parcial,
  movimiento_id REFERENCES almacen_movimientos,
  residente_user_id
)
```

## Reportes que esto habilita

1. **Stock actual por almacén/obra** · `select * from kardex group by recurso`
2. **Costo real por partida** · `sum(consumos_obra.parcial) where partida = X`
3. **OC vs factura pendiente** · OCs sin factura completa
4. **Merma por partida** · % desperdicio real vs APU
5. **Variance precio** · costo real promedio vs APU referencial
