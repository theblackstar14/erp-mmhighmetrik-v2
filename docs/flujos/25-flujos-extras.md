# 25 · Flujos Extras Enterprise

Flujos complementarios que cubren aspectos críticos restantes detectados en auditoría.

## A · Conciliación bancaria automática

```mermaid
flowchart TB
    BANK[Statement file<br/>BCP MT940 / OFX / CSV] --> INGEST[Ingesta automática<br/>diaria 06:00]
    INGEST --> PARSE[Parser específico banco]

    PARSE --> MOVS[Movimientos extraídos]
    MOVS --> MATCH[Matching engine]

    MATCH --> M1{Match por<br/>monto + fecha + ref?}
    M1 -->|exacto| AUTO_OK[Match automático<br/>marca factura/val pagada]
    M1 -->|parcial| QUEUE[Cola revisión manual<br/>tesorería confirma]
    M1 -->|sin match| ORPH[Movimiento huérfano<br/>requiere clasificación]

    AUTO_OK --> CONT[Genera asiento<br/>Dr 421/Cr 104]
    QUEUE --> USER[Usuario asocia]
    USER --> CONT
    ORPH --> CLASIF[Clasificar manualmente:<br/>cobro entidad? gasto admin?]
    CLASIF --> CONT

    CONT --> RECON[Reconciliación cuenta<br/>saldo libro vs banco]
    RECON --> Q_CUAD{¿Cuadra?}
    Q_CUAD -->|sí| OK[Conciliación OK]
    Q_CUAD -->|no| INV[Investigar diferencia<br/>movimientos no registrados]

    style AUTO_OK fill:#d4edda
    style QUEUE fill:#ffc107
    style ORPH fill:#fd7e14,color:#fff
```

## B · Penalidades · cálculo + aplicación

```mermaid
flowchart TB
    EVT[Evento disparador penalidad] --> TIPO{Tipo}

    TIPO --> MORA[Penalidad por mora<br/>retraso vs plazo]
    TIPO --> SUP[Otras 10 supuestos<br/>contrato cláusula 15]

    MORA --> CALC_M[Calc: 0.10 × monto / (F × plazo)<br/>F = 0.25 plazo 61-120d]
    SUP --> CALC_S[Calc según fórmula<br/>específica supuesto]

    CALC_M --> APLIC[Aplicar a valorización<br/>siguiente]
    CALC_S --> APLIC

    APLIC --> CHK_TOPE{¿Acumulado<br/>< 10% monto vigente?}
    CHK_TOPE -->|sí| OK[Descuenta valorización]
    CHK_TOPE -->|no tope alcanzado| ALERT[ALERTA crítica<br/>posible resolución contrato<br/>por incumplimiento]

    OK --> NOTIF[Notifica supervisor + entidad]
    NOTIF --> DESCARGO{¿Contratista<br/>presenta descargo<br/>justificado?}
    DESCARGO -->|sí| EVAL[Entidad evalúa]
    DESCARGO -->|no| FIRM[Penalidad firme]

    EVAL --> Q_JUST{¿Justifica?}
    Q_JUST -->|sí| ANUL[Anular penalidad<br/>asiento reverso]
    Q_JUST -->|no| FIRM

    FIRM --> ASI_FIRM[Asiento contable:<br/>Dr 654 Penalidades<br/>Cr 121 CxC entidad]
    ANUL --> ASI_REV[Asiento reverso]

    style ALERT fill:#dc3545,color:#fff
    style ANUL fill:#d4edda
    style FIRM fill:#fd7e14,color:#fff
```

```sql
-- Penalidades aplicadas
ALTER TABLE penalidades_aplicadas ADD COLUMN
  asiento_aplicacion_id uuid,
  asiento_anulacion_id uuid,
  notif_supervisor_at timestamp,
  fecha_descargo date,
  documento_descargo_nas text,
  fecha_resolucion_descargo date,
  resolucion_descargo varchar;

-- Catálogo penalidades estandarizado
INSERT INTO penalidades_catalogo (proyecto_id, numero, supuesto, formula, procedimiento)
VALUES
  (..., 1, 'Sustitución plantel técnico', '5.5 UIT', '...'),
  (..., 2, 'Materiales fuera estándar', '0.5% valorización mes', '...'),
  (..., 3, 'EPPS no entregados', '0.5% valorización mes', '...'),
  (..., 4, 'Seguridad colectiva', '0.5% valorización mes', '...'),
  (..., 5, 'Cronograma plan trabajo', '5% UIT/día', '...'),
  (..., 6, 'Plazo levantamiento observ', '5% UIT/día', '...'),
  (..., 7, 'Ausencia personal', '5% UIT/ocurrencia', '...'),
  (..., 8, 'Dispositivos seguridad', '0.5% valorización mes', '...'),
  (..., 9, 'Cuaderno incidencias digital', '0.5% valorización mes', '...'),
  (..., 10, 'Plazos prestaciones adicionales', '0.5% valorización mes', '...');
```

## C · Observaciones supervisor entidad

```mermaid
flowchart TB
    VAL_EMI[Val emitida a entidad] --> SUP_REV[Supervisor revisa]
    SUP_REV --> Q_OBS{¿Observaciones?}

    Q_OBS -->|no| APR[Aprueba directo]
    Q_OBS -->|sí| EMI_OBS[Carta observación]

    EMI_OBS --> CLAS{Tipo observación}
    CLAS --> METR[Metrado: cantidad incorrecta]
    CLAS --> CALI[Calidad: protocolo faltante]
    CLAS --> DOC[Documentación: faltante]
    CLAS --> CONT[Contractual: fuera alcance]

    METR --> RESP[Contratista responde<br/>plazo legal típico 5d]
    CALI --> RESP
    DOC --> RESP
    CONT --> RESP

    RESP --> Q_AC{¿Aceptada<br/>por supervisor?}
    Q_AC -->|sí| LEV[Observación levantada<br/>pasa a aprobación]
    Q_AC -->|no| PRORR{¿Concede<br/>prórroga?}

    PRORR -->|sí| RESP
    PRORR -->|no| RECH[Rechazo definitivo<br/>retira valorización]

    RECH --> RECONS[Re-construir valorización<br/>nuevo número]
    LEV --> APR

    APR --> CONT_VAL[Continúa flujo cobranza]

    style EMI_OBS fill:#ffc107
    style RECH fill:#dc3545,color:#fff
    style LEV fill:#d4edda
```

```sql
val_observaciones (
  id uuid PRIMARY KEY,
  valorizacion_id uuid,
  numero varchar,                              -- correlativo OBS-V03-001
  origen ENUM ('supervisor','entidad','sgo','olc'),
  tipo ENUM ('metrado','calidad','documentacion','contractual','tecnico'),

  partida_id uuid,
  monto_observado decimal(14,2),
  metrado_observado decimal(14,4),

  descripcion text,
  fundamento_legal text,

  fecha_apertura date,
  plazo_respuesta_dias integer DEFAULT 5,
  fecha_limite_respuesta date,

  status ENUM (
    'pendiente_respuesta',
    'respondida',
    'levantada',
    'rechazada_definitiva',
    'prorrogada'
  ),

  archivo_carta_pdf_nas text,
  archivo_respuesta_pdf_nas text,
  archivo_resolucion_pdf_nas text,

  fecha_levantamiento date,
  fecha_rechazo date,
  observaciones_internas text
)
```

## D · Cuaderno de obra digital

```mermaid
sequenceDiagram
    participant RES as Residente
    participant SUP as Supervisor
    participant CO as Cuaderno Obra Digital
    participant SEACE as SEACE Pladicop

    RES->>CO: Asiento día N · trabajos ejecutados + ocurrencias
    CO->>CO: Timestamp + GPS + fotos
    CO->>SUP: Notifica firma pendiente
    SUP->>CO: Lee asiento residente
    SUP->>CO: Asiento supervisor · conformidad u observaciones
    CO->>RES: Notifica respuesta
    RES->>CO: Firma confirmación

    Note over RES,SUP: Diariamente

    CO->>CO: Hash chain · garantía no manipulación
    CO->>SEACE: Subida diaria asiento (cuando esté API)
    SEACE-->>CO: Acuse recepción
```

```sql
cuaderno_obra (
  id uuid PRIMARY KEY,
  proyecto_id uuid,
  numero_asiento integer,                       -- correlativo
  fecha date,

  -- Asiento residente
  asiento_residente text,
  trabajos_ejecutados text,
  ocurrencias text,
  condiciones_climatologicas varchar,
  personal_dia_count integer,
  equipos_dia jsonb,

  fotos_nas text[],                             -- panel fotográfico
  gps_coords point,                             -- coordenadas obra
  firma_residente_at timestamp,
  firma_residente_user_id uuid,

  -- Asiento supervisor
  asiento_supervisor text,
  conformidad_supervisor boolean,
  observaciones_supervisor text,
  firma_supervisor_at timestamp,
  firma_supervisor_user_id uuid,

  -- Hash chain inmutabilidad
  previous_hash varchar(64),
  current_hash varchar(64) GENERATED AS (...) STORED,

  -- SEACE
  enviado_seace_at timestamp,
  cdr_seace varchar,

  created_at, updated_at
)

CREATE UNIQUE INDEX ON cuaderno_obra (proyecto_id, numero_asiento);
```

## E · Forecast utility ML

```mermaid
flowchart TB
    HIST[Histórico obras pasadas<br/>features + utility final] --> TRAIN[Entrenamiento modelo]
    TRAIN --> MODEL[Modelo ML<br/>XGBoost / RandomForest]

    OBRA[Obra actual] --> FEATURES[Extracción features]

    FEATURES --> F1[Avance físico actual]
    FEATURES --> F2[SPI/CPI actual]
    FEATURES --> F3[Variance compras vs APU]
    FEATURES --> F4[Productividad MO real]
    FEATURES --> F5[Penalidades acumuladas]
    FEATURES --> F6[Modificaciones contractuales]
    FEATURES --> F7[Tipo entidad cliente]
    FEATURES --> F8[Días restantes plazo]
    FEATURES --> F9[Costo financiero garantías]
    FEATURES --> F10[Inflación período]

    F1 --> PRED[Predicción modelo]
    F2 --> PRED
    F3 --> PRED
    F4 --> PRED
    F5 --> PRED
    F6 --> PRED
    F7 --> PRED
    F8 --> PRED
    F9 --> PRED
    F10 --> PRED

    PRED --> OUT[Output:<br/>Utility final estimada<br/>Intervalo confianza 80%<br/>Top 3 features impacto]

    OUT --> DASH[Dashboard]
    OUT --> ALERT{Utility < 0?}
    ALERT -->|sí| RIESGO[ALERTA RIESGO<br/>análisis causas raíz]

    style RIESGO fill:#dc3545,color:#fff
```

## F · OCR documentos

```mermaid
flowchart LR
    DOC[PDF/imagen recibido<br/>scan email · upload · NAS] --> OCR[OCR engine<br/>AWS Textract / Google Doc AI]
    OCR --> CLAS[Clasificador documento]

    CLAS --> Q{Tipo}
    Q -->|factura| F[Factura]
    Q -->|guía remisión| G[Guía]
    Q -->|contrato| C[Contrato]
    Q -->|carta fianza| CF[Carta fianza]
    Q -->|acta| A[Acta]

    F --> EXT_F[Extrae:<br/>RUC · serie · número · base · IGV · total]
    G --> EXT_G[Extrae:<br/>guía · cantidad · destino]
    C --> EXT_C[Extrae:<br/>partes · monto · plazo · CUI]
    CF --> EXT_CF[Extrae:<br/>banco · monto · vigencia]
    A --> EXT_A[Extrae:<br/>firmantes · fechas]

    EXT_F --> MATCH_F{Match con OC?}
    MATCH_F -->|sí| ASOC[Asocia auto]
    MATCH_F -->|no| QUEUE[Cola revisión]

    EXT_G --> MATCH_G{Match con OC?}
    EXT_CF --> NEW_FIA[Crea registro garantía<br/>flag 'auto_ocr_review']

    ASOC --> SUNAT_VAL[Validación SUNAT auto]
    SUNAT_VAL --> REG[Registro automático]

    style ASOC fill:#d4edda
    style QUEUE fill:#ffc107
```

## G · SEACE / Pladicop integración

```
Cuando API SEACE esté disponible:

Endpoints sugeridos:
  GET /procesos              · listar procesos selección activos
  GET /procesos/{id}         · detalle proceso
  POST /procesos/{id}/oferta · enviar oferta
  GET /contratos/{id}        · detalle contrato

  POST /contratos/{id}/valorizaciones  · subir Val mensual
  POST /contratos/{id}/cuaderno        · subir asiento cuaderno obra
  POST /contratos/{id}/modificaciones  · subir modif

Eventos consumir:
  ProcesoBuenaProAprobada  → mover proyecto a 'adjudicado'
  ContratoFirmado         → mover a 'ejecucion'
  ResolucionEmitida       → crear modificacion_contractual
  AmpliacionPlazoAprobada → trigger reprogramación
```

## H · Flotas equipos · horas máquina

```mermaid
flowchart TB
    EQ[Equipo · ej mezcladora] --> CAT[Catálogo equipos<br/>propios + alquilados]

    CAT --> ASIG[Asignación a partida<br/>vía parte diario]

    ASIG --> HM[Registro horas máquina<br/>HM = horas operativas]

    HM --> COSTO[Cálculo costo:<br/>HM × tarifa hora]

    COSTO --> Q_TIPO{Tipo equipo}
    Q_TIPO -->|propio| TARIFA_P[Tarifa interna<br/>= depreciación + mantto + combustible]
    Q_TIPO -->|alquilado| TARIFA_A[Tarifa contrato alquiler]

    TARIFA_P --> APL[Aplica costo a partida]
    TARIFA_A --> APL

    APL --> CONS[Costo equipo<br/>incrementa costo real partida]

    HM --> COMB[Registro combustible<br/>litros consumidos]
    COMB --> RATIO[Ratio L/HM]
    RATIO --> ANO{¿Anomalía?<br/>>20% promedio}
    ANO -->|sí| ALERT[Alerta robo combustible<br/>o falla mecánica]
```

```sql
equipos (
  id uuid PRIMARY KEY,
  empresa_id uuid,
  codigo varchar UNIQUE,
  descripcion text,
  tipo varchar,
  marca, modelo, serie,
  ano_fabricacion integer,
  tipo_propiedad ENUM ('propio','alquilado','leasing'),

  -- Tarifa
  tarifa_hora decimal(10,2),
  costo_combustible_lt decimal(7,2),

  -- Mantto
  horas_acumuladas decimal(10,2),
  km_acumulados decimal(10,2),
  proximo_mantto_h decimal(10,2),

  -- SCTR si transporta personal
  poliza_id uuid REFERENCES polizas
)

equipo_asignaciones (
  id uuid PRIMARY KEY,
  equipo_id uuid,
  proyecto_id uuid,
  partida_id uuid,
  parte_diario_id uuid,
  fecha date,
  hora_inicio time,
  hora_fin time,
  hm_operativas decimal(5,2),
  combustible_lt decimal(8,2),
  observaciones text,
  operador_id uuid REFERENCES trabajadores
)
```

## I · Multi-proyecto consolidado

```mermaid
flowchart TB
    EMP[Empresa MM] --> P1[Proyecto A · ejecución]
    EMP --> P2[Proyecto B · ejecución]
    EMP --> P3[Proyecto C · liquidación]
    EMP --> P4[Proyecto D · adjudicado]

    P1 --> AGG[Vista consolidada]
    P2 --> AGG
    P3 --> AGG
    P4 --> AGG

    AGG --> CONS[Consolidación]
    CONS --> CONS_F[Caja consolidada]
    CONS --> CONS_U[Utility consolidada]
    CONS --> CONS_R[Recursos compartidos<br/>plantel · equipos]
    CONS --> CONS_G[Garantías consolidadas]
    CONS --> CONS_TR[Tributos mes consolidado]

    CONS --> RPT[Reportes ejecutivos]
    RPT --> R1[Backlog · obras pipeline]
    RPT --> R2[Margen agregado mes]
    RPT --> R3[Liquidez consolidada]
    RPT --> R4[Línea bancaria utilizada]
    RPT --> R5[Top obras rentables/perdedoras]
```

## J · App móvil residente · PWA

```
Capacidades obligatorias móvil:
  - Registro avance partida (% + foto)
  - Cuaderno obra (texto + foto + GPS)
  - Tareo obreros (asistencia + horas + partida)
  - Aprobación OC menor (residente)
  - Recepción material (foto + firma)
  - Vale salida almacén
  - Subida documentos NAS
  - Notificaciones push

Tech stack sugerido:
  PWA (Progressive Web App)
  React + Vite + Workbox
  Service Worker offline-first
  IndexedDB para cache
  Background sync cuando recupera red

Razón: instalar app store es fricción
       PWA = misma URL = se instala con un click
       Funciona offline en obra (sin internet)
```

## Prioridad: Variable según item

| Item | Prioridad |
|---|---|
| A Conciliación bancaria | Alta |
| B Penalidades flujo | Alta |
| C Observaciones supervisor | Crítica |
| D Cuaderno obra digital | Crítica |
| E Forecast utility ML | Media |
| F OCR documentos | Media |
| G SEACE integración | Baja (depende API) |
| H Flotas equipos HM | Alta |
| I Multi-proyecto consolidado | Alta |
| J App móvil residente PWA | Crítica |
