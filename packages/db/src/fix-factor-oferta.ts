/**
 * Fix campos económicos PG0005 · valores correctos
 * - costo_directo = 1,319,122.00 (REFERENCIAL · expediente técnico)
 * - factor_oferta = 0.95 (oferta consorcio)
 * - cd contractual calculado: 1,319,122 × 0.95 = 1,253,165.90
 *
 * Fix necesario porque endpoint UI cronograma anterior sobrescribió
 * costo_directo con valor contractual (mal · debe ser referencial).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = await import('./client.js');
const { proyectos } = await import('./schema.js');
const { eq } = await import('drizzle-orm');

console.log('🔧 Fix económicos PG0005 · valores correctos');

await db
  .update(proyectos)
  .set({
    costoDirecto: '1319122.00', // REFERENCIAL · S10 expediente técnico
    montoReferencial: '1821179.83',
    montoContractual: '1730120.84',
    factorOferta: '0.950000',
    montoVigente: '1675933.17',
    pctGg: '0.1000',
    pctUtilidad: '0.0700',
    pctIgv: '0.1800',
  })
  .where(eq(proyectos.codigo, 'PG0005'));

console.log('✓ Valores económicos corregidos:');
console.log('  costo_directo:     1,319,122.00 (referencial)');
console.log('  monto_referencial: 1,821,179.83');
console.log('  monto_contractual: 1,730,120.84');
console.log('  factor_oferta:     0.950000');
console.log('  monto_vigente:     1,675,933.17');
console.log('  CD contractual:    1,253,165.90 (= 1,319,122 × 0.95)');
process.exit(0);
