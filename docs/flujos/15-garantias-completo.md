# 15 · Garantías + Pólizas + Línea Bancaria · Diseño completo

Sistema garantías enterprise. Cubre fianzas, pólizas, renovaciones, ejecuciones, costo financiero.

## Universo garantías obra pública

```mermaid
flowchart LR
    subgraph CONT["Contratista → Entidad"]
        G1[Fiel Cumplimiento<br/>10% contrato]
        G2[Adelanto Directo<br/>10% + IGV]
        G3[Adelanto Materiales<br/>20% + IGV]
        G4[Adelanto Avance<br/>10% + IGV]
        G5[Beneficios Sociales<br/>5% planilla]
        G6[Retención sustitutiva<br/>10% × valoriz]
    end

    subgraph SC["SC → Contratista"]
        S1[Fiel Cumplimiento SC<br/>5-10%]
        S2[Adelanto SC<br/>si aplica]
        S3[Fondo Garantía<br/>retención 5%]
        S4[Vicios ocultos<br/>365 días post]
    end

    subgraph PRV["Proveedor → Contratista"]
        P1[Anticipo proveedor<br/>si > 30%]
        P2[Garantía equipo<br/>fabricante]
    end

    subgraph SEG["Seguros · Pólizas"]
        SS1[CAR · Construction All Risk]
        SS2[SCTR · Pensión + Salud]
        SS3[Responsabilidad Civil]
        SS4[Equipos contratista]
        SS5[Vehicular flota]
        SS6[TDV · Transporte materiales]
    end

    subgraph LIN["Línea bancaria"]
        L1[Línea cartas fianza<br/>S/ X aprobada]
        L2[Línea adelantos<br/>S/ Y]
        L3[Línea capital trabajo<br/>S/ Z]
    end
```

## Schema enterprise garantías

```sql
-- ENUM tipos garantía
CREATE TYPE garantia_tipo AS ENUM (
  'fiel_cumplimiento',
  'adelanto_directo',
  'adelanto_materiales',
  'adelanto_avance',
  'beneficios_sociales',
  'retencion_sustitutiva',
  'sc_fiel_cumplimiento',
  'sc_adelanto',
  'sc_fondo_garantia',
  'sc_vicios_ocultos',
  'proveedor_anticipo',
  'proveedor_equipo'
);

CREATE TYPE emisor_relacion AS ENUM (
  'contratista_a_entidad',
  'sc_a_contratista',
  'proveedor_a_contratista'
);

CREATE TYPE garantia_estado AS ENUM (
  'borrador',
  'solicitada',
  'emitida',
  'vigente',
  'por_vencer_30d',
  'por_vencer_7d',
  'vencida',
  'renovada',
  'ejecutada',
  'devuelta',
  'cancelada'
);

garantias (
  id uuid PRIMARY KEY,
  proyecto_id uuid,

  -- Tipo + relación
  tipo garantia_tipo,
  emisor_relacion emisor_relacion,

  -- Partes
  emisor_ruc varchar(11),                    -- quien emite (si SC/proveedor)
  emisor_razon varchar,
  beneficiario_ruc varchar(11),
  beneficiario_razon varchar,

  -- Documento
  numero_carta varchar UNIQUE,
  banco_emisor varchar,
  numero_operacion_banco varchar,
  archivo_pdf_nas text,
  archivo_endoso_pdf_nas text,

  -- Montos
  monto decimal(14,2) NOT NULL,
  monto_cobertura decimal(14,2),             -- algunos cubren más
  moneda char(3) DEFAULT 'PEN',
  tipo_cambio_emision decimal(7,4),

  -- Vigencia
  fecha_solicitud date,
  fecha_emision date,
  vigencia_desde date,
  vigencia_hasta date,
  dias_renovacion_alerta integer DEFAULT 30,
  dias_renovacion_critico integer DEFAULT 7,

  -- Estado
  estado garantia_estado DEFAULT 'borrador',
  fecha_estado_actual timestamp,

  -- Renovaciones / encadenamiento
  garantia_padre_id uuid REFERENCES garantias,
  numero_renovacion integer DEFAULT 0,

  -- Ejecución
  ejecutada_at timestamp,
  monto_ejecutado decimal(14,2),
  motivo_ejecucion text,

  -- Devolución
  devuelta_at timestamp,
  acta_devolucion_nas text,

  -- Costo financiero
  comision_emision decimal(14,2),
  tasa_comision_anual decimal(5,4),          -- 0.04 = 4% anual
  costo_total_financiero decimal(14,2),      -- proyectado

  -- Línea bancaria
  linea_bancaria_id uuid,
  consume_linea boolean DEFAULT true,

  -- Triggers contractuales
  modificacion_contractual_id uuid,
  evento_disparador varchar,

  -- Adelanto/garantía relacionado
  adelanto_id uuid,                          -- si garantiza adelanto
  subcontrato_id uuid,                       -- si garantía SC

  -- Audit
  created_at, updated_at,
  created_by, updated_by
)

CREATE INDEX ON garantias (proyecto_id, estado);
CREATE INDEX ON garantias (vigencia_hasta) WHERE estado = 'vigente';
CREATE INDEX ON garantias (linea_bancaria_id);

-- Pólizas seguros (similar pero independiente)
polizas (
  id uuid PRIMARY KEY,
  proyecto_id uuid,

  tipo varchar,                               -- 'CAR','SCTR_pension','SCTR_salud','RC','equipos','vehicular','tdv'

  aseguradora varchar,
  numero_poliza varchar,

  -- Cobertura
  prima decimal(14,2),
  prima_anual decimal(14,2),
  pagos_realizados integer DEFAULT 0,
  pagos_totales integer,
  cobertura_total decimal(14,2),
  deducible decimal(14,2),

  vigencia_desde date,
  vigencia_hasta date,

  archivo_poliza_nas text,
  endosos jsonb DEFAULT '[]',

  estado varchar,                             -- 'vigente','por_vencer','vencida','siniestrada','renovada'
  beneficiarios jsonb,                        -- ente, MM, SC, etc

  created_at, updated_at
)

-- Línea bancaria
lineas_bancarias (
  id uuid PRIMARY KEY,
  empresa_id uuid,
  banco varchar,
  ruc_titular varchar(11),
  tipo varchar,                               -- 'cartas_fianza','adelantos','capital_trabajo'

  monto_aprobado decimal(14,2),
  monto_consumido decimal(14,2) DEFAULT 0,
  monto_disponible decimal(14,2)
    GENERATED ALWAYS AS (monto_aprobado - monto_consumido) STORED,

  fecha_aprobacion date,
  fecha_renovacion date,                      -- línea típicamente anual
  tasa_comision_anual decimal(5,4),
  contrato_linea_pdf_nas text,

  estado varchar DEFAULT 'vigente'            -- 'vigente','en_renovacion','suspendida','cancelada'
)

linea_bancaria_movimientos (
  id uuid PRIMARY KEY,
  linea_id uuid REFERENCES lineas_bancarias,
  fecha date,
  tipo varchar,                               -- 'emision_carta','liberacion','renovacion','ejecucion','ajuste'
  garantia_id uuid REFERENCES garantias,
  monto decimal(14,2),                        -- + consume, − libera
  monto_disponible_post decimal(14,2),
  observaciones text,
  user_id uuid
)

-- Costo financiero devengado mensual
costo_financiero_devengado (
  id uuid PRIMARY KEY,
  garantia_id uuid REFERENCES garantias,
  poliza_id uuid REFERENCES polizas,
  periodo_mes char(7),
  monto_devengado decimal(14,2),
  asiento_id uuid,
  generado_at timestamp
)
```

## Flujo emisión garantía

```mermaid
flowchart TB
    NEC[Necesidad detectada<br/>contrato firmado / amp.plazo / adicional] --> SOL[Solicitud interna<br/>tipo + monto + vigencia]

    SOL --> CHK_LIN{¿Línea bancaria<br/>tiene cupo?}
    CHK_LIN -->|no| LIN_ALT[Buscar línea alterna<br/>o ampliación]
    CHK_LIN -->|sí| RES_LIN[Reserva cupo<br/>− monto disponible]

    LIN_ALT --> RES_LIN
    RES_LIN --> SOL_BANCO[Solicitud formal banco<br/>+ doc respaldo]

    SOL_BANCO --> EVAL[Banco evalúa<br/>1-5 días]
    EVAL --> Q_AP{¿Aprobado?}
    Q_AP -->|no| RECH[Rechazo<br/>buscar otro banco]
    Q_AP -->|sí| EMI[Emisión carta fianza]

    EMI --> COMIS[Cobro comisión emisión<br/>+ ITF]
    COMIS --> ENT[Entrega física<br/>al beneficiario]
    ENT --> EST[Estado: vigente]

    EST --> CRON_DEV[Cron mensual<br/>devenga costo financiero]
    CRON_DEV --> CONT[Asiento:<br/>Dr 67 Gastos financieros<br/>Cr 469 Otras cuentas pagar]

    style EMI fill:#d4edda
    style RECH fill:#dc3545,color:#fff
    style COMIS fill:#7c4dff,color:#fff
```

## Flujo renovación automática

```mermaid
flowchart TB
    CRON[Cron diario 06:00] --> SCAN[Scan garantías vigentes<br/>vigencia_hasta − today]

    SCAN --> CASE{Días para<br/>vencer}
    CASE -->|≤ 30 días| ALERT_30[Notif admin<br/>email + dashboard]
    CASE -->|≤ 7 días| ALERT_7[Notif gerencia<br/>+ legal · URGENTE]
    CASE -->|≤ 0 días| EVENT_VENC[Evento: GarantíaVencida<br/>acción crítica]
    CASE -->|> 30 días| OK[Sin acción]

    EVENT_VENC --> RIESGO[Riesgo:<br/>− Beneficiario puede ejecutar<br/>− Bloqueo valorizaciones<br/>− Sanciones contractuales]

    ALERT_30 --> WORK[Workflow renovación<br/>iniciado auto]
    ALERT_7 --> WORK_URG[Workflow urgencia<br/>autorización gerencia]

    WORK --> SOL_REN[Solicitud renovación<br/>banco]
    WORK_URG --> SOL_REN

    SOL_REN --> NEG[Negociación banco<br/>tarifa renovación<br/>típicamente más alta]
    NEG --> EMI_NEW[Banco emite nueva fianza]
    EMI_NEW --> END_LINK[garantia_padre_id link<br/>a anterior]

    EMI_NEW --> REPL[Reemplazo físico<br/>al beneficiario]
    REPL --> LIB_OLD[Estado anterior:<br/>renovada]
    LIB_OLD --> NEW_VIG[Nueva: vigente]

    NEW_VIG --> COST_DEV[Devenga costo<br/>nueva fianza]

    style EVENT_VENC fill:#dc3545,color:#fff
    style ALERT_7 fill:#fd7e14,color:#fff
    style ALERT_30 fill:#ffc107
    style EMI_NEW fill:#d4edda
```

## Flujo ejecución garantía

```mermaid
flowchart TB
    INC[Incumplimiento<br/>detectado] --> SOL_EJ[Beneficiario solicita<br/>ejecución carta fianza]

    SOL_EJ --> NOT[Notificación al banco<br/>+ cobertura legal]
    NOT --> EVAL[Banco evalúa solicitud]
    EVAL --> Q{¿Procede<br/>ejecución?}
    Q -->|no| OBS_EJ[Banco observa<br/>pide más sustento]
    Q -->|sí| EJEC[Banco paga al beneficiario<br/>monto carta]

    EJEC --> CONT_EJ[Asiento contable banco:<br/>Dr 144 CxC banco al fiado<br/>Cr 104 Bancos]
    CONT_EJ --> COBR_BAN[Banco cobra al fiado<br/>= contratista]

    COBR_BAN --> NEG_COBR[Negociación<br/>contratista − banco]
    NEG_COBR --> Q_PAGA{¿Contratista<br/>paga al banco?}
    Q_PAGA -->|sí| LIQ[Operación liquidada<br/>línea liberada]
    Q_PAGA -->|no| LEGAL[Procedimiento legal<br/>cobranza coactiva<br/>blacklist banco]

    EJEC --> EST_EJ[Estado garantía:<br/>ejecutada]
    EST_EJ --> ALERT_DIR[Alerta crítica<br/>directorio · pérdida]

    style INC fill:#dc3545,color:#fff
    style EJEC fill:#dc3545,color:#fff
    style LEGAL fill:#dc3545,color:#fff
    style ALERT_DIR fill:#dc3545,color:#fff
```

## Triggers automáticos

```mermaid
flowchart TB
    EVT[Evento contractual] --> CASES{Tipo evento}

    CASES -->|adicional aprobado| AD[Adicional<br/>+ S/ monto vigente]
    CASES -->|amp.plazo aprobada| AMP[Ampliación plazo<br/>+ días vigencia]
    CASES -->|reducción aprobada| RED[Reducción<br/>− S/ monto vigente]
    CASES -->|valorización emitida| VAL[Valorización<br/>amortiza adelantos]

    AD --> RECALC_FC[Recalcula FC requerida<br/>= monto_vigente × 10%]
    RECALC_FC --> Q_END{¿FC actual<br/>cubre?}
    Q_END -->|sí| OK1[Sin acción]
    Q_END -->|no| END_FC[Solicitar ENDOSO<br/>incremento cobertura<br/>O nueva FC complementaria]

    AMP --> END_VIG[Solicitar ENDOSO<br/>extender vigencia<br/>FC + adelantos vigentes]

    RED --> Q_RED{¿Justifica<br/>reducción FC?}
    Q_RED -->|sí > 5% baja| REL_FC[Solicitar liberación parcial<br/>banco recupera línea]
    Q_RED -->|no| OK2[Sin acción]

    VAL --> AMORT_AVAN[Amortización adelantos<br/>actualiza saldo cubrir]
    AMORT_AVAN --> Q_AMORT{¿Adelanto<br/>amortizado 100%?}
    Q_AMORT -->|sí| LIB_FA[Libera fianza adelanto<br/>banco recupera línea]
    Q_AMORT -->|no| OK3[Sin acción]

    style END_FC fill:#fd7e14,color:#fff
    style END_VIG fill:#fd7e14,color:#fff
    style REL_FC fill:#d4edda
    style LIB_FA fill:#d4edda
```

## Devengo mensual costo financiero

```sql
-- Cron 1ro de cada mes
CREATE FUNCTION devengar_costos_financieros_mes(p_periodo char(7))
RETURNS void AS $$
BEGIN
  -- Garantías vigentes
  INSERT INTO costo_financiero_devengado (garantia_id, periodo_mes, monto_devengado, generado_at)
  SELECT
    g.id,
    p_periodo,
    -- Costo proporcional al mes
    (g.monto * g.tasa_comision_anual / 12),
    now()
  FROM garantias g
  WHERE g.estado = 'vigente'
    AND p_periodo >= to_char(g.vigencia_desde,'YYYY-MM')
    AND p_periodo <= to_char(g.vigencia_hasta,'YYYY-MM');

  -- Pólizas vigentes
  INSERT INTO costo_financiero_devengado (poliza_id, periodo_mes, monto_devengado, generado_at)
  SELECT
    p.id,
    p_periodo,
    (p.prima_anual / 12),
    now()
  FROM polizas p
  WHERE p.estado = 'vigente'
    AND p_periodo BETWEEN to_char(p.vigencia_desde,'YYYY-MM') AND to_char(p.vigencia_hasta,'YYYY-MM');

  -- Generar asientos
  PERFORM generar_asientos_costo_financiero(p_periodo);
END $$ LANGUAGE plpgsql;
```

## KPIs garantías

| KPI | Fórmula | Alerta |
|---|---|---|
| Línea bancaria utilizada | consumido / aprobado | > 80% solicitar ampliación |
| Garantías por vencer 30d | count | dashboard alerta |
| Garantías ejecutadas YTD | count | objetivo 0 |
| Costo financiero / utility | costo_fin / utility_proyecto | < 3% saludable |
| Ratio cobertura adelantos | Σ fianzas adelantos / Σ adelantos pagados | = 100% obligatorio |
| Pólizas vencidas | count vigencia < today | objetivo 0 |
| Tiempo emisión promedio | días desde solicitud hasta entrega | < 5 días |

## Reportes operativos

```
1. Calendario vencimientos
   Vista calendario Gantt con todas vigencias
   Color: verde/amarillo/rojo por proximidad

2. Línea bancaria status
   Por banco: aprobado, consumido, disponible
   Histórico utilización

3. Costo financiero proyecto
   Σ garantías + pólizas devengadas
   Vs presupuestado en GG

4. Riesgo ejecución
   Garantías con incumplimientos contractuales potenciales
   Probabilidad ejecución × monto = riesgo S/

5. Histórico ejecuciones
   Casos pasados todas obras
   Lecciones aprendidas
```

## Prioridad: **CRÍTICA**
