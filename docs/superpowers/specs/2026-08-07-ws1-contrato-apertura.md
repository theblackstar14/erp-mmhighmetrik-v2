# WS-1 · Contrato de migración de saldos de apertura

Fecha: 2026-08-07 · Depende de: WS0 v0.2.1 CONGELADO. **Es una migración controlada de datos, NO un formulario.**
Sin frontend. Patrón: script tsx con **DRY-RUN → validación → COMMIT** (como el importador FX existente), todo en UNA transacción.
Data: de PRUEBA por ahora (Excel de apertura de prueba que definimos aquí); la real (EECC + balances de Kelly) usa el MISMO formato.

---

## 1. Origen exacto de los datos de apertura
- **Ahora (prueba)**: un Excel de apertura con el formato de §2, poblado con data de prueba coherente (1-2 empresas).
- **Después (real)**: `EECC_Ene2026.pdf` (saldos contables al corte) + detalle de CxC/CxP por documento (lo arma Kelly) + maestros de proveedores/clientes ya existentes.
- **Fecha de apertura** = día previo al go-live (corte). Debe caer en un periodo **ABIERTO**.
- Una carga = **una empresa** (MM o Doratta). Multi-empresa = correr el script por empresa.

## 2. Formato esperado de Excel (una hoja por sección · o columnas `seccion`)
Encabezado: `empresa_ruc`, `fecha_apertura`.
- **BANCOS/CAJA**: `cuenta_contable(104x)`, `moneda`, `tipo_cambio`, `saldo` (signo natural: activo debe).
- **DETRACCIONES**: `cuenta_contable(1071)`, `saldo`.
- **CxC** (una fila por documento): `cuenta_control(1212/…)`, `tercero_ruc`, `tercero_razon`, `doc_tipo`, `doc_serie`, `doc_numero`, `fecha_emision`, `fecha_venc`, `moneda`, `tipo_cambio`, `monto_original`, `saldo_pendiente`, `obra_codigo`(opc).
- **CxP** (una fila por documento): igual que CxC con `cuenta_control(4212/45x/41x)`.
- **OTROS ACTIVOS/PASIVOS** (inventario/activos/tributos): `cuenta_contable`, `saldo` (opc, fase real).
- **PATRIMONIO/RESULTADOS**: `cuenta_contable(50x/591)`, `saldo` — es el **cuadre** (o se valida contra EECC).
Regla: montos en PEN para el mayor; CxC/CxP en USD guardan moneda+TC+monto original.

## 3. Transformación Excel → `documento_pendiente`
Cada fila de CxC/CxP → 1 `documento_pendiente`:
`empresa_id` (de empresa_ruc), `tipo` (cxc|cxp), `cuenta_control`, `tercero_ruc/razon`, `doc_*`, `fecha_emision/venc`, `moneda`, `tipo_cambio`, `monto_original`, `saldo_pendiente=monto_original` (apertura: nada aplicado aún), `estado=abierto`, `obra_id` (de obra_codigo, opc), `asiento_origen_id` = el asiento de apertura, `doc_origen=null` (viene de migración).
Sin `aplicacion_documento` en apertura (no hay pagos aún).

## 4. Transformación Excel → asiento de apertura
UN asiento por empresa: `origen='apertura'`, `origen_id=<empresa_id>` (idempotencia 1/empresa), `fecha=fecha_apertura`, `periodo`, `glosa='Asiento de apertura <empresa> <fecha>'`, `moneda='PEN'`, `hash`.
Líneas (nivel CONTROL, agregadas — NO una por tercero):
- Por cada BANCO/CAJA/DETRACCIÓN/OTRO-ACTIVO → línea `Dr cuenta = saldo`.
- `Dr 1212 (control CxC) = Σ CxC.monto_original` (una línea por cuenta_control distinta).
- `Cr 4212/45x/41x (control CxP) = Σ CxP.monto_original` (por cuenta_control).
- Por cada PASIVO/PATRIMONIO → línea `Cr cuenta = saldo`.
`clase_derivada = null` en todas (cuentas de balance). `obra_id` en línea solo si el saldo es por obra (ej. retención por obra).
Correlativo del asiento por `(empresa, periodo)`.

## 5. Cuadre CxC/CxP contra cuentas control
Antes del INSERT, por cada `cuenta_control`:
`Σ documento_pendiente(empresa, cuenta_control).monto_original == línea_control(cuenta_control).monto` → si no, **ABORTAR**.
Es el invariante 11 aplicado a la carga. Igual para bancos: cada línea de banco = su saldo de Excel.

## 6. Detección de duplicados
- **Dentro del Excel**: `(tipo, doc_tipo, doc_serie, doc_numero)` repetido → error (documento duplicado).
- **Contra DB**: `documento_pendiente` único `(empresa_id, tipo, doc_tipo, doc_serie, doc_numero)` → si ya existe, error.
- **Terceros/cuentas**: RUC no en maestro proveedores/clientes → reportar (crear o abortar según flag). Cuenta_contable no en plan → abortar.

## 7. Validación de idempotencia
- Idempotencia por `(origen='apertura', origen_id=empresa_id)`: **una sola apertura por empresa**.
- `hash` del contenido de la carga en el asiento: re-correr con el MISMO Excel → detecta hash igual → no-op (ya cargado).
- Re-correr con Excel DISTINTO para una empresa ya abierta → **error** salvo `--rollback` previo (§8). Nunca duplicar apertura.

## 8. Rollback completo de una carga fallida
- **Durante la carga**: TODO en UNA transacción (`BEGIN…COMMIT`). Cualquier validación §5/§6/§9 que falle → `ROLLBACK` automático, cero filas escritas.
- **Post-commit (apertura equivocada)**: procedimiento `revertir_apertura(empresa)`:
  1. `DELETE aplicacion_documento` de docs de esa apertura (en apertura = 0).
  2. `DELETE documento_pendiente WHERE asiento_origen_id = <asiento_apertura>`.
  3. `DELETE asientos_lineas WHERE asiento_id = <asiento_apertura>` (cascade) + `DELETE asientos` (el de apertura).
  4. Solo permitido si el periodo de apertura sigue ABIERTO y no hay pagos aplicados posteriores.
- Audit_log de la reversión.

## 9. Checklist de validación ANTES de INSERT (todas deben pasar)
- [ ] Empresa existe (empresa_ruc → empresa_id).
- [ ] Fecha de apertura en periodo **ABIERTO**.
- [ ] Todas las `cuenta_contable` (bancos, control, detracciones, pasivos, patrimonio) existen en el plan y están activas.
- [ ] Todos los `tercero_ruc` existen en maestro (o crear con flag).
- [ ] **Σ debe = Σ haber** del asiento de apertura (patrimonio cuadra).
- [ ] **Σ CxC docs = línea control 1212**; **Σ CxP docs = línea control 4212/45x/41x** (por cuenta_control).
- [ ] Sin documentos duplicados (dentro del Excel y contra DB).
- [ ] `saldo_pendiente ≤ monto_original` en cada documento (en apertura, =).
- [ ] Moneda/TC presentes cuando moneda ≠ PEN.
- [ ] No existe ya una apertura para `(empresa, fecha)` (o hash igual = no-op).
- [ ] Reporte DRY-RUN revisado (cuántas líneas/documentos, totales por cuenta control, cuadre) antes de COMMIT.

## 10. SQL/migraciones que WS-1 ejecutará
**Prerequisito (del contrato WS0 §migraciones)** — deben existir antes de cargar:
1. `empresa` (filas MM+Doratta) · 2. `cuenta_contable` (+clasificable/divisionaria/empresa_id/activa) · 3. `asiento` ALTER (+empresa_id/anula_a/hash) · 4. `asiento_linea` ALTER (+cuenta_contable FK/obra_id/clase_derivada) · 5. `documento_pendiente` CREATE · 6. `aplicacion_documento` CREATE · 7. `mapa_cuenta_clase` CREATE+seed · 8. `asiento_plantilla` CREATE+seed. (En erp_mmh + erp_mmh_f4d + test.)

**Carga de apertura (script tsx, transacción única):**
```
BEGIN
  validar §9 (aborta si falla)
  INSERT asientos (origen='apertura', origen_id=empresa_id, fecha, periodo, glosa, hash)  → asiento_id
  INSERT asientos_lineas (líneas control §4)  -- Σdebe=Σhaber
  INSERT documento_pendiente (una por fila CxC/CxP §3, asiento_origen_id=asiento_id)
  re-validar §5 (Σ sub-mayor = líneas control)  → si no, ROLLBACK
  audit_log (action='apertura', empresa)
COMMIT
```
Modos: `--dry-run` (valida + reporta, no escribe) · `--commit` · `--rollback <empresa>` (§8).

---

## Alcance de WS-1 (explícito)
**SÍ**: migraciones de esquema (prerequisito) + script de carga de apertura (dry-run/commit/rollback) + validaciones + `documento_pendiente` de apertura + asiento de apertura por empresa.
**NO**: ningún formulario, ninguna UI, ningún pago/aplicación (eso es WS4). No toca el motor `/generar` (solo lo prepara para leer cuenta manual, pero eso es WS1).
**Entregable de WS-1**: DB con apertura cargada + cuadrada (Σ=Σ, sub-mayor=control) para 1-2 empresas de prueba, reversible.

> Con WS-1 hecho, WS1 (cuenta manual en forms) y WS2 (compras) construyen ENCIMA de un libro que ya arranca cuadrado.
