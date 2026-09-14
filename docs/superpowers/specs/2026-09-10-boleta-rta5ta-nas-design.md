# Boleta exacta + Renta 5ta + Boleta PDF a NAS — spec

Fecha: 2026-09-10 · Sobre: feature **Planilla de Oficina** (ya implementado, commits b5efeab..4512b6c). DB: `erp_mmh_test`.
Aprobado por el usuario. Decisiones: seed único Julio 2026 (verificación) · motor auto de Renta 5ta con override · boletas PDF batch al cerrar → NAS · email diferido.

## Objetivo
Cerrar la fidelidad de la planilla de oficina: la boleta con el **layout exacto** del Excel, la **Renta 5ta calculada** (proyección anual SUNAT, verificable contra el Excel), la boleta **impresa + archivada en el NAS** al cerrar el mes, y un **seed de Julio 2026** que valide el sistema contra las boletas reales.

Referencia: `07.PERSONAL PLANILLA JULIO 2026 OFICINA.xlsx` (hojas BOLETA, PLANILLA, Cálculo Rta 5ta) — 17 personas.

---

## A. Boleta con layout exacto

### Snapshot faltante
`calcular` hoy no guarda fecha de ingreso/cese en el detalle (la boleta las muestra). Añadir:
- Migración: `planilla_oficina_detalle` += `fecha_ingreso date`, `fecha_cese date`.
- ORM + `calcular`: snapshot `fecha_ingreso = emp.fechaIngreso`, `fecha_cese = emp.fechaCese`.

### Layout (idéntico a la imagen · usado por el modal FE y el PDF)
- **Cabecera**: "BOLETA DE PAGO" · Razón Social (empresa) · Dirección · R.U.C. · correlativo `BOL-1000xx` (derecha).
- **DATOS DEL TRABAJADOR**: Nombre · Cargo · Fecha Ing. · Fecha cese · DNI · A.F.P. · CUSPP · Días Trab. · Horas Trab.
- **Dos columnas**:
  - **REMUNERACIONES** (Mes de: <Mmm-AA> · Importe): Mensual, Dominical, Horas Extras, Destajos, Bonificaciones, Gratificaciones, Vacaciones, Comisiones, Asig. Familiar, Ley 26504, Afp 10.23%,3%, Otros. → **Total Bruto**.
  - **APORTES Y DESCUENTOS** (Motivo · Empleador · Trabajador): O.N.P., Essalud Vida, Impto. Renta (=imptoRenta5ta), Retenc. Judic. (=retencionJudicial), AFP pension (=afpAporte), AFP Seguro, AFP Com.% (=afpComision), Adelantos (=adelantoCuota), Descuentos (=otrosDescuentos), Reg. Salud (empleador=essalud). → **Total Aporte S/** (empleador) · **Total Dscto.** (trabajador) · **Neto Recibido**.
- **Pie**: "Lima, <fecha fin de mes>" · líneas "Firma Empleador" / "Firma Trabajador".
- Rubros sin columna en DB (Destajos, Ley 26504, Afp 10.23%,3%, Otros, Essalud Vida vacío) → se muestran **0.00** (YAGNI; se agregan como columna sólo si el negocio los usa).
- El modal `BoletaOficina.tsx` se reescribe para calcar este layout; el PDF usa la misma disposición.

---

## B. Motor de Renta 5ta (proyección anual SUNAT)

Nuevo `apps/backend/src/lib/rta5taCalc.ts` — función pura.

### Algoritmo (procedimiento SUNAT · 5ta categoría)
Entradas por persona: `sueldoMensual`, `mesNumero` (1-12), `acumuladoPercibidoAntes` (remuneraciones de meses previos del año), `retencionesPrevias` (Rta 5ta ya retenida en el año), `uit` (config), `tieneGratificacion` (jul y dic).
1. **Proyección anual bruta** = `acumuladoPercibidoAntes` + `sueldoMensual × (12 − mesNumero + 1)` (meses restantes incl. actual) + **gratificaciones** por percibir (jul + dic, cada una = 1 sueldo; sólo las que faltan del año) + **bonificación extraordinaria** (9% de cada gratificación · Ley 30334).
2. **Renta neta** = proyección − **7 UIT**.
3. **Impuesto anual** por tramos progresivos (sobre renta neta, en UIT):
   - hasta 5 UIT → 8% · >5 a 20 UIT → 14% · >20 a 35 UIT → 17% · >35 a 45 UIT → 20% · >45 UIT → 30%.
   (si renta neta ≤ 0 → impuesto 0).
4. **Retención del mes** por el divisor SUNAT según el mes:
   - Ene–Mar → `impuestoAnual / 12` · Abr → `(impuestoAnual − retencionesPrevias) / 9` · May–Jul → `(… ) / 8` · Ago → `(…) / 5` · Sep–Nov → `(…) / 4` · Dic → `impuestoAnual − retencionesPrevias`.
   Nunca negativa (`max(0, …)`).
Salida: `{ retencionMes, impuestoAnual, proyeccionAnual, rentaNeta }`.

### Integración
- `calcular` corre `rta5taCalc` por empleado y setea `detalle.imptoRenta5ta` (auto). `acumuladoPercibidoAntes` = `sueldoMensual × (mesNumero − mesesDesdeIngresoEsteAnio?)` — v1: `sueldoMensual × (mesNumero − 1)` asumiendo empleo continuo desde enero (aproximación; el seed revelará desviaciones para afinar por fecha de ingreso). `retencionesPrevias` = 0 en v1 (sin historial mensual cargado) — documentado como aproximación.
- **Kelly sobrescribe** con el `PATCH /planilla-detalle/:id` existente (`imptoRenta5ta`): si viene en el PATCH, gana sobre el auto. Marcar `imptoRenta5ta` como "manual" si Kelly lo tocó (reusa el patrón; opcional un flag).
- **Config**: `uit` (ya existe en config), tramos en constante del motor (fijos por ley).

### Verificación
Unit test del motor con los números de la hoja "Cálculo Rta 5ta" (ej. sueldo 10,000 → RTA 5TA anual 7,548 → retención mensual ≈ 542 · verificar). El seed (C) compara el `imptoRenta5ta` computado vs el del Excel por persona.

---

## C. Seed de verificación · Julio 2026
Script `apps/backend/scripts/oficina/seed-julio-2026.ts` (solo `erp_mmh_test`, idempotente, reversible):
1. Parsear la hoja PLANILLA del Excel (17 filas): nombre, cargo, DNI, sistema de pensión (AFP+sufijo o S.N.P.), cuenta, sueldo, y los montos manuales (HE, gratif, etc. — casi todos 0 en julio).
2. Crear/actualizar los **17 empleados** (`tipoPlanilla='admin'`, activo, con sueldo_base_mensual, cargo, cuspp, banco/cuenta, fecha_ingreso).
3. Crear `planilla_oficina_mes` 2026-07 + `calcular`.
4. **Comparar** por persona el detalle computado (total_bruto, afp_aporte, afp_seguro, essalud, imptoRenta5ta, neto_pago) contra los valores reales del Excel BOLETA/PLANILLA → imprimir un **reporte de diferencias** (OK / Δ por campo). Tolerancia S/0.50.
5. Modo `--limpiar` borra la planilla + los 17 empleados de prueba (marcados por un prefijo/flag) para no ensuciar.
Objetivo: exponer dónde el sistema difiere del Excel (especialmente Rta 5ta y AFP seguro, cuyas tasas del Excel difieren de `afp_tasas`), para calibrar antes de producción. No es data de producción.

---

## D. Boleta PDF → NAS (batch al cerrar)
- `apps/backend/src/lib/boletaOficinaPdf.ts` — genera el PDF de una boleta con pdfkit (patrón de `lib/ocPdf.ts`), mismo layout que A. Devuelve `Buffer`.
- En `POST /planilla/:mesId/cerrar`, **después** de generar el asiento y aplicar cuotas: por cada detalle, generar el PDF y subirlo vía `registrarDocumento({ entidadTipo:'planilla_oficina_detalle', entidadId: detalle.id, docTipo:'boleta_pago', fileBuffer, nombreArchivo:'boleta.pdf', subPath:`${mes}/${dni}` })`. **Idempotente**: si ya existe un `documento_adjunto(boleta_pago)` para ese detalle, no re-generar (permite reabrir/cerrar sin duplicar). Errores de NAS no abortan el cierre (log + continuar; el asiento ya está); se reporta cuántas boletas subieron.
- Badge "boleta" en la grilla pasa a reflejar el `documento_adjunto(boleta_pago)` real (además del modal en pantalla).
- Botón por persona **fuera de alcance** (se decidió batch al cerrar); regenerar individual = fase posterior.

## E. Email — diferido
Interfaz `enviarBoletaEmail(detalle, pdfBuffer): Promise<void>` declarada pero **no implementada** (lanza "no configurado"). Cuando se confirme: añadir nodemailer/SMTP + adjuntar el PDF + destinatario = email del empleado (agregar `empleados.email` si falta).

---

## Invariantes / compatibilidad
- No romper lo hecho: `calcular`/`cerrar`/`reabrir`/asiento WS1 Σ=Σ siguen igual; sólo se añade Rta5ta auto + snapshot fechas + PDF al cierre.
- Rta 5ta auto es **sobre-escribible** (Kelly manda) — coherente con "modo registro".
- Seed y migración sólo en `erp_mmh_test`.
- PDF/NAS no bloquea el cierre contable (best-effort archivado).

## Fuera de alcance
- Importador reusable de Excel (se hará después si Kelly sigue en Excel).
- Email (interfaz lista, sin implementar).
- Botón regenerar boleta individual.
- Historial mensual de retenciones Rta 5ta (v1 asume continuidad desde enero · el seed calibra).

## Decisiones congeladas
1. Boleta = layout exacto del Excel (modal FE + PDF pdfkit, mismo layout). Rubros sin columna → 0.00.
2. Renta 5ta = **motor auto** (proyección anual SUNAT, tramos 8/14/17/20/30%, divisor por mes) en `calcular`, **sobre-escribible** por Kelly.
3. Seed Julio 2026 = crea 17 empleados + planilla + compara vs Excel (reporte de diferencias), reversible.
4. Boletas PDF = **batch al cerrar**, subida a NAS, `documento_adjunto(boleta_pago)`, idempotente, best-effort.
5. Email = interfaz diferida.
