# Preguntas para Kelly · ronda octubre 2026

Lo que está abierto **hoy** y frena código. No repite la ronda anterior
(`PREGUNTAS-CIERRE-ALCANCE.md`): si algo está acá es porque sigue sin respuesta y ya tocó
una decisión de diseño.

Casi todas se responden marcando una casilla. Las que no se puedan cerrar en la reunión se
marcan `ABIERTA` con dueño y fecha.

- **[BLOQUEA]** · no se puede escribir el código sin la respuesta.
- **[CAMBIA DISEÑO]** · se puede avanzar, pero si contesta distinto hay que rehacer.
- **[DATO]** · solo hace falta un archivo o un número.

---

## A · Espejo con CONTASIS (bloquea la integración entera)

**A1. [BLOQUEA] ¿Una línea de asiento puede repartirse entre dos obras?**
En su export del diario hay una columna `C.COSTOS 2` además de `C.COSTOS`. Si `C.COSTOS` es la
obra, ¿qué es la segunda?

- [ ] Es fase/partida de la misma obra (no es otra obra)
- [ ] Es una segunda obra: la línea se prorratea entre dos centros de costo
- [ ] Nunca se usa / viene siempre vacía

> Por qué importa: nuestro modelo asume **una obra por línea**. Si se reparte entre dos, la tabla
> `asientos_lineas` cambia de estructura y el diseño del espejo se revisa completo.
>
> Atajo si no se acuerda: que nos pase **un asiento real cualquiera** con esa columna llena, o que
> confirme que en el Excel siempre sale vacía.

**A2. [BLOQUEA] [DATO] Lista de centros de costo.**
Su catálogo de centros de costo, idealmente con el mismo código que nuestras obras (ej. `PG0001`).
Sin esto el espejo no alimenta ningún reporte por obra.

**A3. [CAMBIA DISEÑO] Sufijos de destino: ¿`093` junta costo directo y gasto general de obra?**
En el plan que nos pasó, las cuentas de obra llevan sufijo `093`. Nosotros separamos tres destinos:
costo directo de obra, gasto general de obra, gasto corporativo.

- [ ] `093` junta CD y GG de obra (no los distingue)
- [ ] Usa `9011` para uno y `9021` para el otro (indicar cuál es cuál)
- [ ] Otro: ______________________

> Por qué importa: si los junta, al importar perdemos la distinción CD/GG de obra y el margen por
> obra sale mal.

**A4. [DATO] Las 4 cuentas que su plan no tiene:** `10441`, `10451`, `407`, `6279`.
¿Las crea de su lado, o le decimos a qué cuenta suya equivale cada una?

- [ ] Las crea Kelly
- [ ] Nos manda el equivalente

**A5. `628095` aparece dos veces en su plan con destino distinto** — una con `9511` (VTA) y otra con
`9611` (OTROS). Cargamos la primera. ¿Cuál es la correcta?

- [ ] `9511` VTA  - [ ] `9611` OTROS

**A6. [DATO] `nafecos` viene vacío** en 3394 de 3396 cuentas. Que lo marque al menos en las de
**costo y gasto** (son las que necesitamos).

**A7. ¿Hay asientos en dólares?** El reporte no trae ni moneda ni tipo de cambio.

- [ ] Todo en soles
- [ ] Hay USD → en qué columna viene la moneda y el TC: ______________________

> Mientras no haya respuesta, todo lo que importemos se graba en **soles**.

**A8. [DATO] Plantilla de importación del diario.** El archivo vacío con las columnas exactas en el
orden que su sistema espera, para que podamos generarlo nosotros.

**A9. Al cargar nuestro asiento de planilla, ¿su sistema expande los destinos solo, o se lo
mandamos ya expandido por obra?**

- [ ] Lo expande su sistema  - [ ] Se lo mandamos expandido

**A10. Token en `GLOSA 2`.** Vamos a poner una marca nuestra ahí para reconocer el asiento al
volver. Pedido: **que no la borre** al registrarlo.

- [ ] De acuerdo  - [ ] No se puede → alternativa: ______________________

---

## B · Planilla de oficina

**B1. [CAMBIA DISEÑO] Practicantes: ¿modalidad formativa real o planilla plena?**
Hoy TODOS van a planilla plena (AFP + EsSalud), incluida gente cuyo cargo dice "practicante".

- [ ] Planilla plena, como está hoy (correcto)
- [ ] Existe modalidad formativa real: subvención, **sin** AFP ni EsSalud, con seguro médico

> El motor ya tiene el gancho apagado. Si dice que sí existe, se prende y el cálculo de esa gente
> cambia.

**B2. ¿El neto de un empleado puede salir negativo?**
(Caso: retención judicial + cuotas de adelanto que suman más que el bruto.)

- [ ] Imposible, nunca pasa → lo bloqueamos al momento de calcular
- [ ] Puede pasar → se deja pasar y se arrastra el saldo

> Hoy el sistema recién avisa al cerrar la planilla. Si es imposible, conviene avisar antes.

**B3. [DATO] Divisor de horas para la hora extra.** Usamos `sueldo / 240`.

- [ ] 240 está bien  - [ ] Es ______ (240 = 30 días × 8 h)

**B4. [DATO] UIT 2026.** Tenemos S/ 5,350. Confirmar.

---

## C · Números que el sistema tiene que redondear igual que ella

**C1. [DATO] Tasa de detracción que les aplica de verdad.**
Contratos de construcción es 4 %, servicios 12 %.

- [ ] Casi todo entra por construcción 4 %
- [ ] Casi todo entra por servicios 12 %
- [ ] Mezcla: depende de ______________________

**C2. [DATO] Redondeo.** ¿A 2 decimales en cada línea, o solo en el total?

- [ ] Cada línea  - [ ] Solo el total

---

## D · Lo que NO hay que preguntar (ya está decidido, no reabrir)

- Cuenta contable manual es la primaria; CD/GG es derivado.
- Renta de 5ta: el motor sugiere, **Kelly tiene el último voto** (hay campo de override).
- Las 4 planillas son: oficina, construcción civil, recibo por honorarios, personal por fuera.
- Pago de planilla es masivo (un voucher → N empleados).
