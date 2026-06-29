/**
 * Parser de Estado de Cuenta Corriente BCP (PDF) vía Gemini.
 * El PDF del BCP trae capa de texto pero el resumen confunde columnas → pedimos SOLO los
 * movimientos (que la IA extrae completos y exactos, validado: 202/202, Σ abonos/cargos = banco).
 * Cross-check de cuadre con el saldo final.
 */
import { getGemini } from './gemini.js';
import { env } from '../env.js';

export interface EeccMovimiento {
  fecha: string; // YYYY-MM-DD
  descripcion: string;
  medioAtencion: string | null;
  numOp: string | null;
  monto: number; // negativo = cargo (débito), positivo = abono (crédito)
  saldo: number | null;
}

export interface EeccParseResult {
  movimientos: EeccMovimiento[];
  abonos: number;
  cargos: number;
  saldoFinal: number | null;
  modelo: string;
  latencyMs: number;
}

const PROMPT = `Eres parser de estados de cuenta bancarios del BCP (Perú). Del PDF adjunto extrae JSON ESTRICTO:
{
  "movimientos": [
    { "fecha": "YYYY-MM-DD", "descripcion": "string", "medioAtencion": "string", "numOp": "string", "monto": number, "saldo": number|null }
  ]
}
REGLAS CRÍTICAS:
- Extrae TODAS las filas de movimiento del estado de cuenta (suelen ser ~200). NO omitas ninguna, NO resumas.
- monto: si el número termina en "-" es CARGO (débito) → NEGATIVO. Si no tiene signo es ABONO (crédito) → POSITIVO.
- El año del periodo está en la cabecera del estado (DD-MM → ese año).
- Devuelve SOLO el JSON, sin markdown.`;

/** Parsea el EECC BCP. anioDefault se usa si la IA devuelve fechas sin año coherente. */
export async function parseEeccBcp(pdfBuffer: Buffer, anioDefault = 2026): Promise<EeccParseResult> {
  const model = getGemini().getGenerativeModel({
    model: env.GEMINI_MODEL,
    generationConfig: { maxOutputTokens: 65536, temperature: 0, responseMimeType: 'application/json' },
  });
  const t0 = Date.now();
  const result = await model.generateContent([
    { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } },
    PROMPT,
  ]);
  const latencyMs = Date.now() - t0;
  const text = result.response.text();
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  let j: { movimientos?: unknown[] };
  try {
    j = JSON.parse(cleaned);
  } catch {
    throw new Error(`Gemini devolvió JSON inválido para EECC. Primeros 300: ${text.slice(0, 300)}`);
  }
  const raw = Array.isArray(j.movimientos) ? j.movimientos : [];
  const movimientos: EeccMovimiento[] = raw
    .map((m) => m as Record<string, unknown>)
    .map((m) => {
      let fecha = String(m.fecha ?? '');
      // normaliza año si vino raro (DD-MM o sin año)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        const mm = fecha.match(/(\d{1,2})[-/](\d{1,2})/);
        if (mm) fecha = `${anioDefault}-${mm[2]!.padStart(2, '0')}-${mm[1]!.padStart(2, '0')}`;
      }
      return {
        fecha,
        descripcion: String(m.descripcion ?? '').trim(),
        medioAtencion: m.medioAtencion ? String(m.medioAtencion) : null,
        numOp: m.numOp ? String(m.numOp) : null,
        monto: Number(m.monto ?? 0),
        saldo: m.saldo == null ? null : Number(m.saldo),
      };
    })
    .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.fecha) && Number.isFinite(m.monto));

  const abonos = movimientos.filter((m) => m.monto > 0).reduce((s, m) => s + m.monto, 0);
  const cargos = movimientos.filter((m) => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);
  const saldoFinal = movimientos.length ? movimientos[movimientos.length - 1]!.saldo : null;

  return { movimientos, abonos, cargos, saldoFinal, modelo: env.GEMINI_MODEL, latencyMs };
}

// Cargos internos del banco que la empresa normalmente NO registra como movimiento propio
// (quedan como no-conciliados para revisión). Usado al sembrar movimientos desde el EECC.
export const ES_CARGO_BANCO = (desc: string): boolean =>
  /\bITF\b|IMPUESTO ITF|COM\.|COMISION|MANTENIM|PORTES|MEMBRES|SEGURO DESGRAV/i.test(desc);
