# Preguntas para cerrar el alcance

**Reunión:** cliente (Kelly, contabilidad · Mario, gerencia)
**Objetivo:** salir de la reunión sin ninguna decisión abierta que bloquee el desarrollo.
**Material de apoyo:** `docs/mockups/finanzas-reestructurado.html` (propuesta visual, no es el sistema).

## Cómo usar este documento

Cada pregunta trae opciones marcables. La respuesta correcta casi siempre es marcar una casilla, no escribir un párrafo. Si una pregunta no se puede responder en la reunión, se marca `QUEDA ABIERTA` con dueño y fecha, porque una pregunta sin dueño es la que nos trajo hasta acá.

Las preguntas marcadas **[BLOQUEA]** impiden avanzar con código. Las marcadas **[DISEÑO]** cambian cómo se ve la pantalla pero se pueden ajustar después. Las **[DATO]** solo requieren que nos pasen un archivo o un número.

---

## Bloque A. Alcance global

Estas cuatro definen todo lo demás. Se responden primero.

**A.1 [BLOQUEA] ¿Cuál es la fecha de corte real?**
A partir de qué fecha el ERP es la fuente de verdad y Kelly deja de llevar el control en Excel.
- [ ] Ya (data histórica se carga después, en paralelo)
- [ ] Cuando esté cargado enero a la fecha
- [ ] Inicio del siguiente ejercicio
- [ ] Otra: ______________

**A.2 [BLOQUEA] ¿El ERP reemplaza al Excel o convive con él?**
Kelly dijo que quiere seguir calculando la planilla obrera en su Excel y solo registrar el resultado. ¿Ese criterio aplica solo a planilla o también a compras y bancos?
- [ ] Solo planilla se calcula fuera, el resto se captura en el ERP
- [ ] Compras y bancos también se cargan desde Excel y el ERP solo reporta
- [ ] Todo se captura en el ERP, el Excel desaparece

**A.3 [BLOQUEA] ¿Qué se entrega al estudio contable externo y en qué formato?**
Hoy generamos PLE 5.1, 6.1, 8.1, 14.1 y los archivos SIRE (RCE y RVIE) en TXT.
- [ ] Los TXT de PLE y SIRE tal como están hoy
- [ ] Un Excel de compras y ventas con un formato que ellos definen (pedir el formato exacto)
- [ ] Acceso directo al sistema para el estudio (implica usuario, rol y empresa)
- [ ] Otra: ______________

**A.4 [BLOQUEA] ¿Quién captura qué?**
Necesitamos el mapa de responsables porque de ahí salen los roles y los permisos.

| Tarea | Responsable | ¿Aprueba alguien? |
|---|---|---|
| Registrar factura de compra | | |
| Registrar pago en banco | | |
| Conciliar extracto bancario | | |
| Registrar venta y valorización | | |
| Cargar planilla | | |
| Cerrar el mes | | |
| Ver reportes de rentabilidad | | |

---

## Bloque B. Detracciones

Este bloque es el que más riesgo tiene en producción, porque una detracción mal calculada cuesta el crédito fiscal. Necesitamos entender el circuito completo, no solo el porcentaje.

### B.1 El circuito

**B.1.1 [BLOQUEA] ¿Quién detrae en la práctica: MM High Metrik como cliente, o los proveedores a MM High Metrik?**
- [ ] Solo detraemos nosotros (somos el usuario del servicio)
- [ ] Solo nos detraen a nosotros (somos el prestador, típico en valorizaciones de obra)
- [ ] Ambos casos ocurren

**B.1.2 [BLOQUEA] Cuando nos detraen en una valorización, ¿cómo llega el dinero?**
El cliente paga el neto a la cuenta corriente y el porcentaje a la cuenta de detracciones del Banco de la Nación. ¿Ese depósito lo vemos reflejado en algún extracto que nos pasan, o solo aparece cuando consultamos el saldo del Banco de la Nación?
- [ ] Tenemos extracto del Banco de la Nación y se puede conciliar como cualquier banco
- [ ] Solo se consulta el saldo, no hay extracto que importar
- [ ] Otra: ______________

**B.1.3 [BLOQUEA] ¿Quieren que el sistema lleve la cuenta de detracciones del Banco de la Nación como una cuenta bancaria más?**
Con su saldo, sus depósitos entrantes (lo que nos detraen) y sus salidas (lo que usamos para pagar impuestos).
- [ ] Sí, como una cuenta más
- [ ] No, se lleva aparte

**B.1.4 ¿Se usa el saldo de detracciones para pagar tributos? ¿Cómo se registra hoy ese uso?**
Respuesta: ______________

**B.1.5 ¿Han tenido ingreso como recaudación alguna vez?**
Es el caso en que SUNAT se lleva el saldo de la cuenta de detracciones. Cambia cómo registramos la salida.
- [ ] Nunca
- [ ] Sí, y se registra así: ______________

### B.2 El cálculo

**B.2.1 [BLOQUEA] ¿Qué tasa se usa en obra y sobre qué base?**
Contratos de construcción es 4 por ciento. Confirmar si en su operación se aplica esa, o si la mayoría entra por servicios al 12.
- [ ] 4 por ciento contratos de construcción, código 030
- [ ] 12 por ciento servicios, código 037 u otro
- [ ] Depende del proveedor, caso por caso

**B.2.2 [BLOQUEA] ¿La base de cálculo es el total de la factura con IGV?**
Confirmar, porque el sistema tiene que redondear igual que ustedes.
- [ ] Sí, total con IGV
- [ ] Otra: ______________

**B.2.3 [BLOQUEA] ¿Cómo redondean el monto de la detracción?**
- [ ] Al entero más cercano
- [ ] Hacia arriba al entero
- [ ] Dos decimales

**B.2.4 [BLOQUEA] ¿Aplican el mínimo de 700 soles?**
Por debajo de ese monto la operación no está sujeta a detracción, salvo excepciones. ¿Lo controlan manualmente o quieren que el sistema lo aplique solo?
- [ ] El sistema lo aplica solo y avisa
- [ ] Lo decide quien registra, caso por caso
- [ ] Hay excepciones que sí detraen bajo 700: ______________

**B.2.5 ¿Existe algún proveedor o servicio que ustedes sepan que cambia de tasa a mitad de año?**
La tabla que nos pasaron tiene columna de vigencia, así que el sistema solo debe ofrecer los códigos vigentes a la fecha del documento.
Respuesta: ______________

### B.3 El pago y la constancia

**B.3.1 [BLOQUEA] ¿En qué momento se paga la detracción respecto del pago de la factura?**
- [ ] Primero se detrae, después se paga el neto
- [ ] Se paga la factura completa y la detracción después
- [ ] Varía

**B.3.2 [BLOQUEA] ¿Qué datos de la constancia necesitan ver en el sistema?**
- [ ] Número de constancia
- [ ] Fecha de depósito
- [ ] Monto
- [ ] Código de bien o servicio
- [ ] El PDF o imagen adjunto
- [ ] Otro: ______________

**B.3.3 [BLOQUEA] ¿Una constancia corresponde siempre a una sola factura?**
- [ ] Sí, una a una
- [ ] Se hacen depósitos masivos que cubren varias facturas

**B.3.4 [DISEÑO] ¿Quieren que el sistema alerte cuando una factura con detracción lleva X días sin constancia?**
Es el riesgo real de perder el crédito fiscal.
- [ ] Sí, alertar a los ___ días
- [ ] No hace falta

### B.4 Casos límite

**B.4.1 ¿Qué pasa cuando una factura con detracción se anula o le emiten nota de crédito después de haber depositado?**
Respuesta: ______________

**B.4.2 ¿Se detrae sobre anticipos?**
- [ ] Sí
- [ ] No
- [ ] Nunca hemos tenido el caso

**B.4.3 ¿Hay facturas en dólares con detracción?**
Si las hay, la detracción se deposita en soles y hace falta el tipo de cambio de la fecha.
- [ ] Sí, ocurre
- [ ] No, todas las detracciones son en soles

---

## Bloque C. Otros tributos y eventos SUNAT

Pregunta transversal: cuáles de estos les ocurren realmente, para no construir pantallas de algo que nunca pasa.

**C.1 [BLOQUEA] ¿MM High Metrik es Agente de Retención de IGV designado por SUNAT?**
Cambia todo el circuito de pago a proveedores (retención de 3 por ciento y comprobante de retención).
- [ ] Sí, somos agente de retención
- [ ] No
- [ ] No estoy seguro, lo confirmo

**C.2 ¿Algún cliente de ustedes es Agente de Retención y les retiene el 3 por ciento?**
- [ ] Sí, ¿cuáles? ______________
- [ ] No

**C.3 ¿Les aplican percepción de IGV en alguna compra?**
Típico en combustible y ciertos bienes importados.
- [ ] Sí, en: ______________
- [ ] No

**C.4 [BLOQUEA] Recibos por honorarios: ¿retienen el 8 por ciento?**
Kelly mencionó que algunas personas se quitan la retención.
- [ ] Retenemos siempre que supere el mínimo mensual
- [ ] Hay personas con suspensión de retención vigente (Formulario 1609)
- [ ] Nunca retenemos

**C.5 [DATO] Si hay suspensión, ¿nos pasan la lista de quiénes la tienen y hasta cuándo vence?**
El sistema debería marcar al proveedor de cuarta categoría con suspensión vigente y dejar de retener automáticamente.
- [ ] Sí, la pasamos
- [ ] Se maneja caso por caso al registrar

**C.6 ¿Hay pagos al exterior o servicios de no domiciliados?**
Implican retención de renta y a veces IGV no domiciliado.
- [ ] Sí
- [ ] No

**C.7 ¿Registran el ITF?**
- [ ] Sí, como gasto
- [ ] No lo registramos por separado

**C.8 ¿Emiten o reciben notas de débito? ¿En qué casos?**
Respuesta: ______________

**C.9 ¿Qué se hace cuando un comprobante se da de baja o se anula después de haberlo registrado?**
Respuesta: ______________

---

## Bloque D. Compras

**D.1 [BLOQUEA] ¿El detalle por línea es obligatorio siempre, o solo en ciertos casos?**
Hoy el formulario captura una sola línea con el total. Kelly pidió detalle por línea para que el inventario se llene solo.
- [ ] Siempre detalle por línea
- [ ] Solo cuando la compra entra a inventario
- [ ] Solo cuando se reparte entre varias partidas
- [ ] Lo decide quien registra, con una casilla

**D.2 [BLOQUEA] Una orden de compra: ¿sus ítems van todos a la misma partida, o se reparten?**
Esta es la pregunta pendiente de la reunión anterior. Define si la partida va en la cabecera o en cada línea.
- [ ] Siempre una sola partida por OC
- [ ] Se reparten entre partidas, hay que poder asignar línea por línea
- [ ] La mayoría es una sola, pero hay excepciones

**D.3 [BLOQUEA] ¿Una factura puede cubrir varias órdenes de compra? ¿Y una OC generar varias facturas?**
- [ ] Una factura, una OC
- [ ] Una factura puede cubrir varias OC
- [ ] Una OC puede facturarse en partes

**D.4 [BLOQUEA] ¿Quieren que el sistema compare lo facturado contra lo que dice la OC y avise si no cuadra?**
- [ ] Sí, avisar si difiere
- [ ] No, la OC es solo referencia

**D.5 [BLOQUEA] ¿Quién decide la cuenta contable, y cuándo?**
Kelly dijo que ella la decide. ¿El que registra la compra la deja en blanco y Kelly la completa, o el sistema propone una y Kelly corrige?
- [ ] El sistema propone según tipo de gasto, Kelly corrige
- [ ] Se deja en blanco y Kelly la asigna en una bandeja de pendientes
- [ ] Quien registra ya la elige

**D.6 [DISEÑO] ¿Hace falta una bandeja de "documentos sin cuenta contable" para que Kelly los trabaje en lote?**
- [ ] Sí
- [ ] No

**D.7 [BLOQUEA] Gastos proyectados.**
Mario pidió poder ver gastos cotizados y no ejecutados para su Excel.
- [ ] Se registran como cotización o presupuesto, sin afectar contabilidad
- [ ] Se registran como OC pendiente de facturar
- [ ] Se manejan fuera del sistema

**D.8 ¿Se adjunta el PDF o XML del comprobante al registro?**
- [ ] Sí, obligatorio
- [ ] Sí, opcional
- [ ] No hace falta

**D.9 [DATO] ¿Nos pueden pasar XML de facturas que sí tengan detracción y que sí tengan retención?**
El único XML que tenemos es una venta exonerada, así que no ejercita ninguno de los dos casos.

**D.10 ¿Qué hacemos cuando llega el XML del proveedor de una factura que ya fue registrada a mano?**
Nuestra propuesta es vincularlo al registro existente comparando RUC, tipo, serie y número, y mostrar las diferencias en vez de duplicar.
- [ ] De acuerdo
- [ ] Otra: ______________

**D.11 ¿Hay compras sin comprobante? ¿Cómo se sustentan?**
Respuesta: ______________

**D.12 ¿Qué porcentaje de las compras llegan en dólares?**
Respuesta: ______________

**D.13 [BLOQUEA] ¿Qué tipo de cambio se usa y de qué fecha?**
- [ ] Tipo de cambio SUNAT de la fecha de emisión
- [ ] Tipo de cambio SUNAT de la fecha de pago
- [ ] El que negocia el banco
- [ ] Se ingresa a mano en cada documento

---

## Bloque E. Ventas, valorizaciones y comprobantes emitidos

**E.1 [BLOQUEA] ¿Quién emite la factura de venta y en qué sistema?**
Hoy el ERP guarda un número de serie provisional que termina llegando al PLE 14.1 y al RVIE. Eso es un riesgo real.
- [ ] Se emite en un facturador externo y se copia el número al ERP
- [ ] Se emite en el ERP
- [ ] Lo emite el estudio contable

**E.2 [BLOQUEA] ¿Cómo entra el número real de la factura al sistema?**
- [ ] Se digita al facturar
- [ ] Se importa el XML emitido
- [ ] Se carga en lote al cierre de mes

**E.3 ¿Una valorización equivale siempre a una factura?**
- [ ] Sí, una a una
- [ ] Una valorización puede facturarse en partes
- [ ] Varias valorizaciones en una sola factura

**E.4 ¿Cómo se manejan los adelantos o anticipos de cliente?**
Y cómo se amortizan contra las valorizaciones siguientes.
Respuesta: ______________

**E.5 ¿La retención de garantía se acumula hasta un tope contractual?**
Quedó en espera desde antes. Hoy se calcula por valorización pero no se acumula.
- [ ] Sí, hay un tope, típicamente el ___ por ciento del contrato
- [ ] No hay tope
- [ ] Varía por contrato

**E.6 ¿Cuándo se devuelve la retención de garantía y cómo se registra?**
Respuesta: ______________

**E.7 ¿Emiten notas de crédito de venta? ¿Por qué motivos?**
Respuesta: ______________

---

## Bloque F. Bancos, cuentas por pagar y por cobrar

**F.1 [BLOQUEA] Confirmación del circuito de pago parcial.**
Kelly lo describió así: proveedor con diez facturas, se paga la número diez y solo el 50 por ciento, y el reporte muestra la diferencia pendiente. ¿Es exactamente eso?
- [ ] Correcto
- [ ] Matizar: ______________

**F.2 [BLOQUEA] ¿Un solo pago puede cubrir varias facturas a la vez?**
- [ ] Sí, es común
- [ ] No, siempre uno a uno

**F.3 [BLOQUEA] ¿Cuántas cuentas bancarias hay que llevar y de qué bancos?**
Incluir la de detracciones del Banco de la Nación si aplica.
Lista: ______________

**F.4 [DATO] ¿En qué formato llega el extracto de cada banco?**
El importador de conciliación ya existe pero está calibrado para un formato. Necesitamos un archivo de ejemplo por banco.
- [ ] Excel
- [ ] TXT o CSV
- [ ] Solo PDF

**F.5 ¿El número de operación viene siempre en el extracto?**
Es la llave con la que Kelly cuadra el libro caja.
- [ ] Sí, siempre
- [ ] A veces
- [ ] Depende del banco

**F.6 ¿Manejan pagos masivos, un archivo con muchos proveedores?**
- [ ] Sí
- [ ] No

**F.7 ¿Trabajan con letras, pagarés, factoring o confirming?**
- [ ] Sí: ______________
- [ ] No

**F.8 ¿Hay líneas de crédito, préstamos o leasing que haya que llevar?**
- [ ] Sí: ______________
- [ ] No

**F.9 ¿Qué antigüedad quieren ver en el reporte de cuentas por pagar?**
- [ ] Corriente, 30, 60, 90, más de 90
- [ ] Otra: ______________

---

## Bloque G. Cajas y rendiciones

**G.1 [BLOQUEA] ¿Cuántas cajas hay y quién es responsable de cada una?**
En el Excel aparece una cuenta llamada `REND-NAYELLI` usada como si fuera un banco.
Lista: ______________

**G.2 [BLOQUEA] ¿Cómo se fondea una caja?**
- [ ] Transferencia bancaria al encargado
- [ ] Efectivo retirado
- [ ] Ambos

**G.3 ¿La rendición se aprueba antes de contabilizarse?**
- [ ] Sí, quién aprueba: ______________
- [ ] No, se contabiliza directo

**G.4 ¿Qué pasa con el saldo no rendido al cierre de mes?**
- [ ] Queda como saldo de caja
- [ ] Se descuenta en planilla
- [ ] Otra: ______________

**G.5 ¿Los gastos de caja chica llevan comprobante siempre?**
- [ ] Sí
- [ ] Hay gastos sin comprobante y se sustentan con: ______________

---

## Bloque H. Personal y planilla

Kelly fue explícita en que quiere registrar el resultado de su Excel, no que el sistema recalcule. Eso hay que cerrarlo con precisión porque cambia mucho el trabajo.

**H.1 [BLOQUEA] ¿Confirmamos que la planilla obrera se calcula fuera y el ERP solo la captura?**
- [ ] Sí, el ERP captura el resultado por trabajador y periodo
- [ ] El ERP calcula y Kelly ajusta lo que haga falta
- [ ] Mixto: el ERP calcula lo estándar y hay campos de ajuste manual

**H.2 [BLOQUEA] Si el ERP solo captura, ¿la carga es fila por fila en pantalla o se sube el Excel?**
- [ ] Se sube el Excel con un formato fijo
- [ ] Se captura en pantalla
- [ ] Las dos cosas

**H.3 [DATO] Si se sube el Excel, necesitamos la plantilla exacta y congelada.**
Kelly ofreció pasar su hoja de trabajo. Necesitamos la versión que va a ser la definitiva, con los nombres de columna que no van a cambiar.

**H.4 [BLOQUEA] Los cuatro tipos de vínculo.**
Kelly pidió: planilla de oficina, planilla de construcción civil, recibo por honorarios y personal por fuera. Confirmar que son exactamente esos cuatro y no más.
- [ ] Esos cuatro
- [ ] Falta: ______________

**H.5 ¿Todas las personas de los cuatro tipos se registran en el mismo maestro de personal?**
Kelly dijo que sí, para llevar el control en un solo lugar.
- [ ] Sí, un solo maestro con el tipo de vínculo como atributo
- [ ] Separados

**H.6 [BLOQUEA] "Personal por fuera": ¿va a gasto directo sin planilla ni comprobante?**
Kelly mencionó que lo carga a la 63.
- [ ] Correcto, gasto directo
- [ ] Matizar: ______________

**H.7 [BLOQUEA] El pago del SCTR y de las planillas desde el módulo de compras.**
Kelly pidió que al elegir tipo de gasto igual a planilla, el formulario le permita jalar los trabajadores registrados. ¿Para qué exactamente?
- [ ] Para asignar el monto del gasto entre trabajadores
- [ ] Solo para dejar constancia de a quiénes cubre el pago
- [ ] Para generar el asiento con detalle por trabajador

**H.8 ¿El SCTR se paga masivo por planilla, o hay pólizas por trabajador?**
Kelly dijo masivo. Confirmar si alguna vez hay pagos individuales.
- [ ] Siempre masivo
- [ ] Hay casos individuales

**H.9 [DATO] ¿Las tasas de AFP y el tope asegurable se actualizan todos los meses?**
Kelly revisa la SBS cada mes. El sistema ya tiene tabla de tasas variables.
- [ ] Kelly las carga cada mes en el sistema
- [ ] Las cargamos nosotros
- [ ] Vienen en el Excel de planilla y no hace falta la tabla

**H.10 ¿Qué conceptos de planilla obrera hay que poder ver por separado?**
Marcar los que importan en el reporte: jornal básico, horas extra 60, horas extra 100, BUC, gratificación, CTS, bonificación extraordinaria, vida ley, SCTR salud, SCTR pensión, ESSALUD, AFP u ONP, asignación familiar, movilidad, otros.
Respuesta: ______________

**H.11 ¿Hay que emitir boletas de pago desde el sistema?**
- [ ] Sí, para todos
- [ ] Solo para planilla de oficina
- [ ] No

**H.12 ¿Se lleva fecha de ingreso y fecha de cese de cada trabajador?**
Kelly lo pidió explícitamente.
- [ ] Sí
- [ ] Además hace falta: ______________

**H.13 ¿Se reporta a PLAME o T-Registro desde el sistema, o eso se queda fuera?**
- [ ] Fuera de alcance
- [ ] Hace falta al menos exportar un archivo

---

## Bloque I. Inversionistas y socios

Este bloque no tiene nada hecho y no ha sido definido nunca.

**I.1 [BLOQUEA] ¿Qué es exactamente lo que hace falta llevar?**
- [ ] Aportes de socios por proyecto
- [ ] Distribución de utilidades por proyecto
- [ ] Préstamos de socios a la empresa
- [ ] Un reporte de rentabilidad por socio
- [ ] Otra: ______________

**I.2 ¿Los aportes son por proyecto o a la empresa en general?**
- [ ] Por proyecto
- [ ] A la empresa
- [ ] Ambos

**I.3 ¿Un socio puede participar en unos proyectos y en otros no? ¿Con qué porcentaje?**
Respuesta: ______________

**I.4 ¿Quién puede ver esta información?**
- [ ] Solo Mario
- [ ] Mario y Kelly
- [ ] Cada socio ve lo suyo

**I.5 ¿Esto entra en esta etapa o es una fase posterior?**
- [ ] Esta etapa
- [ ] Fase posterior

---

## Bloque J. Multi-empresa y permisos

**J.1 [BLOQUEA] ¿Cuántas empresas hay hoy y cuáles son?**
Lista con RUC: ______________

**J.2 [BLOQUEA] ¿Hay operaciones entre las empresas?**
Facturas de una a otra, préstamos, gastos compartidos.
- [ ] Sí: ______________
- [ ] No

**J.3 ¿Hace falta ver reportes consolidados de todas las empresas juntas?**
- [ ] Sí
- [ ] No, cada empresa por separado

**J.4 ¿Un mismo proveedor o trabajador puede estar en varias empresas?**
- [ ] Sí, el maestro es compartido
- [ ] Cada empresa tiene su maestro

**J.5 [BLOQUEA] ¿Un usuario puede ver más de una empresa?**
- [ ] Sí, cambia de empresa con un selector
- [ ] Cada usuario pertenece a una sola

**J.6 [BLOQUEA] Lista de roles y qué puede hacer cada uno.**
El sistema ya tiene roles dinámicos. Necesitamos la lista real.

| Rol | Quién | Qué ve | Qué puede modificar |
|---|---|---|---|
| | | | |
| | | | |
| | | | |

**J.7 ¿Hay información que un rol no debe ver nunca?**
Sueldos, márgenes, datos de socios.
Respuesta: ______________

---

## Bloque K. Logística, inventario y guías de remisión

**K.1 [BLOQUEA] ¿La guía de remisión se emite desde el sistema o solo se registra la que ya existe?**
- [ ] Solo se registra la que emite otro sistema
- [ ] Se emite desde el ERP

**K.2 ¿Qué tipos de traslado hay?**
En las guías que nos pasaron vimos venta y traslado entre establecimientos.
- [ ] Venta
- [ ] Traslado entre almacenes propios
- [ ] Devolución
- [ ] Otro: ______________

**K.3 [BLOQUEA] ¿La guía se vincula a la factura?**
En la guía que revisamos aparece la referencia a la factura.
- [ ] Sí, siempre
- [ ] A veces
- [ ] No hace falta

**K.4 [BLOQUEA] ¿La entrada a inventario se dispara con la factura o con la guía?**
Kelly dijo que al registrar la factura de cinco amoladoras, el inventario se llena solo.
- [ ] Con la factura
- [ ] Con la guía de remisión
- [ ] Con la conformidad de recepción en obra

**K.5 ¿Qué se controla en inventario?**
- [ ] Herramientas y equipos, con código individual
- [ ] Materiales consumibles, por cantidad
- [ ] EPP
- [ ] Todo

**K.6 ¿Los materiales consumibles se descargan de inventario o se consumen al comprarse?**
Respuesta: ______________

**K.7 ¿Hay transferencias de herramientas entre obras? ¿Quién las autoriza?**
Respuesta: ______________

**K.8 [BLOQUEA] ¿Desde qué monto una herramienta o equipo va a activo fijo (33) y no a existencias o gasto?**
Cambia el asiento y arranca depreciación. La referencia tributaria es un cuarto de UIT.
- [ ] El sistema propone según el monto de la línea y Kelly confirma
- [ ] Kelly lo decide línea por línea, sin propuesta
- [ ] Otro criterio: ______________

**K.9 [DISEÑO] ¿Cómo se codifica lo que entra a inventario?**
Propuesta: prefijo por categoría más correlativo (HER-0042), editable. Una herramienta con código individual por unidad; los consumibles como un solo ítem con cantidad.
- [ ] De acuerdo
- [ ] Ya tienen una codificación que hay que respetar: ______________

---

## Bloque L. Contabilidad

**L.1 [BLOQUEA] Plan de cuentas.**
El PDF que nos pasaron es la edición 2010 del PCGE. La versión vigente es el PCGE modificado 2019, obligatorio desde enero de 2020.
- [ ] Usamos el modificado 2019, nos pasan el archivo correcto
- [ ] Usamos el plan que nos pasaron, es el que usa el estudio
- [ ] Kelly nos pasa su plan de cuentas real con las divisionarias que usa

**L.2 [BLOQUEA] ¿Hasta qué nivel de dígitos llegan las cuentas que se usan?**
- [ ] Cinco dígitos
- [ ] Seis
- [ ] Más

**L.3 [BLOQUEA] ¿Llevan contabilidad de costos, las cuentas de clase 9?**
- [ ] Sí
- [ ] No

**L.4 ¿El asiento se genera automático o Kelly lo arma?**
Hoy el sistema genera asientos desde los movimientos y además permite asientos manuales.
- [ ] Automático y Kelly corrige
- [ ] Kelly arma todo
- [ ] Automático sin intervención

**L.5 [BLOQUEA] Auxiliar por tercero en los reportes.**
Hoy el mayor no muestra el proveedor o cliente en cada línea. Kelly lo necesita para cuadrar cuentas por pagar.
- [ ] Sí, hace falta en mayor y balance
- [ ] Solo en un reporte aparte

**L.6 ¿Qué reportes contables necesita Kelly exactamente?**
- [ ] Libro diario
- [ ] Libro mayor
- [ ] Balance de comprobación
- [ ] Registro de compras
- [ ] Registro de ventas
- [ ] Análisis de cuenta por tercero
- [ ] Otro: ______________

**L.7 Estados financieros.**
Kelly dijo que prefiere no tocarlos todavía hasta definir con el estudio con qué NIIF se trabaja, y que a Mario lo que le interesa son los reportes.
- [ ] Confirmado, estados financieros quedan fuera de esta etapa
- [ ] Hace falta al menos un estado de resultados por proyecto

**L.8 ¿Cuándo se cierra el mes y quién lo autoriza?**
Respuesta: ______________

**L.9 ¿Se puede reabrir un mes cerrado? ¿Con qué autorización?**
Respuesta: ______________

---

## Bloque M. Migración y carga de datos

**M.1 [BLOQUEA] Confirmación: el histórico arranca en enero de 2026.**
- [ ] Correcto
- [ ] Otra fecha: ______________

**M.2 [BLOQUEA] ¿Qué se carga del histórico?**
- [ ] Todo el detalle de compras, ventas, bancos y planilla
- [ ] Solo saldos de apertura y de ahí en adelante el detalle
- [ ] Solo lo que ya está cargado

**M.3 ¿Hay saldos de apertura que respetar?**
Saldos de bancos, cuentas por pagar, cuentas por cobrar a la fecha de corte.
- [ ] Sí, nos los pasan
- [ ] No, se arma todo desde el detalle

**M.4 El Excel que nos pasaron tiene datos anteriores a enero y algunas imprecisiones.**
La propuesta es que la carga sea repetible: se borra y se vuelve a cargar las veces que haga falta hasta que cuadre, y recién después se hace el corte.
- [ ] De acuerdo
- [ ] Otra: ______________

**M.5 [DATO] ¿Nos pasan el Excel definitivo, ya depurado, o trabajamos con el que hay?**
Respuesta: ______________

**M.6 ¿Qué significa "cuadrado" para ustedes?**
Necesitamos un número contra el cual validar la carga.
- [ ] El saldo de cada banco al 31 de cada mes
- [ ] El total de compras del mes según el PLE
- [ ] Otra: ______________

---

## Bloque N. Operación diaria

Estas cierran cómo se usa el sistema, que es lo que más discrepancias genera después.

**N.1 ¿Cuántos documentos se registran al mes, aproximadamente?**
En el Excel de enero contamos alrededor de 2,800 filas de compras y 3,600 de bancos, pero incluyen meses anteriores.
Respuesta: ______________

**N.2 ¿Quién registra: una persona o varias en paralelo?**
Respuesta: ______________

**N.3 ¿Se registra desde obra o solo desde oficina?**
- [ ] Solo oficina
- [ ] También desde obra, con celular

**N.4 ¿Hay que trabajar sin internet en obra?**
- [ ] Sí
- [ ] No

**N.5 ¿Qué es lo primero que Mario mira cuando abre el sistema?**
Define el tablero principal.
Respuesta: ______________

**N.6 ¿Qué reporte es el que hoy más trabajo cuesta armar a mano?**
Es el que da mayor retorno automatizar primero.
Respuesta: ______________

---

## Anexo 1. Decisiones ya tomadas

No se vuelven a discutir salvo que alguien las objete en la reunión.

- No se usan APIs externas de SUNAT en esta etapa. La validación de RUC y el tipo de cambio se ingresan a mano o se importan.
- La reestructuración de Finanzas es visual. No se elimina lo que ya existe.
- Los estados financieros quedan pendientes hasta definir NIIF con el estudio externo.
- Kelly decide la cuenta contable. En proyecto la cuenta es informativa.
- Las guías de remisión entran en alcance.
- El detalle por línea en compras entra en alcance.
- La captura de gastos y egresos está unificada en un solo formulario.

## Anexo 2. Lo que proponemos dejar explícitamente fuera

Confirmar en la reunión que ninguno de estos hace falta, para que no aparezcan después.

- Facturación electrónica propia con envío a SUNAT y OSE.
- Consultas en línea a SUNAT: validez de comprobante, ficha RUC, tipo de cambio.
- PLAME y T-Registro.
- Estados financieros con NIIF.
- Presupuesto de obra y control de avance físico más allá de lo que ya existe.
- Firma digital de documentos.

## Anexo 3. Archivos que necesitamos

- [ ] XML de compra con detracción
- [ ] XML de compra con retención de IGV
- [ ] XML de nota de crédito
- [ ] Plan de cuentas real que usa Kelly, con divisionarias
- [ ] Excel de planilla obrera, versión definitiva
- [ ] Excel de planilla de oficina
- [ ] Extracto bancario de ejemplo, uno por banco
- [ ] Formato que exige el estudio contable externo
- [ ] Lista de empresas con RUC
- [ ] Lista de cuentas bancarias
- [ ] Lista de personal con tipo de vínculo
