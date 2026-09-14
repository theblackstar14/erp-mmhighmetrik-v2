# Roadmap rediseño de formularios — v2 (post LLM Council)

Fecha: 2026-08-07 · Base: 3 transcripciones (Kelly contable · Mario dueño) + archivos reales + veredicto LLM Council.
Data: de PRUEBA por ahora. Prioridad cliente: financiero+contable, go-live ~2 semanas.

## Decisiones de modelo (FIJADAS — de aquí cae todo lo demás)
1. **La unidad atómica es el ASIENTO.** Compras, ventas, bancos, planilla, cajas = **plantillas de asiento** (patrón débito/haber precableado) sobre UNA tabla asientos/líneas. El formulario elige plantilla y precarga divisionarias; Kelly corrige.
2. **`cuenta_contable` es el eje.** Se asigna MANUALMENTE en todo (Kelly siempre la determina — es el hecho real del negocio).
3. **CD/GG se DESTRONA → pasa a DERIVARSE de la cuenta** (mapa `cuenta → clase CD/GG_OBRA/GG_CORP`). Ya no es clasificación primaria; es atributo derivado. La clasificación primaria es la cuenta contable.
4. **Dimensión obra/centro de costo en CADA línea de asiento** → habilita reportes y EE.FF por obra casi gratis.
5. **`empresa_id` en el asiento (multi-empresa Doratta+MM) desde ahora** — decisión de esquema gratis ahora, carísima de retrofittear.
6. **Invariante de guardado: Σdebe = Σhaber.** Anulación = contra-asiento (no edición), coherente con H1/H2. Idempotencia por hash (un registro = un asiento).

---

## WS-1 · Migración de saldos de apertura 🔴 (BLOQUEADOR día-1 · lo omitía v1)
Sin esto, los reportes del día 1 (CxC/CxP, banco, 104x) salen falsos.
- [ ] Asiento de apertura por empresa: caja/bancos, por cobrar (con retención), por pagar (proveedores/planilla/préstamos), inventario, activos, patrimonio, detracciones pendientes.
- [ ] Carga masiva desde Excel (su formato) — proveedores/clientes/saldos.

## WS0 · Modelo asiento + catálogos + data prueba
- [ ] Tabla `asiento_plantillas` (patrones débito/haber por tipo de operación) + `cuenta_contable`+`obra`+`empresa_id` en líneas.
- [ ] Mapa `cuenta → clase CD/GG` (para derivar, ya no clasificar).
- [ ] Seed **detracciones (89 códigos)** + retenciones. Divisionarias (crear subcuentas en el plan).
- [ ] Data de prueba coherente (1-2 empresas, proveedores, clientes, proyectos+OF000x, un mes de compras/ventas/bancos/planilla).

## WS1 · Cuenta contable MANUAL en todo form 🔴 (CARRIL PARALELO, no bloquea captura)
- [ ] [BE] `cuenta_contable` + `cuenta_contable_origen` en gastos/movimientos/ventas/planilla_detalle. `obra`+`empresa_id` en líneas.
- [ ] [BE] `GET /contabilidad/plan?q=` autocomplete de cuentas+divisionarias.
- [ ] [FE] `<CuentaContableSelect>` compartido → inyectar en MovModal/GastoForm existentes (no rehacer). Prefill sugerido (por proveedor/tipo), editable. **Recuerda la última cuenta usada con ESE proveedor.**
- [ ] [BE] Motor usa `cuenta_contable` manual cuando existe; CD/GG se deriva de ella (mapa).
- [ ] Bancos: selector = todo elemento 1 (cuentas 10 + divisionarias).

## WS2 · Compras (devengado) + Bancos jala compra → SIRE/RCE
- [ ] [FE] Pestaña **Compras**: form registro (Fact de Compras 23 campos) + cuenta contable + tipoGasto + **inventariable aquí** + **pago parcial** (saldo pendiente).
- [ ] [BE] **IGV/crédito fiscal separado** (base/IGV/exonerado/no gravado); validar detracción vs crédito.
- [ ] [BE/FE] **Notas de crédito/débito** (sin ellas RVIE/RCE se rechaza).
- [ ] [FE] Bancos/Egreso modo **"pagar compra registrada"** (busca por proveedor/factura → jala → solo movimiento ligado por `gastoId`, guard anti-doble-conteo).
- [ ] [BE] Export **libro compras → TXT SIRE/RCE** validado contra el **validador real SUNAT** + `SIRE OCTUBRE.xlsx` (80 col).

## WS3 · Ventas → RVIE
- [ ] [DB/FE] Tabla `ventas` + form con detalle (ítems/IGV/descuentos/**anticipos**/detracción) + **TC USD/diferencia de cambio** + NC.
- [ ] [BE] Asiento venta (12x/70x/40x) + export **RVIE TXT** validado.

## WS4 · Bancos / N° operación / Cajas
- [ ] [FE] **N° de operación** requerido+visible. **Comprobante NO obligatorio**.
- [ ] [DB/FE] **Cuenta detracciones (Banco de la Nación)** propia.
- [ ] [FE] **Cajas/rendiciones** rediseñadas: **liga egreso existente por n° op** + encargado del roster + items **jalan factura por proveedor** + cuenta contable + renombrar "Cajas" + por proyecto (requerido). (Adapta el módulo rendiciones existente, ~80% hecho.)

## WS5 · Conciliación bancaria — cuadre (Fase 1)
- [ ] [BE] `GET /conciliacion/cuadre?cuenta=&periodo=`: saldo extracto (calculado: inicial+Σsigno, el extracto real no trae saldo) vs Σ(debe−haber) cuenta 104x + partidas en tránsito.
- [ ] [FE] Panel cuadre read-only (3 números + 2 listas + badge). Fase 2: crear-mov-desde-línea (ruido), guards.

## WS6 · Planilla — MODO REGISTRO
- [ ] Cargar `ParamPlanilla` con SUS jornales all-in ("Operario 1"=158.33). Modo registro (ingresar montos) + cuenta contable.
- [ ] Planilla oficina (mensual: HE 25/35, asig fam, grati, vaca, Rta 5ta, Essalud) + honorarios + personal por fuera (gasto 63).
- [ ] Fecha ingreso/baja + dar de baja. Gasto "planilla/SCTR" jala trabajadores.

## WS7 · Reportes por cuenta + PLE (alto valor, bajo costo)
- [ ] [BE] Reportes por cuenta: CxC (12x), CxP (42/45/41), detracciones, **utilidad por obra** (dimensión obra). Export Excel.
- [ ] [BE] **Exportador PLE 5.1 Diario / 6.1 Mayor** (casi gratis: caja ya en el libro + todo por cuenta) → el ERP se vuelve el "libro vivo" que reemplaza al estudio para reportes.

## Transversal · UX diaria (o Kelly vuelve al Excel)
- [ ] **Anular/corregir tras guardar** con motivo (contra-asiento, no borrar) — coherente H1/H2.
- [ ] **Plantillas / asientos recurrentes / "duplicar último"** (el 80% se repite).
- [ ] **Velocidad de teclado**: Tab entre campos, Enter guardar-y-seguir, autocompletar RUC→razón, fecha default hoy.
- [ ] **No doble tipeo**: compra→pago→detracción→CxP se alimentan.
- [ ] **Buscador** por RUC/monto/n°op/comprobante + adjunto PDF/foto.
- [ ] **Cerrar mes**: botón que valida (debe=haber, banco conciliado) y avisa QUÉ falta.

## Gobierno · permisos / periodo / auditoría
- [ ] Rol: **solo Kelly asigna/aprueba cuenta** (si obrero/almacén elige, ella reclasifica todo).
- [ ] Reasignar cuenta en periodo cerrado/conciliado → gate 423 + **audit_log del cambio de cuenta**.

## Operacional (antes/durante go-live)
- [ ] **QA con data REAL** (no de prueba) antes del go-live.
- [ ] **Capacitación a Kelly** + guion de captura diaria.
- [ ] Backup/rollback + verificar guard de periodo (H1/H2).

---

## Corte realista (el consejo: 2 semanas NO alcanza para WS0-WS7)
**Sprint 1 (go-live base caja/registro, ~2 sem):** WS-1 (apertura) + WS0 (modelo+data) + WS2 (captura compra/gasto) + WS4 (bancos n°op+cajas) + WS5 (cuadre). **WS1 en paralelo** (inyectar cuenta editable en forms existentes, corregir después). Con esto Kelly **registra y paga el día a día**.
**Sprint 2:** tributario (SIRE/RVIE/NC/numeración), WS3 ventas, WS7 reportes+PLE, WS6 planilla oficina/honorarios.
**Fast-follow:** provisiones (48), préstamos entre empresas, dashboard móvil, gastos proyectados, predicción de caja.
**Diferido:** EE.FF (NIF+estudio externo, aunque el motor de asientos ya lo habilita), guía remisión, panel fotográfico, SEACE/CAC.

## Ajustes a lo ya construido
1. **Egreso unificado** → Compras (devengado) separado + Bancos jala compra.
2. **CD/GG DESTRONADO** → se deriva de la cuenta (mapa cuenta→clase); la cuenta manual es primaria.
3. **Planilla revamp** → +modo registro +jornales all-in +oficina/honorarios.
4. **Detracciones** 4 → 89.
5. **Asiento** pasa a ser unidad con `cuenta_contable`+`obra`+`empresa_id` en cada línea.
