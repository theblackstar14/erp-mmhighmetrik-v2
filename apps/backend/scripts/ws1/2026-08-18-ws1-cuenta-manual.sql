-- WS1 · Cuenta contable MANUAL en formularios · migración de esquema
-- Idempotente. Aplicar SOLO en erp_mmh_test en esta fase.
-- Enmiendas del consejo: (1) procedencia explícita en la LÍNEA + espejo en el ORIGEN
-- (para que el motor la re-lea y NO la pise al regenerar). Sin manual??inferred a ciegas.

BEGIN;

-- ── Línea: procedencia de la cuenta (MANUAL | SUGERIDO | INFERIDO) ──
-- cuenta_contable y clase_derivada ya existen (WS0). Falta declarar QUIÉN eligió la cuenta.
ALTER TABLE asientos_lineas ADD COLUMN IF NOT EXISTS cuenta_origen varchar(10);
ALTER TABLE asientos_lineas
  DROP CONSTRAINT IF EXISTS lineas_cuenta_origen_chk;
ALTER TABLE asientos_lineas
  ADD CONSTRAINT lineas_cuenta_origen_chk
  CHECK (cuenta_origen IS NULL OR cuenta_origen IN ('MANUAL','SUGERIDO','INFERIDO')) NOT VALID;

-- Backfill: todo lo histórico (cuenta_contable = cuenta legacy, WS-1 hardening) es INFERIDO.
UPDATE asientos_lineas SET cuenta_origen = 'INFERIDO'
  WHERE cuenta_origen IS NULL AND cuenta_contable IS NOT NULL;

-- histórico limpio → validar el CHECK.
ALTER TABLE asientos_lineas VALIDATE CONSTRAINT lineas_cuenta_origen_chk;

-- ── Origen GASTO: cuenta elegida por Kelly + su procedencia (espejo) ──
-- NULL = Kelly no eligió → el motor infiere (compat). Presente = el motor la usa y la respeta.
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS cuenta_contable        varchar(10) REFERENCES plan_contable(codigo);
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS cuenta_contable_origen varchar(10);
ALTER TABLE gastos
  DROP CONSTRAINT IF EXISTS gastos_cuenta_origen_chk;
ALTER TABLE gastos
  ADD CONSTRAINT gastos_cuenta_origen_chk
  CHECK (cuenta_contable_origen IS NULL OR cuenta_contable_origen IN ('MANUAL','SUGERIDO')) NOT VALID;
ALTER TABLE gastos VALIDATE CONSTRAINT gastos_cuenta_origen_chk;

-- ── Origen MOVIMIENTO: cuenta contra elegida por Kelly + procedencia (espejo) ──
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS cuenta_contable        varchar(10) REFERENCES plan_contable(codigo);
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS cuenta_contable_origen varchar(10);
ALTER TABLE movimientos
  DROP CONSTRAINT IF EXISTS movimientos_cuenta_origen_chk;
ALTER TABLE movimientos
  ADD CONSTRAINT movimientos_cuenta_origen_chk
  CHECK (cuenta_contable_origen IS NULL OR cuenta_contable_origen IN ('MANUAL','SUGERIDO')) NOT VALID;
ALTER TABLE movimientos VALIDATE CONSTRAINT movimientos_cuenta_origen_chk;

COMMIT;
