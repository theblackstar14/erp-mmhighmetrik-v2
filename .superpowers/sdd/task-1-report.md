# Task 1 Report — Expense Classification Columns

## Status: DONE

## Commit
`a969200` feat(gastos): schema clasificacion CD/GG_OBRA/GG_CORP + clase en config + backfill

## Schema Changes
- `packages/db/src/schema.ts`: Added 4 columns to `gastos` pgTable after `tipoGasto`:
  - `destino varchar(12) NOT NULL DEFAULT 'proyecto'`
  - `clasificacion varchar(10) NOT NULL DEFAULT 'CD'`
  - `clasificacionOrigen varchar(12) NOT NULL DEFAULT 'AUTOMATICO'`
  - `prorrateable boolean NOT NULL DEFAULT false`
- Added 1 column to `gastoCuentaMap` pgTable before `actualizadoEn`:
  - `clase varchar(10) NOT NULL DEFAULT 'CD'`

## Migration Results

### erp_mmh
```
ALTER TABLE (gastos)
ALTER TABLE (gasto_cuenta_map)
UPDATE 8  (GG_OBRA seed: Alquileres, Servicio, Servicios básicos, Mantenimiento, Movilidad, Viáticos, Seguro, Seguros)
UPDATE 4  (GG_CORP seed: Impuestos, Comisión, Gasto Bancario, Financiero)
UPDATE 1574 (gastos backfill)

 destino   | clasificacion | clasificacion_origen | count
-----------+---------------+----------------------+-------
 corporativo | GG_CORP     | BACKFILL             |   106
 proyecto    | CD          | BACKFILL             |   862
 proyecto    | GG_CORP     | BACKFILL             |   146
 proyecto    | GG_OBRA     | BACKFILL             |   460
```

### erp_mmh_f4d
```
ALTER TABLE (gastos)
ALTER TABLE (gasto_cuenta_map)
UPDATE 8  (GG_OBRA seed)
UPDATE 4  (GG_CORP seed)
UPDATE 1575 (gastos backfill)

 destino   | clasificacion | clasificacion_origen | count
-----------+---------------+----------------------+-------
 corporativo | GG_CORP     | BACKFILL             |   106
 proyecto    | CD          | BACKFILL             |   862
 proyecto    | GG_CORP     | BACKFILL             |   146
 proyecto    | GG_OBRA     | BACKFILL             |   461
```

## Notes / Deviations
- No deviations from spec.
- Both DBs show consistent backfill results (1 row difference in proyecto/GG_OBRA is likely a real gasto that differs between DBs).
- GG_OBRA rows (460/461) confirm the gasto_cuenta_map seed matched tipos in the data (Alquileres etc. were present).
- The `seguros` (lowercase) entry in the seed list was included; it matched 0 rows (data uses capitalized `Seguros` which was also in the list), so no issue.
- Temp file `_tmp_clase.sql` deleted after migration.
