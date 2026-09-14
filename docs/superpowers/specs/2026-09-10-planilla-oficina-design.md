# Planilla de Oficina (régimen general) + Trazabilidad de pagos — spec

Fecha: 2026-09-10 · Módulo: **Oficina**. Alcance: **A (planilla de oficina mensual) + B (trazabilidad documental)**.
Depende de: WS1 (cuenta contable manual + motor de asientos) ya implementado. DB de trabajo: `erp_mmh_test`.
Aprobado conceptualmente por el usuario. **C (asistencia/zbiolink) y D (consolidar profesionales↔personal) son specs siguientes.**

## Objetivo
Llevar "el Excel de planilla de oficina" a la web: nómina mensual de régimen general (empleados administrativos + profesionales en planilla), con cálculo híbrido (auto lo mecánico, Renta 5ta como input), boleta de pago por persona, adelantos como préstamo con saldo, y **trazabilidad**: cada pago confirmado exige su boleta + comprobante en el NAS. Genera su asiento contable por el motor WS1 (cuenta manual, sin caminos paralelos).

Fuente del modelo: `07.PERSONAL PLANILLA JULIO 2026 OFICINA.xlsx` (hojas BOLETA, PLANILLA, Cálculo Rta 5ta) — 17 personas, régimen general.

---

## 1. Modelo de datos

### `empleados` (extender · tipoPlanilla='admin')
Ya tiene: nombre, tipoDoc, numDoc, fechaNacimiento, sistemaPension (AFP/ONP), cuspp, fechaIngreso, categoria, tieneHijos/numHijos, banco, numCuenta, tipoPlanilla, activo.
**Añadir**: `cargo` (Residente obra / Gerente adm / …), `sueldo_base_mensual` (numeric), `fecha_cese` (date null), `asignacion_familiar` (bool).
(`categoria` queda para obreros; oficina usa `cargo` + `sueldo_base_mensual`.)

### `planilla_oficina_mes` (NUEVO · header mensual)
`id, empresa_id (FK, default MM=1), mes (varchar YYYY-MM), estado (borrador|calculada|cerrada|pagada), tasas_snapshot (jsonb · tasas vigentes al calcular), created_by, created_at, cerrado_por, cerrado_en`.
Único `(empresa_id, mes)`.

### `planilla_oficina_detalle` (NUEVO · snapshot por empleado)
`id, planilla_mes_id (FK cascade), empleado_id (FK), boleta_correlativo (BOL-1000xx)`,
snapshot identidad: `nombre, cargo, dni, afp, cuspp, cuenta_bancaria, dias_trab, horas_trab`,
**ingresos**: `sueldo_mensual, valor_hora, cant_he25, monto_he25, cant_he35, monto_he35, total_he, dias_dominical, monto_dominical, dias_feriado, monto_feriado, asig_familiar, gratificacion, vacaciones, comisiones, bonificacion, total_bruto`,
**descuentos trabajador**: `onp, afp_aporte, afp_seguro, afp_comision, impto_renta5ta (input), retencion_judicial, adelanto_cuota (auto), otros_descuentos, total_descuento`,
**aportes empleador**: `essalud, essalud_vida, total_aporte`,
**resultado**: `neto_pago, costo_total`,
WS1: `cuenta_contable, cuenta_contable_origen`.

### `adelanto_oficina` (NUEVO · préstamo con saldo)
`id, empleado_id (FK), fecha, monto_total (numeric), num_cuotas (int), monto_cuota (derivado = total/num_cuotas), motivo, estado (vigente|cancelado), created_by, created_at`.
`saldo_pendiente` = **DERIVADO** = monto_total − Σ cuotas ya descontadas (una por `planilla_oficina_detalle.adelanto_cuota` que lo referencie). Se muestra "cuánto debe". Cuando saldo=0 → estado=cancelado.
Tabla puente `adelanto_cuota_aplicada` (`adelanto_id, planilla_detalle_id, monto, fecha`) para trazar qué mes descontó cada cuota (idempotencia + reversión al reabrir un mes).
El comprobante del adelanto se adjunta vía `documento_adjunto` (B).

### `descuento_oficina` (NUEVO · descuentos sueltos del mes)
`id, planilla_detalle_id (FK) | o empleado_id + mes, tipo (judicial|prestamo_externo|otro), monto, motivo`. Alimenta `otros_descuentos`/`retencion_judicial` del detalle.

### `documento_adjunto` (NUEVO · genérico · pieza B) — opción (a) aprobada
`id, entidad_tipo (gasto|rendicion|movimiento|planilla_oficina_detalle|adelanto_oficina|empleado), entidad_id (uuid), doc_tipo (boleta_pago|comprobante_pago|factura|rh|boleta|voucher|otro), nas_path (varchar), nombre_archivo, subido_por (FK users), fecha, created_at`.
Índice `(entidad_tipo, entidad_id)`. Un solo endpoint de subida. Permite preguntar "¿este detalle ya tiene boleta_pago + comprobante_pago?" → badge "falta comprobante".

---

## 2. Motor de cálculo (híbrido) — `lib/planillaOficinaCalc.ts`
Núcleo puro (unit-testeable, sin DB), recibe tasas + inputs, devuelve el detalle calculado.

**Auto-calculado (determinístico):**
- `total_bruto` = sueldo_mensual + total_he + monto_dominical + monto_feriado + asig_familiar + gratif + vacaciones + comisiones + bonificacion.
- `valor_hora` = sueldo_mensual / `horas_mes_base` (config · default 240). `monto_he25` = cant_he25 × valor_hora × 1.25; `monto_he35` = cant_he35 × valor_hora × 1.35. **(divisor a confirmar con Kelly)**.
- `asig_familiar` = si `empleados.asignacion_familiar` → 10% RMV (config `rmv`, ej. 1025 → 102.50), si no 0.
- **EsSalud** = 9% × total_bruto (config `pct_essalud`, reusa `configPlanilla`). *(verificado: 12,850→1,156.50; 6,000→540)*.
- **AFP** (si sistemaPension = AFP): `afp_aporte` = 10% × bruto (config); `afp_seguro` = pct_seguro × min(bruto, `tope_seguro_afp` config); `afp_comision` = pct_comision × bruto — pct_seguro/comision desde tabla `afpTasas` por AFP. *(verificado: aporte 10% exacto; seguro ~1.35% con tope)*.
- **ONP** (si sistemaPension = ONP): 13% × bruto (config `pct_onp`). *(verificado: 5,000→650; 2,900→377)*.
- `adelanto_cuota` = Σ cuotas de adelantos vigentes del empleado ese mes (auto).
- `total_descuento` = onp + afp_aporte + afp_seguro + afp_comision + impto_renta5ta + retencion_judicial + adelanto_cuota + otros_descuentos.
- `neto_pago` = total_bruto − total_descuento.
- `total_aporte` = essalud + essalud_vida.
- `costo_total` = total_bruto + total_aporte.

**Input de Kelly (no se auto-calcula en v1):** `impto_renta5ta` (lo trae de su cálculo anual), gratificacion, vacaciones, comisiones, bonificacion, dominical/feriado (cant), HE (cant), retención judicial, otros descuentos.
**Diferido (mejora):** helper de proyección de Renta 5ta anual (7 UIT + tramos, hoja "Cálculo Rta 5ta") — se documenta, no se implementa en v1.

**Snapshot**: al **calcular**, se congelan las tasas vigentes en `planilla_oficina_mes.tasas_snapshot`. Recalcular reusa el snapshot mientras el mes esté borrador/calculada; cerrar lo fija. Cambiar una tasa afecta meses futuros, nunca reescribe cerrados.

---

## 3. Tasas configurables (nunca hardcode)
- Reusa `configPlanilla` (pct_essalud, pct_onp) y `afpTasas` (pct_aporte/seguro/comision por AFP).
- Añadir a la config de oficina: `rmv`, `uit`, `tope_seguro_afp`, `horas_mes_base`, y (para el helper diferido) tramos Rta 5ta.
- Editable en pestaña **Configuración** (admin/contadora). Cambio → aplica a planillas futuras (snapshot protege las cerradas).

---

## 4. Contabilidad (motor WS1 · sin caminos paralelos)
Al **cerrar** (o pagar) el mes, genera 1 asiento por `planilla_oficina_mes`, `origen='planilla_oficina'`, `origen_id=planilla_mes_id`, idempotente:
- **Dr** cuenta de sueldos por cuenta contable (default 621, agrupado por `detalle.cuenta_contable` — reusa el patrón WS1 de agrupar) · obra_id null (oficina).
- **Dr** cargas empleador (627x EsSalud).
- **Cr** 40x por pagar (AFP/ONP/EsSalud/Renta 5ta) + **Cr** 41x remuneraciones por pagar (neto).
Cuenta manual editable por Kelly (WS1). Clase se deriva. Σdebe=Σhaber. Reusa `crearAsiento` + `cargarDerivarCtx`.

---

## 5. Boleta de pago + Trazabilidad (B)
- **Boleta**: genera la boleta por persona (formato del Excel: datos trabajador + REMUNERACIONES + APORTES Y DESCUENTOS + neto) como **PDF**, correlativo `BOL-1000xx`. Se guarda en NAS y se registra en `documento_adjunto (doc_tipo=boleta_pago, entidad=planilla_oficina_detalle)`.
- **Comprobante de pago**: al confirmar el pago, se sube el voucher/transferencia por persona → `documento_adjunto (doc_tipo=comprobante_pago)`.
- **Ruta NAS**: `/Administracion/Planilla/AAAA-MM/<DNI>/boleta.pdf` y `/comprobante.<ext>` (bajo `NAS_ROOT_ADMIN`).
- **Badge "falta comprobante"**: el detalle expone `docs: { boleta: bool, comprobante: bool }`; la grilla pinta verde/rojo. No bloquea el cierre contable, pero marca el pendiente (checklist antes de "pagada").

---

## 6. Asistencia (v1 · engancha con C)
Faltas/tardanzas que afectan el sueldo del mes se **ingresan manual** en el detalle (o vía descuento). Cuando se haga **C** (endpoint `POST /api/asistencia/huella` + edición manual), esa data alimentará `dias_trab`/descuentos automáticamente. Se deja el campo y el hook; NO se implementa zbiolink aquí.

---

## 7. Roles / gobierno
- Planilla de oficina + Asistencia: **solo admin + contadora**. Gate real en backend: matriz `role_modulo` módulo **`oficina`** nivel edición para planilla; **Asistencia además restringida a los roles admin y contadora** explícitamente. Hoy el back casi no gatea → se cierra para estas rutas. Front `can('oficina','edicion')`.
- Cierre de mes: audita (quién/cuándo). Reabrir mes cerrado → gate 423 + revierte cuotas de adelanto aplicadas (idempotencia).

---

## 8. IA de pestañas · Oficina
- **+ Planilla** (NUEVO): selector de mes → grilla (Bruto/Adelanto/Dscto/Neto/Docs) → Calcular → Cerrar (asiento) → boletas + comprobantes. Apartado **Adelantos** (préstamo con saldo) y **Descuentos**.
- **Personal** (antes "Personal admin"): ficha con los campos nuevos (cargo, sueldo base, AFP, cuenta, asig. familiar).
- **Asistencia**: se queda, **restringida** (admin/contadora). Revamp real = C.
- **Rendiciones**: sin cambios.
- **Profesionales**: sin cambios ahora; **se fusiona en Personal en D** (una ficha; flag "profesional" + colegiatura).

---

## 9. Endpoints (backend)
- `GET/POST/PUT /api/oficina/planilla?mes=` · crear/leer mes.
- `POST /api/oficina/planilla/:mesId/calcular` · calcula detalle (motor híbrido, snapshot tasas). Reemplaza detalle si borrador.
- `POST /api/oficina/planilla/:mesId/cerrar` · estado→cerrada + genera asiento (WS1) + genera boletas PDF a NAS + registra documento_adjunto.
- `POST /api/oficina/planilla/:mesId/reabrir` · gate 423 + revierte cuotas + anula asiento (contra-asiento).
- `GET/POST /api/oficina/adelantos?empleadoId=` · alta/lista de préstamos + saldo derivado.
- `POST /api/oficina/planilla-detalle/:id/descuento` · descuento suelto.
- `POST /api/oficina/documentos/upload` · sube boleta/comprobante a NAS + registra `documento_adjunto` (multipart, entidad_tipo+id+doc_tipo).
- `GET /api/oficina/planilla-detalle/:id/docs` · estado boleta/comprobante.
- Config: `GET/PUT /api/oficina/config-planilla` (rmv, uit, tope_seguro_afp, horas_mes_base) + reusa afpTasas/configPlanilla existentes.

## 10. Frontend
- `PlanillaOficinaTab` (grilla mes + calcular/cerrar), `AdelantosPanel` (préstamos + saldo), `BoletaOficina` (PDF), `<DocumentoAdjunto>` (subir/estado, reusable), extender `AdminForm` (Personal). Reusa `<CuentaContableSelect>` para la cuenta de costo (default 621).

## 11. Fases
1. **BE datos + motor**: migraciones (empleados +campos, planilla_oficina_mes/detalle, adelanto_oficina, descuento_oficina, documento_adjunto) + `planillaOficinaCalc` puro + endpoints calcular/cerrar + asiento WS1. Test: calcular con data del Excel → neto/costo cuadran vs boleta (Levano 6000→5222.80; García 12850→10272.39). Σ=Σ del asiento.
2. **BE trazabilidad**: upload NAS + documento_adjunto + estado docs + boleta PDF.
3. **FE**: PlanillaOficinaTab + AdelantosPanel + DocumentoAdjunto + Personal extendido. `tsc --noEmit`=0.
4. **Roles**: gate admin/contadora.

## 12. Invariantes / compatibilidad (no romper)
- Planilla de obreros (semanal) intacta — esto es un motor **paralelo mensual**, tablas nuevas, no toca `planillaSemanas/planillaDetalle`.
- WS1/WS-1 intactos; el asiento usa el motor existente.
- Tasas snapshot; meses cerrados inmutables (contra-asiento para revertir).
- Guard de entorno: migraciones solo en `erp_mmh_test` en esta fase.

## 13. Fuera de alcance
- **C**: integración zbiolink (huellero) + revamp asistencia (endpoint + edición manual). Se deja el hook.
- **D**: consolidar `profesionales` ↔ `empleados` en una sola ficha.
- Helper de proyección **Renta 5ta anual** (7 UIT + tramos) — v1 es input.
- PLAME/T-Registro export; boleta con firma digital.

## 14. Decisiones congeladas
1. Motor **híbrido** (auto lo mecánico desde config/afpTasas; Renta 5ta input; proyección diferida).
2. Tasas en **config editable** + **snapshot** por mes; cerrados inmutables.
3. Adelanto = **préstamo con saldo** (cuotas, saldo derivado, se auto-descuenta, comprobante en NAS).
4. Trazabilidad = tabla genérica **`documento_adjunto`** (boleta_pago + comprobante_pago por persona/mes) + badge "falta comprobante".
5. Contabilidad por el **motor WS1** (cuenta manual, sin caminos paralelos), `origen='planilla_oficina'`.
6. **Tabs**: +Planilla, Personal extendido, Asistencia restringida (admin/contadora), Rendiciones igual; Profesionales→Personal en D.
7. Motor **mensual paralelo** al de obreros (tablas nuevas, no reusa las semanales).
