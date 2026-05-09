/**
 * Parser Calendario de Adquisición de Materiales y Herramientas (Excel S10)
 *
 * Estructura:
 *   r0-7: cabecera (obra · cliente · fechas)
 *   r8: header columnas
 *     col 0: Cod ("47 00006")
 *     col 1: Descripcion
 *     col 2: Unid
 *     col 3: Cantidad
 *     col 4: Precio S/.
 *     col 5: Parcial S/.
 *     col 6: Mes 1 (Oct-25 · 31 días)
 *     col 7: Mes 2 (Nov-25 · 30 días)
 *     col 8: Mes 3 (Dic-25 · 31 días)
 *     col 9: Mes 4 (Ene-26 · 28 días)
 *     col 10: Total
 *   r10+: secciones MANO DE OBRA · MATERIALES · EQUIPOS
 *   r406+: totales (CD · GG · Util · Subtotal · IGV · TOTAL)
 *
 * Categorización tipo recurso por código S10 prefix:
 *   47 → mano_obra (CAPATAZ · OPERARIO · OFICIAL · PEÓN · etc)
 *   49 → equipo (HM maquinaria/equipos)
 *   00 → material (varios · gasolina · piedra · etc)
 *   02-48 → material específico (acero · cemento · ladrillo · etc)
 */
import * as XLSX from 'xlsx';
import { Decimal } from 'decimal.js';

export type RecursoTipo = 'mano_obra' | 'material' | 'equipo' | 'herramienta';

export interface CalendarioRecurso {
  codigoS10: string; // "47 00006"
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
  parcial: number;
  // Distribución mensual (índice 0-3 = mes 1-4)
  meses: { idx: number; etiqueta: string; fechaDesde: string; fechaHasta: string; monto: number }[];
  tipo: RecursoTipo;
  iuCodigo: string | null;
  iuConfianza: number;
}

export interface CalendarioParseResult {
  recursos: CalendarioRecurso[];
  cantidadMO: number;
  cantidadMaterial: number;
  cantidadEquipo: number;
  // Cuadres matemáticos
  costoDirectoTotal: number;
  totalManoObra: number;
  totalMateriales: number;
  totalEquipos: number;
  totalCD: number; // declarado en archivo
  totalContractual: number; // total presupuesto
  // Distribución mensual
  meses: { idx: number; etiqueta: string; fechaDesde: string; fechaHasta: string; monto: number }[];
  // Resumen breakdown
  resumen: {
    cd: number;
    gg: number;
    utilidad: number;
    subtotal: number;
    igv: number;
    total: number;
  };
  errors: string[];
  warnings: string[];
}

// ─── Categorización ───────────────────────────────────────────
function categorizarPorCodigo(codigo: string, seccionActual: string): RecursoTipo {
  const prefix = codigo.split(/\s+/)[0];
  if (prefix === '47') return 'mano_obra';
  if (prefix === '49') return 'equipo';
  // Por sección actual fallback
  if (seccionActual === 'MANO DE OBRA') return 'mano_obra';
  if (seccionActual === 'EQUIPOS') return 'equipo';
  return 'material';
}

// ─── Clasificación auto IU ────────────────────────────────────
const IU_REGLAS: Array<{ patron: RegExp; iu: string; confianza: number; tipo?: RecursoTipo }> = [
  { patron: /\bCEMENTO\b/i, iu: '21', confianza: 0.95 },
  { patron: /\bACERO\s+(CORRUGADO|FY)/i, iu: '03', confianza: 0.95 },
  { patron: /\bACERO\b/i, iu: '02', confianza: 0.9 },
  { patron: /\bFIERRO\b/i, iu: '03', confianza: 0.9 },
  { patron: /\bLADRILLO\b/i, iu: '04', confianza: 0.95 },
  { patron: /\bBLOCK\s+DE\s+CONCRETO\b/i, iu: '15', confianza: 0.95 },
  { patron: /\bHORMIGON\b/i, iu: '38', confianza: 0.95 },
  { patron: /\bAGREGAD/i, iu: '38', confianza: 0.85 },
  { patron: /\bPIEDRA\b/i, iu: '38', confianza: 0.8 },
  { patron: /\bARENA\b/i, iu: '38', confianza: 0.8 },
  { patron: /\bMADERA\b/i, iu: '43', confianza: 0.85 },
  { patron: /\bPINTURA\b/i, iu: '54', confianza: 0.9 },
  { patron: /\bTUBERIA\s+PVC\b/i, iu: '65', confianza: 0.9 },
  { patron: /\bVIDRIO\b/i, iu: '72', confianza: 0.9 },
  { patron: /\bYESO\b/i, iu: '80', confianza: 0.9 },
  { patron: /\bDIESEL\b|\bPETR[OÓ]LEO\b|\bGASOLINA\b/i, iu: '77', confianza: 0.9 },
  { patron: /\bALUMINIO\b/i, iu: '05', confianza: 0.85 },
  { patron: /\bASFALTO\b/i, iu: '14', confianza: 0.95 },
  { patron: /\bCABLE\b|\bALAMBRE\s+(NYY|TW)/i, iu: '17', confianza: 0.85 },
  // Mano obra · IU 47
  { patron: /^(CAPATAZ|OPERARIO|OFICIAL|PEON|PE[OÓ]N)$/i, iu: '47', confianza: 0.99, tipo: 'mano_obra' },
  { patron: /\bOPERADOR\s+/i, iu: '47', confianza: 0.9, tipo: 'mano_obra' },
  // Equipos/maquinaria · IU 48
  { patron: /\b(MEZCLADORA|CARGADOR|RETROEXCAVADORA|EXCAVADORA|VOLQUETE|GRUA)\b/i, iu: '48', confianza: 0.9, tipo: 'equipo' },
  { patron: /\bVIBRADOR\s+DE\s+CONCRETO\b/i, iu: '48', confianza: 0.85, tipo: 'equipo' },
  { patron: /\bCOMPACTAD/i, iu: '48', confianza: 0.85, tipo: 'equipo' },
];

function clasificarIU(descripcion: string): { iu: string | null; confianza: number } {
  for (const r of IU_REGLAS) {
    if (r.patron.test(descripcion)) return { iu: r.iu, confianza: r.confianza };
  }
  return { iu: null, confianza: 0 };
}

// ─── Helpers ──────────────────────────────────────────────────
function clean(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number.parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const REGEX_CODIGO_S10 = /^\d{2}\s+\d{4,5}$/; // "47 00006" o "00 07449"

const MESES_DEFAULT = [
  { idx: 1, etiqueta: 'Oct-25', fechaDesde: '2025-10-01', fechaHasta: '2025-10-31' },
  { idx: 2, etiqueta: 'Nov-25', fechaDesde: '2025-11-01', fechaHasta: '2025-11-30' },
  { idx: 3, etiqueta: 'Dic-25', fechaDesde: '2025-12-01', fechaHasta: '2025-12-31' },
  { idx: 4, etiqueta: 'Ene-26', fechaDesde: '2026-01-01', fechaHasta: '2026-01-28' },
];

// ─── Parser principal ─────────────────────────────────────────
export function parseCalendarioAdq(buffer: Buffer): CalendarioParseResult {
  const result: CalendarioParseResult = {
    recursos: [],
    cantidadMO: 0,
    cantidadMaterial: 0,
    cantidadEquipo: 0,
    costoDirectoTotal: 0,
    totalManoObra: 0,
    totalMateriales: 0,
    totalEquipos: 0,
    totalCD: 0,
    totalContractual: 0,
    meses: MESES_DEFAULT.map((m) => ({ ...m, monto: 0 })),
    resumen: { cd: 0, gg: 0, utilidad: 0, subtotal: 0, igv: 0, total: 0 },
    errors: [],
    warnings: [],
  };

  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = ['Calendario Valorizado', 'CALENDARIO VALORIZADO'].find(
    (n) => wb.SheetNames.includes(n),
  );
  if (!sheetName) {
    result.errors.push(`Hoja 'Calendario Valorizado' no encontrada en ${wb.SheetNames.join(',')}`);
    return result;
  }
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    result.errors.push(`Hoja vacía: ${sheetName}`);
    return result;
  }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  let seccionActual = '';
  let sumaCalc = new Decimal(0);
  let sumaMO = new Decimal(0);
  let sumaMat = new Decimal(0);
  let sumaEq = new Decimal(0);
  const mesesAcum = [new Decimal(0), new Decimal(0), new Decimal(0), new Decimal(0)];

  for (const row of rows) {
    const codigo = clean(row[0]);
    const desc = clean(row[1]);

    // Detectar header sección
    const descUpper = desc.toUpperCase();
    if (!codigo) {
      if (
        descUpper === 'MANO DE OBRA' ||
        descUpper === 'MATERIALES' ||
        descUpper === 'EQUIPOS' ||
        descUpper === 'EQUIPOS Y HERRAMIENTAS'
      ) {
        seccionActual = descUpper;
        continue;
      }
      // Detectar línea totales
      if (descUpper === 'COSTO DIRECTO') {
        result.resumen.cd = num(row[5]);
        for (let i = 0; i < 4; i++) result.meses[i].monto = num(row[6 + i]);
        continue;
      }
      if (descUpper === 'GASTOS GENERALES') {
        result.resumen.gg = num(row[5]);
        continue;
      }
      if (descUpper === 'UTILIDAD') {
        result.resumen.utilidad = num(row[5]);
        continue;
      }
      if (descUpper === 'SUB TOTAL') {
        result.resumen.subtotal = num(row[5]);
        continue;
      }
      if (descUpper === 'IGV.' || descUpper === 'IGV') {
        result.resumen.igv = num(row[5]);
        continue;
      }
      if (descUpper === 'PRESUPUESTO TOTAL') {
        result.resumen.total = num(row[5]);
        continue;
      }
      continue;
    }

    if (!REGEX_CODIGO_S10.test(codigo)) continue;

    const unidad = clean(row[2]);
    const cantidad = num(row[3]);
    const precioUnitario = num(row[4]);
    const parcial = num(row[5]);
    const m1 = num(row[6]);
    const m2 = num(row[7]);
    const m3 = num(row[8]);
    const m4 = num(row[9]);

    const tipo = categorizarPorCodigo(codigo, seccionActual);
    const { iu, confianza } = clasificarIU(desc);

    const meses = MESES_DEFAULT.map((md, i) => ({
      ...md,
      monto: [m1, m2, m3, m4][i] ?? 0,
    }));

    result.recursos.push({
      codigoS10: codigo,
      descripcion: desc,
      unidad,
      cantidad,
      precioUnitario,
      parcial,
      meses,
      tipo,
      iuCodigo: iu,
      iuConfianza: confianza,
    });

    sumaCalc = sumaCalc.plus(parcial);
    if (tipo === 'mano_obra') {
      result.cantidadMO++;
      sumaMO = sumaMO.plus(parcial);
    } else if (tipo === 'equipo') {
      result.cantidadEquipo++;
      sumaEq = sumaEq.plus(parcial);
    } else {
      result.cantidadMaterial++;
      sumaMat = sumaMat.plus(parcial);
    }
    mesesAcum[0] = mesesAcum[0].plus(m1);
    mesesAcum[1] = mesesAcum[1].plus(m2);
    mesesAcum[2] = mesesAcum[2].plus(m3);
    mesesAcum[3] = mesesAcum[3].plus(m4);
  }

  result.costoDirectoTotal = sumaCalc.toDecimalPlaces(2).toNumber();
  result.totalManoObra = sumaMO.toDecimalPlaces(2).toNumber();
  result.totalMateriales = sumaMat.toDecimalPlaces(2).toNumber();
  result.totalEquipos = sumaEq.toDecimalPlaces(2).toNumber();
  result.totalCD = result.resumen.cd;
  result.totalContractual = result.resumen.total;

  // Validaciones
  if (Math.abs(result.costoDirectoTotal - result.totalCD) > 0.5) {
    result.errors.push(
      `Σ recursos parciales (${result.costoDirectoTotal}) no cuadra con CD declarado (${result.totalCD}) · diff ${result.costoDirectoTotal - result.totalCD}`,
    );
  }

  if (result.recursos.length === 0) {
    result.errors.push('No se encontraron recursos con código S10');
  }

  return result;
}
