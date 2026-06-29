#!/usr/bin/env bash
# FASE 4C · harness multi-ciclo (5 ciclos) · read-mostly + stress · sin tocar cutover/ownership
set +e
B="http://localhost:3001/api"; CID="ccfc0e8f-0bf3-4386-be40-792c68482ab7"; CJ=/tmp/h3cj.txt
CSV="_fase3_input/extracto_abril_h.csv"
PSQL(){ PGPASSWORD=123 /c/Program\ Files/PostgreSQL/18/bin/psql.exe -U postgres -h localhost -d erp_mmh -tAc "$1"; }
login(){ curl -s -m8 -c $CJ -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@mmhighmetrik.com","password":"admin"}' -o /dev/null; }
jget(){ python -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }
login
# una línea sugerida para conciliar/rollback
LID=$(PSQL "select id from extracto_lineas where movimiento_id is not null limit 1")
MID=$(PSQL "select movimiento_id from extracto_lineas where id='$LID'")
echo "ciclo|watchdog|readiness|inv|extractos|asientos|realDiffs|reimport|gener_nuevos|conc_ok|rollback_ok|corrupt_http|locks|idle|t_watchdog_s"
for c in 1 2 3 4 5; do
  login
  # APERTURA
  W=$(curl -s -m12 -b $CJ "$B/contabilidad/watchdog?periodo=2026-04"); est=$(echo "$W"|jget "d['estadoGlobal']"); rd=$(echo "$W"|jget "d['resumen']['realDiffsCount']")
  rdy=$(curl -s -m12 -b $CJ "$B/contabilidad/cutover-readiness?periodo=2026-04"|jget "d['resultado']")
  inv=$(curl -s -m12 -b $CJ "$B/contabilidad/invariantes?periodo=2026-04"|jget "str(sum(1 for c in d['checks'] if c['ok']))+'/'+str(len(d['checks']))")
  # OPS · reimport dedup
  reimp=$(curl -s -m20 -b $CJ -X POST $B/conciliacion/importar -F "file=@$CSV;type=text/csv" -F "cuentaId=$CID" -F "moneda=PEN" -o /dev/null -w "%{http_code}")
  # generar idempotente
  gen=$(curl -s -m60 -b $CJ -X POST $B/contabilidad/generar -H 'Content-Type: application/json' -d '{"periodo":"2026-04"}'|jget "d.get('generados')")
  # conciliar + rollback
  conc=$(curl -s -m12 -b $CJ -X POST "$B/conciliacion/lineas/$LID/conciliar" -H 'Content-Type: application/json' -d "{\"movimientoId\":\"$MID\"}" -o /dev/null -w "%{http_code}")
  rb=$(curl -s -m12 -b $CJ -X POST "$B/conciliacion/lineas/$LID/estado" -H 'Content-Type: application/json' -d '{"estado":"pendiente"}' -o /dev/null -w "%{http_code}")
  # concurrente x3 reimport (dedup)
  for k in 1 2 3; do curl -s -m20 -b $CJ -X POST $B/conciliacion/importar -F "file=@$CSV;type=text/csv" -F "cuentaId=$CID" -F "moneda=PEN" -o /dev/null & done; wait
  # corrupto mixto
  printf 'fecha,descripcion,referencia,monto\n2026-13-01,malo,A,-10\n2026-04-0%s,ok ciclo,B%s,-1.2%s\nbasura,malo2,C,-5\n' "$c" "$c" "$c" > _fase3_input/corr_$c.csv
  ch=$(curl -s -m20 -b $CJ -X POST $B/conciliacion/importar -F "file=@_fase3_input/corr_$c.csv;type=text/csv" -F "cuentaId=$CID" -F "moneda=PEN" -o /dev/null -w "%{http_code}")
  # limpiar extractos corruptos del ciclo (mantener canónico 194)
  PSQL "delete from extractos_bancarios where total_filas<>194" >/dev/null
  # CIERRE
  tw=$(curl -s -m12 -b $CJ "$B/contabilidad/watchdog?periodo=2026-04" -o /dev/null -w "%{time_total}")
  ext=$(PSQL "select count(*) from extractos_bancarios"); asi=$(PSQL "select count(*) from asientos where periodo='2026-04'")
  lk=$(PSQL "select count(*) from pg_stat_activity where datname='erp_mmh' and wait_event_type='Lock'"); idl=$(PSQL "select count(*) from pg_stat_activity where datname='erp_mmh' and state='idle in transaction'")
  echo "$c|$est|$rdy|$inv|$ext|$asi|$rd|$reimp|$gen|$conc|$rb|$ch|$lk|$idl|$tw"
done
