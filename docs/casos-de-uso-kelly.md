# ERP MM High Metrik · Qué se construyó, por qué, y casos de uso para la sesión con Kelly

> Documento de trabajo para la validación con la contadora. Cada sección del sistema
> existe por un requisito explícito de Kelly (audios de requerimiento), una decisión de
> Mario (gerencia) o una obligación SUNAT. Este doc mapea sección → origen → cómo probarla.
>
> **Criterio de aceptación global (acordado):** un mes real cerrado por Kelly, cuadrado
> contra el estudio contable y contra el extracto bancario.

---

## 1 · Qué se construyó (resumen por módulo)

### Finanzas
| Sección | Qué hace |
|---|---|
| **Resumen** | Vista consolidada de tesorería y pendientes del mes. |
| **Compras** | Registro de facturas de proveedor con líneas, detracción (catálogo completo ~48 códigos), retención IGV 3% / renta 4ta 8%, percepción, período de anotación, destino del crédito fiscal (DG/DGNG/DNG), pago parcial, alta automática de proveedor por RUC (consulta SUNAT). Precarga desde OC (3-way match) y desde XML (bandeja CPE). |
| **Ventas** | Valorizaciones facturadas (captura del comprobante electrónico real al facturar) + ventas standalone (factura/boleta/NC/ND), retención IGV 3% cuando el cliente es agente. |
| **Bancos** | Movimientos por cuenta con N° de operación obligatorio; pago a proveedor jala sus facturas pendientes y las aplica (parcial o total); multimoneda USD con TC SUNAT y diferencia de cambio automática (675/776). |
| **Cajas** | Cajas por proyecto, cruzadas con el N° de operación del egreso que las fondea. |
| **Conciliación** | Import del EECC en PDF (parser del formato BCP), clasificación automática de líneas (ITF, comisiones, transferencias propias, abonos, cargos), match automático contra el libro, confirmación en lote, "Registrar desde extracto" (prellena el formulario con la línea del banco), cuadre contra el **saldo oficial impreso** del EECC. |
| **Auxiliar** | Mayor por tercero (RUC) con aging de CxP/CxC. |
| **Registrar movimiento (formulario único)** | Un solo modal para compra/gasto/pago/bancario/ingreso, con cuenta contable manual, saldo de obra CD/GG visible, prorrateo entre obras con tope y confirmación de sobrecosto. |

### Contabilidad (5 tabs)
| Tab | Qué hace |
|---|---|
| **Plan contable** | Plan PCGE con divisionarias libres bajo cualquier cuenta madre + segmento "Ruteo por tipo de gasto" (mapa editable tipo de gasto → cuenta, red de seguridad cuando nadie eligió cuenta). |
| **Diario y mayor** | Hub fusionado: asientos (auto + manuales) y mayor por cuenta. Botón Generar asienta lo devengado/cobrado del período. |
| **Cierre del mes** | Checklist vivo de 5 puntos (todo asentado, banco conciliado, provisiones 48 resueltas, invariante libro=tesorería, pre-cierre técnico) con semáforo y "dónde resolver" cada punto. Cierre congela el período (edits posteriores → error 423) con snapshot auditado y reapertura formal. |
| **Libros y SIRE** | TXT PLE oficiales (5.1 Diario / 6.1 Mayor / 8.1 Compras / 14.1 Ventas, estructura SUNAT Anexo 2 Ver 5 verificada por test) + TXT SIRE (RCE/RVIE, borrador de reemplazo de propuesta) + subtab "IGV y Renta del mes" con crédito fiscal diferido restado. |
| **Estados Financieros** | Balance y resultados básicos (NIIF finas quedan con el estudio externo, en pausa por decisión de Kelly). |

### Motor contable (invisible pero es el corazón)
- Todo registro operativo genera su asiento automáticamente (idempotente: regenerar no duplica).
- El movimiento de tesorería es la única verdad de las cuentas 104x (post-cutover).
- Período cerrado bloquea escritura (423) · auditoría de quién hizo qué · anulación formal, nunca borrado.

---

## 2 · Por qué cada cosa está donde está (justificación rastreable)

Cada fila responde "¿por qué pusieron esto?" con su origen. **K** = requisito de Kelly (audios), **M** = Mario, **S** = norma SUNAT, **D** = decisión de diseño validada con el usuario.

| # | Decisión de diseño | Origen | Detalle |
|---|---|---|---|
| 1 | **Cuenta contable manual en todo registro** (solo se sugiere la última usada) | K | Kelly no quiere que el sistema "adivine" la cuenta; ella decide. El ruteo por tipo de gasto es solo fallback si nadie eligió. |
| 2 | **Divisionarias libres** bajo cualquier cuenta madre | K | Ej.: 1041801 BCP Soles, 45112 préstamo BCP. Kelly maneja su propia dinámica. |
| 3 | **N° de operación obligatorio en bancos** | K | Es la llave del cruce con el extracto y con las cajas de proyecto. |
| 4 | **Documento NO obligatorio** en ingresos/pagos por fuera | K | Ingresos por contrato o pagos sin comprobante van solo con glosa. |
| 5 | **Boleta = gasto, NO entra al Registro de Compras** | K | Regla explícita de Kelly; el IGV de boleta va al costo. |
| 6 | **Provisiones cuenta 48** (pago sin factura → extorno al llegar el comprobante) | K | Flujo real de la empresa: se paga antes de que llegue la factura. |
| 7 | **Detracción por código de catálogo** (~48 códigos) + constancia con N° y fecha | K + S | Sin constancia el crédito fiscal queda **diferido** (se ve restado en "IGV y Renta del mes"). |
| 8 | **Retención IGV 3% en VENTAS** (cliente agente de retención) | K | Va a la 40114; no aplica a compras de MM. |
| 9 | **Período de anotación ≠ mes de emisión** (crédito fiscal hasta 12 meses) | S | El 8.1 sale por período de anotación; estado 6 si se anota después de emitida. |
| 10 | **Destino del crédito DG/DGNG/DNG** | S | Campos 14-19 del 8.1; DNG manda el IGV al costo. |
| 11 | **Duplicado RUC+serie+número rechazado** (409) | D | Evita doble registro de la misma factura aunque cambie el total. |
| 12 | **Pago jala facturas pendientes del proveedor** y cancela la cuenta control (42/12), no el gasto | K + D | Sin esto el gasto se duplicaba contablemente al pagar. |
| 13 | **Conciliación cuadra contra el saldo OFICIAL impreso del EECC** | D | El banco es la verdad; si la lectura del PDF pierde líneas, el sistema lo dice con monto. |
| 14 | **"Registrar desde extracto"** prellena el formulario con la línea del banco | K | Lo que está en el banco y no en el ERP se registra sin re-tipear, en la fecha del banco. |
| 15 | **Cargos del banco en lote** (ITF → 6412, comisiones → 679) | D | 33 cargos de enero se registraron y conciliaron en un clic. |
| 16 | **Cierre del mes con checklist y freeze** | D | El cierre es el evento central del mes de Kelly; el checklist dice exactamente qué falta y dónde resolverlo. Cerrado = congelado + snapshot + reapertura solo formal. |
| 17 | **TXT PLE con estructura oficial Anexo 2 Ver 5** | S | 5.1/6.1 = 21 campos, 8.1 = 41, 14.1 = 34; verificado por test automático contra el XLS oficial de SUNAT. |
| 18 | **SIRE (RCE/RVIE) separado del PLE** | S | SIRE cubre solo compras/ventas (reemplazo de propuesta); Diario y Mayor siguen por PLE siempre. Pendiente confirmar con Kelly desde cuándo MM está obligada al SIRE. |
| 19 | **Saldo de obra CD/GG visible al registrar** + prorrateo con tope + sobrecosto con confirmación explícita | M + D | Mario pidió control por proyecto; el usuario decidió confirmación (no bloqueo duro) para el sobrecosto. |
| 20 | **Vista por proyecto** (contrato/gastado/valorizado/utilidad) | M | La lectura de gerencia. |
| 21 | **OC seleccionada precarga la compra** (3-way match) | D | OC = compromiso, compra = devengado; evita contradicción entre módulos y re-tipeo. |
| 22 | **Multimoneda USD con TC SUNAT** + diferencia de cambio automática | K + S | Pérdida 675 / ganancia 776 (PCGE 2020). TC se trae de SUNAT con un clic o se carga manual. |
| 23 | **EEFF finos en pausa** | K | NIIF con el estudio externo; el sistema entrega balance/resultados básicos. |
| 24 | **Auxiliar por tercero en Finanzas** (no en Contabilidad) | D (usuario) | Es herramienta de gestión de cobranza/pago diaria, no de cierre. Pendiente: filtros cuenta+RUC+rango de períodos. |

---

## 3 · Casos de uso para la sesión con Kelly

Guion sugerido: 90–120 min, en orden. Cada caso tiene **pasos** y **qué debe validar Kelly**
(si algo no le cuadra a su criterio contable, se anota y se ajusta — para eso es la sesión).
Usar datos de prueba; el mes real completo viene después con el reseed.

### CU-1 · Compra con factura y detracción
1. Finanzas → Registrar movimiento → Compra. RUC real de un proveedor suyo → debe autocompletar razón social (consulta SUNAT si no existe).
2. Factura F001-xxx, líneas con partida, código de detracción del catálogo, destino DG.
3. **Valida:** cuenta contable sugerida vs la que ella usaría (puede cambiarla — es manual), asiento generado (60x/40111/4212 con detracción segregada), la factura aparece en CxP y en el 8.1 del período.
4. En Libros → IGV del mes: el IGV de esta compra debe aparecer como **crédito diferido** (sin constancia).

### CU-2 · Constancia de detracción
1. Registrar N° de constancia y fecha de depósito sobre la compra de CU-1.
2. **Valida:** el crédito pasa de diferido a usable; el 8.1 llena campos 31/32 (fecha/número de constancia).

### CU-3 · Boleta
1. Registrar una boleta de gasto.
2. **Valida:** NO aparece en el Registro de Compras (8.1/RCE); el IGV va al costo. (Regla que ella dictó.)

### CU-4 · Pago aplicando facturas
1. Registrar movimiento → Pago. Elegir el proveedor de CU-1 → deben aparecer sus facturas pendientes.
2. Pagar parcial (menos que el total).
3. **Valida:** la CxP baja solo lo aplicado, el asiento cancela la 4212 (no vuelve a tocar el gasto), el saldo pendiente queda visible en el Auxiliar por tercero.

### CU-5 · Provisión 48
1. Registrar un pago SIN factura marcando provisión → va a la 4811.
2. Días después "llega" la factura: registrarla vinculada.
3. **Valida:** extorno automático de la 48 y devengo normal de la compra.

### CU-6 · Venta / valorización
1. Facturar una valorización capturando serie/número del comprobante electrónico real.
2. **Valida:** aparece en el 14.1/RVIE del período con el comprobante real (ya no hay placeholder).

### CU-7 · Nota de crédito de venta
1. Registrar NC (07) referenciando la factura que modifica.
2. **Valida:** resta en el registro de ventas, campos 28-30 del 14.1 llevan el comprobante modificado.

### CU-8 · Conciliación bancaria (el plato fuerte)
1. Conciliación → Importar EECC de enero (PDF BCP real) eligiendo la cuenta.
2. Revisar **Sugeridas** → Confirmar en lote.
3. **Cargos del banco** (ITF, comisiones) → Registrar en lote (cuenta editable por fila).
4. Tomar una línea **Sin pareja** → "Registrar desde extracto" → el formulario llega prellenado con fecha/monto/N° operación del banco.
5. **Valida:** el cuadre de arriba usa el saldo oficial impreso del EECC; el % conciliado sube en vivo; los "sin pareja" restantes son su trabajo real (factoring, devoluciones) — preguntarle qué son y a qué cuenta van.

### CU-9 · Caja de proyecto
1. Fondear una caja de proyecto desde banco (egreso con N° operación) y registrar una rendición.
2. **Valida:** el cruce banco↔caja por N° de operación y el gasto rendido cae al proyecto.

### CU-10 · Compra desde OC
1. Registrar compra eligiendo una OC aprobada → precarga proveedor, líneas y montos; el box compara OC vs factura.
2. **Valida:** si difieren lo muestra; la OC queda ligada y sale del selector (no se factura dos veces).

### CU-11 · Cierre del mes ⭐
1. Contabilidad → Cierre del mes, período de trabajo.
2. Recorrer el checklist: qué falta asentar → botón Generar en Diario; banco conciliado; provisiones 48 resueltas; invariante libro=tesorería (con desglose por cuenta si difiere); pre-cierre.
3. Cerrar el mes → intentar editar un movimiento de ese mes → debe rechazarse (423).
4. **Valida:** ¿el checklist refleja SU rutina de cierre? ¿Falta algún paso suyo? (ej. planillas, depreciación). Reapertura formal si necesita corregir.

### CU-12 · Libros y tributos
1. Descargar TXT 5.1/6.1/8.1/14.1 → que Kelly los abra y revise columnas contra lo que ella presenta hoy.
2. Descargar RCE/RVIE → **pedirle un archivo real de importación SIRE suyo para validar el formato** (pendiente conocido).
3. Subtab IGV y Renta: crédito usable vs diferido, IGV a pagar.
4. **Preguntarle:** ¿desde cuándo MM está obligada al SIRE? (define si el 8.1/14.1 por PLE son solo respaldo).

### CU-13 · Compra en dólares
1. Compra USD → TC se trae de SUNAT con el botón; pagar después con otro TC.
2. **Valida:** asiento en PEN al TC histórico y la diferencia de cambio en 675/776.

### CU-14 · Auxiliar por tercero
1. Abrir el auxiliar, buscar un RUC con deuda.
2. **Valida:** ¿le sirve el aging? Anotar los filtros que pidió el usuario (cuenta + RUC + rango de períodos) como confirmación.

### Cierre de la sesión
- Anotar TODO lo que Kelly haría distinto (cuentas, textos, orden de campos).
- Definir el mes real que ella va a cerrar en paralelo con el estudio (criterio 100%).
- Pedirle: archivo SIRE real, las 15 facturas de ventas con las NC de E001-101/102, y su dinámica de divisionarias si falta alguna.

---

## 4 · Qué falta y en qué orden (contexto para no sobre-prometer)

1. **Casos de uso con Kelly** (este doc) → ajustes que salgan.
2. **Seguridad mínima pre-link** (ya identificada): cambiar admin/admin, quitar hint del login, secretos fuera del repo, HTTPS. Luego RBAC completo (F4.1).
3. **Reseed con datos reales** (F4.2): las 15 facturas de ventas, mes real completo.
4. **Deploy productivo formal** (F4.3): backups automáticos, migraciones versionadas.
5. Paralelo con el estudio contable → mes cerrado cuadrado = 100%.
