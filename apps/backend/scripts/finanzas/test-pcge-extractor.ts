/**
 * Fase 0 · extractor de cuentas del texto del PCGE (sin BD).
 * node apps/backend/node_modules/tsx/dist/cli.mjs apps/backend/scripts/finanzas/test-pcge-extractor.ts
 */
import assert from 'node:assert/strict';
import { extraerCuentasPcge } from '../../../../packages/db/src/generadores/pcge.js';

const texto = [
  '=== PAGINA 19', '1 \tActivo disponible y exigible',
  'ELEMENTO 1: \tACTIVO DISPONIBLE Y EXIGIBLE',
  '10 \tEFECTIVO Y EQUIVALENTES DE EFECTIVO',
  '101 \tCaja',
  '=== PAGINA 21', '17', 'PLAN CONTABLE GENERAL EMPRESARIAL', 'CATÁLOGO DE CUENTAS',
  '1041 \tCuentas corrientes operativas',
  'ELEMENTO 4: \tPASIVO',
  '40 \tTRIBUTOS, CONTRAPRESTACIONES Y APORTES AL SISTEMA DE PENSIONES Y DE',
  'SALUD POR PAGAR',
  '4011 Impuesto general a las ventas',
  '40111 \tIGV – Cuenta propia',
  'ELEMENTO 6: \tGASTOS POR NATURALEZA',
  '6032 Suministros',
  'ELEMENTO 8: \tSALDOS INTERMEDIARIOS DE GESTIÓN Y DETERMINACIÓN DEL',
  'RESULTADO DEL EJERCICIO',
  '80 \tMARGEN COMERCIAL',
  '881 \tImpuesto a la renta – Corriente',
  'ELEMENTO 9: \tCONTABILIDAD ANALÍTICA DE EXPLOTACIÓN: COSTOS DE',
  'PRODUCCIÓN Y GASTOS POR FUNCIÓN',
  'El uso de las cuentas, subcuentas, divisionarias y detalles de este elemento, se determina de',
  'acuerdo con la clasificación requerida por cada entidad.',
  '=== PAGINA 70', '66',
  'ELEMENTO "0": \tCUENTAS DE ORDEN',
  'CUENTAS DE ORDEN DEUDORAS',
  '01 \tBIENES Y VALORES ENTREGADOS',
  '011 \tBienes en préstamo, custodia y no capitalizables',
  '=== PAGINA 72', '68',
  'PARTE III - DESCRIPCIÓN Y DINÁMICA CONTABLE',
  '10 \tEFECTIVO Y EQUIVALENTES DE EFECTIVO',
  'CONTENIDO',
].join('\n');

const r = extraerCuentasPcge(texto);
const by = Object.fromEntries(r.map((c) => [c.codigo, c]));

assert.deepEqual(r.map((c) => c.codigo), ['10', '101', '1041', '40', '4011', '40111', '6032', '80', '881', '01', '011'], 'orden y set de codigos (nada antes de ELEMENTO 1 ni despues de PARTE III)');
assert.deepEqual(by['10'], { codigo: '10', descripcion: 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', tipo: 'Activo', nivel: 1, parentCodigo: null, clasificable: false });
assert.deepEqual(by['1041'], { codigo: '1041', descripcion: 'Cuentas corrientes operativas', tipo: 'Activo', nivel: 3, parentCodigo: '104', clasificable: false });
assert.equal(by['40'].descripcion, 'TRIBUTOS, CONTRAPRESTACIONES Y APORTES AL SISTEMA DE PENSIONES Y DE SALUD POR PAGAR', 'une la linea partida');
assert.deepEqual(by['40111'], { codigo: '40111', descripcion: 'IGV – Cuenta propia', tipo: 'Pasivo', nivel: 4, parentCodigo: '4011', clasificable: false });
assert.equal(by['6032'].clasificable, true, 'elemento 6 clasificable');
assert.equal(by['6032'].tipo, 'Gasto');
assert.equal(by['80'].tipo, 'Resultado');
assert.equal(by['80'].descripcion, 'MARGEN COMERCIAL', 'no pega el titulo del elemento 8');
assert.equal(by['881'].tipo, 'Gasto', '88 es Gasto');
assert.deepEqual(by['011'], { codigo: '011', descripcion: 'Bienes en préstamo, custodia y no capitalizables', tipo: 'Orden', nivel: 2, parentCodigo: '01', clasificable: false });

console.log('pcge-extractor VERDE');
process.exit(0);
