/**
 * F2 · tests puros de resolverDistribucion + repartir (sin DB).
 *   cd apps/backend && ./node_modules/.bin/tsx scripts/oficina/test-distribucion.ts
 * Imprime 'distribucion VERDE' en éxito.
 */
import assert from 'node:assert/strict';
import { repartir, resolverDistribucion, round2 } from '../../src/lib/planillaOficinaDistribucion.js';

const A = '11111111-1111-1111-1111-111111111111'; // obra A
const B = '22222222-2222-2222-2222-222222222222'; // obra B
const E1 = 'aaaaaaaa-0000-0000-0000-000000000001'; // empleado con reglas propias
const E2 = 'aaaaaaaa-0000-0000-0000-000000000002'; // empleado sin reglas propias

const reglas = [
  { empleadoId: null, obraId: A, pct: 70 },
  { empleadoId: null, obraId: B, pct: 30 },
  { empleadoId: E1, obraId: B, pct: 100 },
];

// 1· el empleado con reglas propias IGNORA el global por completo
assert.deepEqual(resolverDistribucion(E1, reglas), [{ obraId: B, pct: 100 }]);

// 2· el empleado sin reglas propias hereda el global, ordenado por obraId asc
assert.deepEqual(resolverDistribucion(E2, reglas), [
  { obraId: A, pct: 70 },
  { obraId: B, pct: 30 },
]);

// 3· sin ninguna regla → 100% oficina (obraId null)
assert.deepEqual(resolverDistribucion(E2, []), [{ obraId: null, pct: 100 }]);

// 4· Σ pct < 100 → el resto va a oficina, al final
assert.deepEqual(resolverDistribucion(E2, [{ empleadoId: null, obraId: A, pct: 60 }]), [
  { obraId: A, pct: 60 },
  { obraId: null, pct: 40 },
]);

// 5· Σ pct == 100 exacto → NO se emite slice de oficina (Review Focus)
assert.deepEqual(resolverDistribucion(E2, [
  { empleadoId: null, obraId: A, pct: 33.34 },
  { empleadoId: null, obraId: B, pct: 66.66 },
]).length, 2);

// 6· reparto exacto con céntimos: Σ porciones == total al céntimo
const total = 12345.67;
const porciones = repartir(total, resolverDistribucion(E2, [
  { empleadoId: null, obraId: A, pct: 60 },
  { empleadoId: null, obraId: B, pct: 40 },
]));
assert.equal(round2(porciones.reduce((s, p) => s + p.monto, 0)), total);

// 7· el ÚLTIMO slice absorbe la diferencia de redondeo
const tres = repartir(100, [
  { obraId: A, pct: 33.33 },
  { obraId: B, pct: 33.33 },
  { obraId: null, pct: 33.34 },
]);
assert.equal(round2(tres.reduce((s, p) => s + p.monto, 0)), 100);
assert.equal(tres[2]!.obraId, null);

// 8· total 0 → una porción en 0 (el armador la descarta por umbral, no explota aquí)
assert.equal(round2(repartir(0, [{ obraId: A, pct: 100 }]).reduce((s, p) => s + p.monto, 0)), 0);

// 9· slices vacío → todo a oficina (defensa; no debería ocurrir)
assert.deepEqual(repartir(500, []), [{ obraId: null, monto: 500 }]);

console.log('distribucion VERDE');
