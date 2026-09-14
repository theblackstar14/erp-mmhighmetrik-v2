# ERP MM HIGH METRIK · Documento de Alcance

> Fuente única de verdad del alcance. Ante cualquier duda de "¿esto va o no va?", manda este doc.
> Estado: **borrador para revisión** (dev + PM). Fecha: 2026-07 · rev. 1

---

## 1. Norte del sistema

**Conectar ingeniería con finanzas.**

El ERP existe para que la ejecución de obra (valorizaciones, avances, hitos, garantías) y el dinero (caja, contabilidad, tributario) hablen el mismo idioma y sean auditables. **NO** es un sistema para gestionar la operación diaria de obra "hasta el último clavo".

Consecuencia práctica: ante dos features, priorizamos la que **une obra ↔ plata**; postergamos o eliminamos la que solo gestiona recursos/almacén/logística fina.

---

## 2. Principios de diseño (no negociables)

1. **El Excel manda.** La valorización real (Excel/S10) es la verdad del monto. El sistema *muestra y deriva*, nunca recalcula lo que la entidad ya aprobó (ej. reajuste/IU).
2. **Movimiento = única verdad de caja** (modelo 104x). Congelado hoy (ver §6).
3. **Registro inmutable.** Toda acción de creación/edición/borrado/override queda en `audit_log` con actor, antes/después y motivo.
4. **Multi-empresa** (grupo, un dueño: MM + MG). RBAC dinámico por empresa. `empresa_id` por fila.
5. **Simplicidad sobre completitud.** Preferimos quitar un cálculo dudoso a mantener uno que genere data incorrecta.

---

## 3. Dentro del alcance (CORE — el puente ingeniería↔finanzas)

- **Proyectos**: KPIs por proyecto (utilidad, avance), valorizaciones, hitos (desde .mpp), garantías, retenciones. Curva S / avance físico.
- **Valorizaciones**: parseo del Excel, montos, retención de garantía, reajuste/IU **mostrado** desde el Excel (condicional, sin calcular).
- **Finanzas**: tesorería, movimientos, cuentas por cobrar/pagar, conciliación bancaria, flujo de caja.
- **Contabilidad**: plan contable (PCGE), libro diario/mayor, fiscal (IGV/Renta), PLE SUNAT, cierres.
- **Consorcios**: participación % por proyecto → derivar la parte de MM en cobranza/garantías (ver §5).
- **Configuración/Seguridad**: usuarios, roles+permisos por empresa+módulo, empresas, registro de auditoría.
- **Soporte que alimenta finanzas**: Inventario como **registro de valor** (activos+depreciación, consumibles=costo de compra), Planillas (costo de mano de obra), Oficina (rendiciones), Logística (OC/OS).

---

## 4. Fuera del alcance (eliminar o no construir)

- **Gestión granular de almacén**: kardex de consumibles, traslados obra→obra, consumo "clavo a clavo". → Inventario es registro de valor, no operación de almacén.
- **RFID** (Logística). Se reemplaza por QR / código de barras.
- **IU INEI como cálculo** (fórmula polinómica / reajuste calculado). Solo se **muestra** lo que trae el Excel.
- **Catálogo de Recursos** (Logística) y el concepto de "recursos" dentro de obra.
- **Contabilidad de obra granular** por cronograma. La obra cambia y no sigue el plan; solo trazamos valorizaciones/hitos/garantías/retenciones y los Excels.
- **Libro de reparto entre socios de consorcio** (quién debe a quién, distribuciones). Solo se modela la participación de MM.

---

## 5. Casos de uso clave (decididos)

### 5.1 Consorcios
Modelo ya parcial en schema: `proyectos.pctParticipacionPropia` (0.5 = 50%, default 1.0 = MM 100%) + tabla `consorcios_integrantes`. Hoy **ningún** proyecto está marcado como consorcio (todos 100% MM).

- **El % es guía SOLO del lado del ingreso** (lo que entra a MM): valorizaciones, liquidaciones, garantías. **Los gastos NO llevan lógica de consorcio** — MM registra su parte a mano en compras, sin justificar ni aplicar %.
- **Cobranza de valorización** (al marcar `cobrada` + adjuntar factura al consorcio):
  1. El sistema **pre-calcula el sugerido** = `total_valo × %` (ej. 100 × 50% = 50) y muestra "cobrar 50" + **Aceptar**.
  2. El monto real **siempre es editable**; un admin puede ajustar → exige **motivo** + audit.
  3. Se guardan **sugerido + real** (+ motivo si difieren). Trazabilidad: "correspondía 50 por el 50%, se registró X".
- **El % es guía, no verdad.** La verdad es lo que el usuario confirma → el cobro real (y su movimiento de caja) = lo confirmado, no un forzado por %. Por eso **ni roza el freeze 104x**.
- **Aplica a:** valorización (cobro), liquidación (cobro final), garantía (retención + devolución; el "cuándo" lo da el hito de liberación). **NO** a gastos/compras.
- **Utilidad MM** = `ingreso MM (lo cobrado) − gastos MM (lo registrado)`. Sin matemática de consorcio en el costo.
- **UI:** badge "Consorcio · 50%" en el proyecto y junto a los montos (evita confundir "cobrar 50" con "valo de 50").
- **Bonus:** al guardar la factura, se captura **serie/número** → alimenta el PLE de ventas (hoy con placeholder).
- **DECIDIDO:** costos = números reales de MM, sin reparto ni % (el libro de reparto entre socios queda FUERA, §4).

### 5.2 IU / Reajuste
- Se **muestra** desde el Excel de valorización si viene (no todas las valos lo traen → condicional; si no viene, N/A). **Nunca se calcula.**
- Se derivan insights simples ("reajuste = X% del monto"), sin recomputar.

### 5.3 Valorizaciones · hitos · garantías (base)
- Valo: parseo Excel → monto, avance, retención de garantía por valo + acumulada hasta tope, neto a pagar.
- Hitos: desde el .mpp del cronograma.
- Garantías: monto retenido por valo + **KPI de garantía acumulada**.

### 5.4 Reconocimiento de ingresos — **DEVENGADO** (decidido 2026-07-18)
- El **ingreso** de una valorización se reconoce contablemente cuando se **APRUEBA** (percepción del ingreso / conformidad de supervisión), **no** cuando se factura. Estados que generan el asiento de venta `70/12/40111`: `aprobada · conformidad_supervision · facturada · cobrada`.
- **Distinción clave**: el asiento de venta es **devengo**; el **PLE Registro de Ventas 14.1** es por **comprobante** → ese sigue tomando solo `facturada/cobrada`. No hay doble conteo de IGV: el asiento se genera una sola vez por valo (dedupe por `origenId`); el PLE lee las valos facturadas directo. Ambos deben conciliar el mismo IGV.
- El **cobro** (asiento de caja `104x/12`) sigue atado a `cobrada` y al freeze 104x (§6) — el devengo del ingreso no lo toca.
- **A validar con la contadora**: sub-cuenta exacta del receivable devengado-no-facturado (hoy usa `1212`) y el momento del IGV débito. Marcado para el primer mes real.

---

## 6. Estado del modelo financiero 104x (CONGELADO)

Hasta tener un mes real ERP↔extracto de la contadora, el modelo caja/104x queda **congelado**:
`CUTOVER=null · PARALLEL=true · ownership legacy · v1 gobierna · v2 read-only (no gobierna GO) · sin flip`.

Dos líneas separadas:
- **Línea A · `erp_mmh`** — producto/demo (RBAC, dashboards, UX, revisión de contadora).
- **Línea B · `erp_mmh_f4d`** — validación técnica (shadow/readiness reales sobre 2026-04).

Nada de flip/ownership/gating hasta: mes real alineado → ground-truth del clasificador → parallel-run → GO explícito.

---

## 7. Prioridad y pendientes por módulo (del PM, ordenados por el norte)

**Proyectos** (núcleo): utilidad por proyecto · avance por proyecto · consorcios · retención por valo + KPI garantía acumulada · botón "ver avances desde Excel" · plantillas de valorización · residente consulta valos diarias/semanales · mejorar gráfico mensual · **simplificar (quitar cálculos innecesarios, ej. apartado OC/OS)** · revisar códigos compartidos entre colegios.

**Finanzas** (núcleo): reordenar dashboard · selector de gráficos · corregir conciliación (con data real) · mostrar solo lo relevante · movimiento por socio · mejorar reportes y flujo proyectado.

**Contabilidad** (núcleo): plan contable · conciliación · revisar enlace con planillas · PLE.

**Inventario** (soporte · registro de valor): buscador multi-criterio · ajustes chicos. *(La "suma por OC/OS" es de Proyectos → hold, luego quitar.)*

**RRHH/Planillas** (soporte): diseño · cálculo semanal · export pagos (diario/semanal/total) a Excel · número de cuenta bancaria · formato básico de planilla.

**Oficina** (soporte): alerta monto mensual por pagar · quitar redundancia del dashboard · simplificar.

**Logística** (soporte): **eliminar RFID** · QR/código de barras · mejorar impresión de etiquetas · **eliminar IU INEI (cálculo) y catálogo Recursos**.

**Configuración**: cambiar de empresa solo usuarios autorizados · NAS organizado por empresa · registro de todas las acciones *(hecho: tab Registro)*.

**Licitaciones / SEACE**: completar módulo · integración SEACE. *(Hoy son stubs; evaluar si entran o se ocultan del nav.)*

**Reportes**: informe general del ERP · export a Excel · buscador con filtros avanzados.

**Casos de uso a documentar**: Personal · Proyectos · Contabilidad · flujo general del sistema.

---

## 8. Supuestos y decisiones abiertas (confirmar con PM)

1. ~~Costos de consorcio~~ **CERRADO**: el % es solo guía de ingreso; los gastos son números reales de MM, sin % ni reparto.
2. **IU/reajuste**: ¿qué valos reales lo traen en el Excel? (define si hay algo que mostrar).
3. **Códigos por colegio**: hoy `1 inversión (CUI) → N colegios`. Separar códigos ¿rompe el rollup de inversión? Confirmar antes de tocar.
4. **Licitaciones/SEACE**: ¿en alcance corto plazo o se ocultan hasta después?
5. **Apartado OC/OS en Proyectos**: hold → confirmar si se quita en la próxima pasada.

---

## 9. Secuencia de ejecución sugerida

1. **Este doc** aprobado por PM (ancla todo).
2. **Consorcios** (esConsorcio + participacionPct + cobranza con parte-MM + override auditado). Autocontenido, no toca el freeze.
3. **Limpieza segura** (eliminar RFID · IU-cálculo · catálogo Recursos · apartados muertos).
4. **Proyectos**: KPIs (utilidad/avance) + IU display + garantía acumulada.
5. **Validación financiera** (data-gated): al llegar el mes real de la contadora → conciliación, libros, PLE, clasificador.
