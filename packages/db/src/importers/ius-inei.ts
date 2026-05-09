/**
 * Importer IUs INEI mensuales
 *
 * Formato CSV esperado:
 *   iu_codigo,area,anio_mes,valor,resolucion_jefatural,fecha_publicacion
 *   47,lima,2025-06,100.0000,RJ-001-2025-INEI,2025-07-15
 *
 * Áreas válidas: lima, norte, centro, sur, oriente
 */
import fs from 'node:fs';

export interface IuMensualParsed {
  iuCodigo: string;
  area: string;
  anioMes: string; // 'YYYY-MM'
  valor: number;
  resolucionJefatural?: string;
  fechaPublicacion?: string;
}

export interface IusIneiParseResult {
  rows: IuMensualParsed[];
  errors: string[];
  warnings: string[];
}

const ANIO_MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const AREAS_VALIDAS = new Set(['lima', 'norte', 'centro', 'sur', 'oriente']);

export function parseIusIneiCsv(csvPath: string): IusIneiParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: IuMensualParsed[] = [];

  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());

  if (lines.length < 2) {
    errors.push('CSV vacío o sin filas datos');
    return { rows, errors, warnings };
  }

  // header
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = {
    iu: header.indexOf('iu_codigo'),
    area: header.indexOf('area'),
    anioMes: header.indexOf('anio_mes'),
    valor: header.indexOf('valor'),
    rj: header.indexOf('resolucion_jefatural'),
    fp: header.indexOf('fecha_publicacion'),
  };

  if (idx.iu < 0 || idx.area < 0 || idx.anioMes < 0 || idx.valor < 0) {
    errors.push('CSV header faltante: iu_codigo,area,anio_mes,valor obligatorios');
    return { rows, errors, warnings };
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const iu = cols[idx.iu]?.padStart(2, '0');
    const area = cols[idx.area]?.toLowerCase();
    const anioMes = cols[idx.anioMes];
    const valorStr = cols[idx.valor];

    if (!iu || !area || !anioMes || !valorStr) {
      warnings.push(`L${i + 1} · campos vacíos · skip`);
      continue;
    }
    if (!ANIO_MES_RE.test(anioMes)) {
      errors.push(`L${i + 1} · anio_mes inválido "${anioMes}" · esperado YYYY-MM`);
      continue;
    }
    if (!AREAS_VALIDAS.has(area)) {
      errors.push(`L${i + 1} · area inválida "${area}"`);
      continue;
    }
    const valor = Number(valorStr);
    if (!Number.isFinite(valor) || valor <= 0) {
      errors.push(`L${i + 1} · valor inválido "${valorStr}"`);
      continue;
    }

    rows.push({
      iuCodigo: iu,
      area,
      anioMes,
      valor,
      resolucionJefatural: idx.rj >= 0 ? cols[idx.rj] || undefined : undefined,
      fechaPublicacion: idx.fp >= 0 ? cols[idx.fp] || undefined : undefined,
    });
  }

  return { rows, errors, warnings };
}
