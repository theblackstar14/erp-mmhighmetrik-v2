# Conciliación bancaria · rediseño — panel de resumen (Fase 1) — diseño

Fecha: 2026-08-07 · Rama: feat/rbac-multiempresa · Estado: aprobado (Fase 1 a implementar)
Base: LLM Council (conciliación) + refinamientos del usuario.

## Contexto

El sistema salió de la "sombra 104x" → los movimientos ahora postean asientos en la cuenta
contable 10 (bancos). Cada cuenta bancaria tiene su `cuenta_contable` 104x (BCP Soles=10411,
Scotiabank Soles=10441, Caja Chica=10451). El módulo H3 de conciliación ya existe y funciona
(import CSV/XLSX, matcher determinístico línea↔movimiento, estados, taxonomía). El veredicto del
consejo: **la verdad es el SALDO** (extracto vs cuenta 104x), las líneas son el puente.

Fase 1 = un **panel de resumen read-only** que responde la pregunta que un gerente/contador hace
primero: **"¿Está cuadrado o no?"**. Es una capa de consulta sobre la información existente — sin
tocar el matcher, sin persistencia nueva, sin riesgo.

## Alcance Fase 1 (esta spec)

Panel de resumen de conciliación por **cuenta bancaria + periodo**. Todo read-only.

### Backend — endpoint `GET /conciliacion/resumen?cuenta=&periodo=`
(nombre `resumen`, no `cuadre`: devuelve el resumen completo, no un solo número)

Devuelve:

1. **Resumen ejecutivo (KPIs):**
   - `saldoBanco` (según extracto), `saldoLibro` (según cuenta 104x), `diferencia`, `estado`
     (`cuadrado` si |dif| ≤ tolerancia, si no `descuadrado`).
   - `partidasLibroPendientes` (count), `movimientosBancoPendientes` (count).

2. **Saldo según extracto — doble cálculo con cross-check:**
   - Vía A: si el extracto trae columna **Saldo**, usar la **última fila** (fuente más confiable).
   - Vía B: `saldo inicial + créditos − débitos`.
   - Si ambas existen y difieren → bandera `extractoInconsistente` + delta (el extracto tiene un
     problema). Si no hay saldo inicial → resultado marcado `estimado`, no se asume valor.
   - Soporta extractos de distintos bancos (BCP/BBVA/Interbank/Scotiabank) sin cambiar algoritmo.

3. **Saldo según libro:** `Σ(debe − haber)` sobre la cuenta 104x de esa cuenta bancaria, asientos
   con fecha ≤ fin de periodo.

4. **Partidas conciliatorias, CLASIFICADAS (heurística inicial):**
   - **Libro → Banco** (en libro, no en banco aún): `cheques_pendientes`, `depositos_en_transito`,
     `transferencias_pendientes`. Fuente: movimientos de la cuenta en periodo **no conciliados**.
   - **Banco → Libro** (en banco, no en libro): `itf`, `comisiones`, `intereses`,
     `debitos_automaticos`, `creditos_no_registrados`. Fuente: líneas de extracto **pendientes**
     (reusa `RUIDO_PAT` de la taxonomía existente + reglas simples por glosa).
   - Cada partida: descripción, monto, **aging (días)**.

5. **Puente de conciliación explícito** (formato que espera el contador):
   ```
   Saldo banco (extracto)
   + Partidas en libro no en banco (depósitos/cheques/transf. en tránsito)
   − Partidas en banco no en libro (ITF/comisiones/…)
   = Saldo ajustado banco
   Saldo libro (104x)   → debe igualar al ajustado
   ```

6. **Indicador de calidad de conciliación:** `% conciliado` = líneas conciliadas / total, con
   counts (total, conciliados, pendientes). Reusa estados existentes, no toca el matcher.

### Frontend — sub-sección "Resumen / Cuadre" en Conciliación
- Selector **cuenta bancaria + periodo**.
- **4 KPIs arriba:** Saldo banco · Saldo libro · Diferencia · Estado (badge verde/rojo). Debajo:
  "N partidas del libro pendientes · M movimientos del banco pendientes" + **% conciliado**.
- **Puente** de conciliación (bloque saldo banco → ajustes → saldo ajustado vs saldo libro).
- **Dos tablas clasificadas** (Libro→Banco · Banco→Libro) con columna **Días (aging)** coloreada:
  **0–7 verde · 8–30 amarillo · >30 rojo**.
- **Exportar** = la pantalla completa como evidencia mensual (cuenta, periodo, saldos, partidas,
  resultado, espacio de firmas).
- Todo read-only.

### Por qué funciona ahora
Post-cutover la cuenta 104x tiene saldo real (test: BCP 1.39M). Antes el libro daba 0; ahora el
panel cuadra contra data real.

## Fuera de alcance Fase 1 → Fase 2 (transaccional)

- **Crear-movimiento-desde-línea** (ITF/comisiones → postea 65x/10), idempotente (hash de línea,
  `origen='conciliacion'`, solo líneas `pendiente` sin `movimientoId`; ruido auto, crítico prohibido).
- **Guards anti-doble-conteo**: `movimientoId` único por línea; transferencia interna = un
  movimiento con dos patas ligadas (una por extracto); al crear desde línea que ya matchea un
  movimiento-transferencia → linkea, no crea.
- **Registro persistente de partidas en tránsito** (cheques girados/depósitos) con su ciclo de vida.
- **Cierre de mes** que exige `diferencia de saldo = 0` (o justificada) — integra con preclose.
- Bajar **tolerancia del matcher** ±1.0 → ±0.05 (salvo redondeo ITF) + exigir referencia si |Δ|>0.

## Notas / decisiones

- Clasificación de partidas es **heurística** en Fase 1 (por glosa); se afina con extractos reales.
- El saldo libro se filtra por el **104x específico** de la cuenta (10411), no todo el grupo 10.
- Reusa: taxonomía `RUIDO_PAT`, estados, tabla `extractoLineas`, cuenta_contable de cuentas
  bancarias. No crea tablas.
- Validar con el **set de un mes real** (extracto + planilla + pagos) que se pidió a la contadora.
