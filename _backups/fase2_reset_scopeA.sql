-- ════════════════════════════════════════════════════════════════════════════
-- FASE 2 · RESET CONTROLADO · Scope A (quirúrgico) · 100% REVERSIBLE
-- Backup previo: _backups/erp_mmh_pre-reset_20260625_112359.dump (pg_restore --clean)
-- NO ejecutar hasta GO explícito. Transaccional: si algo falla, ROLLBACK automático.
--
-- PRESERVA: gastos (1575 · menos 5 auto-gastos de OC), partidas, inventario,
--           proveedores, OCs (estructura), proyectos, valos (solo status), cuentas,
--           plan_contable, configuracion_contable, periodos_contables.
-- NO TOCA:  CUTOVER (null), ownership (legacy), PARALLEL (true).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- 0 · GUARD anti-flip: abortar si CUTOVER no es null (nunca resetear con flip activo)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM configuracion_contable
             WHERE clave='MOVIMIENTOS_104X_CUTOVER' AND valor IS NOT NULL AND valor <> '') THEN
    RAISE EXCEPTION 'ABORT: CUTOVER no es null — no resetear con flip activo';
  END IF;
END $$;

-- 1 · conciliación bancaria (idempotente · hoy 0 filas)
DELETE FROM extracto_lineas;
DELETE FROM extractos_bancarios;

-- 2 · snapshots de transición F4.2 (3)
DELETE FROM cutover_snapshots;

-- 3 · asientos contables (321) → CASCADE asientos_lineas (912)
DELETE FROM asientos;

-- 4 · movimientos de tesorería (14) · extracto_lineas ya borrado (sin SET NULL pendiente)
DELETE FROM movimientos;

-- 5 · auto-gastos de las 5 OC pagadas (5 gastos OC-origin · los otros 1575 se preservan)
--     (verificado: exactamente 5 gastos con OC.gasto_id → estos)
DELETE FROM gastos
 WHERE id IN (SELECT gasto_id FROM ordenes_compra WHERE estado_pago='pagada' AND gasto_id IS NOT NULL);

-- 6 · reset estado de pago de OC (pagada → pendiente · gasto_id queda NULL por el delete anterior)
UPDATE ordenes_compra
   SET estado_pago='pendiente', pagado_en=NULL, comprobante_pago_nas_path=NULL,
       forma_pago=NULL, medio_pago=NULL, pagado_por_email=NULL
 WHERE estado_pago='pagada';

-- 7 · reset valorización cobrada → facturada (re-cobrable en la simulación)
UPDATE valorizaciones SET status='facturada' WHERE status='cobrada';

-- 8 · notificaciones (4 · regenerables por el motor de alertas)
DELETE FROM notificaciones;

-- 9 · audit_log (28) · YA archivado en _backups/erp_mmh_reset-tables_*.sql → limpiar trail
DELETE FROM audit_log;

-- ── verificación DENTRO de la transacción (revisar antes del COMMIT) ──
DO $$
DECLARE m int; a int; al int; g int; ocp int; vc int; cut text;
BEGIN
  SELECT count(*) INTO m  FROM movimientos;
  SELECT count(*) INTO a  FROM asientos;
  SELECT count(*) INTO al FROM asientos_lineas;
  SELECT count(*) INTO g  FROM gastos;            -- esperado 1575
  SELECT count(*) INTO ocp FROM ordenes_compra WHERE estado_pago='pagada'; -- esperado 0
  SELECT count(*) INTO vc FROM valorizaciones WHERE status='cobrada';       -- esperado 0
  SELECT valor INTO cut FROM configuracion_contable WHERE clave='MOVIMIENTOS_104X_CUTOVER';
  RAISE NOTICE 'POST-RESET → movimientos=% asientos=% lineas=% gastos=% OC_pagadas=% valo_cobradas=% cutover=%',
    m, a, al, g, ocp, vc, COALESCE(cut,'NULL');
  IF m<>0 OR a<>0 OR al<>0 OR ocp<>0 OR vc<>0 THEN
    RAISE EXCEPTION 'ABORT: verificación post-reset falló (algo no quedó en 0)';
  END IF;
END $$;

COMMIT;
-- Rollback total si hiciera falta:
--   pg_restore --clean --if-exists -U postgres -h localhost -d erp_mmh _backups/erp_mmh_pre-reset_20260625_112359.dump
