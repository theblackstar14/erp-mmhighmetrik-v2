# ERP MM High Metrik · Qué se construyó, por qué, y casos de uso para la sesión con Kelly

> Documento de trabajo para la validación con la contadora. Cada sección del sistema
> existe por un requisito explícito de Kelly (audios de la reunión de requerimientos,
> transcritos en `AUDIO-KELLY-1/2.txt`), una decisión de Mario (`AUIDO-MARIO.txt`) o una
> obligación SUNAT. Este doc mapea sección → qué dijo el cliente → cómo probarla.
>
> **Criterio de aceptación global (acordado):** un mes real cerrado por Kelly, cuadrado
> contra el estudio contable y contra el extracto bancario.

---

## 1 · En palabras de Kelly y Mario (citas de los audios)

Lo que pidieron, textual, y qué se construyó con cada pedido:

| Cita (transcripción) | Qué se construyó |
|---|---|
| *"Yo quiero mandarlos manualmente las cuentas contables porque a veces hago el análisis de distinta forma. Por ejemplo un gasto de EPPs: cuando se inicia el proyecto es mi costo directo de materiales… pasa un mes y me vuelven a pedir EPPs por un accidente, entonces eso ya no viene a ser parte de esa cuenta."* | **Cuenta contable manual en todo registro** (compra, gasto, pago, ingreso, bancario). El sistema solo sugiere; Kelly decide. |
| *"Yo voy a crear divisionarias… tienes la 1041, a partir de la 1041 en adelante se crea: 1041801 BCP Soles, BCP Dólares, BCP Soles 2… Y me voy a la cuenta 45: 45112 para pagar préstamos de BCP."* | **Divisionarias libres** bajo cualquier cuenta madre en el Plan contable; cada cuenta bancaria mapeada a su divisionaria 104x. |
| *"Te voy a mandar igual la dinámica… la dinámica es un libro."* | Plan PCGE cargado con la dinámica que ella maneja; ampliable por ella misma. |
| *"Todos los meses recibimos detracciones… yo te paso mi tablita, porque no solamente trabajo con estas cuatro detracciones."* | **Catálogo completo de detracciones (~48 códigos)** de su tabla, elegibles por código en cada compra. |
| *"La retención es 3%… la retención fue en honorarios de cuartos distintos."* | Retención IGV 3% tipada (ventas con cliente agente → 40114) y renta de 4ta 8% en recibos por honorarios. |
| *"Me interesa hacer mis asientos contables de provisión… provisiones es la cuenta 48. Yo estoy pagando ahorita pero todavía no me emiten la factura. Hago mi cierre contable y el siguiente mes tengo un montón de 48, voy, reviso, ya le he pagado a tal y tal, cuántas facturas me faltan."* | **Provisiones cuenta 48**: pago sin factura → 4811; al llegar el comprobante, extorno automático. Subtab propia en Compras y punto del checklist de cierre. |
| *"¿Ingresos sí o sí siempre tenemos que poner facturas? No quiero que sea necesario… hay ingresos que no van a tener factura… deseo que no sea condicional."* | **Documento NO condicional** en ingresos y pagos por fuera — basta la glosa (y el contrato si aplica). |
| *"Cuando yo voy a sacar mi libro de caja para compararlo, tiene que estar con el número de operación… sí necesito que vayan los números de operación."* | **N° de operación obligatorio** en todo movimiento bancario; es la llave de conciliación y del cruce con cajas. |
| *"Muy aparte de las cuentas corrientes también vamos a llevar el control de la cuenta de detracciones, que es una cuenta del Banco de la Nación, únicamente sirve para pagar impuestos."* | Cuenta BN de detracciones como cuenta más del sistema (1071), conciliable. |
| *"Yo necesito registro de compras y ventas… voy a enviar una captura del registro con el que yo trabajaba antes, que jalaba directamente al libro de compras, y me gustaría así, que genere TXT esto, TXT para SIRE."* | Tabs **Compras** y **Ventas** en Finanzas con registro estilo Nubefac; **TXT PLE (5.1/6.1/8.1/14.1) y TXT SIRE (RCE/RVIE)** descargables por período. |
| *"Que te tomes como ejemplo lo que tiene la facturación de Nubefac para registrar la factura… ítems, cantidades, valor, IGV, si las facturas tienen anticipo."* | Formulario de compra/venta con líneas completas (ítem, cantidad, valor, IGV), anticipos 422 y pago parcial. |
| *"Si has registrado en compras la factura F001-16, te vas a banco… pongo el proveedor y me jala la factura, automáticamente me jala todos los datos."* | **Pago bancario jala las facturas pendientes del proveedor** y las aplica (parcial o total, N facturas por pago). |
| *"Estamos pagando la número diez y solamente el 50%… cuando jale el reporte me va a salir la diferencia que todavía está pendiente."* | Pago parcial con saldo pendiente visible en CxP y en el Auxiliar por tercero. |
| *"Nosotros armamos cajas: yo le doy 100 soles a Andrea para que me rinda… en vez de jalar factura por factura, un registro de cajas: encargado, monto dado, y jala con el número de operación del egreso, porque nosotros primero damos el dinero y después nos rinden… ya tengo un cruce del dinero que le di con la caja registrada."* / *"Caja por obra… sí, por proyecto. Solo por proyecto, y le pones quién es la persona encargada."* | **Cajas y rendiciones por proyecto**: entrega sale del banco con N° de operación, la caja es una cuenta más, sus gastos se registran contra ella, cierre devuelve el saldo. |
| *"Cuando yo me voy a conciliar bancos, todos los bancos me tienen que salir referidos con sus facturas, con sus cajas, y si son pagos por fuera pues la glosa… yo comparo con mi estado de cuenta y digo ya, sí, chao."* | **Conciliación**: import del EECC PDF, match automático contra facturas/cajas/movimientos, y lo no registrado se registra desde la línea del banco. |
| *"Las comisiones y todo eso [ITF]… automáticamente en la conciliación bancaria lo va a detectar. Rara vez vas a agregar un ITF ahí."* | Cargos del banco (ITF → 6412, comisiones → 679) detectados y registrados en lote desde el extracto. |
| *"Mejor sería que los reportes los vincules a sacarlos por cuentas… cuentas por pagar: toda mi línea 42 con todos los proveedores, cuenta 45 con todos los bancos, cuenta 41 con todos los sueldos por pagar."* | **Reportes por cuenta contable** (CxP 42/45/41, CxC 12) + Auxiliar por tercero (mayor por RUC) con aging, export Excel plano. |
| *"Boletas te voy a enseñar que no se registren en el registro de compras."* | **Regla dura: boleta = gasto, NO entra al 8.1/RCE**; su IGV va al costo. |
| *"El registro en el NAS, porque se guarda todo por trazabilidad."* | Sustento de archivos previsto vía NAS (campo por ítem de rendición + tabla de adjuntos); el cableado del NAS es pendiente conocido. |
| *"Estados financieros: hay que ver con qué NIIF se va a trabajar… prefiero verlo una vez pueda verlo bien con el estudio. Lo que más le interesa a Mario es los reportes."* | **EEFF finos en pausa** (decisión de Kelly); el sistema entrega balance/resultados básicos y prioriza reportes. |
| *"Acá voy a hacer un manejo en mi orden… para hacer comparación con el estudio contable."* | El criterio 100%: un mes cerrado en paralelo contra el estudio. |
| Mario: *"Si yo entro del celular, pico el proyecto: monto del proyecto, cuánto vamos gastando, cuánto vamos valorizando… luego el presupuesto… y las órdenes de servicio comprometidas con cada proveedor."* | Vista por proyecto (contrato/gastado/valorizado/utilidad) + OC/OS comprometidas. |
| Mario: *"Sale un nuevo proyecto, no nace con plata, necesita la inversión de los socios… para que cuando se haga el cierre del proyecto se devuelva el monto del inversionista."* | Inversionistas por proyecto (registro de aportes y devolución al cierre). |
| Kelly (planillas): *"Planilla de construcción para la gente obrera, planilla para la gente de oficina, recibo por honorarios, y personal por fuera… todos registrados acá para yo llevar un control."* | Planillas separadas (obreros/oficina), RH 4ta, personal por fuera como gasto 63. |

---

## 2 · Mapa del sistema: módulo → tab → subtab, con su flujo

### Módulo FINANZAS (el registro diario — lo operan Kelly/Andrea)

**Resumen** — ingreso, gasto, margen, por cobrar, por pagar, posición de caja. Kelly en el audio: *"como ves ahí el ingreso, gasto, margen, crédito, por cobrar, por pagar, posición de la caja — no necesitas agregar nada más"*.

**Compras** — 3 subtabs:
- *Registro*: la lista de compras del período. Flujo de alta (botón Registrar movimiento → Compra): RUC → autocompleta razón social (maestro → historial → API SUNAT, alta silenciosa del proveedor nuevo) → opcionalmente elegir OC (precarga líneas y compara OC vs factura) → comprobante (factura/RH; la boleta se registra pero NO va al 8.1) → líneas con partida y cuenta por línea → detracción por código + retención tipada → destino del crédito (DG/DGNG/DNG) → período de anotación si difiere del mes → CxP nace pendiente o pagada. Duplicado RUC+serie+número → rechazo 409.
- *Bandeja CPE*: Kelly sube XML en masa; cada uno queda como borrador clasificado (factura=compra, boleta=gasto, NC=vincula, duplicado=rechaza) para confirmar con 1 revisión. Detalle abajo.
- *Provisiones 48*: pagos sin factura esperando comprobante; al llegar, se vincula y el sistema extorna la 4811.

> **¿Para qué sirve la Bandeja CPE? (uso para la contadora)** Es el buzón de comprobantes
> electrónicos: Kelly arrastra los XML (hasta 50 por tanda, 2 MB c/u) que bajó del buzón SOL o que
> le mandó el proveedor, y el sistema los lee y los deja pre-armados. Responde literalmente a su
> pregunta del audio: *"¿me has cargado todos los comprobantes acá para registrar?"*.
>
> **Por qué existe (el problema que mata):** tipear una factura a mano son ~15 campos, y cada uno
> es una oportunidad de error que después SUNAT cruza contra el XML del emisor (RUC, razón social,
> serie, número, fecha, moneda, base, IGV, total, código y monto de detracción). El XML ES el
> documento legal; tipearlo de nuevo es copiar a mano algo que ya viene en formato máquina.
> La bandeja invierte el trabajo: el sistema pone los datos duros y Kelly solo pone lo que ningún
> XML puede saber — **cuenta contable y destino (obra/oficina)**, que es exactamente donde ella
> quiere decidir.
>
> **Qué hace el lector (`leerCpe`, UBL 2.1):** identifica el tipo por la raíz del XML
> (`Invoice`=01/03, `CreditNote`=07, `DebitNote`=08), extrae emisor/cliente/serie/número/fecha/
> moneda/líneas/totales, y saca la **detracción declarada en el propio XML** (código + monto).
>
> **4 controles automáticos antes de que el XML entre a la bandeja:**
>
> | Control | Qué hace |
> |---|---|
> | **Compra o venta (rol)** | Compara los RUC del XML con el RUC de la empresa activa: cliente=nosotros → compra; emisor=nosotros → venta. Si no aparece ninguno → **rechazo `EMPRESA_AJENA`** (el XML es de otra empresa, no se cuela). |
> | **Clasificación** | factura (01) → borrador de compra · boleta (03) → gasto (**no entra al 8.1/RCE**, su regla) · NC (07) → se vincula al documento que modifica · ND (08) → nota de débito. |
> | **Duplicado** | dos niveles: (a) `hash` del XML único → subir el mismo archivo 2 veces = `duplicado_xml`; (b) contra el Registro de compras por RUC+serie+número → `ya_registrada`. Ninguno de los dos entra. |
> | **Detracción validada** | busca el código en la tabla de 48 tasas vigentes a la fecha de emisión, recalcula el monto y lo **compara contra lo declarado en el XML**. Si el código no está vigente, o falta el TC de la fecha en compras en moneda extranjera, lo dice con nombre propio. |
>
> **Flujo:** subir XML → bandeja (estado `pendiente`, contador en la pestaña) → por cada uno
> **Completar** (elegir cuenta contable + destino; el resto ya viene) o **Descartar con motivo**.
> Al completar, el alta real la hace el mismo endpoint de siempre (`POST /gastos` o `POST /ventas`)
> — la bandeja no es una vía paralela de registro, solo el pre-llenado — y el borrador queda
> `registrado` y ligado al gasto/venta creado. Nada se escribe en el Registro sin que Kelly
> confirme: la bandeja es una **sala de espera con trazabilidad**, no un importador ciego.
>
> El Resumen tiene una tarjeta de acción ("N XML en la bandeja CPE · falta asignarles cuenta y
> destino") que salta directo acá, para que no se olviden borradores colgados.

**Ventas** — valorizaciones facturadas (capturan serie/número del comprobante electrónico real al facturar) + ventas standalone (01/03/07/08). NC referencia al comprobante que modifica. Retención IGV 3% si el cliente es agente. Todo alimenta 14.1/RVIE.

> **Cancelar/reducir un documento por Nota de Crédito (07)** — el ERP distingue dos cosas que
> suelen confundirse: la **NC**, que es tributaria y va a los libros, y la **anulación**, que es
> interna y borra un error del ERP. No son intercambiables.
>
> **1 · NC de VENTA (nosotros emitimos).** Registrar la NC exige la factura que modifica
> (serie+número): sin eso, rechazo 400. El sistema busca la **CxC abierta** de esa factura (mismo
> cliente) y si no existe devuelve 404 — no se puede aplicar una NC contra algo que no está en el
> libro. Si existe, aplica sobre esa CxC `min(total de la NC, saldo pendiente)` — o sea, una NC
> total deja la factura en 0 (cancelada) y una parcial solo baja el saldo; nunca deja saldo
> negativo. La NC **no genera CxC propia** ni detracción.
> *Asiento (invertido respecto de la venta):* 7041 (o la cuenta manual) al **debe** por la base,
> 40111 al **debe** por el IGV (reversa del débito fiscal), 1212 al **haber** por el total.
> *En el 14.1/RVIE:* la NC se guarda con total positivo pero **entra al registro con signo −1**
> (base, IGV y total negativos, como exige SUNAT) y los campos 27-30 llevan tipo/serie/número del
> comprobante modificado.
>
> **2 · NC de COMPRA (el proveedor nos la emite).** Misma exigencia: debe indicar la factura que
> modifica, y debe existir la **CxP** de ese proveedor con ese serie+número (404 si no). Aplica
> contra esa CxP y baja lo que debemos.
> *Asiento (invertido respecto de la compra):* 4212 al **debe** por el total (deja de ser deuda),
> la cuenta de gasto al **haber** (el costo se va), 40111 al **haber** (se devuelve el crédito
> fiscal que se había tomado). Esto fue un fix explícito (F3.5): antes la NC de compra se asentaba
> como una compra normal y **duplicaba el gasto**.
> La NC de compra tampoco genera detracción ni liga OC.
>
> **3 · Lo que NO es una NC: la anulación.** Si el documento nunca debió existir (se tipeó mal, se
> registró dos veces), no se emite NC: se **anula formalmente**. El movimiento/asiento no se borra
> nunca — queda marcado como anulado con usuario, fecha y motivo obligatorio, con su contra-asiento
> y su entrada en el `audit_log`. Criterio práctico para Kelly: *si SUNAT ya vio el comprobante
> (está declarado/aceptado) → NC. Si el error es solo del ERP → anulación.*
>
> **Gap anotado:** en el 14.1 el campo "tipo de CP que se modifica" se emite fijo `01` (factura).
> Si Kelly emite NC sobre boletas (03) hay que leerlo del documento original — pendiente chico,
> preguntárselo en la sesión (CU-7).

**Caja y bancos** — 4 subtabs:
- *Libro por cuenta*: el libro de cada cuenta (bancos, BN detracciones, cajas) con N° de operación.
- *Todos los movimientos*: flujo consolidado de todas las cuentas.
- *Cajas y rendiciones* (= cajas de OBRA): Nueva entrega (proyecto obligatorio + encargado + monto + banco origen + N° operación) → la caja se vuelve una cuenta → los gastos del encargado se registran contra ella (jalan facturas igual que un banco) → tabla Entregado/Rendido/Saldo → Cerrar devuelve el saldo al banco. *Nota: los viáticos/reembolsos de EMPLEADOS y la caja chica de OFICINA van por el módulo Oficina → Rendiciones (ahí el proyecto es opcional y null = oficina).*
- *Cuentas*: alta de cuentas y asignación de su divisionaria 104x.

**Conciliación** — bandeja única con 6 vistas (Pendientes / Sugeridas / Cargos del banco / Sin pareja / Resueltas / Todas):
1. Importar EECC PDF (BCP) eligiendo la cuenta del archivo → el parser lee las líneas y el bloque RESUMEN (saldo oficial impreso).
2. Sugeridas: match automático por N° operación + monto → Confirmar en lote.
3. Cargos del banco (ITF/comisiones) → Registrar en lote con cuenta editable (6412/679).
4. Sin pareja: lo que está en el banco y no en el ERP → "Registrar desde extracto" abre el formulario prellenado (fecha, monto, N° op) y concilia al guardar. Lo que está en el libro y no en el banco queda como papel de trabajo del cierre.
5. El panel de cuadre compara contra el **saldo oficial** del EECC; si la lectura del PDF perdió líneas lo dice con monto.

**Reportes** — por cuenta contable (la regla de Kelly): CxP (42/45/41), CxC (12), detracciones, utilidad por proyecto, costos de obra CD/GG, Auxiliar por tercero (mayor por RUC + aging). Export Excel plano. *Pendiente anotado: filtros del auxiliar Cuenta + RUC + rango de períodos.*

### Módulo CONTABILIDAD (el cierre — lo opera Kelly)

**Plan contable** — plan PCGE con divisionarias libres + segmento **"Ruteo por tipo de gasto"**.

> **¿Para qué sirve el Ruteo? (uso para la contadora)** Es una tabla de configuración editable —
> una fila por tipo de gasto (Materiales, Seguro, Combustible…) — con 4 columnas y 4 usos:
>
> | Columna | Uso |
> |---|---|
> | **Cuenta PCGE** | Red de seguridad de la cuenta, nivel 3 de 3. La cuenta de una compra se decide: 1º la que Kelly eligió a mano (**siempre manda** — su requisito), 2º la sugerida (última usada con ese proveedor), 3º recién la del ruteo. Lo que nadie revisó nunca cae en un hueco. |
> | **Es gasto (sí/no)** | Gobierna el motor: un tipo marcado "no es gasto" (financiamiento, préstamo, CxC) **no se provisiona como compra** al generar el Diario — evita gasto fantasma en resultados. |
> | **Es activo** | Marca los tipos que son activo fijo (33x, no resultado) — los 5 taladros del audio. |
> | **Clase CD/GG** | Alimenta la clasificación de costos de obra (Costo Directo / GG obra / GG corporativo) → reporte de costos y Resultado de obra de Mario. Es la mecánica detrás del ejemplo de los EPPs de Kelly: mismo tipo de compra, clase distinta según el momento/destino. |
>
> En una frase: *no elige la cuenta por Kelly — atrapa lo que quedó sin decisión manual y le dice
> al motor qué cosas ni siquiera son gasto.* Ella lo mantiene sola, sin tocar código.
> Mejora futura anotada: contador de "compras del mes que cayeron al ruteo" para repasarlas antes del cierre.

**Diario y mayor** — hub con 2 vistas (Diario · asientos / Mayor · por cuenta). Botón **Generar**: asienta todo lo devengado/cobrado del período que aún no tiene asiento (idempotente: regenerar no duplica). Banner de cobertura dice qué orígenes faltan.

**Cierre del mes** ⭐ — checklist vivo de 5 puntos: (1) todo asentado, (2) banco conciliado, (3) provisiones 48 del mes resueltas, (4) invariante libro 104x = tesorería (con desglose por cuenta si difiere), (5) pre-cierre técnico. Cerrar congela el período (row-level freeze, editar → 423) con snapshot hasheado; reapertura solo formal y auditada. Segmento Auditoría con el log.

**Libros y SIRE** — subtab *PLE y SIRE*: descarga de TXT 5.1/6.1/8.1/14.1 (estructura oficial Anexo 2 Ver 5, en ANSI, verificada por test automático) y RCE/RVIE (borrador de reemplazo de propuesta SIRE). Subtab *IGV y Renta del mes*: IGV ventas − crédito usable (con el **crédito diferido** por detracción sin constancia restado y visible) → IGV a pagar; renta MYPE.

**Estados Financieros** — balance/resultados básicos. NIIF finas con el estudio (decisión de Kelly).

### Módulo OFICINA (administrativo)

**Rendiciones** — viáticos/reembolsos/anticipos de EMPLEADOS: empleado + modo (reembolso/anticipo) + estados (borrador→pendiente→aprobado→rendido→cerrado) + ítems con comprobante chico (boleta/factura/RH/recibo, categoría, deducible sí/no, archivo NAS). Proyecto opcional: null = gasto de oficina. La captura la hace la contadora (no self-service). También: planilla de oficina, asistencia (reloj Zlink).

---

## 3 · Por qué cada cosa está donde está (justificación rastreable)

**K** = requisito de Kelly (audio), **M** = Mario, **S** = norma SUNAT, **D** = decisión de diseño validada con el usuario.

| # | Decisión | Origen | Detalle |
|---|---|---|---|
| 1 | Cuenta contable manual en todo registro | K | Cita del EPP (§1). El ruteo es solo fallback. |
| 2 | Divisionarias libres | K | 1041801 BCP Soles, 45112 préstamo (§1). |
| 3 | N° de operación obligatorio en bancos | K | Llave del libro de caja vs extracto (§1). |
| 4 | Documento NO condicional | K | "Deseo que no sea condicional" (§1). |
| 5 | Boleta NO entra al 8.1/RCE | K | Regla explícita (§1); IGV al costo. |
| 6 | Provisiones 48 con extorno | K | Cita completa del flujo 48 (§1). |
| 7 | Detracción por código + constancia | K+S | Su tabla completa; sin constancia el crédito queda diferido (RS detracciones). |
| 8 | Retención IGV 3% en ventas | K | Cliente agente → 40114. |
| 9 | Período de anotación ≠ emisión | S | Crédito fiscal hasta 12 meses; 8.1 estado '6'. |
| 10 | Destino DG/DGNG/DNG | S | Campos 14-19 del 8.1. |
| 11 | Duplicado RUC+serie+número → 409 | D | Anti doble registro. |
| 12 | Pago jala facturas y cancela cuenta control | K+D | Cita F001-16 (§1); sin esto el gasto se duplicaba al pagar. |
| 13 | Conciliación contra saldo oficial del EECC | D | El banco es la verdad; lectura perdida se reporta con monto. |
| 14 | Registrar desde extracto prellenado | K | "Comparo con mi estado de cuenta y digo ya, sí, chao" (§1). |
| 15 | Cargos del banco en lote (6412/679) | K | "Automáticamente lo va a detectar" (§1). |
| 16 | Cierre del mes con checklist y freeze | D | El cierre es el evento del mes; cerrado = congelado + snapshot + reapertura formal. |
| 17 | TXT PLE estructura oficial Ver 5 en ANSI | S | 21/21/41/34 campos; test automático; revisión externa aplicada (§6). |
| 18 | SIRE separado del PLE | S | SIRE solo compras/ventas; Diario/Mayor siguen por PLE siempre. Confirmar con Kelly desde cuándo MM está obligada al SIRE. |
| 19 | Saldo obra CD/GG + prorrateo + sobrecosto confirmado | M+D | Control por proyecto; sobrecosto = confirmación explícita, no bloqueo. |
| 20 | Vista por proyecto móvil | M | Cita del celular (§1). |
| 21 | OC precarga compra (3-way) | D+M | OC=compromiso, compra=devengado. |
| 22 | Multimoneda USD + TC SUNAT + dif. cambio 675/776 | K+S | PCGE 2020. |
| 23 | EEFF finos en pausa | K | Cita NIIF (§1). |
| 24 | Auxiliar por tercero en Finanzas | D (usuario) | Herramienta diaria de cobranza/pago, no de cierre. |
| 25 | Cajas de obra ≠ rendiciones de empleados | K+D | Kelly describió la caja de obra (§1); los viáticos de oficina son otro flujo (Oficina). |

---

## 4 · Casos de uso para la sesión con Kelly

Guion sugerido: 90–120 min, en orden. Cada caso tiene **pasos** y **qué debe validar Kelly**.
Si algo no cuadra con su criterio contable, se anota y se ajusta — para eso es la sesión.

### CU-1 · Compra con factura y detracción
1. Finanzas → Registrar movimiento → Compra. RUC real de un proveedor suyo → autocompleta razón social.
2. Factura F001-xxx, líneas con partida, código de detracción de su catálogo, destino DG.
3. **Valida:** cuenta sugerida vs la suya (es manual), asiento generado (60x/40111/4212 con detracción segregada), la factura en CxP y en el 8.1.
4. Libros → IGV del mes: el IGV aparece como **crédito diferido** (sin constancia).
5. Extra: registrar otra compra SIN elegir cuenta → verificar que cae a la cuenta del **Ruteo por tipo de gasto** (Plan contable) y preguntarle si el mapa tipo→cuenta refleja su dinámica.

### CU-2 · Constancia de detracción
1. Registrar N° de constancia y fecha de depósito sobre CU-1.
2. **Valida:** crédito pasa a usable; el 8.1 llena campos 31 (fecha) / 32 (número).

### CU-3 · Boleta
1. Registrar una boleta de gasto.
2. **Valida:** NO aparece en 8.1/RCE; IGV al costo. (Su regla.)

### CU-4 · Pago aplicando facturas
1. Registrar movimiento → Pago → proveedor de CU-1 → aparecen sus facturas pendientes → pagar parcial.
2. **Valida:** CxP baja solo lo aplicado; el asiento cancela la 4212 (no re-toca el gasto); saldo visible en Auxiliar.

### CU-5 · Provisión 48
1. Pago SIN factura marcando provisión → 4811. 2. Llega la factura: registrarla vinculada.
3. **Valida:** extorno automático de la 48 y devengo normal.

### CU-6 · Venta / valorización
1. Facturar una valo capturando serie/número reales.
2. **Valida:** 14.1/RVIE con el comprobante real.

### CU-7 · Cancelación por Nota de Crédito (07) — venta y compra
1. **NC de venta:** emitir NC (07) referenciando la factura → verificar que baja el saldo de la CxC (total = cancela, parcial = reduce) y que el asiento sale invertido (7041 y 40111 al debe, 1212 al haber).
2. **NC de compra:** registrar una NC del proveedor contra una factura existente → verificar que baja la CxP y que el gasto y el crédito fiscal se **reversan** (no que se duplique el gasto — ese era el bug F3.5).
3. Intentar una NC **sin** indicar el documento que modifica → rechazo 400. Sobre una factura que no está en el libro → 404.
4. **Valida:** la NC entra al 14.1 con signo negativo y los campos 27-30 con el comprobante modificado.
5. **Preguntarle:** ¿emite NC sobre **boletas** (03)? Hoy el 14.1 pone fijo `01` en el campo "tipo de CP que se modifica". ¿Y cuándo prefiere **anular** (error solo del ERP) en vez de emitir NC (SUNAT ya lo vio)?

### CU-8 · Conciliación bancaria (el plato fuerte)
1. Importar el EECC de enero (PDF BCP real) eligiendo la cuenta.
2. Sugeridas → Confirmar en lote. 3. Cargos del banco → Registrar en lote.
4. Una línea Sin pareja → "Registrar desde extracto" → formulario prellenado.
5. **Valida:** el cuadre usa el saldo oficial impreso; % sube en vivo; los sin-pareja restantes son su trabajo real (factoring DSCTO +316,975.55, DEVOL +2,677.50) — preguntarle qué son y a qué cuenta van.

### CU-9 · Caja de obra
1. Nueva entrega a rendir (proyecto + encargado + N° operación del egreso) → registrar 2 gastos contra la caja → cerrar con devolución del saldo.
2. **Valida:** el cruce banco↔caja por N° de operación (su cita textual) y que los gastos caigan al proyecto.

### CU-9b · Rendición de empleado (Oficina)
1. Oficina → Rendiciones: anticipo a un empleado SIN proyecto (= oficina) → items con boletas (deducible/no deducible) → aprobar y rendir.
2. **Valida:** que su flujo real separe igual obra (Finanzas→Cajas) vs oficina/viáticos (aquí); dónde espera adjuntar la boleta escaneada (campo NAS por ítem).

### CU-10 · Compra desde OC
1. Compra eligiendo OC aprobada → precarga líneas; box compara OC vs factura.
2. **Valida:** diferencia visible; la OC ligada sale del selector.

### CU-11 · Cierre del mes ⭐
1. Contabilidad → Cierre del mes → recorrer el checklist (Generar si falta asentar; invariante con desglose).
2. Cerrar → intentar editar un movimiento del mes → rechazo 423. Reapertura formal si necesita corregir.
3. **Valida:** ¿el checklist refleja SU rutina? ¿Falta un paso suyo (planillas, depreciación)?

### CU-12 · Libros y tributos
1. Descargar TXT 5.1/6.1/8.1/14.1 → que los abra y revise columnas contra lo que presenta hoy (ya están en ANSI y con CUO cruzado entre libros).
2. Descargar RCE/RVIE → **pedirle un archivo real de importación SIRE** para validar el formato.
3. IGV y Renta: crédito usable vs diferido, a pagar.
4. **Preguntarle:** ¿desde cuándo MM está obligada al SIRE?

### CU-13 · Compra en dólares
1. Compra USD → botón TC SUNAT (o TC manual); pagar después con otro TC.
2. **Valida:** asiento en PEN al TC histórico; diferencia de cambio 675/776. *Nota: el 8.1 exige TC en compras USD — si la compra no lo trae, el export cae al TC de la tabla (fecha más cercana anterior); la tabla debe tener los TC del mes cargados.*

### CU-14 · Auxiliar por tercero
1. Buscar un RUC con deuda. 2. **Valida:** ¿sirve el aging? Confirmar los filtros pedidos (cuenta + RUC + rango de períodos).

### Cierre de la sesión — pedirle a Kelly
- Todo lo que haría distinto (cuentas, textos, orden de campos).
- El mes real que va a cerrar en paralelo con el estudio (criterio 100%).
- Archivo SIRE real de importación; las 15 facturas de ventas con las NC de E001-101/102; dinámica de divisionarias faltante; fecha de obligación SIRE de MM.

---

## 5 · Data para los casos de uso — auditoría de `erp_mmh_test` (2026-09-30)

Medido con `apps/backend/scripts/f1/audit-data-casos-uso.ts` (re-corrible antes de la sesión).

### Verde · el CU se puede hacer con data real, sin tocar nada

| Apartado | Data |
|---|---|
| **Contabilidad · Diario y mayor** | 3,610 asientos registrados en 11 períodos (2025-09 → 2026-09). **Debe = Haber exacto (dif 0.00) en los 11**. Enero 2026: S/1,378,927.05; febrero: S/1,560,089.32. |
| **Contabilidad · Plan contable / Ruteo** | 1,814 cuentas PCGE, 33 filas de ruteo tipo→cuenta, 14 filas de mapa cuenta→clase. |
| **Contabilidad · Libros y SIRE** | los 6 TXT salen con data real (enero: 1,139 líneas de diario, 206 compras). |
| **Finanzas · Compras (Registro)** | 1,576 compras, S/1,740,277.43, **todas con cuenta contable asignada**. 24 en USD. |
| **Finanzas · Caja y bancos** | 2,421 movimientos en 10 meses (egresos + ingresos por mes). |
| **Finanzas · Conciliación** ⭐ | 2 extractos reales: **Ene2026 BCP** 215 líneas (184 conciliadas / 31 sueltas) y **Abr2026** 202 líneas (166 / 36). Es el CU más sólido. |
| **Finanzas · Reportes / Auxiliar** | 5 CxC abiertas (1212, S/191,498.30) + 4 CxP abiertas (4212, S/35,000.00) → el aging tiene con qué. |
| **Contabilidad · Cierre del mes** | 2026-01 a 2026-09 **abiertos** (se puede cerrar en vivo); 2025-02 cerrado y 2025-04 reabierto ya sirven para mostrar el freeze 423 y la reapertura auditada. |
| **Logística · OC** | 60 OCs (15 aprobadas, 15 emitidas, 15 entregadas, 15 por aprobar) para el selector del 3-way. |
| **Catálogos** | 48 tasas de detracción, 226 filas de catálogos SUNAT, 5 proyectos (PG0001 en liquidación con presupuesto CD/GG). |

### Ámbar · hay data pero es mínima — el CU se hace, se ve pobre

| Apartado | Data real | Qué falta |
|---|---|---|
| **Ventas** | 2 facturas sueltas (2025-01 y 2025-06) + 5 valorizaciones cobradas (3 facturadas, 2 con retención de garantía) | las 15 facturas reales E001-89..103 |
| **Detracciones** | 2 documentos, S/16,707.00, ambos `pendiente` y **0 con constancia** | una con constancia para mostrar el crédito pasando de diferido a usable (CU-2) |
| **Cajas de obra** | 1 caja abierta, 1 obra | una caja con 2-3 gastos y un cierre con devolución (CU-9) |
| **Rendiciones de oficina** | 1 aprobada, S/800 de anticipo, **0 ítems y 0 archivos** | ítems con boletas (deducible/no) para CU-9b |
| **Bandeja CPE** | 3 borradores: 2 registrados (facturas de venta) + **1 pendiente que es justo una NC (07) de venta** | 3-4 XML de compra para la subida en masa (CU-1 vía bandeja) |

### Rojo · el CU NO tiene data — hay que cargarla o el caso no se puede mostrar

| Falta | Bloquea | Nota |
|---|---|---|
| **TC USD del mes**: la tabla `tipo_cambio` solo tiene 2 filas (2026-09-28 y 29) | CU-13 y el campo 25 del 8.1 en las 24 compras USD | el export cae al TC más cercano anterior; sin TC del mes queda vacío |
| **Provisiones 48**: 0 filas (no hay ninguna CxP con cuenta de control 4811) | CU-5 completo (provisión → llega factura → extorno) | crear 1 pago sin factura y luego vincularla |
| **NC de compra**: 0 en 1,576 gastos | la mitad "compra" de CU-7 | registrar 1 NC contra una factura existente |
| **Compra ligada a OC**: 0 gastos con `orden_compra_id` | CU-10 (3-way match) — hay OCs pero ninguna facturada | registrar 1 compra desde una OC aprobada |
| **Aplicaciones de pago**: 1 sola, y está anulada | CU-4 (pago que jala facturas pendientes) | hacer 1 pago aplicando 2 CxP |
| **Anotación en período posterior**: `periodo_contable` es NULL en las 1,576 compras (cae al mes de emisión) | el estado `'6'` del 8.1 (crédito fiscal usado tarde) | registrar 1 compra con período de anotación ≠ emisión |

**Resumen honesto para la sesión:** conciliación, diario/mayor, libros PLE, compras, cierre y
auxiliar están listos con data real. Ventas, detracción con constancia, provisión 48, NC, OC→factura
y pago aplicado necesitan **6 registros de siembra** (~20 min) o se demuestran capturándolos EN VIVO
con Kelly, que es probablemente mejor: así ella ve el flujo de alta, no solo el resultado.

Sigue pendiente de Kelly: las 15 facturas reales (bloqueadas por las NC de E001-101/102), un archivo
SIRE real de importación, y el mes completo del cierre en paralelo (= reseed F4.2).

---

## 6 · Revisión externa de los TXT PLE (2026-09-29) — estado

Un contador revisó los TXT exportados y marcó errores. Estado de cada uno:

| Observación | Estado |
|---|---|
| 8.1 campo 25 vacío en compra USD (TC obligatorio) | ✅ Corregido: TC del documento o fallback a la tabla de TC (fecha más cercana anterior), formato oficial 1.3. Requiere TC del mes cargados (§5). |
| TXT en UTF-8 (`PERÃš`) — SUNAT exige ANSI | ✅ Corregido: los TXT salen en ISO-8859-1. Además el mojibake que ya estaba GUARDADO en la DB (import viejo) se repara al exportar. |
| CUO/correlativo del 8.1 (`1`/`M1`) no cruzaba con el Diario (`AS-202601-0001`/`M0001`) | ✅ Corregido: 8.1/14.1/RCE/RVIE usan el correlativo del asiento de centralización como CUO y todos los libros derivan el M-correlativo con la misma regla. Verificado: 206/206 compras de enero cruzan. |
| Entidades HTML en glosas (`4 &quot ROJO`) | ✅ Corregido: se decodifican al generar el TXT. |
| Basura de puntuación en glosas | ✅ Sanitización (control chars, pipes, saltos de línea, espacios dobles) en la única puerta de salida del TXT. |
| 14.1 campo 27 "tipo de CP que se modifica" fijo en `01` | ⏳ Pendiente chico: leerlo del documento original (importa solo si emite NC sobre boletas) — confirmar con Kelly en CU-7. |
| Planilla asentada 659 directo contra 10411 (sin pasar por pasivo clase 4) | ⏳ **PENDIENTE (acordado no arreglar hoy)**: la dinámica PCGE sugiere provisionar el gasto por la 41x antes de la salida de bancos. Es un cambio del motor de asientos de planilla — programar junto con el rediseño contable / preguntar a Kelly su dinámica exacta de planillas en la sesión (CU-11). |

---

## 7 · Qué falta y en qué orden

1. **Casos de uso con Kelly** (este doc) → ajustes que salgan.
2. **Seguridad mínima pre-link**: cambiar admin/admin, quitar hint del login, secretos fuera del repo, HTTPS. Luego RBAC completo (F4.1).
3. **Reseed con datos reales** (F4.2): 15 facturas, TC del mes, mes real completo.
4. **Deploy productivo formal** (F4.3): backups automáticos, migraciones versionadas.
5. Paralelo con el estudio contable → mes cerrado cuadrado = 100%.
