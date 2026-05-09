-- ════════════════════════════════════════════════════════════════
-- F0 FOUNDATION · Triggers + Funciones SQL custom
-- ════════════════════════════════════════════════════════════════

-- ─── 1. domain_events INMUTABLE ───────────────────────────────
-- Convertir sequence_number a BIGSERIAL (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'domain_events' AND column_name = 'sequence_number'
      AND column_default LIKE 'nextval%'
  ) THEN
    ALTER TABLE domain_events DROP COLUMN IF EXISTS sequence_number;
    ALTER TABLE domain_events ADD COLUMN sequence_number BIGSERIAL UNIQUE;
  END IF;
END $$;
--> statement-breakpoint

-- Bloquea UPDATE y DELETE
CREATE OR REPLACE FUNCTION prevent_domain_events_modification()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'domain_events son inmutables · no se permite UPDATE/DELETE';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tr_domain_events_no_update ON domain_events;
CREATE TRIGGER tr_domain_events_no_update
  BEFORE UPDATE ON domain_events
  FOR EACH ROW EXECUTE FUNCTION prevent_domain_events_modification();
--> statement-breakpoint

DROP TRIGGER IF EXISTS tr_domain_events_no_delete ON domain_events;
CREATE TRIGGER tr_domain_events_no_delete
  BEFORE DELETE ON domain_events
  FOR EACH ROW EXECUTE FUNCTION prevent_domain_events_modification();
--> statement-breakpoint

-- LISTEN/NOTIFY para event bus
CREATE OR REPLACE FUNCTION notify_domain_event()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'domain_events',
    jsonb_build_object(
      'id', NEW.id,
      'aggregate_type', NEW.aggregate_type,
      'aggregate_id', NEW.aggregate_id,
      'event_type', NEW.event_type,
      'sequence', NEW.sequence_number,
      'occurred_at', NEW.occurred_at
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tr_notify_domain_event ON domain_events;
CREATE TRIGGER tr_notify_domain_event
  AFTER INSERT ON domain_events
  FOR EACH ROW EXECUTE FUNCTION notify_domain_event();
--> statement-breakpoint

-- ─── 2. audit_log_immutable INMUTABLE + hash chain ────────────
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_immutable es append-only · no se permite UPDATE/DELETE';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tr_audit_no_update ON audit_log_immutable;
CREATE TRIGGER tr_audit_no_update
  BEFORE UPDATE ON audit_log_immutable
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
--> statement-breakpoint

DROP TRIGGER IF EXISTS tr_audit_no_delete ON audit_log_immutable;
CREATE TRIGGER tr_audit_no_delete
  BEFORE DELETE ON audit_log_immutable
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
--> statement-breakpoint

-- Calcular hash chain antes insert
CREATE OR REPLACE FUNCTION compute_audit_hash()
RETURNS trigger AS $$
DECLARE
  v_prev_hash TEXT;
BEGIN
  -- Get hash último registro
  SELECT current_hash INTO v_prev_hash
  FROM audit_log_immutable
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  NEW.previous_hash := COALESCE(v_prev_hash, '');

  NEW.current_hash := encode(
    sha256(
      (NEW.id::text ||
       COALESCE(NEW.user_id::text, '') ||
       NEW.action ||
       COALESCE(NEW.entity_id::text, '') ||
       COALESCE(NEW.payload_diff::text, '') ||
       NEW.occurred_at::text ||
       NEW.previous_hash)::bytea
    ),
    'hex'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tr_audit_hash ON audit_log_immutable;
CREATE TRIGGER tr_audit_hash
  BEFORE INSERT ON audit_log_immutable
  FOR EACH ROW EXECUTE FUNCTION compute_audit_hash();
--> statement-breakpoint

-- Verificación integridad chain
CREATE OR REPLACE FUNCTION verify_audit_chain()
RETURNS TABLE (broken_at_id uuid, expected_prev_hash text, actual_prev_hash text) AS $$
  WITH ordered AS (
    SELECT
      id,
      previous_hash,
      LAG(current_hash) OVER (ORDER BY occurred_at, id) AS expected_prev
    FROM audit_log_immutable
  )
  SELECT id, expected_prev, previous_hash
  FROM ordered
  WHERE previous_hash IS DISTINCT FROM expected_prev
    AND expected_prev IS NOT NULL;
$$ LANGUAGE sql;
--> statement-breakpoint

-- ─── 3. periodos_contables · bloqueo asientos cerrados ────────
-- (Trigger se aplica cuando exista vínculo asiento ↔ periodo · F15)

-- ─── 4. param_get · función obtener parámetro vigente ─────────
CREATE OR REPLACE FUNCTION param_get(
  p_codigo varchar,
  p_fecha date DEFAULT CURRENT_DATE,
  p_empresa_id integer DEFAULT NULL,
  p_proyecto_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_param record;
BEGIN
  SELECT * INTO v_param FROM parametros
  WHERE codigo = p_codigo
    AND p_fecha BETWEEN vigencia_desde AND COALESCE(vigencia_hasta, p_fecha)
    AND estado = 'vigente'
    AND (
      (scope = 'proyecto' AND proyecto_id = p_proyecto_id)
      OR (scope = 'empresa' AND empresa_id = p_empresa_id AND proyecto_id IS NULL)
      OR (scope = 'global' AND empresa_id IS NULL AND proyecto_id IS NULL)
    )
  ORDER BY
    CASE scope
      WHEN 'proyecto' THEN 1
      WHEN 'empresa' THEN 2
      WHEN 'global' THEN 3
    END,
    vigencia_desde DESC
  LIMIT 1;

  IF v_param IS NULL THEN
    RAISE EXCEPTION 'Parámetro % no encontrado para fecha %', p_codigo, p_fecha;
  END IF;

  RETURN CASE v_param.tipo_dato
    WHEN 'decimal' THEN to_jsonb(v_param.valor_decimal)
    WHEN 'integer' THEN to_jsonb(v_param.valor_integer)
    WHEN 'varchar' THEN to_jsonb(v_param.valor_varchar)
    WHEN 'boolean' THEN to_jsonb(v_param.valor_boolean)
    WHEN 'json'    THEN v_param.valor_json
    WHEN 'date'    THEN to_jsonb(v_param.valor_date)
  END;
END;
$$ LANGUAGE plpgsql STABLE;
--> statement-breakpoint

-- ─── 5. parametros · validación vigencia no solape ────────────
CREATE OR REPLACE FUNCTION validar_vigencia_parametro()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM parametros
    WHERE codigo = NEW.codigo
      AND scope = NEW.scope
      AND COALESCE(empresa_id, -1) = COALESCE(NEW.empresa_id, -1)
      AND COALESCE(proyecto_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(NEW.proyecto_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND id != NEW.id
      AND estado = 'vigente'
      AND (
        NEW.vigencia_desde BETWEEN vigencia_desde AND COALESCE(vigencia_hasta, '9999-12-31'::date)
        OR vigencia_desde BETWEEN NEW.vigencia_desde AND COALESCE(NEW.vigencia_hasta, '9999-12-31'::date)
      )
  ) THEN
    RAISE EXCEPTION 'Vigencia parámetro % se solapa con existente', NEW.codigo;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tr_validar_vigencia_parametro ON parametros;
CREATE TRIGGER tr_validar_vigencia_parametro
  BEFORE INSERT OR UPDATE ON parametros
  FOR EACH ROW EXECUTE FUNCTION validar_vigencia_parametro();
--> statement-breakpoint

-- ─── 6. Update timestamp automático ───────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tr_proyectos_updated_at ON proyectos;
CREATE TRIGGER tr_proyectos_updated_at
  BEFORE UPDATE ON proyectos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

DROP TRIGGER IF EXISTS tr_documentos_updated_at ON documentos;
CREATE TRIGGER tr_documentos_updated_at
  BEFORE UPDATE ON documentos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

DROP TRIGGER IF EXISTS tr_parametros_updated_at ON parametros;
CREATE TRIGGER tr_parametros_updated_at
  BEFORE UPDATE ON parametros
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
