-- WS-1 Fase 1 · Migraciones de esquema WS0 (v0.2.1 CONGELADO)
-- Idempotente. Aplicar SOLO en erp_mmh_test en esta fase.
-- No rompe datos existentes: ALTERs con ADD COLUMN IF NOT EXISTS, backfill, luego constraints.
-- Tablas fisicas: se "promueve" plan_contable en sitio (no rename) para no romper FKs/varchars.

BEGIN;

-- ============================================================
-- 1) empresa  (ya existe · no-op)
-- ============================================================
-- Filas MM(1) + MG(2) ya presentes. Nada que migrar.

-- ============================================================
-- 2) cuenta_contable  (promover plan_contable EN SITIO)
--    +clasificable (elem 6/9) +es_divisionaria +empresa_id +activa
-- ============================================================
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS clasificable   boolean;
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS es_divisionaria boolean NOT NULL DEFAULT false;
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS empresa_id      integer REFERENCES empresa(id) ON DELETE SET NULL;
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS activa          boolean NOT NULL DEFAULT true;

-- clasificable = cuentas de gasto/costo (elementos 6 y 9). Idempotente (recomputa siempre).
UPDATE plan_contable
  SET clasificable = (left(codigo,1) IN ('6','9'))
  WHERE clasificable IS DISTINCT FROM (left(codigo,1) IN ('6','9'));

-- ============================================================
-- 3) asiento  ALTER: +empresa_id +anula_a_asiento_id +hash
-- ============================================================
ALTER TABLE asientos ADD COLUMN IF NOT EXISTS empresa_id         integer REFERENCES empresa(id);
ALTER TABLE asientos ADD COLUMN IF NOT EXISTS anula_a_asiento_id uuid REFERENCES asientos(id) ON DELETE SET NULL;
ALTER TABLE asientos ADD COLUMN IF NOT EXISTS hash               varchar(64);

-- Backfill: todo lo historico = MM (empresa 1). MG(2) queda limpio para el test.
UPDATE asientos SET empresa_id = 1 WHERE empresa_id IS NULL;
ALTER TABLE asientos ALTER COLUMN empresa_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS asientos_empresa_idx ON asientos(empresa_id);
-- Idempotencia de apertura: 1 apertura por empresa (parcial, ignora anulados).
CREATE UNIQUE INDEX IF NOT EXISTS asientos_apertura_uq
  ON asientos(empresa_id) WHERE origen = 'apertura' AND status <> 'anulado';

-- ============================================================
-- 4) asiento_linea ALTER: +cuenta_contable(FK) +obra_id +clase_derivada
-- ============================================================
ALTER TABLE asientos_lineas ADD COLUMN IF NOT EXISTS cuenta_contable varchar(10);
ALTER TABLE asientos_lineas ADD COLUMN IF NOT EXISTS obra_id         uuid REFERENCES proyectos(id) ON DELETE SET NULL;
ALTER TABLE asientos_lineas ADD COLUMN IF NOT EXISTS clase_derivada  varchar(10);

-- Backfill: cuenta_contable = cuenta (varchar historico); obra_id = header proyecto_id.
UPDATE asientos_lineas SET cuenta_contable = cuenta WHERE cuenta_contable IS NULL;
UPDATE asientos_lineas al
  SET obra_id = a.proyecto_id
  FROM asientos a
  WHERE al.asiento_id = a.id AND al.obra_id IS NULL AND a.proyecto_id IS NOT NULL;

-- FK a plan_contable (todas las cuentas historicas ya existen · verificado 0 huerfanas).
-- NOT VALID: aplica a filas nuevas; no revalida historico (barato + no rompe).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lineas_cuenta_contable_fk') THEN
    ALTER TABLE asientos_lineas
      ADD CONSTRAINT lineas_cuenta_contable_fk
      FOREIGN KEY (cuenta_contable) REFERENCES plan_contable(codigo) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS lineas_cuenta_contable_idx ON asientos_lineas(cuenta_contable);
CREATE INDEX IF NOT EXISTS lineas_obra_idx ON asientos_lineas(obra_id);

-- CHECK debe/haber >= 0 (NOT VALID · solo filas nuevas).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lineas_signo_chk') THEN
    ALTER TABLE asientos_lineas
      ADD CONSTRAINT lineas_signo_chk
      CHECK (debe >= 0 AND haber >= 0) NOT VALID;
  END IF;
END $$;

-- WS-1 HARDENING · validar formalmente los 2 constraints NOT VALID cuando el historico este limpio.
-- Condicional: si hay huerfanas/negativos NO valida (deja NOT VALID + no rompe la migracion) para no
-- enmascarar datos sucios; reporta via NOTICE. En erp_mmh_test el historico esta limpio (huerfanas=0, neg=0).
DO $$
DECLARE huerfanas int; negativos int;
BEGIN
  SELECT count(*) INTO huerfanas FROM asientos_lineas l
    WHERE l.cuenta_contable IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM plan_contable p WHERE p.codigo = l.cuenta_contable);
  SELECT count(*) INTO negativos FROM asientos_lineas WHERE debe < 0 OR haber < 0;

  IF huerfanas = 0 THEN
    ALTER TABLE asientos_lineas VALIDATE CONSTRAINT lineas_cuenta_contable_fk;
  ELSE
    RAISE NOTICE 'lineas_cuenta_contable_fk NO validada: % cuentas huerfanas. Sanear antes.', huerfanas;
  END IF;

  IF negativos = 0 THEN
    ALTER TABLE asientos_lineas VALIDATE CONSTRAINT lineas_signo_chk;
  ELSE
    RAISE NOTICE 'lineas_signo_chk NO validada: % lineas con debe/haber negativo. Sanear antes.', negativos;
  END IF;
END $$;

-- ============================================================
-- 5) documento_pendiente  (sub-mayor CxC/CxP por tercero/documento)
--    saldo_pendiente = DERIVADO (cache) · monto_pen = valor en PEN para cuadre del mayor
-- ============================================================
CREATE TABLE IF NOT EXISTS documento_pendiente (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        integer NOT NULL REFERENCES empresa(id),
  tipo              varchar(3) NOT NULL,                     -- cxc | cxp
  cuenta_control    varchar(10) NOT NULL REFERENCES plan_contable(codigo),
  tercero_ruc       varchar(11),
  tercero_razon     varchar(255),
  doc_tipo          varchar(20),
  doc_serie         varchar(20),
  doc_numero        varchar(30),
  fecha_emision     date,
  fecha_venc        date,
  moneda            varchar(3) NOT NULL DEFAULT 'PEN',
  tipo_cambio       numeric(8,4),
  monto_original    numeric(14,2) NOT NULL,                  -- moneda nativa
  monto_pen         numeric(14,2) NOT NULL,                  -- equivalente PEN (mayor)
  saldo_pendiente   numeric(14,2) NOT NULL,                  -- DERIVADO = monto_original - Σ aplicaciones activas
  estado            varchar(10) NOT NULL DEFAULT 'abierto',  -- abierto | parcial | cancelado
  obra_id           uuid REFERENCES proyectos(id) ON DELETE SET NULL,
  asiento_origen_id uuid REFERENCES asientos(id) ON DELETE SET NULL,
  doc_origen_tipo   varchar(20),
  doc_origen_id     uuid,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now(),
  CONSTRAINT docpend_tipo_chk   CHECK (tipo IN ('cxc','cxp')),
  CONSTRAINT docpend_estado_chk CHECK (estado IN ('abierto','parcial','cancelado')),
  CONSTRAINT docpend_montos_chk CHECK (monto_original >= 0 AND monto_pen >= 0 AND saldo_pendiente >= 0),
  CONSTRAINT docpend_saldo_chk  CHECK (saldo_pendiente <= monto_original)
);
CREATE UNIQUE INDEX IF NOT EXISTS docpend_uq
  ON documento_pendiente(empresa_id, tipo, doc_tipo, doc_serie, doc_numero);
CREATE INDEX IF NOT EXISTS docpend_control_idx ON documento_pendiente(empresa_id, cuenta_control);
CREATE INDEX IF NOT EXISTS docpend_asiento_idx ON documento_pendiente(asiento_origen_id);

-- ============================================================
-- 6) aplicacion_documento  (trazabilidad pago↔documento · N↔M)
-- ============================================================
CREATE TABLE IF NOT EXISTS aplicacion_documento (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_pendiente_id uuid NOT NULL REFERENCES documento_pendiente(id) ON DELETE CASCADE,
  asiento_id            uuid NOT NULL REFERENCES asientos(id) ON DELETE CASCADE,
  asiento_linea_id      uuid REFERENCES asientos_lineas(id) ON DELETE SET NULL,
  monto_aplicado        numeric(14,2) NOT NULL,
  moneda                varchar(3) NOT NULL DEFAULT 'PEN',
  tipo_cambio           numeric(8,4),
  fecha                 date,
  estado                varchar(10) NOT NULL DEFAULT 'activa',  -- activa | anulada
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  origen_ref            varchar(80),
  created_at            timestamp NOT NULL DEFAULT now(),
  CONSTRAINT aplic_estado_chk CHECK (estado IN ('activa','anulada')),
  CONSTRAINT aplic_monto_chk  CHECK (monto_aplicado > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS aplic_asiento_doc_uq
  ON aplicacion_documento(asiento_id, documento_pendiente_id);
CREATE INDEX IF NOT EXISTS aplic_doc_idx ON aplicacion_documento(documento_pendiente_id);

-- ============================================================
-- 7) mapa_cuenta_clase  (DATA de derivarClase · cuenta→clase_obra)
--    Seed: invertir gasto_cuenta_map (solo cuentas de gasto). Conflictos → pick determinista.
-- ============================================================
CREATE TABLE IF NOT EXISTS mapa_cuenta_clase (
  cuenta     varchar(10) PRIMARY KEY REFERENCES plan_contable(codigo),
  clase_obra varchar(10) NOT NULL,
  CONSTRAINT mapa_clase_chk CHECK (clase_obra IN ('CD','GG_OBRA'))
);
-- clase_obra = la clase cuando la cuenta se usa en obra. GG_CORP no vive aqui (es obra_id=null en la regla).
INSERT INTO mapa_cuenta_clase (cuenta, clase_obra)
SELECT cuenta, clase_obra FROM (
  SELECT DISTINCT ON (cuenta) cuenta,
         CASE WHEN clase = 'GG_OBRA' THEN 'GG_OBRA' ELSE 'CD' END AS clase_obra
  FROM gasto_cuenta_map
  WHERE es_gasto = true AND clase IN ('CD','GG_OBRA')
  ORDER BY cuenta, clase   -- determinista
) s
WHERE EXISTS (SELECT 1 FROM plan_contable pc WHERE pc.codigo = s.cuenta)
ON CONFLICT (cuenta) DO NOTHING;

-- ============================================================
-- 8) asiento_plantilla  (patrones · precarga de formularios · no usado por WS-1)
-- ============================================================
CREATE TABLE IF NOT EXISTS asiento_plantilla (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        varchar(30) NOT NULL UNIQUE,
  nombre        varchar(120) NOT NULL,
  origen        varchar(20) NOT NULL,
  lineas_patron jsonb NOT NULL DEFAULT '[]'::jsonb,
  activa        boolean NOT NULL DEFAULT true,
  created_at    timestamp NOT NULL DEFAULT now()
);
INSERT INTO asiento_plantilla (codigo, nombre, origen, lineas_patron) VALUES
 ('PL-COMPRA','Compra (devengado)','compra',
   '[{"rol":"gasto","lado":"debe","fuente_monto":"base"},{"rol":"igv","cuenta_default":"40111","lado":"debe","fuente_monto":"igv"},{"rol":"cxp","cuenta_default":"4212","lado":"haber","fuente_monto":"total"}]'::jsonb),
 ('PL-VENTA','Venta / valorizacion','venta',
   '[{"rol":"cxc","cuenta_default":"1212","lado":"debe","fuente_monto":"total"},{"rol":"ventas","cuenta_default":"7041","lado":"haber","fuente_monto":"base"},{"rol":"igv","cuenta_default":"40111","lado":"haber","fuente_monto":"igv"}]'::jsonb),
 ('PL-BANCO-PAGO','Pago desde banco','banco_pago',
   '[{"rol":"cxp","cuenta_default":"4212","lado":"debe","fuente_monto":"total"},{"rol":"caja","lado":"haber","fuente_monto":"total"}]'::jsonb),
 ('PL-PLANILLA','Planilla','planilla',
   '[{"rol":"gasto","cuenta_default":"621","lado":"debe","fuente_monto":"total"},{"rol":"cxp","cuenta_default":"411","lado":"haber","fuente_monto":"total"}]'::jsonb),
 ('PL-CAJA','Caja / rendicion','caja',
   '[{"rol":"gasto","lado":"debe","fuente_monto":"total"},{"rol":"caja","lado":"haber","fuente_monto":"total"}]'::jsonb),
 ('PL-APERTURA','Asiento de apertura','apertura',
   '[]'::jsonb)
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
