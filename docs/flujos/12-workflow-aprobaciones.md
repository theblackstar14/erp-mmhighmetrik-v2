# 12 · Workflow aprobaciones

Flujo genérico aprobación entidad ERP. Aplica a OC, SC, Valorización, Pago, Modif.

## Modelo genérico

```mermaid
flowchart TB
    INI[Documento creado] --> EST_BORR[Estado: borrador]
    EST_BORR --> SOLI[Solicitante envía<br/>a aprobación]
    SOLI --> EST_PEND[Estado: pendiente]

    EST_PEND --> APR{Aprobador 1<br/>decide}
    APR -->|aprueba| NEXT{¿Hay más<br/>aprobadores?}
    APR -->|observa| EST_OBS[Estado: observado]
    APR -->|rechaza| EST_RECH[Estado: rechazado]

    EST_OBS --> EST_BORR
    NEXT -->|sí| APR2[Aprobador 2]
    NEXT -->|no| EST_APR[Estado: aprobado]

    APR2 --> APR
    EST_APR --> EJEC[Acción se ejecuta:<br/>OC se libera<br/>Val se cobra<br/>Pago se transfiere]

    style EST_BORR fill:#fff4cc
    style EST_PEND fill:#cce5ff
    style EST_APR fill:#d4edda
    style EST_RECH fill:#dc3545,color:#fff
    style EST_OBS fill:#ffc107
```

## Workflow OC (Orden de Compra)

```mermaid
flowchart LR
    R[Residente] -->|crea OC| OT[Oficina Técnica<br/>revisa partida vs APU]
    OT -->|aprueba| ADM[Administración<br/>revisa proveedor + caja]
    ADM -->|aprueba| LOG[Logística<br/>cotizaciones ≥3]
    LOG -->|aprueba| GER{Monto > umbral?}
    GER -->|≥ S/ 50,000| GERENTE[Gerente firma]
    GER -->|< S/ 50,000| EMI[OC emitida]
    GERENTE --> EMI

    EMI --> PROV[Enviada a proveedor]
```

## Workflow Valorización

```mermaid
flowchart LR
    R[Residente arma] --> OT[Oficina Técnica<br/>revisa metrados]
    OT --> RES_TEC[Residente firma<br/>responsabilidad técnica]
    RES_TEC --> SUP[Supervisor entidad<br/>revisa+aprueba]
    SUP -->|conforme| ENT_REC[Entidad recibe<br/>mesa partes]
    SUP -->|observa| OT

    ENT_REC --> CONT_ENT[Contadora entidad<br/>revisa CxP]
    CONT_ENT --> PAGO[Tesorería paga<br/>último día mes]
```

## Workflow Pago Proveedor

```mermaid
flowchart LR
    FAC[Factura recibida<br/>OC + guía remisión OK] --> CONT[Contadora<br/>valida facturas SUNAT]
    CONT --> CXP[Genera CxP<br/>plan contable]
    CXP --> APR_PAGO{Monto?}
    APR_PAGO -->|< S/ 5,000| ADM_F[Admin firma]
    APR_PAGO -->|≥ S/ 5,000| GER_F[Gerente firma]
    ADM_F --> TEL[Telebanking<br/>BCP/BBVA]
    GER_F --> TEL
    TEL --> CONF[Conciliación auto<br/>match factura vs pago]
```

## Schema aprobaciones genéricas

```sql
aprobacion_workflows (                     -- definición plantillas
  id, nombre,                              -- "Aprobación OC"
  entity_type varchar,                     -- "ordenes_compra"
  pasos jsonb,                              -- [{paso:1, rol:"OT"}, {paso:2, rol:"admin"}]
  condicion_monto_minimo decimal(14,2)     -- umbral activación
)

aprobaciones (                             -- instancia × documento
  id,
  workflow_id,
  entity_type varchar,                     -- "ordenes_compra"
  entity_id uuid,
  paso_actual integer,
  status ENUM ('pendiente','en_proceso','aprobado','observado','rechazado'),
  created_at, completed_at
)

aprobacion_pasos (                         -- audit trail decisiones
  id,
  aprobacion_id,
  paso integer,
  rol_requerido varchar,
  user_id_aprobador uuid,
  decision ENUM ('aprobado','observado','rechazado'),
  comentario text,
  fecha timestamp,
  ip varchar
)
```

## Notificaciones

```mermaid
flowchart TB
    EVT[Evento aprobación pendiente] --> NOTIF[Sistema notificaciones]
    NOTIF --> CHAN1[Email]
    NOTIF --> CHAN2[Push web app]
    NOTIF --> CHAN3[WhatsApp opcional]
    NOTIF --> BAD[Badge in-app<br/>"3 pendientes"]
```

## Reglas seguridad

```
Solo el rol asignado al paso puede aprobar
Aprobador no puede ser el solicitante (4-eyes principle)
Cada decisión queda en audit_log inmutable
Aprobaciones no se "deshacen" → si error, se REVOCA con nueva acción
Timeout opcional: si no aprueba en X días, escala automático
```

## Niveles aprobación por monto · sugerencia inicial

| Documento | Hasta | Aprobador final |
|---|---|---|
| OC menor | S/ 5,000 | Residente |
| OC media | S/ 50,000 | Administración |
| OC mayor | > S/ 50,000 | Gerente |
| Subcontrato | < 100,000 | Administración |
| Subcontrato | > 100,000 | Gerente |
| Valorización entidad | cualquier | Supervisor + Entidad (externo) |
| Pago proveedor | < 5,000 | Admin |
| Pago proveedor | > 5,000 | Gerente |
| Modificación contractual | cualquier | Gerente + Entidad |
| Caja chica rendición | mensual | Admin |

## UI sugerida

```
Inbox aprobaciones (top-right badge)
  ├─ Pendientes mías (5)
  │   ├─ OC-2026-0023 · S/ 12,500 · cemento
  │   ├─ Val 03 · S/ 437,720
  │   └─ ...
  ├─ Pendientes esperan otros
  └─ Histórico mis aprobaciones
```
