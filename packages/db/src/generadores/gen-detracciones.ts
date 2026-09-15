/**
 * Genera data/detracciones.json uniendo el catálogo 54 SUNAT (códigos oficiales) con la tabla
 * de detracciones de Kelly (% , vigencia, anexos). Conflictos quedan listados para revisión.
 *   pnpm --filter @erp/db exec tsx src/generadores/gen-detracciones.ts "C:/Users/gabri/Downloads/Gabriel/DOCUMENTOS PARA GABRIEL/TABLA DE DETRACCIONES.xlsx"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const origen = process.argv[2];
if (!origen) throw new Error('uso: gen-detracciones.ts <ruta TABLA DE DETRACCIONES.xlsx>');

const cats = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/sunat-catalogos.json'), 'utf8')) as Record<string, { filas: { codigo: string; descripcion: string }[] }>;
const sunat = new Map(cats['54'].filas.map((f) => [f.codigo, f.descripcion]));

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (s: string) => limpio(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const pad = (c: string) => c.padStart(3, '0');
const pctDe = (s: string): number | null => { const m = /([\d.,]+)\s*%/.exec(s); return m ? Number.parseFloat(m[1].replace(',', '.')) : null; };

const wb = XLSX.read(fs.readFileSync(origen));
const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, raw: false }).map((r) => r.map(limpio));

type Kelly = { codigo: string; descripcion: string; porcentaje: number | null; vigenciaHasta: string | null; noVigente: boolean };
const principal: Kelly[] = [];
const bloques: { descripcion: string; porcentaje: number | null }[][] = [];
let enAnexos = false;
for (const c of rows.slice(1)) {
  if (c[0] === 'Nº') { enAnexos = true; bloques.push([]); continue; }
  if (!c[0] || !c[1]) continue;
  if (!enAnexos) {
    const hasta = /Hasta el (\d{2})\/(\d{2})\/(\d{4})/i.exec(c[3] ?? '');
    principal.push({
      codigo: pad(c[0]), descripcion: c[1], porcentaje: pctDe(c[2] ?? ''),
      vigenciaHasta: hasta ? `${hasta[3]}-${hasta[2]}-${hasta[1]}` : null,
      noVigente: /no vigente/i.test(c[3] ?? ''),
    });
  } else bloques[bloques.length - 1].push({ descripcion: c[1], porcentaje: pctDe(c[2] ?? '') });
}
const NOMBRE_BLOQUE = ['1', '2', '3', 'transporte'];
if (bloques.length !== 4) throw new Error(`Se esperaban 4 bloques de anexos, hay ${bloques.length}`);

type Conflicto = { codigo: string; tipo: string; detalle: string };
const conflictos: Conflicto[] = [];

// Empareja una fila de anexo con la lista principal: igualdad, prefijo completo, o prefijo común >= 12 único.
function emparejar(desc: string): Kelly | null {
  const d = norm(desc);
  const exacto = principal.find((k) => norm(k.descripcion) === d);
  if (exacto) return exacto;
  const prefijo = principal.filter((k) => { const n = norm(k.descripcion); return n.startsWith(d) || d.startsWith(n); });
  if (prefijo.length === 1) return prefijo[0];
  const lcp = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
  const puntajes = principal.map((k) => ({ k, p: lcp(norm(k.descripcion), d) })).sort((a, b) => b.p - a.p);
  return puntajes[0].p >= 12 && puntajes[0].p > (puntajes[1]?.p ?? 0) ? puntajes[0].k : null;
}

const anexoDe = new Map<string, string>();
bloques.forEach((bloque, i) => {
  for (const fila of bloque) {
    const k = emparejar(fila.descripcion);
    if (!k) { conflictos.push({ codigo: '???', tipo: 'anexo_sin_match', detalle: `anexo ${NOMBRE_BLOQUE[i]}: ${fila.descripcion}` }); continue; }
    if (anexoDe.has(k.codigo)) conflictos.push({ codigo: k.codigo, tipo: 'anexo_duplicado', detalle: `anexo ${anexoDe.get(k.codigo)} y ${NOMBRE_BLOQUE[i]}` });
    else anexoDe.set(k.codigo, NOMBRE_BLOQUE[i]);
    if (fila.porcentaje !== k.porcentaje) conflictos.push({ codigo: k.codigo, tipo: 'porcentaje', detalle: `principal ${k.porcentaje}% vs anexo ${NOMBRE_BLOQUE[i]} ${fila.porcentaje}%` });
  }
});

const kellyPorCodigo = new Map(principal.map((k) => [k.codigo, k]));
const codigos = [...new Set([...sunat.keys(), ...kellyPorCodigo.keys()])].sort();
const tasas = codigos.map((codigo) => {
  const k = kellyPorCodigo.get(codigo);
  const obs: string[] = [];
  if (!sunat.has(codigo)) { conflictos.push({ codigo, tipo: 'solo_kelly', detalle: k?.descripcion ?? '' }); obs.push('no figura en catalogo 54 SUNAT'); }
  if (!k) { conflictos.push({ codigo, tipo: 'solo_sunat', detalle: sunat.get(codigo) ?? '' }); obs.push('sin % en tabla de Kelly'); }
  if (k?.noVigente) obs.push('No vigente segun tabla de Kelly');
  if (codigo === '027') obs.push('minimo 400 por evidencia F013-107901 (S/ 645 detrajo); a confirmar con Kelly');
  return {
    codigo,
    descripcion: sunat.get(codigo) ?? k!.descripcion,
    anexo: anexoDe.get(codigo) ?? null,
    porcentaje: k?.porcentaje ?? null,
    montoMinimo: codigo === '027' ? 400 : 700,
    vigenciaDesde: '2000-01-01',
    vigenciaHasta: k?.noVigente ? '2000-01-01' : (k?.vigenciaHasta ?? null),
    observacion: obs.length ? obs.join('; ') : null,
  };
});

const destino = path.resolve(__dirname, '../data/detracciones.json');
fs.writeFileSync(destino, `${JSON.stringify({ fuente: 'SUNAT catalogo 54 (reglas CPE 26.08.2026) + TABLA DE DETRACCIONES.xlsx (Kelly)', tasas, conflictos }, null, 1)}\n`);
console.log(`${tasas.length} tasas · ${conflictos.length} conflictos →`, destino);
for (const c of conflictos) console.log(`  ${c.codigo} ${c.tipo} · ${c.detalle}`);
