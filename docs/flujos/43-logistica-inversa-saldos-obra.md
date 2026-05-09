# 43 · Logística inversa · Saldos de obra · Cierre limpio

★ Gap crítico. Cada obra termina con S/ 20K-200K en materiales/herramientas que "desaparecen". Pérdida silenciosa.

## El problema real

```
Caso típico fin de obra:
  Concreto sobrante: 30 bls cemento × S/ 30 = S/ 900
  Acero sobrante: 200 kg × S/ 4.50 = S/ 900
  Pintura sobrante: 8 baldes × S/ 200 = S/ 1,600
  Herramientas: amoladoras · taladros · escaleras · andamios · S/ 12,000
  Equipos pequeños: vibradores · niveles · S/ 8,000
  Materiales menores · ferretería · cables · S/ 5,500

  Total típico: S/ 28,900 obra mediana

¿Qué pasa hoy en MM (sin sistema)?
  - Residente "regala" a operarios al cerrar
  - Capataz "lleva" equipos a su empresa propia
  - Material queda abandonado · roban
  - Se vende informal en mercado · plata no entra a empresa
  - Se da de baja contable · costo asumido por obra
  - Nunca llega al almacén central

Impacto:
  - 1-3% pérdida utility por obra
  - Robo · descontrol activos
  - Costo "fantasma" en contabilidad
  - Sin trazabilidad propietario empresa
  - Tributariamente: gasto no recuperado
```

## Flujo logística inversa

```mermaid
flowchart TB
    PRE[Pre-cierre obra<br/>30 días antes término] --> INV[Inventario físico<br/>OBLIGATORIO]

    INV --> CONT[Contar todo:<br/>· Materiales en almacén<br/>· Herramientas<br/>· Equipos pequeños<br/>· Insumos consumibles]

    CONT --> CONC[Conciliación física vs kardex<br/>identifica diferencias]
    CONC --> Q_DIF{¿Diferencias?}
    Q_DIF -->|merma normal| AJ_M[Ajuste merma]
    Q_DIF -->|robo · faltante grave| INVEST[Investigación · responsabilidad]
    Q_DIF -->|sin diferencia| OK

    AJ_M --> SALDOS
    INVEST --> SALDOS
    OK --> SALDOS[Lista saldos disponibles<br/>kardex actualizado]

    SALDOS --> CLAS[Clasificación saldos]

    CLAS --> C1[Material reutilizable<br/>cemento · acero · pintura]
    CLAS --> C2[Herramientas/equipos<br/>vida útil restante]
    CLAS --> C3[Material no reutilizable<br/>scrap · merma · vencido]
    CLAS --> C4[Activo fijo · maquinaria]

    C1 --> DEC1{Decisión}
    DEC1 --> T1A[Transfiere a otra obra<br/>misma empresa]
    DEC1 --> T1B[Devuelve a almacén central]
    DEC1 --> T1C[Vende a tercero<br/>recupera valor]

    C2 --> DEC2{Decisión}
    DEC2 --> T2A[Devuelve almacén central<br/>+ ficha estado mantto]
    DEC2 --> T2B[Asigna otra obra]

    C3 --> SCRAP[Disposición scrap]
    SCRAP --> SCR1[Venta chatarra · recuperar S/]
    SCRAP --> SCR2[Disposición ambiental<br/>según norma]

    C4 --> ACT[Activos fijos]
    ACT --> RET[Retorna parque equipos]
    ACT --> EVAL[Evaluación:<br/>vender · reasignar · baja]

    T1A --> EJEC[Ejecución transferencia]
    T1B --> EJEC
    T1C --> EJEC
    T2A --> EJEC
    T2B --> EJEC
    SCR1 --> EJEC
    RET --> EJEC

    EJEC --> ACTAS[Actas firmadas:<br/>· entrega · recepción]
    ACTAS --> KARDEX[Kardex actualizado<br/>movimientos transferencia]
    KARDEX --> CONT_AS[Asientos contables<br/>según destino]

    CONT_AS --> CHK_FIN{¿Saldo<br/>almacén obra<br/>= 0?}
    CHK_FIN -->|no| BLOQ[BLOQUEO<br/>no permite cerrar obra<br/>hasta saldo = 0]
    CHK_FIN -->|sí| LIB[Permite cierre obra]

    LIB --> CIERRE[Cierre administrativo]

    style INV fill:#cce5ff
    style INVEST fill:#fd7e14,color:#fff
    style BLOQ fill:#dc3545,color:#fff
    style LIB fill:#d4edda
```

## Schema logística inversa

```sql
-- Pre-cierre · proceso formal
pre_cierres_obra (
  id uuid PRIMARY KEY,
  proyecto_id uuid,
  fecha_inicio_pre_cierre date,
  fecha_objetivo_cierre date,
  responsable_id uuid,                          -- residente o admin

  -- Inventario físico
  inventario_realizado boolean,
  fecha_inventario date,
  archivo_acta_inventario_pdf_nas text,

  -- Saldos
  monto_saldos_recuperables decimal(14,2),
  monto_saldos_scrap decimal(14,2),
  num_items_pendientes_disposicion int,

  estado ENUM (
    'iniciado',
    'inventario_completado',
    'disposicion_en_proceso',
    'todos_saldos_dispuestos',
    'aprobado_cierre',
    'cerrado'
  )
)

-- Inventario físico · línea por recurso
inventario_fisico_obras (
  id uuid PRIMARY KEY,
  pre_cierre_id uuid,
  recurso_id uuid,
  unidad varchar,

  cantidad_kardex decimal(14,4),
  cantidad_fisica decimal(14,4),
  diferencia decimal(14,4),
  diferencia_pct decimal(7,4),

  motivo_diferencia ENUM (
    'merma_normal',
    'merma_excesiva',
    'robo',
    'error_registro',
    'no_aplica'
  ),

  costo_unitario_kardex decimal(14,4),
  monto_diferencia decimal(14,2),

  estado_recurso ENUM (
    'reutilizable',
    'reutilizable_con_mantto',
    'scrap',
    'desechable',
    'activo_fijo'
  ),

  observaciones text,
  fotos_nas text[]
)

-- Disposiciones · qué se hizo con cada saldo
saldos_disposiciones (
  id uuid PRIMARY KEY,
  pre_cierre_id uuid,
  recurso_id uuid,
  cantidad decimal(14,4),
  costo_unitario decimal(14,4),
  monto_total decimal(14,2),

  tipo_disposicion ENUM (
    'transferencia_otra_obra',
    'devolucion_almacen_central',
    'venta_tercero',
    'venta_chatarra',
    'donacion',
    'baja_scrap',
    'baja_merma',
    'reincorporado_parque_equipos'
  ),

  -- Detalle según tipo
  obra_destino_id uuid,                         -- transferencia
  almacen_destino_id uuid,                      -- devolución
  comprador_ruc varchar(11),                    -- venta
  comprador_razon varchar,
  monto_venta decimal(14,2),
  factura_emitida_id uuid,                      -- venta
  receptor_ruc varchar(11),                     -- donación
  motivo text,

  -- Control
  fecha_disposicion date,
  responsable_disposicion_id uuid,
  acta_pdf_nas text,
  fotos_nas text[],

  -- Contable
  movimiento_almacen_id uuid,                   -- kardex correspondiente
  asiento_id uuid,

  estado ENUM ('borrador','en_proceso','ejecutado','observado'),
  validado_por uuid,
  validado_at timestamp
)

-- Activos fijos retornados
activos_fijos_retorno (
  id uuid PRIMARY KEY,
  proyecto_origen_id uuid,
  equipo_id uuid REFERENCES equipos,

  -- Estado equipo
  horometro_al_retorno decimal(10,2),
  km_al_retorno decimal(10,2),
  estado_fisico ENUM ('excelente','bueno','regular','malo','para_baja'),
  requiere_mantto boolean,
  costo_mantto_estimado decimal(14,2),

  -- Disposición futura
  destino_decidido ENUM ('parque_central','otra_obra','venta','baja_definitiva','reparacion'),
  proyecto_destino_id uuid,

  fecha_retorno date,
  acta_devolucion_pdf_nas text,
  fotos_estado_nas text[],
  responsable_id uuid
)
```

## Bloqueo cierre administrativo

```sql
-- Función validación pre-cierre obra
CREATE FUNCTION puede_cerrar_obra(p_proyecto_id uuid)
RETURNS TABLE (puede boolean, bloqueos jsonb) AS $$
DECLARE bloqueos jsonb := '[]';
BEGIN
  -- 1. Inventario físico realizado
  IF NOT EXISTS (
    SELECT 1 FROM pre_cierres_obra
    WHERE proyecto_id = p_proyecto_id
      AND inventario_realizado = true
  ) THEN
    bloqueos := bloqueos || jsonb_build_object('codigo','INV_FALTA',
      'mensaje','Inventario físico no realizado');
  END IF;

  -- 2. Saldo kardex obra = 0 (todo dispuesto)
  IF EXISTS (
    SELECT 1 FROM almacen_movimientos m
    WHERE m.proyecto_id = p_proyecto_id
    GROUP BY m.recurso_id
    HAVING SUM(CASE WHEN m.tipo = 'ingreso' THEN m.cantidad ELSE -m.cantidad END) > 0.001
  ) THEN
    bloqueos := bloqueos || jsonb_build_object('codigo','SALDO_NO_CERO',
      'mensaje','Saldos almacén obra > 0 · disponer antes cerrar');
  END IF;

  -- 3. Activos fijos · todos retornados o vendidos/baja
  IF EXISTS (
    SELECT 1 FROM equipo_asignaciones ea
    WHERE ea.proyecto_id = p_proyecto_id
      AND ea.fecha_fin IS NULL                  -- todavía asignado
  ) THEN
    bloqueos := bloqueos || jsonb_build_object('codigo','ACTIVOS_PENDIENTES',
      'mensaje','Activos fijos sin retornar');
  END IF;

  -- 4. Disposiciones aprobadas
  IF EXISTS (
    SELECT 1 FROM saldos_disposiciones
    WHERE pre_cierre_id IN (SELECT id FROM pre_cierres_obra WHERE proyecto_id = p_proyecto_id)
      AND estado != 'ejecutado'
  ) THEN
    bloqueos := bloqueos || jsonb_build_object('codigo','DISPOSICIONES_PENDIENTES',
      'mensaje','Disposiciones no completadas');
  END IF;

  RETURN QUERY SELECT jsonb_array_length(bloqueos) = 0, bloqueos;
END $$;

-- Trigger en cambio status proyecto a 'cerrado'
CREATE FUNCTION trigger_validar_cierre()
RETURNS trigger AS $$
DECLARE v_validacion record;
BEGIN
  IF NEW.status = 'cerrado' AND OLD.status != 'cerrado' THEN
    SELECT * INTO v_validacion FROM puede_cerrar_obra(NEW.id);
    IF NOT v_validacion.puede THEN
      RAISE EXCEPTION 'No se puede cerrar obra · %', v_validacion.bloqueos;
    END IF;
  END IF;
  RETURN NEW;
END $$;
```

## Tipos disposición · tratamiento contable

```mermaid
flowchart TB
    DISP[Disposición saldo] --> TIPO{Tipo}

    TIPO --> T1[Transferencia otra obra]
    T1 --> T1_K[Kardex:<br/>Salida obra A<br/>+ Ingreso obra B<br/>tipo='transferencia']
    T1 --> T1_C[Asiento:<br/>NO afecta resultados<br/>solo cambia centro costo]

    TIPO --> T2[Devolución almacén central]
    T2 --> T2_K[Kardex:<br/>Salida obra<br/>+ Ingreso central]
    T2_K --> T2_C[Asiento:<br/>Dr 25 Suministros central<br/>Cr 92 Costo partida obra]
    T2_C --> T2_NOTE[Recupera costo · ya no es 'consumo'<br/>partida obra reduce costo real]

    TIPO --> T3[Venta a tercero]
    T3 --> T3_FAC[Emite factura venta]
    T3_FAC --> T3_K[Kardex: salida tipo 'venta']
    T3_K --> T3_C[Asiento:<br/>Dr 12 CxC<br/>Cr 75 Otros ingresos<br/>Cr 401 IGV débito]
    T3_C --> T3_REC[Recupera valor · ingreso operativo]

    TIPO --> T4[Venta chatarra/scrap]
    T4 --> T4_FAC[Factura tipo · ingresos varios]
    T4_FAC --> T4_C[Asiento:<br/>Dr 12 CxC<br/>Cr 75 Otros ingresos]

    TIPO --> T5[Donación]
    T5 --> T5_C[Asiento:<br/>Dr 65 Otros gastos · donación<br/>Cr 25 Suministros]
    T5_C --> T5_NOTE[Sustento beneficiario · acta]

    TIPO --> T6[Baja · scrap · merma]
    T6 --> T6_C[Asiento:<br/>Dr 65 Mermas<br/>Cr 25 Suministros]
    T6_C --> T6_NOTE[Documentar causa · prevenir reincidencia]

    style T2_NOTE fill:#d4edda
    style T3_REC fill:#d4edda
    style T6_NOTE fill:#fd7e14,color:#fff
```

## Caso ejemplo numérico

```
PG0005 CREMATORIO SURCO · cierre obra

INVENTARIO FÍSICO:
  20 bls cemento × S/ 30      = S/    600
  150 kg acero × S/ 4.50      = S/    675
  3 baldes pintura × S/ 200   = S/    600
  1 amoladora · usada bueno   = S/  1,200
  1 vibrador hormigón         = S/  3,500
  2 escaleras                 = S/    400
  Material menor varios       = S/  1,200
  ─────────────────────────────────────────
  TOTAL DISPONIBLE            = S/  8,175

DISPOSICIONES:
  Cemento + acero + pintura → Obra próxima COMAS
    Transferencia: S/ 1,875
    Asiento: cambio centro costo (sin impacto utility)

  Amoladora + vibrador + escaleras → Almacén central
    Devolución: S/ 5,100
    Asiento: Dr 25 Central · Cr 92 Costo PG0005
    → recupera S/ 5,100 a utility de PG0005

  Material menor (cables · ferretería sueltos) → Venta chatarra
    Recupera: S/ 800 (vs S/ 1,200 valor)
    Asiento: ingreso operativo S/ 800

  Diferencia: S/ 1,200 − S/ 800 = S/ 400 baja como merma
    Asiento: Dr 65 Mermas · Cr 25

RESULTADO:
  Sin proceso (status quo): S/ 8,175 perdidos
  Con logística inversa: S/ 7,775 recuperados (95%)
                          + S/ 400 documentado merma
                          → utility +S/ 7,775
```

## App residente · check-out final

```mermaid
sequenceDiagram
    participant RES as Residente
    participant APP as App móvil
    participant ALM as Almacenero obra
    participant CEN as Almacén central

    Note over RES,CEN: 30 días antes cierre obra

    RES->>APP: Inicia "Pre-cierre obra"
    APP-->>RES: Checklist tareas

    RES->>ALM: Coordina inventario físico
    ALM->>APP: Cuenta items · escanea códigos
    APP->>APP: Compara con kardex
    APP-->>RES: Diferencias detectadas: 3 items

    RES->>RES: Investiga · justifica
    RES->>APP: Marca diferencias (merma · robo · etc)

    APP-->>RES: Lista saldos disponibles<br/>+ sugerencias destino

    RES->>APP: Asigna disposiciones<br/>(transferencia · venta · etc)

    Note over RES,CEN: Ejecución

    APP->>CEN: Notifica devolución almacén central
    CEN->>RES: Confirma recepción
    RES->>APP: Foto acta firmada

    APP->>APP: Actualiza kardex
    APP->>APP: Genera asientos contables

    Note over RES,CEN: Saldo obra = 0
    APP-->>RES: ✓ Cierre habilitado
```

## Reportes logística inversa

```
1. Saldos pendientes disposición
   Por obra · monto · días pendiente
   Alerta si > 30 días post-cierre

2. Recuperación valor histórico
   Por obra: % recuperado vs perdido
   Ranking residentes

3. Análisis mermas
   Top items con mayor merma
   Detección patrones · corrupción

4. Activos fijos circulación
   Tracking equipos · obras pasadas
   Mantenimiento acumulado

5. Auditoría disposiciones
   Por tipo · cumplimiento normas
   Sustento documental

6. Ahorro recuperación
   S/ recuperado total año
   Vs proyectado sin proceso
```

## KPIs

| KPI | Target |
|---|---|
| % saldos recuperados al cierre | > 90% |
| % obras con inventario físico | 100% |
| Tiempo cierre administrativo | < 30 días post-recepción |
| Variance kardex vs físico cierre | < 1% |
| Items perdidos (sin trazabilidad) | 0 |
| Recuperación valor / obra | > 1% utility incremental |

## Política empresa documentada

```
Antes cierre obra:
  1. Inventario físico OBLIGATORIO con almacenero + residente
  2. Conciliación kardex físico · investigar diferencias
  3. Plan disposición saldos firmado
  4. Ejecución disposiciones < 30 días
  5. Solo entonces se libera cierre administrativo

Sanciones:
  Residente: descuento haberes si saldo perdido > umbral
  Almacenero: responsable solidario faltantes
  Capataces: reportan herramientas asignadas
```

## Prioridad: **CRÍTICA**
