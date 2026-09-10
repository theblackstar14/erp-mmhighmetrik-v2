-- Planilla de oficina (regimen general) + trazabilidad. Solo erp_mmh_test. Idempotente.
BEGIN;

ALTER TABLE empleados ADD COLUMN IF NOT EXISTS cargo                 varchar(80);
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS sueldo_base_mensual   numeric(14,2);
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS fecha_cese            date;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS asignacion_familiar   boolean NOT NULL DEFAULT false;

-- Config extra para el motor de oficina (reusa configPlanilla singleton)
ALTER TABLE config_planilla ADD COLUMN IF NOT EXISTS rmv             numeric(14,2) NOT NULL DEFAULT 1025;
ALTER TABLE config_planilla ADD COLUMN IF NOT EXISTS uit             numeric(14,2) NOT NULL DEFAULT 5350;
ALTER TABLE config_planilla ADD COLUMN IF NOT EXISTS tope_seguro_afp numeric(14,2) NOT NULL DEFAULT 12786.4;
ALTER TABLE config_planilla ADD COLUMN IF NOT EXISTS horas_mes_base  integer NOT NULL DEFAULT 240;

CREATE TABLE IF NOT EXISTS planilla_oficina_mes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     integer NOT NULL REFERENCES empresa(id),
  mes            varchar(7) NOT NULL,
  estado         varchar(12) NOT NULL DEFAULT 'borrador',
  tasas_snapshot jsonb,
  asiento_id     uuid REFERENCES asientos(id) ON DELETE SET NULL,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamp NOT NULL DEFAULT now(),
  cerrado_por    uuid REFERENCES users(id) ON DELETE SET NULL,
  cerrado_en     timestamp,
  CONSTRAINT pom_estado_chk CHECK (estado IN ('borrador','calculada','cerrada','pagada'))
);
CREATE UNIQUE INDEX IF NOT EXISTS pom_empresa_mes_uq ON planilla_oficina_mes(empresa_id, mes);

CREATE TABLE IF NOT EXISTS planilla_oficina_detalle (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planilla_mes_id    uuid NOT NULL REFERENCES planilla_oficina_mes(id) ON DELETE CASCADE,
  empleado_id        uuid NOT NULL REFERENCES empleados(id),
  boleta_correlativo varchar(20),
  nombre             varchar(200), cargo varchar(80), dni varchar(15),
  afp                varchar(40), cuspp varchar(40), cuenta_bancaria varchar(40),
  dias_trab          integer DEFAULT 30, horas_trab integer DEFAULT 240,
  sueldo_mensual     numeric(14,2) DEFAULT 0, valor_hora numeric(14,4) DEFAULT 0,
  cant_he25 numeric(8,2) DEFAULT 0, monto_he25 numeric(14,2) DEFAULT 0,
  cant_he35 numeric(8,2) DEFAULT 0, monto_he35 numeric(14,2) DEFAULT 0,
  total_he numeric(14,2) DEFAULT 0,
  dias_dominical integer DEFAULT 0, monto_dominical numeric(14,2) DEFAULT 0,
  dias_feriado integer DEFAULT 0, monto_feriado numeric(14,2) DEFAULT 0,
  asig_familiar numeric(14,2) DEFAULT 0, gratificacion numeric(14,2) DEFAULT 0,
  vacaciones numeric(14,2) DEFAULT 0, comisiones numeric(14,2) DEFAULT 0,
  bonificacion numeric(14,2) DEFAULT 0, total_bruto numeric(14,2) DEFAULT 0,
  onp numeric(14,2) DEFAULT 0, afp_aporte numeric(14,2) DEFAULT 0,
  afp_seguro numeric(14,2) DEFAULT 0, afp_comision numeric(14,2) DEFAULT 0,
  impto_renta5ta numeric(14,2) DEFAULT 0, retencion_judicial numeric(14,2) DEFAULT 0,
  adelanto_cuota numeric(14,2) DEFAULT 0, otros_descuentos numeric(14,2) DEFAULT 0,
  total_descuento numeric(14,2) DEFAULT 0,
  essalud numeric(14,2) DEFAULT 0, essalud_vida numeric(14,2) DEFAULT 0, total_aporte numeric(14,2) DEFAULT 0,
  neto_pago numeric(14,2) DEFAULT 0, costo_total numeric(14,2) DEFAULT 0,
  cuenta_contable varchar(10) REFERENCES plan_contable(codigo),
  cuenta_contable_origen varchar(10)
);
CREATE INDEX IF NOT EXISTS pod_mes_idx ON planilla_oficina_detalle(planilla_mes_id);

CREATE TABLE IF NOT EXISTS adelanto_oficina (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id uuid NOT NULL REFERENCES empleados(id),
  fecha       date NOT NULL,
  monto_total numeric(14,2) NOT NULL,
  num_cuotas  integer NOT NULL DEFAULT 1,
  motivo      varchar(200),
  estado      varchar(12) NOT NULL DEFAULT 'vigente',
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT adel_estado_chk CHECK (estado IN ('vigente','cancelado')),
  CONSTRAINT adel_montos_chk CHECK (monto_total > 0 AND num_cuotas >= 1)
);
CREATE INDEX IF NOT EXISTS adel_empleado_idx ON adelanto_oficina(empleado_id);

CREATE TABLE IF NOT EXISTS adelanto_cuota_aplicada (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adelanto_id         uuid NOT NULL REFERENCES adelanto_oficina(id) ON DELETE CASCADE,
  planilla_detalle_id uuid NOT NULL REFERENCES planilla_oficina_detalle(id) ON DELETE CASCADE,
  monto               numeric(14,2) NOT NULL,
  fecha               date NOT NULL,
  CONSTRAINT aca_uq UNIQUE (adelanto_id, planilla_detalle_id)
);

CREATE TABLE IF NOT EXISTS descuento_oficina (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planilla_detalle_id uuid NOT NULL REFERENCES planilla_oficina_detalle(id) ON DELETE CASCADE,
  tipo                varchar(20) NOT NULL,
  monto               numeric(14,2) NOT NULL,
  motivo              varchar(200),
  CONSTRAINT desc_tipo_chk CHECK (tipo IN ('judicial','prestamo_externo','otro'))
);

CREATE TABLE IF NOT EXISTS documento_adjunto (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidad_tipo  varchar(30) NOT NULL,
  entidad_id    uuid NOT NULL,
  doc_tipo      varchar(20) NOT NULL,
  nas_path      varchar(400) NOT NULL,
  nombre_archivo varchar(200),
  subido_por    uuid REFERENCES users(id) ON DELETE SET NULL,
  fecha         date,
  created_at    timestamp NOT NULL DEFAULT now(),
  CONSTRAINT docadj_tipo_chk CHECK (doc_tipo IN ('boleta_pago','comprobante_pago','factura','rh','boleta','voucher','otro'))
);
CREATE INDEX IF NOT EXISTS docadj_entidad_idx ON documento_adjunto(entidad_tipo, entidad_id);

COMMIT;
