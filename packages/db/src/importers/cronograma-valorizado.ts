/**
 * Parser Cronograma Valorizado · formato XLSX construcción Perú (CAPECO/S10)
 *
 * Estructura típica (hoja "Calendario Valorizado" o "Calendario Desembolso"):
 *   Row 1-3: Título "Calendario Valorizado de Avance de Obra"
 *   Row 4: Obra | : <nombre>
 *   Row 5: Ubicacion | : <ubicacion>
 *   Row 6: Costo A | : <mes-año base>  | Cliente | : <cliente>
 *   Row 7: PLAZO DE EJECUCION (col G)
 *   Row 8: headers · A=Item B=Descripcion C=Unid D=Metrado E=PU F=Parcial G..S=meses T=TOTAL
 *   Row 10+: partidas jerárquicas (codigo "01", "01.01", "01.01.01", ...)
 *   Bottom: COSTO DIRECTO · GG · UTILIDAD · SUB TOTAL · MOBILIARIO · IGV ·
 *           PRESUPUESTO TOTAL · DOC TRABAJO · SUPERVISION · VALOR REFERENCIAL ·
 *           % AVANCE FISICO MENSUAL · % ACUMULADO
 *
 * Notas:
 *   - Items sin Unid/Metrado/PU = títulos (is_summary)
 *   - Items con Unid+Metrado+PU = partidas hoja
 *   - fechaInicio/fechaFin de partida hoja se infieren del primer/último mes con valor>0
 */
import * as XLSX from 'xlsx';
import { Decimal } from 'decimal.js';

export interface CvParsedPartida {
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
  // Distribución mensual (idx 0..N-1) · solo hojas
  distribucionMensual: number[];
  fechaInicio: string | null; // ISO yyyy-mm-dd (primer día del primer mes con valor>0)
  fechaFin: string | null; // ISO yyyy-mm-dd (último día del último mes con valor>0)
}

export interface CvParsedMes {
  idx: number; // 0..N-1
  year: number;
  month: number; // 1-12
  diasDuracion: number; // del header (16, 31, 30, ...)
  fechaInicio: string; // ISO yyyy-mm-dd
  fechaFin: string; // ISO yyyy-mm-dd
  label: string; // 'Abr-26'
}

export interface CvParseResult {
  // Cabecera
  obra: string | null;
  ubicacion: string | null;
  cliente: string | null;
  costoBase: string | null; // 'Abr - 2026'
  fechaBase: string | null; // ISO yyyy-mm-dd (primer día costo base)
  diasPlazo: number | null;
  // Estructura
  meses: CvParsedMes[];
  partidas: CvParsedPartida[];
  // Totales bottom
  costoDirecto: number | null;
  pctGg: number | null; // 0.15
  montoGg: number | null;
  pctUtilidad: number | null;
  montoUtilidad: number | null;
  subTotal: number | null;
  mobiliario: number | null;
  pctIgv: number | null;
  montoIgv: number | null;
  presupuestoTotal: number | null;
  supervision: number | null;
  valorReferencial: number | null;
  // Validación
  totalPartidasHoja: number;
  totalTitulos: number;
  sumaParcialesHoja: number;
  cuadre: boolean;
  diferenciaCuadre: number;
  errors: string[];
  warnings: string[];
}

const REGEX_CODIGO = /^\d+(\.\d+)*$/;
const MES_NOMBRE_TO_NUM: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12,
};

function cleanText(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s).trim();
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function calcularParent(codigo: string): string | null {
  const idx = codigo.lastIndexOf('.');
  return idx > 0 ? codigo.substring(0, idx) : null;
}

/** Parsea 'Abr - 2026' o 'Abr 2026' o 'abril 2026' → { year, month } */
function parseMesAnio(text: string): { year: number; month: number } | null {
  const m = text.toLowerCase().match(/([a-z]{3})\w*\s*[-/]?\s*(\d{4})/);
  if (!m) return null;
  const monthKey = m[1]!;
  const year = Number.parseInt(m[2]!, 10);
  const month = MES_NOMBRE_TO_NUM[monthKey];
  if (!month) return null;
  return { year, month };
}

/** Parsea header de columna mes tipo '15-Abr-26\n30-Abr-26\n16 Dias' */
function parseMesHeader(text: string): {
  fechaInicio: string;
  fechaFin: string;
  diasDuracion: number;
  year: number;
  month: number;
  label: string;
} | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  // Formato esperado: '15-Abr-26', '30-Abr-26', '16 Dias'
  const parseDate = (s: string): { d: number; m: number; y: number } | null => {
    const mm = s.match(/(\d{1,2})[-/](\w{3})[-/](\d{2,4})/);
    if (!mm) return null;
    const d = Number.parseInt(mm[1]!, 10);
    const monthKey = mm[2]!.toLowerCase();
    const mNum = MES_NOMBRE_TO_NUM[monthKey];
    if (!mNum) return null;
    let y = Number.parseInt(mm[3]!, 10);
    if (y < 100) y += 2000;
    return { d, m: mNum, y };
  };
  const dStart = parseDate(lines[0]!);
  const dEnd = parseDate(lines[1]!);
  if (!dStart || !dEnd) return null;
  const diasMatch = lines[2]?.match(/(\d+)/);
  const dias = diasMatch ? Number.parseInt(diasMatch[1]!, 10) : 30;
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  const label = `${monthNames[dEnd.m - 1]}-${String(dEnd.y).slice(-2)}`;
  return {
    fechaInicio: `${dStart.y}-${String(dStart.m).padStart(2, '0')}-${String(dStart.d).padStart(2, '0')}`,
    fechaFin: `${dEnd.y}-${String(dEnd.m).padStart(2, '0')}-${String(dEnd.d).padStart(2, '0')}`,
    diasDuracion: dias,
    year: dEnd.y,
    month: dEnd.m,
    label,
  };
}

/** Encuentra fila por descripción case-insensitive en primera columna B (idx 1) */
function findRowByDesc(rows: unknown[][], descKeyword: string): unknown[] | null {
  const kw = descKeyword.toUpperCase();
  for (const row of rows) {
    const desc = cleanText(row[1]).toUpperCase();
    if (desc.includes(kw) && !cleanText(row[0])) return row;
  }
  return null;
}

export function parseCronogramaValorizado(buffer: Buffer): CvParseResult {
  const result: CvParseResult = {
    obra: null,
    ubicacion: null,
    cliente: null,
    costoBase: null,
    fechaBase: null,
    diasPlazo: null,
    meses: [],
    partidas: [],
    costoDirecto: null,
    pctGg: null,
    montoGg: null,
    pctUtilidad: null,
    montoUtilidad: null,
    subTotal: null,
    mobiliario: null,
    pctIgv: null,
    montoIgv: null,
    presupuestoTotal: null,
    supervision: null,
    valorReferencial: null,
    totalPartidasHoja: 0,
    totalTitulos: 0,
    sumaParcialesHoja: 0,
    cuadre: false,
    diferenciaCuadre: 0,
    errors: [],
    warnings: [],
  };

  const wb = XLSX.read(buffer, { type: 'buffer', cellNF: false, cellText: false });
  // Buscar hoja por nombre · Calendario Valorizado, Calendario Desembolso o primera
  const sheetName = wb.SheetNames.find((n) => /calendario/i.test(n)) ?? wb.SheetNames[0];
  if (!sheetName) {
    result.errors.push('Workbook sin hojas');
    return result;
  }
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    result.errors.push(`Hoja '${sheetName}' no encontrada`);
    return result;
  }
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // ─── Cabecera (rows 0-6 aprox) ─────────────────────────────
  for (const row of rows.slice(0, 10)) {
    const a = cleanText(row[0]).toLowerCase();
    const b = cleanText(row[1]);
    if (a.startsWith('obra')) result.obra = b.replace(/^:\s*/, '');
    else if (a.startsWith('ubicacion') || a.startsWith('ubicación')) result.ubicacion = b.replace(/^:\s*/, '');
    else if (a.startsWith('costo a')) {
      result.costoBase = b.replace(/^:\s*/, '');
      const ma = parseMesAnio(result.costoBase);
      if (ma) result.fechaBase = `${ma.year}-${String(ma.month).padStart(2, '0')}-01`;
    }
    // Cliente puede estar en col D o E
    const d = cleanText(row[3]).toLowerCase();
    if (d.startsWith('cliente')) {
      result.cliente = cleanText(row[4]).replace(/^:\s*/, '');
    }
  }

  // ─── Headers fila (con 'Item' en col A) ────────────────────
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const a = cleanText(rows[i]![0]).toLowerCase();
    if (a === 'item') {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) {
    result.errors.push("No se encontró fila de encabezados (col A='Item')");
    return result;
  }

  const headerRow = rows[headerRowIdx]!;
  // Cols meses · empiezan en col 6 (G) · terminan antes de 'TOTAL'
  const mesCols: number[] = [];
  for (let j = 6; j < headerRow.length; j++) {
    const txt = cleanText(headerRow[j]);
    if (!txt) continue;
    if (/total/i.test(txt) && !/d[íi]as/i.test(txt)) break;
    const parsed = parseMesHeader(txt);
    if (parsed) {
      mesCols.push(j);
      result.meses.push({
        idx: result.meses.length,
        year: parsed.year,
        month: parsed.month,
        diasDuracion: parsed.diasDuracion,
        fechaInicio: parsed.fechaInicio,
        fechaFin: parsed.fechaFin,
        label: parsed.label,
      });
    }
  }

  if (result.meses.length === 0) {
    result.warnings.push('No se detectaron columnas mensuales · solo se extraen partidas');
  }

  // Calcular plazo total a partir de meses
  if (result.meses.length > 0) {
    const totalDias = result.meses.reduce((s, m) => s + m.diasDuracion, 0);
    result.diasPlazo = totalDias;
  }

  // ─── Partidas (desde row siguiente al header) ──────────────
  let orden = 0;
  let sumaHoja = new Decimal(0);

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const codigo = cleanText(row[0]);
    const descripcion = cleanText(row[1]);

    if (!codigo || !REGEX_CODIGO.test(codigo)) continue;

    const unidad = cleanText(row[2]) || null;
    const metrado = toNumber(row[3]);
    const precioUnitario = toNumber(row[4]);
    const parcial = toNumber(row[5]) ?? 0;
    const isSummary = !unidad || metrado === null || precioUnitario === null;
    const nivel = codigo.split('.').length;

    const distribucionMensual: number[] = [];
    let firstNonZero = -1;
    let lastNonZero = -1;
    for (let k = 0; k < mesCols.length; k++) {
      const v = toNumber(row[mesCols[k]!]) ?? 0;
      distribucionMensual.push(v);
      if (v > 0) {
        if (firstNonZero === -1) firstNonZero = k;
        lastNonZero = k;
      }
    }

    const fechaInicio = firstNonZero >= 0 ? result.meses[firstNonZero]!.fechaInicio : null;
    const fechaFin = lastNonZero >= 0 ? result.meses[lastNonZero]!.fechaFin : null;

    result.partidas.push({
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
      distribucionMensual,
      fechaInicio,
      fechaFin,
    });

    if (isSummary) {
      result.totalTitulos++;
    } else {
      result.totalPartidasHoja++;
      sumaHoja = sumaHoja.plus(parcial);
    }
  }

  result.sumaParcialesHoja = sumaHoja.toDecimalPlaces(2).toNumber();

  // ─── Totales bottom ─────────────────────────────────────────
  const findTotal = (kw: string): unknown[] | null => findRowByDesc(rows, kw);

  const cdRow = findTotal('COSTO DIRECTO');
  if (cdRow) result.costoDirecto = toNumber(cdRow[5]);

  const ggRow = findTotal('GASTOS GENERALES');
  if (ggRow) {
    result.pctGg = toNumber(ggRow[2]);
    result.montoGg = toNumber(ggRow[5]);
  }

  const utilRow = findTotal('UTILIDAD');
  if (utilRow) {
    result.pctUtilidad = toNumber(utilRow[2]);
    result.montoUtilidad = toNumber(utilRow[5]);
  }

  const subRow = findTotal('SUB TOTAL');
  if (subRow) result.subTotal = toNumber(subRow[5]);

  const mobRow = findTotal('MOBILIARIO');
  if (mobRow) result.mobiliario = toNumber(mobRow[5]);

  const igvRow = findTotal('IGV');
  if (igvRow) {
    result.pctIgv = toNumber(igvRow[2]);
    result.montoIgv = toNumber(igvRow[5]);
  }

  const ptRow = findTotal('PRESUPUESTO TOTAL');
  if (ptRow) result.presupuestoTotal = toNumber(ptRow[5]);

  const supRow = findTotal('SUPERVISION DE OBRA') ?? findTotal('SUPERVISION');
  if (supRow) result.supervision = toNumber(supRow[5]);

  const vrRow = findTotal('VALOR REFERENCIAL');
  if (vrRow) result.valorReferencial = toNumber(vrRow[5]);

  // ─── Cuadre ─────────────────────────────────────────────────
  if (result.costoDirecto !== null) {
    result.diferenciaCuadre = new Decimal(result.costoDirecto)
      .minus(result.sumaParcialesHoja)
      .toDecimalPlaces(2)
      .toNumber();
    result.cuadre = Math.abs(result.diferenciaCuadre) <= 1;
    if (!result.cuadre) {
      result.warnings.push(
        `CD declarado=${result.costoDirecto} vs Σ hojas=${result.sumaParcialesHoja} · diff=${result.diferenciaCuadre}`,
      );
    }
  }

  if (result.totalPartidasHoja === 0) {
    result.errors.push('No se encontraron partidas hoja con und + metrado + PU');
  }

  return result;
}
