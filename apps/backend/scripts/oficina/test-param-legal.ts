import assert from 'node:assert/strict';
import { resolverParamLegal } from '../../src/lib/paramLegalOficina.js';
const sep = await resolverParamLegal('2026-09-01');
assert.equal(Number(sep.rmv), 1130, `sep RMV ${sep.rmv}`);
const oct = await resolverParamLegal('2026-10-01');
assert.equal(Number(oct.rmv), 1300, `oct RMV ${oct.rmv}`);
const nov = await resolverParamLegal('2026-11-01');
assert.equal(Number(nov.rmv), 1300, `nov RMV ${nov.rmv}`);
console.log('param-legal VERDE'); process.exit(0);
