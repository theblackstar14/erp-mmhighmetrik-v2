-- Boleta: fechas de ingreso/cese + flag manual de renta 5ta. Solo erp_mmh_test. Idempotente.
BEGIN;
ALTER TABLE planilla_oficina_detalle ADD COLUMN IF NOT EXISTS fecha_ingreso  date;
ALTER TABLE planilla_oficina_detalle ADD COLUMN IF NOT EXISTS fecha_cese     date;
ALTER TABLE planilla_oficina_detalle ADD COLUMN IF NOT EXISTS renta5ta_manual boolean NOT NULL DEFAULT false;
COMMIT;
