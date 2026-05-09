/**
 * Parser presupuesto desagregado S10 · Excel xls/xlsx
 *
 * Estructura típica S10 (Range B1:Z1227 · primer col = índice 0 en SheetJS):
 *   col 0: Item (código '01.01.01.01')   · Excel col B
 *   col 4: Descripción                    · Excel col F
 *   col 9: Und.                           · Excel col K
 *   col 11: Metrado                       · Excel col M
 *   col 14: Precio S/.                    · Excel col P
 *   col 20: Parcial S/.                   · Excel col V
 *
 * - Items sin Und/Metrado = títulos (is_summary)
 * - Items con Und/Metrado = partidas hoja (executable)
 */
import * as XLSX from 'xlsx';
import { Decimal } from 'decimal.js';

export interface S10ParsedPartida {
  codigo: string;
  parentCodigo: string | null;
  nivel: number;
  descripcion: string;
  unidad: string | null;
  metrado: number | null;
  precioUnitario: number | null;
  parcial: number;
  isSummary: boolean;
  orden: number;
}

export interface S10ParseResult {
  partidas: S10ParsedPartida[];
  totalPartidasHoja: number;
  totalTitulos: number;
  sumaParcialesHoja: number;
  costoDirectoEsperado: number | null;
  diferenciaCuadre: number;
  cuadre: boolean;
  titulosNivel1: { codigo: string; descripcion: string; monto: number }[];
  errors: string[];
  warnings: string[];
}

const REGEX_CODIGO = /^\d+(\.\d+)*$/;

function cleanText(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s).trim();
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function calcularParent(codigo: string): string | null {
  const idx = codigo.lastIndexOf('.');
  return idx > 0 ? codigo.substring(0, idx) : null;
}

export function parsePresupuestoS10(buffer: Buffer): S10ParseResult {
  const result: S10ParseResult = {
    partidas: [],
    totalPartidasHoja: 0,
    totalTitulos: 0,
    sumaParcialesHoja: 0,
    costoDirectoEsperado: null,
    diferenciaCuadre: 0,
    cuadre: false,
    titulosNivel1: [],
    errors: [],
    warnings: [],
  };

  const workbook = XLSX.read(buffer, { type: 'buffer', cellNF: false, cellText: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    result.errors.push('Workbook sin hojas');
    return result;
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    result.errors.push(`Hoja '${sheetName}' no encontrada`);
    return result;
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  let orden = 0;
  let sumaHoja = new Decimal(0);
  let costoDirectoFromFile: number | null = null;

  for (const row of rows) {
    const codigo = cleanText(row[0]);
    const descripcion = cleanText(row[4]);

    // Detectar línea CD/GG/Util/Subtotal/IGV/TOTAL al final
    if (descripcion.toUpperCase().includes('COSTO DIRECTO') && !codigo) {
      costoDirectoFromFile = toNumber(row[20]);
      continue;
    }

    if (!REGEX_CODIGO.test(codigo)) continue;

    const unidad = cleanText(row[9]) || null;
    const metrado = toNumber(row[11]);
    const precioUnitario = toNumber(row[14]);
    const parcial = toNumber(row[20]) ?? 0;
    const isSummary = !unidad || metrado === null;
    const nivel = codigo.split('.').length;

    const partida: S10ParsedPartida = {
      codigo,
      parentCodigo: calcularParent(codigo),
      nivel,
      descripcion: descripcion.trimStart(),
      unidad,
      metrado,
      precioUnitario,
      parcial,
      isSummary,
      orden: orden++,
    };

    result.partidas.push(partida);

    if (isSummary) {
      result.totalTitulos++;
      if (nivel === 1) {
        result.titulosNivel1.push({
          codigo,
          descripcion: descripcion.trimStart(),
          monto: parcial,
        });
      }
    } else {
      result.totalPartidasHoja++;
      sumaHoja = sumaHoja.plus(parcial);
    }
  }

  result.sumaParcialesHoja = sumaHoja.toDecimalPlaces(2).toNumber();
  result.costoDirectoEsperado = costoDirectoFromFile;

  // Cuadre · Σ partidas hoja vs CD declarado en archivo
  if (costoDirectoFromFile !== null) {
    result.diferenciaCuadre = new Decimal(costoDirectoFromFile)
      .minus(result.sumaParcialesHoja)
      .toDecimalPlaces(2)
      .toNumber();
    result.cuadre = Math.abs(result.diferenciaCuadre) <= 0.01;
  } else {
    // Validar contra Σ títulos nivel 1
    const sumaTitulos = result.titulosNivel1.reduce(
      (acc, t) => acc.plus(t.monto),
      new Decimal(0),
    );
    result.diferenciaCuadre = sumaTitulos.minus(result.sumaParcialesHoja).toDecimalPlaces(2).toNumber();
    result.cuadre = Math.abs(result.diferenciaCuadre) <= 0.01;
    if (!result.cuadre) {
      result.warnings.push(
        `CD no declarado en archivo · usando suma títulos nivel 1: ${sumaTitulos.toFixed(2)}`,
      );
    }
  }

  // Validaciones adicionales
  if (result.totalPartidasHoja === 0) {
    result.errors.push('No se encontraron partidas hoja (con und + metrado)');
  }

  if (!result.cuadre) {
    result.errors.push(
      `Cuadre falla · Σ partidas hoja=${result.sumaParcialesHoja} vs CD=${result.costoDirectoEsperado ?? 'n/a'} · diff=${result.diferenciaCuadre}`,
    );
  }

  return result;
}
