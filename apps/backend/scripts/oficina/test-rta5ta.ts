/**
 * Test para el motor de Renta 5ta Categoría (SUNAT).
 * Ejecutar: node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/oficina/test-rta5ta.ts
 */

import assert from "node:assert/strict";
import { calcularRta5ta } from "../../src/lib/rta5taCalc.js";

// ── Case A ────────────────────────────────────────────────────────────────────
// Sueldo 10 000, mes 7, acumulado 60 000, sin retenciones previas, UIT 5 350
// nGrati = 2 (meses 7 y 12 >= 7)
// proyeccion = 60000 + 10000*6 + 2*10000 + 2*900 = 141 800
// rentaNeta  = 141800 - 7*5350 = 104 350
// impuesto   = 5UIT(26750)*8% + 77600*14% = 2140 + 10864 = 13 004
// retencion  = 13004 / 8 = 1 625.50  (divisor mes 5-7)
{
  const r = calcularRta5ta({
    sueldoMensual: 10_000,
    mesNumero: 7,
    acumuladoPercibidoAntes: 60_000,
    retencionesPrevias: 0,
    uit: 5_350,
  });

  console.log("Case A:", r);
  assert(
    Math.abs(r.proyeccionAnual - 141_800) < 1,
    `A:proyeccionAnual esperado 141800, obtenido ${r.proyeccionAnual}`
  );
  assert(
    Math.abs(r.impuestoAnual - 13_004) < 1,
    `A:impuestoAnual esperado 13004, obtenido ${r.impuestoAnual}`
  );
  assert(
    Math.abs(r.retencionMes - 1_625.5) < 0.05,
    `A:retencionMes esperado 1625.50, obtenido ${r.retencionMes}`
  );
}

// ── Case B ────────────────────────────────────────────────────────────────────
// Sueldo bajo → rentaNeta negativa → impuesto 0, retención 0
// proyeccion = 12000 + 2000*6 + 2*2000 + 2*180 = 28 360
// rentaNeta  = 28360 - 37450 = -9090
{
  const r = calcularRta5ta({
    sueldoMensual: 2_000,
    mesNumero: 7,
    acumuladoPercibidoAntes: 12_000,
    retencionesPrevias: 0,
    uit: 5_350,
  });

  console.log("Case B:", r);
  assert(
    r.impuestoAnual === 0,
    `B:impuestoAnual esperado 0, obtenido ${r.impuestoAnual}`
  );
  assert(
    r.retencionMes === 0,
    `B:retencionMes esperado 0, obtenido ${r.retencionMes}`
  );
  assert(
    Math.abs(r.proyeccionAnual - 28_360) < 1,
    `B:proyeccionAnual esperado 28360, obtenido ${r.proyeccionAnual}`
  );
  assert(
    Math.abs(r.rentaNeta - (-9_090)) < 1,
    `B:rentaNeta esperado -9090, obtenido ${r.rentaNeta}`
  );
}

// ── Case C ────────────────────────────────────────────────────────────────────
// Diciembre, nGrati = 1 (solo mes 12 >= 12)
// proyeccion = 110000 + 10000*1 + 1*10000 + 1*900 = 130 900
// rentaNeta  = 130900 - 37450 = 93 450
// impuesto   = 26750*8% + 66700*14% = 2140 + 9338 = 11 478
// retencion  = 11478 - 9000 = 2 478  (divisor dic: total − previas)
{
  const r = calcularRta5ta({
    sueldoMensual: 10_000,
    mesNumero: 12,
    acumuladoPercibidoAntes: 110_000,
    retencionesPrevias: 9_000,
    uit: 5_350,
  });

  console.log("Case C:", r);
  assert(
    Math.abs(r.proyeccionAnual - 130_900) < 1,
    `C:proyeccionAnual esperado 130900, obtenido ${r.proyeccionAnual}`
  );
  assert(
    Math.abs(r.impuestoAnual - 11_478) < 1,
    `C:impuestoAnual esperado 11478, obtenido ${r.impuestoAnual}`
  );
  assert(
    Math.abs(r.retencionMes - 2_478) < 1,
    `C:retencionMes esperado 2478, obtenido ${r.retencionMes}`
  );
}

console.log("rta5ta VERDE");
process.exit(0);
