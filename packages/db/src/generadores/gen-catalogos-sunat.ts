/**
 * Genera data/sunat-catalogos.json desde la hoja "Catálogos" (Anexo 8) del Excel oficial
 * "Reglas de validación CPE" de SUNAT. Se corre una vez por actualización del Excel.
 *   pnpm --filter @erp/db exec tsx src/generadores/gen-catalogos-sunat.ts ../../.tmp/reglas-validacion-sunat.xlsx
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEREMOS = new Set(['01', '06', '07', '09', '10', '51', '52', '53', '54', '59']);

const origen = process.argv[2];
if (!origen) throw new Error('uso: gen-catalogos-sunat.ts <ruta-excel-reglas-sunat>');
const wb = XLSX.read(fs.readFileSync(origen));
const hoja = wb.Sheets['Catálogos'];
if (!hoja) throw new Error('El Excel no tiene la hoja "Catálogos"');
const rows = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, blankrows: false, raw: false });

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
type Fila = { codigo: string; descripcion: string; extra: Record<string, string> };
const out: Record<string, { nombre: string; filas: Fila[] }> = {};
let actual: string | null = null;
let headers: string[] = [];

for (const r of rows) {
  const c = r.map(limpio);
  if (c[0] === 'No.' && c[1]) { // inicio de un catálogo
    actual = QUEREMOS.has(c[1]) ? c[1] : null;
    headers = [];
    if (actual) out[actual] = { nombre: '', filas: [] };
    continue;
  }
  if (!actual) continue;
  if (c[0] === 'Catálogo') { out[actual].nombre = c[1] ?? ''; continue; }
  if (c[0] === 'Código') { headers = c; continue; }
  if (!headers.length || !c[0] || !c[1]) continue;
  const extra: Record<string, string> = {};
  for (let i = 2; i < headers.length; i++) if (headers[i] && c[i]) extra[headers[i]] = c[i];
  out[actual].filas.push({ codigo: c[0], descripcion: c[1], extra });
}

for (const k of QUEREMOS) if (!out[k]?.filas.length) throw new Error(`Catálogo ${k} vacío o ausente`);
const destino = path.resolve(__dirname, '../data/sunat-catalogos.json');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, `${JSON.stringify(out, null, 1)}\n`);
console.log(Object.entries(out).map(([k, v]) => `${k}:${v.filas.length}`).join(' '), '→', destino);
