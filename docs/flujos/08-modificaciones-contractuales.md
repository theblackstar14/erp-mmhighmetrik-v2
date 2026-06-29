# 08 · Modificaciones contractuales

Cambios al contrato firmado: monto y/o plazo. Ley 32069 art 63 + 109.

## Tipos

```mermaid
flowchart TB
    MOD[Modificación contractual] --> TIPO{Tipo}

    TIPO --> ADIC[ADICIONAL<br/>+ alcance + monto]
    TIPO --> RED[REDUCCIÓN<br/>− alcance − monto<br/>tope 25% art 109.1]
    TIPO --> AMP[AMPLIACIÓN PLAZO<br/>+ días<br/>± monto GG]
    TIPO --> PAR[PARALIZACIÓN<br/>suspende plazo<br/>causal externa]

    ADIC --> ADIC_T{¿Aprobado<br/>por entidad?}
    ADIC_T -->|sí| ADIC_OK[+ monto vigente<br/>cobrable a entidad]
    ADIC_T -->|no| ADIC_INT[Adicional INTERNO<br/>asume contratista<br/>impacta utility]

    style ADIC_OK fill:#d4edda
    style ADIC_INT fill:#f8d7da
    style RED fill:#fff4cc
    style AMP fill:#cce5ff
```

## Caso PG0005 · ResoluAción Gerencial 35-2026

```mermaid
flowchart LR
    A[Contrato original<br/>S/ 1,730,120.84] --> B[Reducción Res 35-2026<br/>−S/ 54,187.67]
    B --> C[Monto vigente<br/>S/ 1,675,933.17]

    style A fill:#cce5ff
    style B fill:#fff4cc
    style C fill:#d4edda
```

Reducción 3.13% del contrato. Dentro del 25% legal. 6 partidas suprimidas:

| Ítem | Descripción | Monto |
|---|---|---|
| 02.02.06.01 | Listones división ambientes | 6,403.11 |
| 03.01.01.07.05 | Escalera de gato | 1,670.76 |
| 03.01.01.11.01.01 | Tanque GLP | 31,071.96 |
| 03.01.01.03.02 | Bloqueta vidrio | 259.28 |
| 03.01.01.10.05 | Celosía divisora | 2,296.35 |
| 03.01.03.03.01.01 | Pintura látex muros 2 manos | 1,216.06 |
| | **CD reducción** | **42,917.52** |
| | + Utilidad 7% | 3,004.23 |
| | Subtotal | 45,921.75 |
| | + IGV 18% | 8,265.92 |
| | **Total reducción** | **54,187.67** |

## Flujo aprobación adicional

```mermaid
flowchart TB
    DET[Residente detecta<br/>necesidad adicional<br/>ej. roca dura no prevista] --> SUST[Sustento técnico<br/>+ presupuesto adicional<br/>+ APUs nuevos]

    SUST --> SUP[Supervisor revisa]
    SUP -->|conformidad técnica| ENT[Eleva a entidad]
    SUP -->|observa| SUST

    ENT --> RES{Resolución<br/>Gerencia<br/>aprueba?}
    RES -->|sí| RES_PUB[Resolución publicada<br/>numero, monto, días]
    RES -->|no| ASUME[Contratista ASUME<br/>= adicional interno]

    RES_PUB --> AMP_M[Actualiza<br/>monto_vigente += monto_adicional]
    AMP_M --> NEW_PART[Crea partidas nuevas<br/>en árbol]
    NEW_PART --> COBR[Cobra en próx valorización]

    ASUME --> COSTO[Costo registrado<br/>SIN cobrarse a entidad<br/>impacta utility −]

    style RES_PUB fill:#d4edda
    style ASUME fill:#dc3545,color:#fff
    style COSTO fill:#f8d7da
```

## Flujo ampliación de plazo

```mermaid
flowchart TB
    CAUSAL[Causal art 158 RLGCP<br/>ej. lluvia · fuerza mayor · adicional · entidad demora] --> SOL[Solicitud ampliación<br/>+ sustento + cuaderno obra]
    SOL --> SUP[Supervisor opina]
    SUP --> ENT[Entidad resuelve<br/>15 días]

    ENT --> RES{¿Aprueba?}
    RES -->|sí| AMP_DIAS[+ días al plazo<br/>+ posible monto GG]
    RES -->|no| PEN_RIESGO[Sin ampliación<br/>riesgo penalidad mora<br/>si excede plazo original]

    AMP_DIAS --> REPRO[Reprogramación cronograma<br/>nueva línea base]
    REPRO --> CURVA_S[Actualiza Curva S<br/>nuevo programado]

    style AMP_DIAS fill:#d4edda
    style PEN_RIESGO fill:#dc3545,color:#fff
```

## Flujo paralización

```mermaid
flowchart TB
    EVT[Evento causal<br/>ej. fenómeno natural · falta predios · arqueológico] --> ACTA_PAR[Acta paralización<br/>firmada residente + supervisor]
    ACTA_PAR --> SUSP[Suspende cronograma<br/>desde fecha X]
    SUSP --> COND[Condición se resuelve]
    COND --> ACTA_REI[Acta reinicio]
    ACTA_REI --> RECALC[Recalcula plazo<br/>= original + días paralizados]

    style ACTA_PAR fill:#fff4cc
    style ACTA_REI fill:#d4edda
```

## Schema

```sql
modificaciones_contractuales (
  id, proyecto_id,
  tipo ENUM ('adicional','reduccion','ampliacion_plazo','paralizacion','adicional_interno'),
  numero,                          -- correlativo MOD-001
  numero_resolucion text,          -- "Res 35-2026-GAF-MSS"
  fecha_solicitud date,
  fecha_resolucion date,
  status ENUM ('solicitada','aprobada','rechazada','aplicada'),
  monto_delta decimal(14,2),       -- + adicional, − reducción, 0 amp.plazo
  dias_delta integer,              -- + amp.plazo, 0 otros
  motivo text,
  sustento_tecnico_nas text,
  resolucion_pdf_nas text,
  causal_legal text,               -- art 63 ley 32069 · art 158 RLGCP · etc
  created_at, created_by
)

modificaciones_partidas (          -- partidas afectadas
  id, modificacion_id, partida_id,
  tipo ('agregar' | 'eliminar' | 'modificar_metrado' | 'modificar_pu'),
  metrado_anterior, metrado_nuevo,
  pu_anterior, pu_nuevo,
  monto_delta
)
```

## Tope legal modificaciones

```
Adicionales acumulados ≤ 50% monto contrato (art 109.2 RLGCP)
Reducciones acumuladas ≤ 25% monto contrato (art 109.1)
Ampliación plazo: sin tope, requiere causal válida
```

## Recálculo monto vigente

```sql
monto_vigente = monto_contractual
              + Σ adicionales_aprobados
              − Σ reducciones_aprobadas
              + Σ ajuste_GG_ampliaciones_plazo
```

ERP recalcula `proyectos.monto_vigente` cada vez que `modificacion.status = aplicada`.

## Impacto en utility

| Tipo | Impacto utility |
|---|---|
| Adicional aprobado | +utility (cobra extra) |
| Adicional interno | −utility (asume contratista) |
| Reducción | neutro a +utility (libera trabajo, libera GG fijos) |
| Amp.plazo sin GG | −utility (más tiempo · más GG fijos) |
| Amp.plazo con GG | neutro |
| Paralización | depende causa (imputable o no) |
