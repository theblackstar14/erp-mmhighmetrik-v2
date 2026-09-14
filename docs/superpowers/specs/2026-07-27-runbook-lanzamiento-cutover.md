# Runbook de lanzamiento — arranque contable definitivo (cutover 104x)

Fecha: 2026-07-27 · Estado: plan aprobado, ejecución espera saldos reales
Decidido con LLM Council (5/5) + verificación en vivo.

## Principio (reencuadre del consejo)

No es un "flip de un sistema vivo". La caja **nunca se contabilizó** (cuenta 10 vacía) y la
data actual es demo/reset. **No estás migrando: estás encendiendo.** El camino definitivo es:

> **DB limpia + `CUTOVER = fecha de lanzamiento` + `PARALLEL = false` + asiento de apertura con saldos reales.**

Así el "flip" es casi un no-evento (no hay historia legacy real que migrar) y la cuenta 10 vive
desde el día 1. La maquinaria F4.5 (readiness/dry-run/playbook/watchdog/rollback) queda como
**red de seguridad**, no como el camino.

## Reglas de oro (del consejo)

1. **Nunca flipear con readiness ≠ GO corrido el mismo día.** El CONDITIONAL de 34 días = ABORT.
2. **No cambiar dos cosas el mismo día.** Lanzar operación + cambiar motor de caja a la vez = ciego
   para diagnosticar. Con arranque limpio esto se disuelve (no hay flip, se nace configurado).
3. **DB de producción limpia**, no la demo/reset. Backup del demo ya en `_backups/`.
4. **El asiento de apertura es el trabajo real**, no la regeneración. Sin él la cuenta 10 arranca
   en cero (coherente pero falso). Necesita **saldos reales** (los docs que se van a pedir).
5. **Sin doble conteo:** `/generar` es incremental; en DB limpia no hay asientos legacy de caja
   que dupliquen (verificado: `legacyCajaAAnular=[]`).

## Pre-requisitos antes de tocar producción

- [ ] Saldos de apertura reales al día de lanzamiento: caja/bancos (por cuenta), por cobrar
      (clientes + retención), por pagar (proveedores), inventario/activos, patrimonio.
- [ ] Plan contable con las cuentas 10x ya sembrado (✅ existe: 10411 BCP Soles, 10441 Scotiabank
      Soles, 10451 Caja Chica Soles, etc.).
- [ ] Cada cuenta bancaria con su `cuenta_contable` (104x) asignada. **Procedimiento validado hoy**
      en demo: mapear cuenta → código 104x según banco+moneda. Gap de config cerrado (0/0).

## Procedimiento de config de cuentas (validado 2026-07-27 en demo)

Cada cuenta bancaria debe tener `cuenta_contable`:
- BCP Soles → `10411` · BCP Dólares → `10412`
- Scotiabank Soles → `10441` · Scotiabank Dólares → `10442`
- Caja Chica → `10451` · Detracciones → `1071` · por clasificar → `10491`

Verificación: `readiness` → `cuentasSin104x=0` y `movimientosSinCuenta=0`.

## Runbook de lanzamiento (orden exacto)

### Fase 0 · Preparar DB de producción limpia
1. Crear DB de producción vacía (esquema por migraciones, sin data demo).
2. Sembrar masters reales: empresas/RUC, plan contable, usuarios/roles, proyectos vigentes,
   proveedores/clientes, cuentas bancarias (con `cuenta_contable`).
3. **NO** cargar transacciones demo.

### Fase 1 · Asiento de apertura (el trabajo real)
4. Con los saldos reales verificados, postear **UN** asiento de apertura al día de lanzamiento:
   `Dr 10x caja/bancos · Dr 12x por cobrar · Dr 20/33 inventario/activos / Cr 42x por pagar ·
   Cr 12x anticipos · Cr 50/59 patrimonio/resultados acumulados`. Debe cuadrar (Σdebe=Σhaber).
5. Verificar que la cuenta 10 refleja los saldos bancarios reales.

### Fase 2 · Fijar el modelo definitivo
6. `PUT /contabilidad/config { cutover: '<fecha-lanzamiento>' }`.
7. `PUT /contabilidad/config { parallel: false }`.
8. Desde aquí: cada `movimiento` nace dueño de su asiento en la cuenta 10.

### Fase 3 · Validación go-live
9. `GET /cutover-readiness?periodo=<mes>` → debe ser **GO** (no CONDITIONAL).
10. `GET /watchdog?periodo=<mes>` → **verde**.
11. `GET /smoke?periodo=<mes>` → 10/10.
12. Registrar 2-3 operaciones reales (una compra pagada, un cobro) y confirmar que la cuenta 10
    se mueve y concilia contra el banco.

### ABORT / Rollback
- Cualquier hard gate en rojo, o cuenta 10 que no cuadra contra banco → **detener**.
- Rollback: `PUT /config { cutover: null, parallel: true }` + revisar asiento de apertura.
  (CUTOVER es config reversible; verificado `rollback_posible=true`.)

## Qué NO hacer

- No flipear la DB demo/reset "para probar en serio" — es data de juguete.
- No forzar readiness CONDITIONAL → GO con `force`.
- No lanzar operación y flip el mismo día si se opta por migrar un sistema ya operando (no es el
  caso aquí, pero la regla queda).

## Estado actual (demo, para referencia)

- Config gaps cerrados (cuentasSin104x=0, movSinCuenta=0).
- Diff shadow = −1,531,756.36 = la caja de cobros de valo que no está posteada. Al postearla, el
  12x baja a 144,177 (= retención = saldo de liquidación). Todo reconcilia.
- readiness=CONDITIONAL (diff + snapshot), watchdog=amarillo. Esperado en demo sin apertura.
