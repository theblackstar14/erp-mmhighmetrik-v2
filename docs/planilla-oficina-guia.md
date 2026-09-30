# Planilla de Oficina — Guía de presentación y casos de uso

Documento operativo del módulo de Planilla de Oficina (régimen general). Explica **cómo presentarlo**, **cómo ejecutar cada caso de uso** y **el porqué de cada apartado y función**. Referencia de verdad: la planilla real de julio 2026 (17 trabajadores), contra la que el motor cuadra al céntimo.

---

## 1. Qué es y para quién

El módulo calcula la planilla mensual del personal administrativo: toma el sueldo y los datos de cada trabajador, aplica las reglas legales vigentes (AFP/ONP, EsSalud, renta de 5ta) y produce la boleta y el asiento contable.

- **Contadora (Kelly)** — opera el día a día: calcula, revisa fila por fila, ajusta lo manual, cierra el mes. Tiene el último voto sobre la renta de 5ta.
- **Gerencia/Admin** — consulta el costo total, aprueba el cierre.

Regla de fondo: **el sistema propone, la contadora dispone.** Todo lo automático es una sugerencia auditada; lo que Kelly teclea manda.

---

## 2. El flujo mensual

```
Crear mes  →  Calcular  →  Revisar  →  Cerrar
```

| Paso | Qué hace | Por qué existe |
|------|----------|----------------|
| **Crear mes** | Abre el periodo (ej. 2026-07) en estado borrador | Separa cada mes; permite trabajarlo sin afectar los cerrados |
| **Calcular** | Corre el motor sobre todos los administrativos activos y llena el detalle | Automatiza lo repetitivo (AFP, ONP, EsSalud, HE, prorrateo) para que Kelly no lo haga a mano |
| **Revisar** | Kelly ajusta lo manual (HE, gratificación, adelantos, renta de 5ta) fila por fila | Los datos que el sistema no puede saber (horas extra reales, un descuento puntual) los pone la persona |
| **Cerrar** | Bloquea el mes, genera boletas, postea el asiento y alimenta el acumulado de renta de 5ta | Deja el mes inmutable y trazable; contabiliza en un solo acto |

Un mes cerrado se puede **reabrir** para corregir; al recerrar se recalcula sin duplicar nada (ver sección 5).

---

## 3. Configuración del motor (tres apartados)

Estos parámetros viven en configuración, no en el código, para que la contadora los mantenga sin depender de un desarrollador.

### 3.1 Parámetros legales por vigencia
RMV, UIT, tope del seguro, porcentajes de EsSalud/ONP/AFP y asignación familiar, **cada uno con su fecha de vigencia**.

**Por qué versionado:** las cifras legales cambian por decreto. La RMV pasó de S/ 1,130 a S/ 1,300 el 1 de octubre de 2026. Con vigencias, una planilla de setiembre resuelve 1,130 y una de octubre resuelve 1,300 **sola**, sin tocar nada. Además, una planilla vieja siempre se recalcula con los valores que estaban vigentes ese mes, no con los de hoy.

### 3.2 Tasas AFP
Por cada AFP: aporte (10%), prima de seguro (1.37%) y comisión (flujo y mixta).

**Por qué por empleado:** dos trabajadores de la misma AFP pueden pagar comisión distinta. En el Excel real, García (Profuturo) paga comisión 0 porque está en "comisión sobre saldo"; Huerta (Profuturo también) paga 1.69% porque está en "comisión por flujo". Por eso cada trabajador lleva su **tipo de comisión** (flujo / mixta / saldo) y el motor aplica la tasa correcta.

### 3.3 Importar renta de 5ta (baseline)
Por trabajador y año: la remuneración acumulada percibida y la renta ya retenida **antes** de que el ERP empezara a llevar la planilla.

**Por qué "no arrancar en cero":** la renta de 5ta se proyecta sobre lo ganado en todo el año. Si el ERP arranca en agosto, no sabe qué ganó el trabajador de enero a julio. Kelly carga ese acumulado una sola vez desde su hoja; de ahí en adelante el sistema lo acumula solo mes a mes. Sin esto, la sugerencia de renta saldría mal para el resto del año.

---

## 4. Casos de uso (cómo hacer cada uno y por qué)

### 4.1 Alta de un trabajador
En la ficha del administrativo se registran: nombre, DNI, cargo, fecha de ingreso, **sistema de pensión** (AFP/ONP), **tipo de comisión AFP** (flujo/mixta/saldo), sueldo base, y si tiene **asignación familiar** (hijos).

**Por qué esos campos:** cada uno cambia el cálculo. El sistema de pensión decide AFP vs ONP; el tipo de comisión decide cuánto se descuenta; la asignación familiar suma 10% de la RMV; la fecha de ingreso ajusta la proyección de renta para altas a mitad de año.

### 4.2 Cese o alta a mitad de mes (prorrateo)
Se registra la fecha de cese y los días trabajados. El sueldo se prorratea: `sueldo × días / días del mes`.

**Ejemplo real:** Yangari cesó el 31/07 con 29 días → 3,100 × 29/31 = **2,900**, y sobre eso se calculan ONP (377) y EsSalud (261). El motor lo hace automático.

### 4.3 AFP flujo vs saldo vs mixta
Se elige el tipo en la ficha. El motor: flujo → aplica la comisión por flujo de la AFP; mixta → la mixta; saldo → 0 en la boleta (la comisión sobre saldo no se descuenta de la planilla).

**Por qué importa:** ponerlo mal descuenta de más o de menos. Huerta (flujo) descuenta 19.10; García (saldo) descuenta 0. Mismo AFP, distinto resultado.

### 4.4 Practicante
Hoy **todos van a planilla plena** (con AFP y EsSalud), como Sheyla en el Excel. El sistema deja el interruptor `modalidad formativa` apagado por defecto.

> **Pendiente de confirmar con la contadora:** si existe algún practicante de modalidad formativa real (subvención, sin AFP/EsSalud, con seguro médico), se prende ese interruptor y el motor lo exonera. Mientras no se confirme, van todos a planilla plena.

### 4.5 Renta de 5ta — sugerencia y último voto
El motor proyecta la renta anual (sueldo restante del año + gratificaciones proporcionales + bonificación extraordinaria − 7 UIT), aplica la escala progresiva y sugiere la retención del mes. **Kelly puede sobrescribirla**; si lo hace, su valor queda marcado como manual y ninguna recalculación posterior lo pisa.

**Por qué híbrido:** la renta de 5ta tiene matices (otros ingresos, ajustes) que la contadora conoce. El motor le ahorra el 90% del cálculo; ella corrige el 10% cuando su hoja diga otra cosa.

### 4.6 Gratificación (julio y diciembre)
Si se ingresa una gratificación, el motor la trata como **inafecta**: no paga AFP/ONP/EsSalud, y agrega la bonificación extraordinaria del 9% (Ley 30334).

**Por qué:** por ley la gratificación no aporta a pensión ni a EsSalud; el 9% que el empleador ahorraría en EsSalud se le entrega al trabajador. Mezclarla con el sueldo afecto descontaría de más.

### 4.7 Cambio de RMV
No se hace nada manual. El parámetro con vigencia 2026-10-01 (RMV 1,300) entra solo en la planilla de octubre; setiembre sigue con 1,130.

---

## 5. El porqué del diseño (en simple)

- **Bases independientes.** El motor calcula por separado la remuneración afecta, la gratificación inafecta y la bonificación extraordinaria, y de ahí las bases de AFP, ONP y EsSalud. Así nadie puede, al tocar una fórmula, volver a gravar la gratificación por error.
- **Snapshot autosuficiente.** Al calcular, el mes congela todos los parámetros usados (RMV, tasas, datos por trabajador). Dentro de dos años se puede abrir julio 2026 y responder "por qué este trabajador recibió exactamente S/ X" sin depender de la configuración actual.
- **Acumulado por baseline + ledger.** La renta de 5ta acumulada no se suma con `+=` (que se rompe si cierras dos veces). Se deriva sumando el baseline importado más un registro por mes. Reabrir y recerrar un mes lo **corrige** sin duplicar; recerrar dos veces deja el mismo resultado.
- **La contadora tiene el último voto.** Toda automatización es sugerencia; el override de Kelly siempre gana y queda marcado para auditoría.

---

## 6. Cómo presentarlo (guion de demo)

1. **Abrir el mes y calcular.** Mostrar que en un clic aparecen los 17 trabajadores con sus números. Recalcar que lo repetitivo lo hace el sistema.
2. **Cuadre con el Excel.** Poner lado a lado una boleta del Excel (García, Huerta) y el detalle del sistema: mismos números al céntimo. Es la prueba de confianza.
3. **Un caso con matiz.** Mostrar Yangari (cese, prorrateo) y Huerta (comisión flujo) para explicar que el motor entiende los casos particulares.
4. **Renta de 5ta híbrida.** Editar la renta de un trabajador y mostrar que su valor manual se conserva tras recalcular. "El sistema propone, usted dispone."
5. **Configuración.** Enseñar los tres apartados (parámetros por vigencia, tasas AFP, import de renta) y explicar que Kelly los mantiene sin depender de nadie.
6. **Cerrar.** Cerrar el mes: se generan boletas y se postea el asiento. Recalcar que queda inmutable y trazable, y que se puede reabrir para corregir.

Mensaje de cierre de la demo: **el sistema no reemplaza a la contadora; le quita el trabajo mecánico y le deja el criterio.**

---

## 7. Checklist de puesta en marcha (VPS)

- [ ] Correr la migración de esquema v2 contra la base de producción.
- [ ] Sembrar las tasas AFP y los parámetros legales con vigencia (RMV 1,130 y 1,300).
- [ ] Revisar el tipo de comisión AFP de cada trabajador (flujo/saldo).
- [ ] Kelly importa el baseline de renta de 5ta del año en curso.
- [ ] Calcular el mes de prueba y cuadrar contra la última planilla real antes de operar.
