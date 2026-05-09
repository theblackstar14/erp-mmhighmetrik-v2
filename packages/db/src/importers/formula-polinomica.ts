/**
 * Parser PDF Fórmula Polinómica S10
 *
 * Estructura típica del PDF:
 *   F�rmula Polin�mica
 *   Presupuesto 1002033 ...
 *   Subpresupuesto 002 ESTRUCTURAS
 *   Fecha Presupuesto 07/06/2025
 *   Moneda SOLES
 *   Ubicaci�n Geogr�fica 150140 LIMA - LIMA - SANTIAGO DE SURCO
 *   K = 0.173*(MOr / MOo) + 0.076*(Cr / Co) + 0.087*(ACr / ACo) + ...
 *   Monomio Factor (%) S�mbolo Indice Descripci�n
 *   1 0.173 100.000MO 47 MANO DE OBRA
 *   2 0.076 65.789C 21 CEMENTO PORTLAND TIPO I
 *           34.211 05 AGREGADO GRUESO
 *   3 0.087 100.000AC 03 ACERO DE CONSTRUCCION CORRUGADO
 *   ...
 */
import { Decimal } from 'decimal.js';

export interface FpMonomioIu {
  iuCodigo: string; // "47", "21", etc
  pesoPorcentual: number; // 100.000, 65.789, etc
  descripcionIu: string;
}

export interface FpMonomio {
  numero: number;
  coeficiente: number;
  simbolo: string; // 'MO', 'C', 'AC', 'D', 'GU', etc
  descripcion: string;
  ius: FpMonomioIu[];
}

export interface FpParseResult {
  subpresupuestoCodigo: string; // '001'
  subpresupuestoNombre: string; // 'OBRAS PROVISIONALES'
  fechaBase: string; // '2025-06-07'
  areaGeografica: string;
  formulaTexto: string;
  monomios: FpMonomio[];
  sumaCoeficientes: number;
  cuadre: boolean;
  errors: string[];
  warnings: string[];
}

const REGEX_SUBP = /Subpresupuesto\s+(\d{3})\s+(.+?)(?:\r?\n|$)/i;
const REGEX_FECHA = /Fecha\s+Presupuesto\s+(\d{2})\/(\d{2})\/(\d{4})/i;
const REGEX_AREA = /Ubicaci(?:[óo�])?n\s+Geogr(?:[áa�])?fica\s+(.+?)(?:\r?\n|$)/i;
const REGEX_K = /K\s*=\s*(.+?)(?:Monomio|$)/is;

// Línea monomio principal: "1 0.125 100.000MO 47 MANO DE OBRA"
//   numero · coef · peso% + simbolo · iu · descripcion
const REGEX_MONOMIO_PRINCIPAL = /^\s*(\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s*([A-Z]{1,4})\s+(\d{1,3})\s+(.+)$/;

// Línea sub-IU dentro de monomio: "23.438 43 MADERA NACIONAL"
//   peso% · iu · descripcion (sin numero ni coef · está bajo el principal)
const REGEX_SUBIU = /^\s*(\d+\.\d+)\s+(\d{1,3})\s+(.+)$/;

// Línea con coef adicional al simbolo (cuando primer monomio tiene varios IUs)
//   "0.064 53.125FL 32 FLETE TERRESTRE"
const REGEX_MONOMIO_CONT = /^\s*(\d+\.\d+)\s+(\d+\.\d+)\s*([A-Z]{1,4})\s+(\d{1,3})\s+(.+)$/;

export async function parseFormulaPolinomicaPdf(buffer: Buffer): Promise<FpParseResult> {
  const result: FpParseResult = {
    subpresupuestoCodigo: '',
    subpresupuestoNombre: '',
    fechaBase: '',
    areaGeografica: '',
    formulaTexto: '',
    monomios: [],
    sumaCoeficientes: 0,
    cuadre: false,
    errors: [],
    warnings: [],
  };

  // pdf-parse v2 usa clase PDFParse
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const result_pdf = await parser.getText();
  const text = result_pdf.text as string;

  // Subpresupuesto
  const mSubp = text.match(REGEX_SUBP);
  if (mSubp) {
    result.subpresupuestoCodigo = mSubp[1];
    result.subpresupuestoNombre = mSubp[2].trim();
  } else {
    result.errors.push('No se detectó subpresupuesto');
  }

  // Fecha
  const mFecha = text.match(REGEX_FECHA);
  if (mFecha) {
    result.fechaBase = `${mFecha[3]}-${mFecha[2]}-${mFecha[1]}`;
  }

  // Área geográfica
  const mArea = text.match(REGEX_AREA);
  if (mArea) {
    result.areaGeografica = mArea[1].trim();
  }

  // Fórmula K = ... (extraer texto completo de K hasta "Monomio")
  const mK = text.match(REGEX_K);
  if (mK) {
    result.formulaTexto = `K = ${mK[1].replace(/\s+/g, ' ').trim()}`;
  }

  // ─── Estrategia robusta ─────────────────────────────────────
  // 1. Extraer monomios desde fórmula K (numero · coef · simbolo) · ORDEN canónico
  // 2. Extraer IUs sueltos desde tabla (iu · descripcion · peso · simbolo opcional)
  // 3. Asignar IUs a monomios por simbolo o · si no tiene · al monomio en curso
  // (Algunos PDFs ponen IUs fuera de orden · no se puede confiar en posición lineal)

  // Paso 1 · monomios canónicos desde K
  // K = 0.173*(MOr / MOo) + 0.076*(Cr / Co) + ... formato:
  //   coef *(SIMBOLOr / SIMBOLOo)
  if (result.formulaTexto) {
    const monomioPattern = /(\d+\.\d+)\s*\*\s*\(\s*([A-Z]{1,4})\s*r/g;
    let match: RegExpExecArray | null = null;
    let numero = 1;
    while ((match = monomioPattern.exec(result.formulaTexto)) !== null) {
      const [, coef, simbolo] = match;
      result.monomios.push({
        numero: numero++,
        coeficiente: Number.parseFloat(coef),
        simbolo,
        descripcion: simbolo,
        ius: [],
      });
    }
  }

  // Paso 2 · extraer IUs sueltos · cualquier formato
  // Necesita identificar simbolo de cada IU (cuando aparece) y mapear a monomio
  // Formatos línea valores (después del 3er TAB):
  //   "1 0.173 100.000 MO"     · num · coef · peso · simbolo
  //   "2 0.064 23.438"         · num · coef · peso (sin simbolo)
  //   "0.064 53.125 FL"        · coef_dup · peso · simbolo
  //   "0.064 23.438"           · coef_dup · peso
  //   "23.438"                 · solo peso
  // O sin TABs en líneas extras:
  //   "0.064 64.063 C 21 CEMENTO PORTLAND TIPO I"
  //   "3 0.124 56.452 VD 79 VIDRIO INCOLORO NACIONAL"

  type IuExtraido = {
    iu: string;
    peso: number;
    descripcion: string;
    simbolo: string | null;
    monomioHint: number | null;
    coefHint: number | null; // si el sub-IU venia con coef duplicado · útil para matchear
  };
  const iusExtraidos: IuExtraido[] = [];

  // Parser dual · líneas con TAB y líneas sin TAB
  const lines = text.split(/\r?\n/);
  let lastMonomioNum: number | null = null;

  for (const rawLine of lines) {
    const parts = rawLine.split('\t').map((s) => s.trim());

    // ─── Caso A: línea con TAB · DESCRIPCION\tIU\tVALORES ───
    if (parts.length >= 3 && /^\d{1,3}$/.test(parts[1])) {
      const desc = parts[0];
      const iuNorm = parts[1].padStart(2, '0');
      const valores = parts[2];

      // "N COEF PESO SIMBOLO" · monomio principal completo
      let m = valores.match(/^(\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+([A-Z]{1,4})$/);
      if (m) {
        lastMonomioNum = Number.parseInt(m[1], 10);
        iusExtraidos.push({
          iu: iuNorm,
          peso: Number.parseFloat(m[3]),
          descripcion: desc,
          simbolo: m[4],
          monomioHint: lastMonomioNum,
          coefHint: Number.parseFloat(m[2]),
        });
        continue;
      }
      // "N COEF PESO" · monomio principal sin simbolo
      m = valores.match(/^(\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)$/);
      if (m) {
        lastMonomioNum = Number.parseInt(m[1], 10);
        iusExtraidos.push({
          iu: iuNorm,
          peso: Number.parseFloat(m[3]),
          descripcion: desc,
          simbolo: null,
          monomioHint: lastMonomioNum,
          coefHint: Number.parseFloat(m[2]),
        });
        continue;
      }
      // "COEF PESO SIMBOLO" · sub-IU con simbolo (cierre monomio anterior)
      m = valores.match(/^(\d+\.\d+)\s+(\d+\.\d+)\s+([A-Z]{1,4})$/);
      if (m) {
        iusExtraidos.push({
          iu: iuNorm,
          peso: Number.parseFloat(m[2]),
          descripcion: desc,
          simbolo: m[3],
          monomioHint: lastMonomioNum,
          coefHint: Number.parseFloat(m[1]),
        });
        continue;
      }
      // "COEF PESO" · sub-IU sin simbolo · usar COEF como hint primario
      m = valores.match(/^(\d+\.\d+)\s+(\d+\.\d+)$/);
      if (m) {
        iusExtraidos.push({
          iu: iuNorm,
          peso: Number.parseFloat(m[2]),
          descripcion: desc,
          simbolo: null,
          monomioHint: lastMonomioNum,
          coefHint: Number.parseFloat(m[1]),
        });
        continue;
      }
      // "PESO" solo · sin coef hint
      m = valores.match(/^(\d+\.\d+)$/);
      if (m) {
        iusExtraidos.push({
          iu: iuNorm,
          peso: Number.parseFloat(m[1]),
          descripcion: desc,
          simbolo: null,
          monomioHint: lastMonomioNum,
          coefHint: null,
        });
        continue;
      }
    }

    // ─── Caso B: línea sin TAB · "COEF PESO SIMBOLO IU DESCRIPCION..." ───
    // Ej: "0.064 64.063 C 21 CEMENTO PORTLAND TIPO I"
    // Ej: "3 0.124 56.452 VD 79 VIDRIO INCOLORO NACIONAL"
    const noTab = rawLine.trim();

    // Con número monomio: "N COEF PESO SIMBOLO IU DESC"
    let m2 = noTab.match(/^(\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+([A-Z]{1,4})\s+(\d{1,3})\s+(.+)$/);
    if (m2) {
      lastMonomioNum = Number.parseInt(m2[1], 10);
      iusExtraidos.push({
        iu: m2[5].padStart(2, '0'),
        peso: Number.parseFloat(m2[3]),
        descripcion: m2[6].trim(),
        simbolo: m2[4],
        monomioHint: lastMonomioNum,
        coefHint: Number.parseFloat(m2[2]),
      });
      continue;
    }
    // Sin número (sub-IU): "COEF PESO SIMBOLO IU DESC"
    m2 = noTab.match(/^(\d+\.\d+)\s+(\d+\.\d+)\s+([A-Z]{1,4})\s+(\d{1,3})\s+(.+)$/);
    if (m2) {
      iusExtraidos.push({
        iu: m2[4].padStart(2, '0'),
        peso: Number.parseFloat(m2[2]),
        descripcion: m2[5].trim(),
        simbolo: m2[3],
        monomioHint: lastMonomioNum,
        coefHint: Number.parseFloat(m2[1]),
      });
      continue;
    }
  }

  // Paso 3 · asignar IUs a monomios · prioridad simbolo > coef > último target
  let ultimoTarget: FpMonomio | undefined;
  for (const ext of iusExtraidos) {
    let target: FpMonomio | undefined;

    // Prioridad 1: simbolo coincide
    if (ext.simbolo) {
      target = result.monomios.find((m) => m.simbolo === ext.simbolo);
    }
    // Prioridad 2: coeficiente coincide
    if (!target && ext.coefHint != null) {
      target = result.monomios.find((m) => Math.abs(m.coeficiente - (ext.coefHint as number)) < 0.0001);
    }
    // Prioridad 3: último target asignado (para sub-IUs solo peso · "20.161")
    if (!target && ultimoTarget) {
      target = ultimoTarget;
    }
    // Prioridad 4: monomioHint global (último recurso)
    if (!target && ext.monomioHint != null) {
      target = result.monomios.find((m) => m.numero === ext.monomioHint);
    }

    if (!target) {
      result.warnings.push(`IU ${ext.iu} (${ext.descripcion}) no asignado a monomio`);
      continue;
    }
    ultimoTarget = target;

    // Evitar duplicados (mismo IU)
    if (target.ius.some((i) => i.iuCodigo === ext.iu)) continue;

    target.ius.push({
      iuCodigo: ext.iu,
      pesoPorcentual: ext.peso,
      descripcionIu: ext.descripcion,
    });
  }

  // Validación · suma coeficientes = 1.0
  const suma = result.monomios.reduce((s, m) => s.plus(m.coeficiente), new Decimal(0));
  result.sumaCoeficientes = suma.toDecimalPlaces(4).toNumber();
  result.cuadre = Math.abs(result.sumaCoeficientes - 1.0) <= 0.001;

  if (!result.cuadre) {
    result.errors.push(
      `Σ coeficientes = ${result.sumaCoeficientes} ≠ 1.000 · diff ${(result.sumaCoeficientes - 1).toFixed(4)}`,
    );
  }

  if (result.monomios.length === 0) {
    result.errors.push('No se detectaron monomios');
  }

  return result;
}
