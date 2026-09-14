-- WS1 v2 · cierre de brecha vs spec congelado (2026-08-14)
-- (1) vocabulario origen USUARIO/SUGERIDO/AUTOMATICO (espejo de clasificacion_origen)
-- (2) cuenta_contable en valorizaciones + planilla_detalle
-- (3) backfill gastos/movimientos (AUTOMATICO desde mapa/gasto ligado) · solo donde NULL
-- Idempotente. Solo erp_mmh_test.

BEGIN;

-- ============================================================
-- 1) Vocabulario origen: MANUAL→USUARIO · INFERIDO→AUTOMATICO
--    DROP de los CHECK viejos ANTES de actualizar (si no, el UPDATE dispara el check viejo).
-- ============================================================
ALTER TABLE asientos_lineas DROP CONSTRAINT IF EXISTS lineas_cuenta_origen_chk;
ALTER TABLE gastos          DROP CONSTRAINT IF EXISTS gastos_cuenta_origen_chk;
ALTER TABLE movimientos     DROP CONSTRAINT IF EXISTS movimientos_cuenta_origen_chk;

UPDATE asientos_lineas SET cuenta_origen = 'USUARIO'    WHERE cuenta_origen = 'MANUAL';
UPDATE asientos_lineas SET cuenta_origen = 'AUTOMATICO' WHERE cuenta_origen = 'INFERIDO';
UPDATE gastos       SET cuenta_contable_origen = 'USUARIO' WHERE cuenta_contable_origen = 'MANUAL';
UPDATE movimientos  SET cuenta_contable_origen = 'USUARIO' WHERE cuenta_contable_origen = 'MANUAL';

ALTER TABLE asientos_lineas ADD CONSTRAINT lineas_cuenta_origen_chk
  CHECK (cuenta_origen IS NULL OR cuenta_origen IN ('USUARIO','SUGERIDO','AUTOMATICO'));
ALTER TABLE gastos ADD CONSTRAINT gastos_cuenta_origen_chk
  CHECK (cuenta_contable_origen IS NULL OR cuenta_contable_origen IN ('USUARIO','SUGERIDO','AUTOMATICO'));
ALTER TABLE movimientos ADD CONSTRAINT movimientos_cuenta_origen_chk
  CHECK (cuenta_contable_origen IS NULL OR cuenta_contable_origen IN ('USUARIO','SUGERIDO','AUTOMATICO'));

-- ============================================================
-- 2) cuenta_contable en valorizaciones + planilla_detalle
-- ============================================================
ALTER TABLE valorizaciones ADD COLUMN IF NOT EXISTS cuenta_contable        varchar(10) REFERENCES plan_contable(codigo);
ALTER TABLE valorizaciones ADD COLUMN IF NOT EXISTS cuenta_contable_origen varchar(10);
ALTER TABLE valorizaciones DROP CONSTRAINT IF EXISTS valo_cuenta_origen_chk;
ALTER TABLE valorizaciones ADD CONSTRAINT valo_cuenta_origen_chk
  CHECK (cuenta_contable_origen IS NULL OR cuenta_contable_origen IN ('USUARIO','SUGERIDO','AUTOMATICO'));

ALTER TABLE planilla_detalle ADD COLUMN IF NOT EXISTS cuenta_contable        varchar(10) REFERENCES plan_contable(codigo);
ALTER TABLE planilla_detalle ADD COLUMN IF NOT EXISTS cuenta_contable_origen varchar(10);
ALTER TABLE planilla_detalle DROP CONSTRAINT IF EXISTS pdet_cuenta_origen_chk;
ALTER TABLE planilla_detalle ADD CONSTRAINT pdet_cuenta_origen_chk
  CHECK (cuenta_contable_origen IS NULL OR cuenta_contable_origen IN ('USUARIO','SUGERIDO','AUTOMATICO'));

-- ============================================================
-- 3) Backfill (solo WHERE cuenta_contable IS NULL · nunca sobrescribe)
-- ============================================================
-- gastos: cuenta del mapa tipoGasto→cuenta (solo si la cuenta existe y esta activa)
UPDATE gastos g
  SET cuenta_contable = m.cuenta, cuenta_contable_origen = 'AUTOMATICO'
  FROM gasto_cuenta_map m
  JOIN plan_contable pc ON pc.codigo = m.cuenta AND pc.activa = true
  WHERE g.cuenta_contable IS NULL AND g.tipo_gasto = m.tipo_gasto AND m.es_gasto = true;

-- movimientos: cuenta_contable del gasto ligado (gasto_id)
UPDATE movimientos mv
  SET cuenta_contable = g.cuenta_contable, cuenta_contable_origen = 'AUTOMATICO'
  FROM gastos g
  WHERE mv.cuenta_contable IS NULL AND mv.gasto_id = g.id AND g.cuenta_contable IS NOT NULL;

COMMIT;

-- Reporte de remanentes (informativo · no falla)
SELECT 'gastos sin cuenta_contable'      AS que, count(*) AS n FROM gastos WHERE cuenta_contable IS NULL
UNION ALL SELECT 'movimientos sin cuenta_contable (financieros puros ok)', count(*) FROM movimientos WHERE cuenta_contable IS NULL AND gasto_id IS NULL
UNION ALL SELECT 'movimientos con gasto pero sin cuenta (revisar)', count(*) FROM movimientos mv WHERE mv.cuenta_contable IS NULL AND mv.gasto_id IS NOT NULL;
