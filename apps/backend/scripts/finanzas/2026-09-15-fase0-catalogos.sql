-- apps/backend/scripts/finanzas/2026-09-15-fase0-catalogos.sql
-- Fase 0 finanzas: catalogos SUNAT, tasas de detraccion, tipo de cambio manual. Globales (sin empresa_id).
CREATE TABLE IF NOT EXISTS catalogo_sunat (
  catalogo    varchar(4)  NOT NULL,
  codigo      varchar(10) NOT NULL,
  descripcion text        NOT NULL,
  extra       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (catalogo, codigo)
);

CREATE TABLE IF NOT EXISTS detraccion_tasa (
  codigo         varchar(3)    NOT NULL,
  descripcion    text          NOT NULL,
  anexo          varchar(12),
  porcentaje     numeric(5,2),
  monto_minimo   numeric(12,2) NOT NULL DEFAULT 700,
  vigencia_desde date          NOT NULL DEFAULT '2000-01-01',
  vigencia_hasta date,
  observacion    text,
  PRIMARY KEY (codigo, vigencia_desde)
);

CREATE TABLE IF NOT EXISTS tipo_cambio (
  fecha      date         NOT NULL,
  moneda     varchar(3)   NOT NULL,
  compra     numeric(8,4) NOT NULL,
  venta      numeric(8,4) NOT NULL,
  fuente     varchar(30)  NOT NULL DEFAULT 'manual',
  updated_at timestamp    NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, moneda)
);
