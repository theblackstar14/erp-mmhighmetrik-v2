# Checklist de datos y documentos para la contadora

Fecha: 2026-07-27 · Para: puesta en producción del ERP + cierre de gaps contables/tributarios/planilla.
Prioridad: 🔴 crítico para lanzar · 🟡 importante · ⚪ complementario.

---

## A. Saldos de apertura (🔴 — es el trabajo que bloquea el lanzamiento)

El sistema arranca con un **asiento de apertura** al día de lanzamiento. Se necesitan los saldos
REALES al corte, por empresa (RUC):

- [ ] 🔴 **Caja y bancos** — saldo de cada cuenta corriente/caja al corte + **extracto bancario** de cada cuenta.
- [ ] 🔴 **Cuentas por cobrar** — clientes, detallado por obra; separar **retención de garantía** pendiente por obra.
- [ ] 🔴 **Cuentas por pagar** — proveedores, detallado; incluir detracciones/retenciones pendientes.
- [ ] 🔴 **Anticipos recibidos de clientes** — saldo por obra (adelanto directo/materiales no amortizado).
- [ ] 🔴 **Inventario** — existencias valorizadas al corte.
- [ ] 🔴 **Activos fijos** — registro con costo, depreciación acumulada y valor neto (para seguir depreciando).
- [ ] 🔴 **Patrimonio y resultados acumulados** — capital, reservas, resultados de ejercicios anteriores.
- [ ] 🟡 **Tributos por pagar / saldos a favor** — IGV, IR (pagos a cuenta / saldo a favor), ONP/EsSalud/AFP pendientes.
- [ ] 🟡 **Provisiones** — CTS, gratificaciones, vacaciones devengadas.

## B. Plan de cuentas / PCGE (🔴 — para que los asientos usen los códigos correctos)

- [ ] 🔴 **Plan de cuentas oficial** que usan hoy (Excel/PDF), con el nivel de subcuentas que manejan.
- [ ] 🔴 Confirmar **código de la cuenta de retención de garantía por cobrar** (propuesta del sistema: `1213` o `12125`).
- [ ] 🔴 Confirmar **cuenta de anticipos recibidos de clientes** (pasivo; propuesta: `46X`).
- [ ] 🔴 Confirmar **cuentas de cargas sociales del empleador**: SCTR por pagar, SENCICO por pagar, y las
      cuentas de costo `627x` (hoy el asiento de planilla omite SCTR/SENCICO).
- [ ] 🟡 Validar el **mapeo cuenta bancaria → cuenta contable 104x** ya cargado: BCP Soles `10411`,
      Scotiabank Soles `10441`, Caja Chica `10451` (y los de la otra empresa).
- [ ] 🟡 Criterio de **Costo Directo (CD) vs Gasto General (GG)** por tipo de gasto (para afinar la clasificación).

## C. Contratos y obras (🔴/🟡 — alimentan valorizaciones, garantías, adelantos, liquidación)

- [ ] 🔴 **Contratos de obra vigentes** (monto, plazo, cliente/entidad, fórmula de reajuste si aplica).
- [ ] 🔴 Por cada obra: **% y tope de retención de garantía** y el **hito que la libera** (recepción / consentimiento).
- [ ] 🔴 Por cada obra: **adelantos** (directo/materiales, %, monto, cómo se amortizan).
- [ ] 🟡 **Valorizaciones históricas** presentadas/aprobadas/cobradas por obra (para reconstruir el estado).
- [ ] 🟡 **Una liquidación de obra real ya practicada** (ejemplo completo) — para validar la fórmula del
      saldo final y los asientos de cierre antes de automatizarlos.
- [ ] 🟡 Estado de cobranza por obra (qué valorizaciones están cobradas y cuáles no).

## D. Planilla · construcción civil (🔴/🟡 — para el motor y los asientos)

- [ ] 🔴 **Jornal básico vigente** por categoría (operario / oficial / peón) — convenio FTCCP-CAPECO actual.
- [ ] 🔴 **Porcentajes vigentes**: EsSalud, ONP, AFP (aporte/comisión/seguro por AFP), CONAFOVICER,
      SENCICO, SCTR salud, SCTR pensión.
- [ ] 🔴 **BUC** (Bonificación Unificada de Construcción) y demás bonificaciones: altura, agua, riesgo,
      movilidad — % o montos vigentes.
- [ ] 🟡 Gratificaciones, CTS, vacaciones, asignación escolar — reglas de cálculo del régimen.
- [ ] 🟡 **Cómo declaran la planilla hoy**: PLAME / T-Registro (un archivo PLAME real de ejemplo, si lo tienen).
- [ ] 🟡 Pólizas **SCTR** vigentes (aseguradora, vigencia) por obra.

## E. SUNAT / tributario (🔴/🟡)

- [ ] 🔴 **RUC y razón social** de todas las empresas del grupo (MM, **MG**, y cualquier otra).
- [ ] 🔴 **Régimen tributario** de cada RUC (RER / RMT / General) y **actividad económica**.
- [ ] 🔴 **MG — ¿tiene obras o no?** (define si usa el módulo de obras o solo contabilidad/gastos corporativos).
      Incluir sus cuentas bancarias y saldos de apertura.
- [ ] 🟡 **Un juego de PLE real aceptado por SUNAT** (Diario 5.1, Mayor 6.1, Compras 8.1, Ventas 14.1) — para
      validar que nuestro formato coincide campo a campo.
- [ ] 🟡 **Un archivo SIRE real** (RVIE ventas / RCE compras) aceptado — mismo fin de validación.
- [ ] 🟡 **% de detracción** por tipo de servicio que aplican (construcción, etc.) y régimen de retención/percepción IGV si aplica.
- [ ] 🟡 **Series de comprobantes** por empresa/obra y **cómo emiten** (facturador SUNAT / OSE).
- [ ] ⚪ Cronograma de vencimientos (último dígito de RUC) por si se automatizan alertas.

## G. Set de validación — conciliación bancaria de UN mes (🔴 — para pruebas end-to-end)

Elegir **un mes representativo y una cuenta bancaria operativa** (la de mayor movimiento) y entregar
TODO lo de ese mes, para probar el flujo completo: importar extracto → auto-match → conciliar → cuadrar.

- [ ] 🔴 **Estado de cuenta bancaria completo del mes** (extracto): todos los movimientos con fecha,
      monto, glosa/descripción y **saldo inicial y final**. En Excel/CSV si es posible (mejor que PDF para importar).
- [ ] 🔴 **Planilla completa de ese mismo mes**: todas las semanas, todos los obreros, con **neto pagado**,
      **fecha y forma de pago** (cómo salió del banco: transferencia masiva, cheques, etc.).
- [ ] 🔴 **Comprobantes y pagos de ese mes** (compras pagadas, valorizaciones cobradas, otros egresos/ingresos)
      — para que la conciliación tenga las dos patas: lo del banco vs lo del sistema.
- [ ] 🟡 Cómo pagan la planilla operativamente (un abono total al banco, o uno por obrero) — afecta cómo
      se cruza el pago de planilla contra el extracto.

**Objetivo:** validar que (1) el extracto importa bien, (2) los pagos de planilla y de proveedores del
sistema hacen match automático contra el extracto, (3) el saldo del banco cuadra con la cuenta 104x, y
(4) queda expuesto cualquier descuadre real. Es la prueba de fuego antes de operar en producción.

## F. Otros (⚪)

- [ ] ⚪ Declaraciones juradas del último ejercicio (para cuadrar saldos de apertura y arrastre de IR).
- [ ] ⚪ Detracciones — saldo en la cuenta de detracciones (Banco de la Nación) al corte.
- [ ] ⚪ Cualquier **cuenta de orden** o control que lleven fuera del sistema.

---

### Lo mínimo para arrancar (si hay que priorizar)
1. Saldos de apertura (A) por empresa.
2. Plan de cuentas + los 3-4 códigos a confirmar (B).
3. Datos de MG: obras sí/no + RUC/régimen (E).
4. Jornal y % vigentes de planilla (D).

Con eso se ejecuta el runbook de lanzamiento; el resto (PLAME, validación PLE/SIRE, liquidación real)
entra en paralelo.
