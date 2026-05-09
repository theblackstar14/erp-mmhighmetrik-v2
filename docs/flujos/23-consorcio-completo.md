# 23 · Consorcio · Completo

Reemplaza diseño consorcio anterior. Cubre operador tributario, cuentas orden, distribución utility, préstamos socios, garantías compartidas.

## Estructura organizacional consorcio

```mermaid
flowchart TB
    CONS[CONSORCIO LIMA<br/>contrato consorcio<br/>NO persona jurídica]

    CONS --> ROLES[Roles definidos<br/>en contrato]

    ROLES --> OP_TRIB[OPERADOR TRIBUTARIO<br/>quien factura entidad<br/>típicamente líder]
    ROLES --> OP_ADM[OPERADOR ADMINISTRATIVO<br/>quien lleva contabilidad<br/>cuentas de orden]
    ROLES --> REPR[REPRESENTANTE COMÚN<br/>persona natural<br/>firma en nombre consorcio]

    CONS --> SOC1[SOCIO A · DORATTA 50%<br/>OP_TRIB + OP_ADM]
    CONS --> SOC2[SOCIO B · LCL 50%]

    SOC1 --> APO1[Aporte capital · 50%]
    SOC1 --> RES1[Responsabilidad solidaria · 100%]
    SOC1 --> EXP1[Aporta experiencia técnica]

    SOC2 --> APO2[Aporte capital · 50%]
    SOC2 --> RES2[Responsabilidad solidaria · 100%]
    SOC2 --> EXP2[Aporta otra especialidad]
```

## Flujo dinero consorcio

```mermaid
flowchart TB
    ENT[Entidad] -->|paga 100%| OP_TRIB[Operador tributario<br/>cuenta DORATTA]

    OP_TRIB --> AGR[Cuenta consorcio<br/>cuentas de orden]
    AGR --> REGS[Registra ingreso<br/>50/50]

    AGR --> PAY[Pagos obra]
    PAY --> P_MAT[Materiales]
    PAY --> P_MO[Planilla]
    PAY --> P_SC[SC]
    PAY --> P_GG[GG]

    P_MAT --> COSTOS[Costos consorcio]
    P_MO --> COSTOS
    P_SC --> COSTOS
    P_GG --> COSTOS

    COSTOS --> REG_C[Registra costos<br/>cuentas orden 50/50]

    AGR --> END[Fin obra]
    END --> LIQ[Liquidación final]
    LIQ --> UTIL[Utility neta]
    UTIL --> RET_IR[− IR 30%]
    RET_IR --> NET_DIST[Neto distribuible]
    NET_DIST --> DIST[Distribución 50/50]
    DIST --> DOR[DORATTA 50%]
    DIST --> LCL[LCL 50%]

    DOR --> ADJ_DOR[± ajustes:<br/>− préstamos pendientes<br/>+ aportes recuperados]
    LCL --> ADJ_LCL[± ajustes]

    ADJ_DOR --> TRA_DOR[Transferencia bancaria<br/>cuenta DORATTA]
    ADJ_LCL --> TRA_LCL[Transferencia bancaria<br/>cuenta LCL]

    style OP_TRIB fill:#cce5ff
    style AGR fill:#fff4cc
    style DIST fill:#d4edda
```

## Cuentas de orden · principio contable

```
Consorcio NO es persona jurídica → no lleva contabilidad propia formalmente
PERO cada socio debe llevar cuentas de orden de su participación

Cuentas orden socio operador (DORATTA):
  Cuenta orden 010 · Ingresos consorcio (registra 100% facturado a entidad)
  Cuenta orden 020 · Distribución a socio LCL (50%)
  Cuenta orden 030 · Costos consorcio
  Cuenta orden 040 · Aportes capital socios
  Cuenta orden 050 · Préstamos intersocios
  Cuenta orden 060 · Utility consorcio (resultado)

DORATTA factura entidad → 100% va a su contabilidad oficial (cuenta 70)
PERO de esa 100%, el 50% es "para el otro socio" → cuenta orden 020

Mensual:
  - Reporta a LCL su 50% de ingresos y costos
  - LCL contabiliza su 50% en SU contabilidad
  - LCL declara su % en SUNAT propio

Liquidación:
  - DORATTA transfiere a LCL el 50% utility neta
  - LCL emite factura "honorarios consorcio" o factura participación
  - DORATTA reconoce gasto / LCL reconoce ingreso
  - O alternativa: distribuye sin facturación (ATR)
```

## Schema enterprise

```sql
consorcios (
  id uuid PRIMARY KEY,
  proyecto_id uuid REFERENCES proyectos,
  nombre varchar,
  ruc_consorcio varchar(11),                   -- si tiene RUC propio (poco común)

  domicilio_legal text,
  email_notificaciones varchar,
  telefono varchar,

  representante_comun_dni varchar,
  representante_comun_nombre varchar,
  representante_comun_email varchar,

  fecha_constitucion date,
  fecha_inicio_vigencia date,
  fecha_fin_vigencia date,

  archivo_contrato_consorcio_nas text,
  archivo_modificaciones_nas text,

  estado ENUM ('borrador','vigente','en_liquidacion','liquidado','disuelto','sancionado'),

  created_at, updated_at
)

consorcios_integrantes (
  id uuid PRIMARY KEY,
  consorcio_id uuid REFERENCES consorcios,
  empresa_id uuid REFERENCES empresas,         -- internal empresa MM
  ruc varchar(11),
  razon_social varchar,
  pct_participacion decimal(5,4),              -- 0.5000 = 50%

  -- Roles
  es_operador_tributario boolean DEFAULT false,
  es_operador_administrativo boolean DEFAULT false,
  es_lider boolean DEFAULT false,

  -- Datos
  cci_aporte varchar(20),                      -- cuenta interbancaria
  email_principal varchar,
  telefono_principal varchar,
  representante_legal_dni varchar,
  representante_legal_nombre varchar,
  domicilio text,

  -- Aportes
  capital_aportado decimal(14,2),
  experiencia_acreditada jsonb,                -- obras previas
  rnp_codigo varchar,
  rnp_vigencia date,

  -- CCLC
  cclc_monto decimal(14,2),                    -- Constancia Capacidad Libre Contratación
  cclc_vigencia date,

  fecha_alta date,
  fecha_baja date,
  estado ENUM ('activo','retirado','sustituido')
)

-- Cuentas bancarias del consorcio
consorcio_cuentas_bancarias (
  id uuid PRIMARY KEY,
  consorcio_id uuid,
  banco varchar,
  numero_cuenta varchar,
  cci varchar(20),
  moneda char(3) DEFAULT 'PEN',
  proposito ENUM ('cobranzas_entidad','pagos_obra','garantias','adelantos','tesoreria'),
  titular_ruc varchar(11),                      -- típicamente operador tributario
  estado varchar
)

-- Movimientos cuentas de orden
consorcio_cuentas_orden (
  id uuid PRIMARY KEY,
  consorcio_id uuid,
  fecha date,
  numero_orden varchar,                         -- correlativo CO-0001
  tipo ENUM (
    'ingreso_facturado',           -- entidad pagó · 100% al consorcio
    'distribucion_ingreso',        -- 50% a cada socio
    'pago_costo_obra',             -- consorcio paga a proveedor/SC
    'distribucion_costo',          -- 50% costo a cada socio
    'aporte_capital',              -- socio aporta dinero
    'devolucion_capital',          -- socio recupera aporte
    'prestamo_socio',              -- un socio presta a otro
    'devolucion_prestamo',
    'pago_intereses_prestamo',
    'distribucion_utility',        -- liquidación final
    'reparto_costos_extra'         -- adicional asumido por uno
  ),
  socio_origen_id uuid REFERENCES consorcios_integrantes,
  socio_destino_id uuid REFERENCES consorcios_integrantes,
  monto decimal(14,2),
  glosa text,
  origen_evento_tabla varchar,
  origen_evento_id uuid,
  asiento_orden_id uuid,
  user_id uuid,
  created_at timestamp
)

-- Préstamos intersocios
consorcio_prestamos (
  id uuid PRIMARY KEY,
  consorcio_id uuid,
  socio_acreedor_id uuid,
  socio_deudor_id uuid,
  monto decimal(14,2),
  tasa_anual decimal(5,4),                      -- típico 0% o costo oportunidad
  fecha_otorgamiento date,
  fecha_vencimiento date,
  monto_pagado decimal(14,2) DEFAULT 0,
  saldo decimal(14,2)
    GENERATED AS (monto - monto_pagado) STORED,
  intereses_devengados decimal(14,2) DEFAULT 0,
  estado ENUM ('vigente','pagado_parcial','liquidado','default'),
  contrato_pdf_nas text
)

-- Distribución utility
consorcio_distribucion_utility (
  id uuid PRIMARY KEY,
  consorcio_id uuid,
  fecha_corte date,
  fecha_distribucion date,

  -- Cálculos
  ingreso_total decimal(14,2),
  costos_total decimal(14,2),
  utility_bruta decimal(14,2),
  ir_30pct decimal(14,2),
  utility_neta decimal(14,2),

  -- Detalle por socio
  detalle jsonb,                                -- [{socio, %, monto, ajustes, neto_transferir}]

  -- Status
  estado ENUM ('proyectada','aprobada','transferida','observada'),
  acta_distribucion_pdf_nas text,

  created_at, updated_at
)

-- Resoluciones internas
consorcio_resoluciones_internas (
  id uuid PRIMARY KEY,
  consorcio_id uuid,
  numero varchar,
  fecha date,
  tipo ENUM (
    'acuerdo_general',
    'modificacion_contrato_consorcio',
    'sustitucion_representante',
    'autorizacion_prestamo',
    'aprobacion_distribucion',
    'disolucion'
  ),
  descripcion text,
  votos_favor int,
  votos_contra int,
  acta_pdf_nas text,
  vinculante boolean DEFAULT true
)

-- Garantías compartidas (vincula garantia con socio aportante)
garantias_aportantes (
  id uuid PRIMARY KEY,
  garantia_id uuid REFERENCES garantias,
  socio_id uuid REFERENCES consorcios_integrantes,
  monto_aportado decimal(14,2),
  pct_aporte decimal(5,4)                       -- algunos socios aportan más fianza
)
```

## Flujo distribución utility · liquidación

```mermaid
flowchart TB
    FIN[Fin obra · acta recepción] --> LIQ_INI[Inicia liquidación final]

    LIQ_INI --> SUMA[Suma flujos consorcio<br/>desde inicio]

    SUMA --> ING[Σ ingresos<br/>valorizaciones cobradas<br/>+ adicionales<br/>+ devolución retenciones]
    SUMA --> COST[Σ costos<br/>materiales + MO + SC<br/>+ GG + costo financiero]
    SUMA --> AJ[Ajustes:<br/>+ devolución detracciones<br/>+ devolución cartas fianza<br/>− préstamos intersocios pendientes]

    ING --> UTIL[Utility bruta]
    COST --> UTIL
    AJ --> UTIL

    UTIL --> IR[− IR 30%]
    IR --> NETO[Utility neta]

    NETO --> ACTA[Acta liquidación interna<br/>aprobada por todos socios]
    ACTA --> Q_AP{¿Todos<br/>aprueban?}
    Q_AP -->|no| OBS[Observaciones<br/>arbitraje interno]
    Q_AP -->|sí| DIST[Distribución según %]

    DIST --> CALC_SOC[Por cada socio:<br/>monto = neto × pct_part<br/>± préstamos pendientes<br/>+ aportes recuperar]

    CALC_SOC --> Q_PREST{¿Préstamos<br/>activos?}
    Q_PREST -->|sí| COMP[Compensación<br/>− deuda con + ingreso]
    Q_PREST -->|no| TRANSF

    COMP --> TRANSF[Transferencia<br/>cuenta cada socio]
    TRANSF --> CONT[Cada socio contabiliza<br/>en SU contabilidad oficial]
    CONT --> SUNAT[Cada socio declara<br/>en SU PDT/SIRE]

    SUNAT --> DISO[Disolución consorcio<br/>obra liquidada]

    style ACTA fill:#cce5ff
    style DIST fill:#d4edda
    style DISO fill:#fff4cc
```

## Préstamos intersocios

Caso real: si un socio adelanta más caja que el otro durante la obra.

```mermaid
sequenceDiagram
    participant DOR as DORATTA caja
    participant CON as Cuenta orden
    participant LCL as LCL caja

    Note over DOR,LCL: Mes 1 · DORATTA paga 100% planilla S/ 200K

    DOR->>DOR: Pagó S/ 200K planilla
    DOR->>CON: Registra "ingreso costos consorcio" S/ 200K
    CON->>CON: Distribuye 50/50 = S/ 100K c/u
    CON->>LCL: CxC LCL → DORATTA = S/ 100K (préstamo de hecho)

    Note over DOR,LCL: Mes 2 · LCL paga S/ 80K SC

    LCL->>LCL: Pagó S/ 80K SC
    LCL->>CON: Registra "ingreso costos consorcio" S/ 80K
    CON->>CON: Distribuye 50/50 = S/ 40K c/u
    CON->>DOR: CxC DORATTA → LCL = S/ 40K

    Note over DOR,LCL: Compensación

    CON->>CON: Saldo neto · LCL debe a DORATTA = S/ 60K
    CON->>CON: Devenga intereses si tasa convenio > 0%

    Note over DOR,LCL: Liquidación final · compensa con utility
```

## Validaciones

```sql
-- Σ % participación = 100%
CREATE FUNCTION validar_consorcio_pct()
RETURNS trigger AS $$
DECLARE total decimal(10,8);
BEGIN
  SELECT SUM(pct_participacion) INTO total
  FROM consorcios_integrantes
  WHERE consorcio_id = NEW.consorcio_id AND estado = 'activo';

  IF ABS(total - 1.0) > 0.0001 THEN
    RAISE EXCEPTION 'Σ % participación = % (debe ser 1.0000)', total;
  END IF;
  RETURN NEW;
END $$;

-- Solo un operador tributario activo
CREATE FUNCTION validar_un_operador_trib()
RETURNS trigger AS $$
DECLARE count_op int;
BEGIN
  IF NEW.es_operador_tributario THEN
    SELECT COUNT(*) INTO count_op
    FROM consorcios_integrantes
    WHERE consorcio_id = NEW.consorcio_id
      AND es_operador_tributario = true
      AND estado = 'activo'
      AND id != NEW.id;
    IF count_op > 0 THEN
      RAISE EXCEPTION 'Solo un operador tributario permitido';
    END IF;
  END IF;
  RETURN NEW;
END $$;
```

## Reportes

```
1. Estado caja consorcio
   Por mes: ingresos vs costos vs saldo
   Saldo distribuible si liquidaran hoy

2. Cuentas de orden por socio
   Movimientos · saldos pendientes
   Préstamos abiertos

3. Distribución utility proyectada
   Forecast utility final × % participación
   Por socio: ingreso esperado

4. Aportes vs participación
   Quien aportó más capital del que le toca
   Quien aportó menos
   Compensaciones pendientes

5. Cumplimiento contractual
   Obligaciones cláusula consorcio
   Plazos · sanciones internas
```

## KPIs

| KPI | Fórmula | Target |
|---|---|---|
| Σ % participación | sum(pct_participacion) | = 1.0 exacto |
| Préstamos activos | count préstamos no liquidados | minimizar |
| Aporte vs participación | aporte_socio / (aporte_total × pct_socio) | = 1.0 |
| Días transferencia distribución | desde acta hasta TRX banco | < 7 días |

## Prioridad: **ALTA**
