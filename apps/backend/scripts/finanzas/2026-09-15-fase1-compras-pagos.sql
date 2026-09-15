-- apps/backend/scripts/finanzas/2026-09-15-fase1-compras-pagos.sql
-- Fase 1: lineas de compra, datos de documento en gastos, detraccion por documento,
-- aplicaciones capturadas antes del asiento, tipo de cuenta de tesoreria. Idempotente.

CREATE TABLE IF NOT EXISTS gasto_lineas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gasto_id        uuid NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
  numero          integer NOT NULL,
  descripcion     text NOT NULL,
  unidad          varchar(10),
  cantidad        numeric(14,4) NOT NULL DEFAULT 1,
  valor_unitario  numeric(14,5) NOT NULL DEFAULT 0,
  descuento       numeric(14,2) NOT NULL DEFAULT 0,
  valor_venta     numeric(14,2) NOT NULL,
  afectacion_igv  varchar(2) NOT NULL DEFAULT '10',
  igv             numeric(14,2) NOT NULL DEFAULT 0,
  cuenta_contable varchar(10) REFERENCES plan_contable(codigo),
  partida_id      uuid REFERENCES partidas(id) ON DELETE SET NULL,
  proyecto_id     uuid REFERENCES proyectos(id) ON DELETE SET NULL,
  a_inventario    boolean NOT NULL DEFAULT false,
  CONSTRAINT gasto_lineas_montos_chk CHECK (cantidad > 0 AND valor_venta >= 0 AND igv >= 0 AND descuento >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS gasto_lineas_numero_uq ON gasto_lineas (gasto_id, numero);

ALTER TABLE gastos ADD COLUMN IF NOT EXISTS fecha_vencimiento   date;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS tipo_cambio         numeric(8,4);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS retencion           numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS retencion_tipo      varchar(10);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS percepcion          numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS doc_modifica_serie  varchar(20);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS doc_modifica_numero varchar(40);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS motivo_nota         varchar(2);
DO $$ BEGIN
  ALTER TABLE gastos ADD CONSTRAINT gastos_retencion_tipo_chk CHECK (retencion_tipo IS NULL OR retencion_tipo IN ('igv3', 'renta4ta'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS detraccion_documento (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_origen_tipo   varchar(12) NOT NULL,
  doc_origen_id     uuid NOT NULL,
  empresa_id        integer NOT NULL REFERENCES empresa(id),
  codigo            varchar(3) NOT NULL,
  porcentaje        numeric(5,2) NOT NULL,
  base_pen          numeric(14,2) NOT NULL,
  monto             numeric(14,2) NOT NULL,
  monto_declarado   numeric(14,2),
  cuenta_bn         varchar(20),
  npd               varchar(20),
  constancia_numero varchar(30),
  fecha_deposito    date,
  estado            varchar(12) NOT NULL DEFAULT 'pendiente',
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now(),
  CONSTRAINT detrdoc_origen_chk CHECK (doc_origen_tipo IN ('gasto', 'valorizacion')),
  CONSTRAINT detrdoc_estado_chk CHECK (estado IN ('pendiente', 'depositada', 'no_aplica'))
);
CREATE UNIQUE INDEX IF NOT EXISTS detrdoc_origen_uq ON detraccion_documento (doc_origen_tipo, doc_origen_id);

-- D1: 'Recibo por Honorarios' son 21 caracteres; doc_tipo en 20 truncaba con error 22001.
ALTER TABLE documento_pendiente ALTER COLUMN doc_tipo TYPE varchar(40);

ALTER TABLE aplicacion_documento ALTER COLUMN asiento_id DROP NOT NULL;
ALTER TABLE aplicacion_documento ADD COLUMN IF NOT EXISTS origen_tipo varchar(12);
ALTER TABLE aplicacion_documento ADD COLUMN IF NOT EXISTS origen_id   uuid;
DO $$ BEGIN
  ALTER TABLE aplicacion_documento ADD CONSTRAINT aplic_origen_tipo_chk CHECK (origen_tipo IS NULL OR origen_tipo IN ('movimiento', 'nota'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS aplic_origen_doc_uq ON aplicacion_documento (origen_tipo, origen_id, documento_pendiente_id) WHERE origen_id IS NOT NULL;

DROP INDEX IF EXISTS docpend_uq;
CREATE UNIQUE INDEX docpend_uq ON documento_pendiente (empresa_id, tipo, tercero_ruc, doc_tipo, doc_serie, doc_numero);

ALTER TABLE cuentas_bancarias ADD COLUMN IF NOT EXISTS tipo varchar(15) NOT NULL DEFAULT 'banco';
DO $$ BEGIN
  ALTER TABLE cuentas_bancarias ADD CONSTRAINT cuentas_tipo_chk CHECK (tipo IN ('banco', 'caja', 'detracciones'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE cuentas_bancarias SET tipo = 'caja' WHERE codigo LIKE 'REND-%' AND tipo = 'banco';
INSERT INTO cuentas_bancarias (codigo, banco, moneda, descripcion, cuenta_contable, tipo, activo)
VALUES ('00003354431', 'BANCO DE LA NACION', 'PEN', 'Cuenta de detracciones MM', '1071', 'detracciones', true)
ON CONFLICT (codigo) DO NOTHING;
