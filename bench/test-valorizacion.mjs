import { readFileSync } from 'node:fs';
import { parseValorizacionXlsx } from '../packages/db/src/importers/valorizacion-s10.ts';

const buf = readFileSync(String.raw`C:\Users\gabri\Downloads\VALORIZACION Nº01-MM- SAN MARTIN DE PORRAS- 2026.xlsx`);

try {
  const r = parseValorizacionXlsx(buf);
  console.log('OK');
  console.log({
    numero: r.numero,
    mesPeriodo: r.mesPeriodo,
    valorizacion: r.valorizacion,
    montoCd: r.montoCd ?? r.valorizacion,
    montoIgv: r.montoIgv,
    partidas: r.partidas?.length ?? 0,
    errors: r.errors,
    warnings: r.warnings,
  });
} catch (e) {
  console.log('ERROR:', e.message);
  console.log(e.stack?.slice(0, 1000));
}
