-- F1 espejo CONTASIS · columnas del catálogo canónico + mapeo de centros de costo.
-- Idempotente. Solo erp_mmh_test.
-- Spec: docs/superpowers/specs/2026-10-07-contasis-espejo-design.md §3.1 y §3.3
BEGIN;

-- ── plan_contable · columnas propias de CONTASIS (spec §3.1) ──
-- codigo ya es varchar(10) y el código más largo de CONTASIS tiene 10 chars: no se migra el tipo.
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS contasis_nivel      integer;      -- nnivcue 1|2|3
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS contasis_tipo       integer;      -- ntipcue 1..7
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS contasis_analisis   integer;      -- nanacue 0 ninguno · 1 genérico · 2 tercero · 5 tributo
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS destino_debe        varchar(10);  -- cdesdeb
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS destino_haber       varchar(10);  -- cdeshab
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS exige_centro_costo  boolean NOT NULL DEFAULT false; -- nafecos <> null
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS cod_balance_1       varchar(4);   -- ccodbal1 (F115, F210…)
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS cod_balance_2       varchar(4);   -- ccodbal2 (N215, N310…)
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS cuenta_cierre       varchar(10);  -- ccuecie
ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS es_contasis         boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS plan_contable_es_contasis_idx ON plan_contable (es_contasis);

-- ── contasis_centro_costo · centro de costo de CONTASIS ↔ obra del ERP (spec §3.3) ──
-- Sin fila acá, una línea con centro de costo desconocido RECHAZA la importación en F2:
-- una obra mal asignada corrompe el resultado del proyecto, que es el reporte que mira Mario.
CREATE TABLE IF NOT EXISTS contasis_centro_costo (
  codigo      varchar(20) PRIMARY KEY,
  proyecto_id uuid REFERENCES proyectos(id) ON DELETE SET NULL,  -- null = corporativo (GG_CORP)
  descripcion text,
  empresa_id  integer NOT NULL REFERENCES empresa(id),
  activo      boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS ccc_proyecto_idx ON contasis_centro_costo (proyecto_id);

COMMIT;
