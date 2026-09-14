# Diseño: Clasificación de gastos de obra (CD / GG_OBRA / GG_CORP)

**Fecha:** 2026-07-21
**Estado:** Aprobado (validado en 3 rondas de LLM Council)

## Objetivo

Saber cuánto cuesta realmente cada obra, separando:
- Costo directo vs gasto general de obra vs gasto administrativo corporativo.
- Margen real por obra (sin mezclar con overhead de empresa).
- Sin mezclar con tesorería. Reconciliable con la contabilidad (PCGE) por construcción.

## 1. Modelo — 3 clasificaciones

| Interno | UI | Definición | Ejemplos |
|---|---|---|---|
| `CD` | Costo Directo | Pertenece a una partida del presupuesto | Cemento, acero, ladrillo, MO de construcción, subcontratos de partida, maquinaria usada en partida |
| `GG_OBRA` | Gasto General de Obra | Necesario para la obra, NO es partida. Pertenece al proyecto | Residente, guardianía, oficina de obra, internet de obra, viáticos/movilidad del equipo de obra |
| `GG_CORP` | Gasto Administrativo Corporativo | De la empresa, no de una obra | Oficina principal, contabilidad, gerencia, licencias, fiesta empresa |

## 2. Registro de gasto — flujo

1. **Destino** (obligatorio): `PROYECTO` | `CORPORATIVO`.
2. Si `PROYECTO` → pregunta operativa (NO jerga contable), 2 botones con ejemplos inline:
   - *"Va a una tarea del presupuesto (cemento, fierro, mano de obra)"* → `CD`
   - *"Gasto del terreno en general (vigilante, campamento, viáticos)"* → `GG_OBRA`
   - Pre-llenado desde la sugerencia del config por tipo.
3. Si `CORPORATIVO` → `GG_CORP` automático, sin decisión del usuario.

## 3. Config por tipo de gasto (sugerencia, no regla)

Extender la tabla existente `gasto_cuenta_map` (tipo → cuenta PCGE) con columna `clase` sugerida:
Cemento→CD, Acero→CD, Guardianía→GG_OBRA, Viáticos→GG_OBRA, Contabilidad→GG_CORP, etc.
Es sugerencia: pre-llena el form, el usuario puede cambiar.

## 4. Campos nuevos en `gastos`

```
destino             PROYECTO | CORPORATIVO
clasificacion       CD | GG_OBRA | GG_CORP
clasificacionOrigen AUTOMATICO | USUARIO | BACKFILL
prorrateable        boolean (default false)  -- solo flag; NO se implementa prorrateo ahora
```

- `AUTOMATICO`: puesto por la sugerencia del config.
- `USUARIO`: cambiado manualmente (el detalle quién/cuándo/motivo vive en `audit_log`, no se duplica).
- `BACKFILL`: heredado de la migración histórica.
- NO se agrega `revisado` (sería un mini-flujo de auditoría; `audit_log` ya cubre). La contadora revisa filtrando `clasificacionOrigen = 'BACKFILL'`.
- Ignorar el campo viejo `tipo_registro` (queda muerto).

## 5. Backfill de los 1,573 gastos existentes

```
Si proyecto_id IS NULL   → clasificacion = GG_CORP, destino = CORPORATIVO
Si proyecto_id NOT NULL  → clasificacion = COALESCE(config_tipo.clase, 'CD'), destino = PROYECTO
Siempre                  → clasificacionOrigen = BACKFILL
```
Nota: NO todo-a-CD. Usa la sugerencia del config (Guardianía→GG_OBRA, etc.) para que el reporte GG-obra no salga falsamente en 0.

## 6. Presupuesto (fuente de verdad = Excel importado)

`proyectos` YA guarda: `costoDirecto` / `costoDirectoSinIgv` (CD presupuestado explícito), `pctGg` (default 0.10, **sobre CD**), `pctUtilidad`, `ggUtModo`.

Respetar `ggUtModo`:
- `separado`: Presupuesto GG-obra = `costoDirecto × pctGg`. Presupuesto vs ejecutado limpio.
- `embebido_cd`: CD ya incluye GG+UT (pctGg/pctUtilidad NULL) → NO hay presupuesto GG separable; mostrar CD combinado.
- `simple_pct`: variante simple.

El ERP trabaja en absolutos post-import (CD S/, GG S/, Utilidad S/, IGV S/).

## 7. Reportes

**Nivel obra:**
```
Valorización (ingreso reconocido)
  − CD ejecutado
  − GG_OBRA ejecutado
  = Resultado de obra (sin gastos de oficina)
Presupuesto vs Ejecutado para CD y GG_OBRA (respetando ggUtModo)
Costos compartidos (prorrateable=true) → LÍNEA APARTE "sin distribuir", NO sumados en silencio
```
Renombrar en UI: nunca "utilidad", usar **"Resultado de obra (sin gastos de oficina)"**.

**Nivel empresa:**
```
Σ Resultados de obra
  − GG_CORP
  = Resultado empresarial
```

**Reconciliación con contabilidad (clave):**
Los asientos se derivan de los mismos `gastos` (motor `/generar`), así que reconcilian por construcción. El reporte muestra el PUENTE, no fuerza igualdad:
```
Resultado empresarial (operacional)
  ± timing devengado
  − depreciación / provisiones
  ± asientos manuales
  = Utilidad contable (Estado de Resultados)
```

## 8. Futuro (NO ahora — YAGNI)

Módulo de prorrateo configurable de GG_CORP entre obras (driver: valorización / CD / ingresos / otro). Hoy solo el flag `prorrateable`, cero lógica.

## No-objetivos de esta versión

- Prorrateo automático de corporativo o de compartidos.
- Costo por partida individual (obra-total basta para MYPE; per-partida es refinamiento futuro).
- Split de un gasto entre varias obras (se carga a la principal + flag prorrateable).
