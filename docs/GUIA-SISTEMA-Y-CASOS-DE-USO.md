# ERP MM HIGH METRIK — Guía del sistema y casos de uso

> Documento autónomo para presentar y operar el ERP. No requiere acceso al chat.
> Empresa constructora peruana (grupo multi-RUC). Ingeniería ↔ finanzas ↔ contabilidad en un solo sistema.

---

## 1. Speech de presentación (para el gerente y la contadora)

**Qué es.** Un ERP hecho a la medida de una constructora peruana. Une en un solo lugar tres mundos que normalmente viven en Excel separados: **la obra** (contrato, valorizaciones, avance, planilla), **las finanzas** (caja, cobranzas, pagos, garantías) y **la contabilidad** (PCGE 2020, PLE para SUNAT, IGV/Renta). La idea central: **se captura el dato una sola vez, donde ocurre, y el sistema arma solo la contabilidad y los reportes.** Nadie vuelve a teclear asientos.

**Para quién.**
- **Gerencia** ve el negocio de una mirada: cuánto vale la cartera, cuánto se está ganando por obra, dónde hay riesgo, cuánta caja hay. Todo de solo lectura, sin tocar nada.
- **La contadora / administración** opera: registra gastos e ingresos, arma la planilla semanal, carga valorizaciones, genera los asientos, concilia el banco y cierra el mes.

**La promesa.** Una obra deja de ser una carpeta de Excel. Cada gasto que se registra sabe a qué obra pertenece, si es Costo Directo o Gasto General, y aparece automáticamente en el resultado de esa obra y en la contabilidad de la empresa. La planilla de construcción civil se calcula con las tasas del régimen (jornal por categoría, BUC, CTS, gratificación, EsSalud, SCTR, SENCICO, CONAFOVICER) y se contabiliza sola. El banco se concilia contra el libro con un semáforo que dice si cuadra. Y al cerrar la obra hay un checklist que no deja cerrar si falta algo (liquidación, consentimiento, retención).

**Por qué importa.** Menos errores, menos doble digitación, trazabilidad completa (quién hizo qué y cuándo), y cumplimiento tributario (PLE) sin trabajo extra. El dueño ve la utilidad real de cada obra **hoy** (devengado) y **proyectada al cierre** (EAC), que no son el mismo número — y el sistema los muestra por separado para no engañar.

---

## 2. Los casos de uso (cómo hacer cada uno, paso a paso)

Login: `admin@mmhighmetrik.com`. El menú lateral tiene los módulos; arriba a la derecha, en varios módulos, hay un **selector de obra** y el botón **Registrar movimiento**.

### UC1 · Dashboard (gerencia)
**Objetivo:** foto del negocio.
**Pasos:** entrar a **Dashboard**. Se lee, no se edita.
- **Cartera total** = suma de contratos de obras activas.
- **Salud CPI/SPI** = semáforo de costo/plazo (crítico / observación / saludable).
- **Avance físico** = % ejecutado promedio.
- **Flujo de caja consolidado** = ingresos vs egresos por mes (toggle Día/Mes/Año/Total). Click en el gráfico desglosa.

### UC2 · Proyectos / detalle de obra
**Objetivo:** ver y gestionar una obra.
**Pasos:**
1. **Proyectos** → filtros (Todos / En ejecución / Licitación / Liquidación / Cerrados).
2. Abrir una obra → 8 pestañas: **Resumen · Partidas · Cronograma · Avance · Financiero · Contractual · Equipo · Documentos**.
3. **Resumen:** contrato, costo directo, **costo ejecutado** (CD + GG obra real), **resultado real** (valorizado − costo real, devengado a hoy), avance, días restantes, curva S, hitos, equipo, alertas.
4. **Financiero (Económico):** la utilidad protagonista es la **Utilidad al cierre (EAC)** = proyección a fin de obra; abajo el **Resultado de obra** = real devengado a hoy. **Son distintos a propósito.** También ingresos/cobranza, costos por rubro, retención garantía y flujo de caja proyectado.
5. **Contractual:** cierre de obra (checklist), hitos, **garantías** (cartas fianza / retención), **adelantos**, **liquidación de obra**.

> Regla clave que el sistema respeta: **Costo Directo (CD)** = lo que entra a la partida (materiales, mano de obra, equipo). **Gasto General (GG)** = indirecto de obra (guardianía, etc.). El resultado de obra = valorización − CD − GG_obra.

### UC3 · Registrar egreso / gasto (finanzas)
**Objetivo:** capturar una compra o servicio, y que quede clasificada y contabilizable.
**Pasos:**
1. **Finanzas → Registrar movimiento**.
2. Elegir **Egreso**.
3. **¿Qué tipo de egreso?**
   - **Gasto o compra** → clasifica CD/GG y es costo de obra u oficina.
   - **Movimiento financiero** → préstamo, pago de deuda ya registrada, impuesto (NO crea gasto).
4. **Tipo de gasto** (27 opciones = la plantilla maestra de la empresa) + **Estado de pago**:
   - **Pagado** = crea el Gasto **y** el Movimiento de caja.
   - **Pendiente** = crea solo el Gasto (queda como Cuenta por Pagar).
5. Elegir **obra** → aparece "¿A qué parte de la obra?" (**Costo Directo / GG Obra**, con sugerido automático) y el **widget de saldo de la obra** (cuánto CD queda). Sin obra → **GG_CORP** (gasto corporativo) automático.
6. (Opcional) **Repartir entre varias obras (prorrateo):** un mismo comprobante se divide en N obras; el sistema valida que la suma = total del comprobante y crea N gastos ligados por una referencia común.
7. **Comprobante** (8 tipos = plantilla) + serie/número. Guardar.

### UC4 · Valorizaciones y liquidación (contractual)
**Objetivo:** facturar avance de obra y liquidar al final.
**Pasos (valorización):** en la obra, cargar la valorización del periodo → facturar → el sistema captura el comprobante electrónico (va al registro de ventas / PLE 14.1) → marcar cobrada cuando entra la plata.
**Pasos (liquidación de obra, Fase 1):** Contractual → **Liquidación de obra** → "Practicar liquidación". Calcula el **saldo final** (facturado c/IGV − ya cobrado), congela un snapshot con hash, y muestra la conciliación con el libro (cuenta 1212). Se puede **reabrir** con motivo (queda auditado). *Fase 1 = solo cálculo, sin asientos.*

### UC5 · Planilla de construcción civil (personal)
**Objetivo:** pagar a los obreros según el régimen y que sume al CD de la obra.
**Pasos:**
1. **Personal** → seleccionar obra.
2. **Asistencia → Nueva semana** (lunes a domingo).
3. Marcar asistencia: click en la celda cicla el estado (**P** normal, **T** tardanza, **F** falta injustificada, **J** justificada, **DM** descanso médico, **FT** feriado trabajado, **V** vacaciones, **D** dominical). "Marcar todos normales" llena lun-sáb.
4. **Obra del día:** cada obrero puede imputar sus días a **distintas obras** (reparte su costo entre obras).
5. **Planilla →** ingresar **H.E. 60% / 100%** y **adelantos** → **Calcular planilla**.
6. Revisar totales (bruto, descuentos, neto, aportes empleador, **costo total**) y la **boleta** individual. **Exportar semana**.
7. El costo va al **CD de la obra** (mano de obra) y se contabiliza (ver UC6).

> **El Dashboard de Personal es consolidado (todas las obras)** — no depende del selector de obra. Los tabs Asistencia/Planilla sí filtran por obra.

### UC6 · Contabilidad (PCGE / PLE)
**Objetivo:** convertir los documentos operativos en asientos y reportes SUNAT, sin teclear.
**Pasos:**
1. **Contabilidad → Libro Diario**.
2. El banner muestra **documentos sin contabilizar** (gastos, pagos, valos, cobros, planillas).
3. **Generar** → el motor crea los asientos. Es **incremental** (solo lo nuevo) e **idempotente** (no duplica). Cada asiento se valida **cuadrado** (debe = haber) y con cuentas que existen en el plan.
4. Ver **Libro Mayor** (saldos por cuenta), **Bancos y Conciliación**, **Fiscal (IGV/Renta)**.
5. Un asiento nunca se borra: se **anula** (queda registro).
6. Todo fluye al **PLE 5.1 (Diario) / 6.1 (Mayor)** para SUNAT.

### UC7 · Conciliación bancaria
**Objetivo:** que el banco cuadre con el libro.
**Pasos:**
1. **Finanzas → Conciliación** → elegir **cuenta** y **periodo**.
2. **Importar** el extracto (Excel del banco).
3. El panel responde **¿está cuadrado?**: compara **saldo banco (extracto)** vs **saldo libro (cuenta 104x)**, marca **✓ Cuadrado / X Descuadrado**, y si el extracto **no cuadra consigo mismo** lo avisa (columna de saldo vs saldo calculado).
4. Las partidas pendientes se clasifican solas: **Libro → Banco (en tránsito)** y **Banco → Libro (ITF / comisiones / intereses)**, con **antigüedad por colores** (verde 0-7d, ámbar 8-30d, rojo >30d).
5. **Auto-match** empareja lo obvio; el resto se concilia a mano. Objetivo: llegar a **100% conciliado** antes de cerrar el mes.

### UC8 · Cierre de obra
**Objetivo:** cerrar formalmente una obra.
**Pasos:** Contractual → **Cierre de obra**. El checklist (culminación, recepción, liquidación practicada, consentimiento, adelantos amortizados, garantías devueltas, **retención liberada**, valorizado 100%) tiene un **gate duro**: el botón "Cerrar obra" solo se habilita si se cumplen los ítems obligatorios. La **retención** solo cuenta como liberada cuando hay **consentimiento de la liquidación** (es el disparador legal de su devolución).

---

## 3. El motor contable (cómo funciona por dentro)

- **Fuente única de la verdad = el documento operativo.** Un gasto, una valo, una planilla o un movimiento de caja generan su propio asiento; no se digita contabilidad.
- **Generación automática, incremental e idempotente.** "Generar" recorre los documentos del periodo que aún no tienen asiento (`origen:origenId`) y los crea. Volver a generar no duplica. Anular un asiento lo saca del set → se puede regenerar.
- **Validación dura.** Cada asiento exige ≥2 líneas, **debe = haber** (tolerancia de redondeo S/0.50; si sobra ≤0.50 se agrega línea 659/759 de ajuste), y que **todas las cuentas existan en el PCGE**.
- **PCGE 2020 jerárquico.** Saldo del padre = Σ de los hijos (ej.: cuenta 104 = BCP + … − Caja Chica).
- **Mapeos automáticos:**
  - **Compra/gasto** → 60/63 (gasto por naturaleza) + 40111 (IGV crédito) contra 42 (por pagar) o 10 (caja si pagado).
  - **Valorización** → 12 (por cobrar) / 70 (venta) / 40111 (IGV débito).
  - **Planilla CC** → **621** remuneraciones + **627x** cargas patronales (**6271** EsSalud, **6273** SCTR, **6279** SENCICO) contra **40xx** tributos por pagar (4031/4032/4033/4034/407/4039), **40173** renta 5ta, **469** adelantos/sindical y **411** neto por pagar. Imputado al **CD de la obra**.
  - **Movimiento de caja** (bajo cutover) → nace de la cuenta 104x real.
- **Cutover 104x.** Config `MOVIMIENTOS_104X_PARALLEL` / `MOVIMIENTOS_104X_CUTOVER`. Antes del cutover manda el modelo legacy; después, la caja se postea a la cuenta 10 desde el movimiento real. En este entorno de prueba el cutover está hecho: caja en 10 ≈ S/1.4M, cuenta 1212 = S/144,176.73 (= retención/liquidación).
- **Hardening.** Guarda de periodo cerrado (error 423), `audit_log` (quién/cuándo), anulación formal en vez de borrado, freeze de cierre con snapshot/hash, y preclose-check antes de cerrar el mes.

---

## 4. Verificaciones y correcciones (sesión de QA)

Recorrido de los 7 casos en vivo; **4 inconsistencias encontradas y corregidas**:

1. **Tab Resumen de obra** mostraba el valorizado (ingreso) etiquetado como "Ejecutado Real" (costo) y una "utilidad real" que solo repetía la presupuestada → ahora lee la misma fuente que el tab Financiero: **Costo Ejecutado** y **Resultado Real** reales.
2. **Cierre de obra** marcaba "Retención liberada ✓" leyendo un flag manual, aun con la liquidación mostrando S/144,176.73 pendiente y sin consentimiento → ahora la retención solo cuenta liberada con **consentimiento** registrado.
3. **Dashboard de Personal** parecía filtrado por obra pero es **consolidado** → se agregó el rótulo de alcance.
4. **Asiento de planilla** omitía **SCTR + SENCICO** (subvaluaba el costo patronal ~S/218/semana) y el rótulo prometía "627x incl. SCTR/SENCICO" → se agregaron cuentas (6273 SCTR gasto, 4034 SCTR por pagar; 6279 SENCICO) y las líneas; el asiento regeneró cuadrado con el costo total de la planilla.

**Dato a limpiar (no es bug):** Caja Chica en −S/800 (imposible en la realidad; falta una reposición o hay un movimiento mal cargado en el seed).

---

## 5. Régimen de Construcción Civil (base normativa de la planilla)

- **Régimen especial** (no el general): jornal **diario** por categoría, no sueldo mensual.
- **D.S. 011-79-TR** + **convenios anuales FTCCP–CAPECO** fijan jornal por categoría (Operario / Oficial / Peón / Capataz) y el **BUC**.
- Conceptos y tasas que el motor aplica: **BUC** 32% Operario / 30% Oficial-Peón, **CTS** 15%, **comp. vacacional** 10%, **gratificación** proporcional, **bonif. extraord. L.30334** = 9% de la gratificación, **dominical** (descanso pagado al completar la semana).
- Descuentos al trabajador: **ONP** 13% (o AFP), **CONAFOVICER** 2%.
- Aportes del empleador: **EsSalud** 9%, **SCTR** (salud 1.55% + pensión 1.74%, obligatorio por trabajo de riesgo), **SENCICO** 0.2%.

---

## 6. El formulario "Registrar movimiento" en profundidad (campo por campo)

Este es el formulario más importante del día a día: por él entra casi todo el dinero que se mueve. Está en **Finanzas → Registrar movimiento** (botón azul arriba a la derecha).

### 6.1 Por qué tiene esta forma (la lógica detrás)

Un movimiento no es "un campo de monto". Es un **hecho económico** que el sistema tiene que **contabilizar solo**. Para armar el asiento correcto, el motor necesita responder tres preguntas, y **cada bloque del formulario responde una**:

1. **¿El dinero entra, sale, o solo se mueve entre mis cuentas?** → el toggle **Ingreso / Egreso / Bancario**.
2. **¿Contra qué cuenta del PCGE va?** → la **Naturaleza contable** (y, si es gasto de obra, la clasificación **CD/GG**).
3. **¿A quién, con qué comprobante, cuánto, con qué impuestos, y de qué caja?** → los bloques **Proveedor/Cliente, Montos, Fechas y estado**.

En otras palabras: **el formulario es largo porque reemplaza al asiento contable**. En vez de que la contadora piense "esto es un cargo a la 60 con crédito a la 42 y IGV a la 40111", llena campos en lenguaje de negocio y el motor traduce a PCGE. Por eso cada espacio existe: **le quita una decisión contable de encima al usuario**.

### 6.2 El primer botón: Ingreso / Egreso / Bancario

Es lo primero que se elige porque **cambia todo el resto del formulario**.

| Botón | Cuándo | Qué significa contablemente |
|---|---|---|
| **↑ Ingreso** | Entra plata (cobro, adelanto, préstamo recibido, aporte) | Débito a caja/banco (10) contra la cuenta que diga la naturaleza (1212 cliente, 451 préstamo, 501 aporte, 759 otro) |
| **↓ Egreso** | Sale plata o se causa un gasto (compra, servicio, pago, impuesto) | Cargo a gasto/pasivo contra caja (si pagado) o CxP (si pendiente) |
| **⇄ Bancario** | El dinero se mueve **entre cuentas propias** (o comisión/ITF del banco) | No es ingreso ni egreso del negocio: es traslado. Genera egreso + ingreso espejo entre dos cuentas |

Al cambiar de botón, el sistema **reajusta los valores por defecto** (estado, si aplica IGV, naturaleza) para no dejar basura del modo anterior.

### 6.3 Bloque "¿Qué tipo de egreso?" (solo aparece en Egreso)

Esta es la bifurcación más importante y la razón por la que el egreso se unificó en un solo formulario:

- **Gasto o compra** → es **costo**. Genera un **Gasto** (con su IGV crédito) y lo clasifica en **CD/GG**. Es lo que impacta el resultado de la obra. *(Ej.: comprar cemento, pagar al maestro, alquilar un mixer.)*
- **Movimiento financiero** → **NO es un gasto nuevo**. Es mover plata contra algo ya registrado: pagar una deuda que ya existe (CxP), devolver/otorgar un préstamo, pagar un impuesto ya provisionado. *(Si esto creara un "gasto", se contaría el costo dos veces.)*

> Regla de oro: **si el costo todavía no está en el sistema → "Gasto o compra". Si ya está y solo estás moviendo la plata → "Movimiento financiero".**

Cuando eliges **Gasto o compra**, se despliegan:

**Tipo de gasto** (27 opciones = plantilla maestra de la empresa). No es decorativo: **decide dos cosas automáticamente**:
- La **clasificación sugerida CD o GG** (vía la config "Cuentas por tipo").
- Si es **inventariable** (Herramientas, Maquinaria y equipo, EPPS → entran al inventario valorizado).

**Estado de pago** — el corazón del devengado:
- **Pagado** = crea el **Gasto + el Movimiento de caja** (salió la plata ahora).
- **Pendiente** = crea **solo el Gasto**, que queda como **Cuenta por Pagar** (el costo ya se causó, pero se paga después). Esto permite ver deuda con proveedores sin haber pagado.

**¿A qué parte de la obra corresponde?** (aparece solo si elegiste una obra):
- **Costo Directo** = materiales, mano de obra, equipo de la partida (entra al CD que se compara contra el presupuesto).
- **Gasto General de Obra** = indirecto de esa obra (guardianía, campamento, etc.).
- Muestra "Sugerido por config: CD/GG_OBRA" y, si lo cambias a mano, marca "ajustado manualmente" (el sistema recuerda que fue decisión del usuario, no automática).
- **Widget "Saldo de esta obra":** CD ejecutado / presupuesto → **cuánto queda**, y el **resultado de obra a hoy**. Sirve para no reventar el presupuesto sin darte cuenta.
- **Sin obra → GG_CORP** (gasto corporativo de la empresa, no de una obra) automático.

**Repartir entre varias obras (prorrateo):** un mismo comprobante que sirve a varias obras (ej.: un flete que dejó material en 2 obras). Se abren filas **obra + monto**; el sistema valida que **la suma = total del comprobante** (Σ … de … ✓) y crea **N gastos**, uno por obra, ligados por una referencia común. *No es distribuir overhead: es partir un gasto real entre obras.*

**Registrar en inventario:** si la compra es de bienes almacenables, entra al módulo de inventario con su valuación.

### 6.4 Bloques comunes (Ingreso y Egreso)

**Bloque "Clasificación":**
- **Proyecto** — a qué obra pertenece (o "Oficina / general" = corporativo).
- **Naturaleza contable** — *la traducción a PCGE*. Cada opción tiene una cuenta de contrapartida fija:

  | Naturaleza | Cuenta PCGE | Tipo | ¿Enlaza documento? |
  |---|---|---|---|
  | Cobro de cliente | 1212 | ingreso | **Sí** (salda una factura por cobrar) |
  | Préstamo recibido | 451 | ingreso | no |
  | Aporte de socio | 501 | ingreso | no |
  | Otro ingreso | 759 | ingreso | no |
  | Pago a proveedor | 4212 | egreso | **Sí** (salda una CxP) |
  | Pago de planilla | 411 | egreso | no |
  | Pago de impuesto | 401 | egreso | no |
  | Préstamo otorgado | 161 | egreso | no |
  | Caja chica / reposición | 631 | egreso | no |
  | Gasto operativo | 639 | egreso | no |
  | Otro egreso | 659 | egreso | no |
  | Transferencia | — | transfer | no |

  *"Enlaza documento" = la operación paga/cobra algo que ya existe (por eso no crea gasto nuevo).* Esta tabla es la razón por la que existe el campo: **le dice al motor a qué cuenta del PCGE mandar la contrapartida sin que el usuario sepa contabilidad.**
- **Subtipo / etiqueta** — texto libre para el detalle ("combustible camioneta"). Ayuda a filtrar y reportar.
- **Tipo comprobante** — 8 tipos canónicos (Factura, Boleta, Recibo por Honorarios, Nota de Crédito, Sin Comprobante, Contrato, Invoice, Recibo de servicios). Define el tratamiento tributario y el registro (compras/ventas → PLE).
- **Serie / Número** — el correlativo del comprobante (F001 - 00012). Es la identidad del documento ante SUNAT.

**Bloque "Proveedor" (egreso) / "Cliente" (ingreso):**
- **Tipo doc** (RUC / DNI / CE) + **N°** — validado (RUC 11 dígitos, DNI 8). Se pone en rojo si no cuadra.
- **Nombre / Razón social** (obligatorio, por eso el `*`) — con **autocompletado**: al escribir, sugiere proveedores/clientes ya registrados y rellena RUC solo. Evita duplicar la misma empresa con nombres distintos.

**Bloque "Montos" (aquí vive la lógica tributaria peruana):**
- **Moneda** (PEN / USD).
- **Subtotal (s/IGV)** o **Monto (c/IGV)** — el rótulo cambia según el check de abajo.
- **IGV (18%)** — calculado, no se teclea.
- **Total** — calculado (verde si ingreso, rojo si egreso).
- **Afecto a IGV** — si la operación grava IGV (algunos servicios/bienes no).
- **El monto ya incluye IGV** — si el número que tecleaste es con IGV (el sistema lo desagrega) o sin IGV (lo agrega).
- **Detracción** (%) — el SPOT de SUNAT: 4% construcción, 10% servicios, 12% intermediación, 1.5% comisión. Se **descuenta del pago al proveedor** y se deposita al Banco de la Nación.
- **Retención** (%) — 3% retención de IGV, u 8% de honorarios (renta 4ta). También se descuenta del pago.
- **Neto a pagar** — total − detracción − retención = lo que realmente sale de caja al proveedor.

> Por qué tanto detalle en montos: en Perú el **monto del comprobante ≠ lo que pagas** (detracción y retención se quedan en el camino a SUNAT). El sistema lo separa para que la caja cuadre y el PLE salga bien.

**Bloque "Fechas y estado":**
- **Fecha emisión** — la del comprobante (define el periodo tributario).
- **Vencimiento** (opcional) — para alertas de CxP/CxC.
- **Estado** — Por cobrar/Cobrada/Vencida (ingreso) · Pendiente/Pagada/Anulada (egreso).
- **Cuenta (caja afectada)** (opcional) — de qué cuenta bancaria salió/entró la plata. Si la dejas vacía, es solo el documento (devengado sin caja).

**Bloque "Descripción":** texto libre para observaciones.

### 6.5 Modo Bancario (traslados y cargos del banco)

Cuando el dinero no entra ni sale del negocio, solo se mueve:
- **Subtipo** — Transferencia entre cuentas / Comisión bancaria / ITF / Mantenimiento / Otros.
- **Estado** — Completada / En proceso / Rechazada.
- **Cuenta origen** y, si es transferencia, **Cuenta destino** (deben ser distintas — lo valida). Una transferencia genera **dos movimientos espejo**: egreso en origen + ingreso en destino, para que ambas cuentas cuadren.
- **Monto**, **Fecha**, **N° operación / referencia** (el código de la transferencia del banco).

### 6.6 Todos los casos de uso que se registran aquí

| Caso real | Botón | Cómo llenarlo |
|---|---|---|
| Compra de materiales al contado | Egreso | Gasto o compra · Compra Materiales · **Pagado** · obra + CD · Factura · cuenta = de dónde salió |
| Compra al crédito (aún no pago) | Egreso | Gasto o compra · **Pendiente** → queda como CxP |
| Servicio de terceros con detracción | Egreso | Gasto o compra · Servicio Terceros · marca **Detracción 10%** |
| Honorarios (RH) con retención 4ta | Egreso | Gasto o compra · comprobante **Recibo por Honorarios** · **Retención 8%** |
| Pagar una factura que ya estaba registrada | Egreso | **Movimiento financiero** · naturaleza **Pago a proveedor** (no crea gasto nuevo) |
| Pago de planilla | Egreso | Movimiento financiero · **Pago de planilla** |
| Pago de impuesto (IGV, renta) | Egreso | Movimiento financiero · **Pago de impuesto** |
| Gasto compartido entre 2+ obras | Egreso | Gasto o compra · marca **Repartir entre varias obras** |
| Compra de herramientas/EPP | Egreso | Gasto o compra · tipo **Herramientas/EPPS** · marca **Registrar en inventario** |
| Gasto de oficina (no de obra) | Egreso | Gasto o compra · Proyecto = "Oficina / general" → **GG_CORP** |
| Reposición de caja chica | Egreso | Movimiento financiero · **Caja chica / reposición** |
| Cobro de una valorización/cliente | Ingreso | naturaleza **Cobro de cliente** (salda la CxC 1212) |
| Adelanto de obra recibido | Ingreso | **Otro ingreso** o cobro de cliente, según el caso |
| Préstamo recibido / otorgado | Ingreso / Egreso | naturaleza **Préstamo recibido / otorgado** |
| Aporte de socio | Ingreso | **Aporte de socio** (va a capital 501) |
| Transferencia entre cuentas propias | Bancario | Transferencia · origen + destino |
| Comisión / ITF del banco | Bancario | Comisión bancaria / ITF |

### 6.7 Por qué el botón "Registrar" a veces está apagado (validación)

El botón se habilita solo cuando el hecho económico está **completo y contabilizable**:
- Monto > 0 y fecha puesta (siempre).
- **Ingreso/Egreso:** razón social escrita **y** documento válido (RUC 11 / DNI 8, o vacío).
- **Prorrateo:** al menos 2 obras y la **suma = total** del comprobante.
- **Bancario:** cuenta elegida; si es transferencia, **origen y destino distintos**.

Si falta algo, abajo dice exactamente qué ("Completa contraparte, monto y documento" / "Completa cuenta(s) y monto"). Es una **red de seguridad**: no deja registrar un movimiento que la contabilidad no podría cerrar.
