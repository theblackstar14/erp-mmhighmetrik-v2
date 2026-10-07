/**
 * Check del parser del plan de CONTASIS contra la fixture real de Kelly.
 * No toca DB. Correr:
 *   node <tsx> scripts/contasis/test-parse-plan.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlanContasis, tipoPorElemento } from '../../src/lib/contasisPlan.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(AQUI, 'PLAN DE CUENTAS ESTANDAR_SQL.xlsx');

const { cuentas, duplicados } = parsePlanContasis(fs.readFileSync(FIXTURE));

// ── forma general ──
// 3396 filas en el Excel, 3392 códigos: su export trae 4 códigos repetidos (ver abajo).
assert.equal(cuentas.length, 3392, `esperaba 3392 cuentas, vinieron ${cuentas.length}`);
assert.ok(cuentas.every((c) => c.codigo.length >= 2 && c.codigo.length <= 10), 'código fuera de 2..10 chars');
console.log('  ✓ 3392 cuentas, códigos de 2 a 10 caracteres');

// ── Review Focus 1 · ccodcue viene padded a C(20,0): sin trim el código no casa ──
assert.ok(cuentas.every((c) => c.codigo === c.codigo.trim()), 'hay códigos con espacios de relleno');
assert.ok(cuentas.every((c) => c.descripcion === c.descripcion.trim()), 'hay descripciones con relleno');
assert.equal(new Set(cuentas.map((c) => c.codigo)).size, 3392, 'quedaron códigos duplicados tras el dedupe');
console.log('  ✓ códigos y descripciones sin relleno, sin duplicados');

// ── duplicados del catálogo de Kelly: se reportan, NO se eligen en silencio ──
// `ccodcue` es su PK declarada, así que su tabla no podría tener dos filas con el mismo
// código: el export no es un dump fiel. El parser se queda con la primera y devuelve el
// resto para que el loader los imprima; la que difiere en destino va a la lista de Kelly.
assert.deepEqual(
  duplicados.map((d) => d.codigo).sort(),
  ['30221', '30224', '628095', '6882'],
  `duplicados inesperados: ${duplicados.map((d) => d.codigo).join(', ')}`,
);
const d628095 = duplicados.find((d) => d.codigo === '628095');
assert.ok(d628095, '628095 debía venir como duplicado');
assert.equal(d628095.difiereEnDestino, true, '628095 difiere en cdesdeb (9511 vs 9611): tiene que marcarse');
assert.equal(d628095.conservada.destinoDebe, '9511', 'se conserva la PRIMERA fila (VTA)');
assert.equal(d628095.descartada.destinoDebe, '9611', 'se descarta la segunda (OTROS)');
// los otros 3 solo cambian la descripción: inofensivos para la contabilidad
for (const d of duplicados.filter((x) => x.codigo !== '628095')) {
  assert.equal(d.difiereEnDestino, false, `${d.codigo} no debía diferir en destino`);
}
console.log('  ✓ 4 duplicados reportados · 628095 marcado por destino distinto (9511 vs 9611)');

const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]));

// ── la cuenta del asiento de prueba, con su destino automático (spec §1.2) ──
const c6011020 = porCodigo.get('6011020');
assert.ok(c6011020, '6011020 no vino en el parseo');
assert.equal(c6011020.descripcion, 'MERCADERÍAS - COMPRAS');
assert.equal(c6011020.destinoDebe, '20111');
assert.equal(c6011020.destinoHaber, '6111020');
assert.equal(c6011020.tipo, 'Gasto');
assert.equal(c6011020.clasificable, true);
assert.equal(c6011020.contasisNivel, 3);
assert.equal(c6011020.nivel, 6); // nivel = largo − 1
console.log('  ✓ 6011020 · destino 20111/6111020, Gasto, clasificable, nivel 6');

// ── Review Focus 2 · parent = prefijo EXISTENTE más largo, no largo−1 ──
// 6011020 (7 chars): no existen 601102 ni 60110 → el padre es 6011 (4 chars).
assert.equal(c6011020.parentCodigo, '6011', `padre de 6011020 debía ser 6011, vino ${c6011020.parentCodigo}`);
// 60322521 (8 chars): tampoco existe 6032252 → padre 6032 o el prefijo que sí esté.
const c60322521 = porCodigo.get('60322521');
assert.ok(c60322521, '60322521 no vino en el parseo');
assert.ok(c60322521.parentCodigo && porCodigo.has(c60322521.parentCodigo), 'padre de 60322521 no existe en el catálogo');
assert.ok(c60322521.codigo.startsWith(c60322521.parentCodigo), 'el padre no es prefijo del hijo');
// invariante global: todo padre declarado existe y es prefijo propio del hijo
for (const c of cuentas) {
  if (c.parentCodigo === null) continue;
  assert.ok(porCodigo.has(c.parentCodigo), `${c.codigo} declara padre ${c.parentCodigo} que no existe`);
  assert.ok(c.codigo.startsWith(c.parentCodigo) && c.parentCodigo.length < c.codigo.length, `padre inválido en ${c.codigo}`);
}
// y es el MÁS largo posible: no debe existir otro prefijo propio más largo que el elegido
for (const c of cuentas) {
  for (let n = c.codigo.length - 1; n > (c.parentCodigo?.length ?? 0); n--) {
    assert.ok(!porCodigo.has(c.codigo.slice(0, n)), `${c.codigo} debió colgar de ${c.codigo.slice(0, n)}, no de ${c.parentCodigo}`);
  }
}
console.log('  ✓ parent_codigo = prefijo existente más largo, en las 3392');

// ── Review Focus 3 · elementos 0 y 8 tienen tipo (la columna es NOT NULL) ──
assert.ok(cuentas.every((c) => typeof c.tipo === 'string' && c.tipo.length > 0), 'hay cuentas sin tipo');
assert.equal(tipoPorElemento('01'), 'Orden');
assert.equal(tipoPorElemento('8211'), 'Resultado');
assert.equal(tipoPorElemento('1041'), 'Activo');
assert.equal(tipoPorElemento('4212'), 'Pasivo');
assert.equal(tipoPorElemento('50'), 'Patrimonio');
assert.equal(tipoPorElemento('6011020'), 'Gasto');
assert.equal(tipoPorElemento('7041'), 'Ingreso');
assert.equal(tipoPorElemento('9311'), 'Costo');
const cOrden = porCodigo.get('0111');
assert.ok(cOrden && cOrden.tipo === 'Orden', '0111 debía ser tipo Orden');
console.log('  ✓ todas las cuentas tienen tipo · elementos 0 y 8 mapeados');

// ── clasificable = elemento 6 o 9 (regla WS0, alimenta derivarClase) ──
assert.ok(cuentas.filter((c) => c.clasificable).every((c) => c.codigo[0] === '6' || c.codigo[0] === '9'), 'clasificable fuera de elem 6/9');
assert.ok(porCodigo.get('9311')!.clasificable, '9311 debía ser clasificable');
assert.equal(porCodigo.get('4212')!.clasificable, false, '4212 no debía ser clasificable');
console.log('  ✓ clasificable solo en elementos 6 y 9');

// ── destino automático: 1368 cuentas, y viene en PAR (spec §1.2) ──
const conDestino = cuentas.filter((c) => c.destinoDebe || c.destinoHaber);
assert.equal(conDestino.length, 1368, `esperaba 1368 con destino, vinieron ${conDestino.length}`);
assert.ok(conDestino.every((c) => c.destinoDebe && c.destinoHaber), 'hay destino a medias (solo debe o solo haber)');
console.log('  ✓ 1368 cuentas con destino automático, todas con el par completo');

// ── el sufijo de destino es la clase (spec §1.3) ──
assert.equal(porCodigo.get('6271094')!.destinoDebe, '9411'); // ADM
assert.equal(porCodigo.get('6271093')!.destinoDebe, '9311'); // CDS
assert.equal(porCodigo.get('6271093')!.destinoHaber, '7911');
console.log('  ✓ sufijos de destino 093→9311 y 094→9411');

// ── exige_centro_costo: nafecos está casi vacío y ESO es el bloqueante del spec §1.4 ──
const conCC = cuentas.filter((c) => c.exigeCentroCosto);
assert.ok(conCC.length <= 5, `nafecos poblado en ${conCC.length} cuentas: Kelly ya configuró, revisar el spec §1.4`);
console.log(`  ✓ exige_centro_costo en ${conCC.length} cuentas (sin configurar, como esperaba el spec §1.4)`);

// ── formularios EEFF ──
assert.equal(cuentas.filter((c) => c.codBalance1).length, 925);
assert.equal(cuentas.filter((c) => c.codBalance2).length, 2318);
assert.equal(cuentas.filter((c) => c.cuentaCierre).length, 1469);
console.log('  ✓ 925 cod_balance_1 · 2318 cod_balance_2 · 1469 cuenta_cierre');

console.log('✅ parser del plan CONTASIS OK');
