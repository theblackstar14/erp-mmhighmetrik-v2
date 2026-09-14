# Rediseño planilla de obreros + conexión contable/PLE — diseño

Fecha: 2026-08-03 · Rama: feat/rbac-multiempresa · Estado: aprobado (a implementar)
Decidido con: LLM Council (2 rondas) + análisis de archivos reales de pago + brainstorming.

## Contexto y evidencia

Módulo de planilla de obreros (construcción civil, régimen D.S. 011-79-TR, semanal, por obra).
El motor `planillaCalc` ya calcula jornal/BUC/EsSalud/ONP/AFP/CONAFOVICER/Renta5/SCTR/SENCICO/neto.

**Archivos reales analizados** (SEMANA 05 Arequipa · SEMANA 01): son extractos de PAGO, no el
cálculo. Hacen `VLOOKUP` a una hoja `PLAME` externa (~54 cols A:BB) que es el motor real; jalan el
**neto** (col AW) + banco/cuenta para armar el **Telecrédito** (transferencia masiva BCP, multi-banco:
BCP/Nación/Interbank). Base del pago = **jornal diario × días por categoría** (Maestro 170, Operario
158.33, Oficial 125 × 6 días). La corrida semanal empaqueta obreros + proveedores + honorarios.
La hoja PLAME fuente NO está disponible aún → la fidelidad exacta del cálculo se difiere.

## Gaps verificados (del sistema actual)

1. SCTR/SENCICO se calculan pero NO se contabilizan (faltan en el asiento → faltan en PLE 5.1/6.1).
2. La mano de obra NO entra a `costos-obra` (CD): la planilla crea asiento, no gasto.
3. El pago del neto NO genera movimiento de caja (cuenta 10 vacía · mismo hueco del cutover).
4. No hay export Telecrédito ni PLAME.

## Decisiones de dominio (fijadas con el usuario)

- **Unidad atómica = asistencia diaria (obrero × día × obra)** ["parte diario lite", sin partida].
- **Obra imputada por día**, no atributo fijo del obrero. `Empleado.obraDefault` solo pre-llena el grid.
- **Pago/neto = uno por obrero/semana** (jornal × total días + conceptos − deducciones). Una
  transferencia, un `Cr 411`, una fila Telecrédito.
- **Costo (621/627x → CD) repartido por obra** proporcional a los días en cada obra (incluye aportes
  empleador EsSalud/SCTR/SENCICO = costo de MO). Débitos por centro de costo = obra.
- **MO → CD por lectura directa (read-through), NO creando gasto** → sin doble conteo.
- Export Telecrédito: se diseña ahora, se implementa después; botón "Exportar semana" visible ya.
- Alerta semanal "crear semana de planilla" vía motor de notificaciones existente.

## Modelo de datos

- `planilla_semanas` (existe): + asegurar `proyectoId` opcional (la obra real viene del detalle diario).
- **`planilla_asistencia`** (nuevo o extendido): una fila por **obrero × día**:
  `semanaId, empleadoId, fecha, obraId, tipoDia (completo|medio|falta_just|falta_injust|dm|feriado|descanso), horas, observacion`.
  Fuente única de días efectivos y de imputación de obra.
- `empleados`: + `obraDefault` (uuid, opcional, solo pre-fill).
- `planilla_detalle` (existe): el cálculo por obrero/semana (ingresos, deducciones, aportes, neto) —
  se conserva; `diasEfectivos` se deriva de `planilla_asistencia`.

## Cálculo (se conserva el motor; se ajusta el input)

- `diasEfectivos` por obrero = agregación de `planilla_asistencia` (completo=1, medio=0.5, dm/feriado
  según régimen). Reemplaza el conteo manual de días.
- Neto = jornal × diasEfectivos + conceptos − deducciones (misma lógica actual).
- **Reparto por obra** = por cada obra, díasObra / díasTotales × costo del obrero (jornal + aportes).
- Fidelidad legal exacta (BUC%, tasas, provisiones) → se afina cuando llegue el PLAME.

## Conexión contable/PLE (el foco)

1. **Asiento (motor `/generar`)**: agregar líneas **SCTR** y **SENCICO** (Dr 627x / Cr 40xx por pagar)
   — códigos exactos por confirmar con contadora. Los débitos de costo (621/627x) se **reparten por
   obra** (centro de costo = `proyectoId` en el asiento). Regla: el asiento debe cuadrar (Σdebe=Σhaber).
2. **`costos-obra` lee la MO de planilla** (read-through): suma la MO por obra/periodo desde
   `planilla_detalle` + reparto de `planilla_asistencia`, marcada origen "planilla". Sin gasto, sin
   asiento nuevo. Guard anti-duplicación si algún día se registra MO como gasto manual.
3. **Pago del neto → movimiento de caja**: al generar/pagar, el neto crea el egreso (multi-banco por
   obrero) → toca la cuenta 10 → conecta con conciliación bancaria. (Alineado al modelo de cutover.)
4. **PLE**: el asiento (ahora completo) ya fluye a 5.1 Diario / 6.1 Mayor.
5. **Export Telecrédito** (diseño; wiring posterior): por semana → filas DNI + banco + cuenta + neto.

## UI — 5 pestañas

- **Dashboard**: nómina semana, costo total, por obra/categoría, faltas, DM.
- **Trabajadores**: obreros con categoría/jornal + banco/cuenta + obraDefault.
- **Asistencia**: grid obrero × día (L-S), con **tipo de día** y **obra por día** (pre-llena obraDefault).
  Totales por cuadrilla. Es el dato clave.
- **Planilla**: boleta por obrero (ingresos/descuentos/neto + aportes/costo total con SCTR/SENCICO),
  totales por cuadrilla y gran total, **bloque de trazabilidad** (asiento generado, imputación CD por
  obra, link PLE), botón **Generar** (asiento + pago/caja) y botón **Exportar semana** (Telecrédito, wiring después).
- **Config**: jornales por categoría, %/tasas, cuentas 104x, cuentas contables de aportes.

## Alerta

- Motor de notificaciones: aviso semanal "crear semana de planilla" (cuando la semana en curso no
  tiene `planilla_semana`). Sin cron nuevo; se engancha al engine existente.

## Fuera de alcance (difere a "cómo lo ejecutan" + PLAME)

- Fidelidad legal exacta del cálculo (BUC% por categoría, tasas SCTR/SENCICO, dominical condicional,
  subsidio DM como 1411, feriados).
- **Provisiones** CTS 15% / gratificaciones / vacaciones (el consejo las marcó necesarias para que el
  CD y la liquidación sean reales → se añaden cuando se valide el PLAME).
- Costeo por **partida** (el parte diario ya deja el gancho; se añade partidaId al día después).
- **Export PLAME** SUNAT y wiring del Telecrédito (solo el botón entra ahora).

## Orden de implementación (del consejo · barato→caro)

1. Backend conexión (independiente de UI): SCTR/SENCICO al asiento + `costos-obra` read-through de MO.
2. Modelo `planilla_asistencia` diario + reparto por obra + días efectivos.
3. Pago del neto → movimiento de caja.
4. UI de las 5 pestañas sobre datos ya correctos.
5. Botón Exportar semana (placeholder) + alerta de creación de semana.
6. (Difere) provisiones, fidelidad PLAME, Telecrédito real, partida.
