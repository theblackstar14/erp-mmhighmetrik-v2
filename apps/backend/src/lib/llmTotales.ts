/**
 * LLM parser · extrae SOLO totales de Cronograma Valorizado XLSX
 *
 * Estrategia: LLM NO procesa partidas (mala accuracy · alucina conteo).
 * Solo extrae ~10 números del bottom · cross-validación con deterministic parser.
 *
 * Modelo default: claude-haiku-4-5 · 6s · $0.06 · accuracy alta (output corto).
 */
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { env } from '../env.js';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no configurada en .env');
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export interface LlmTotalesResult {
  obra: string | null;
  ubicacion: string | null;
  cliente: string | null;
  costoBase: string | null;
  diasPlazo: number | null;
  costoDirecto: number | null;
  pctGg: number | null;
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
  // Meta
  modelUsed: string;
  latencyMs: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

const PROMPT = `Eres parser estricto de Cronograma Valorizado de construcción en Perú (formato CAPECO/S10).

Te paso datos XLSX serializados como tabla pipe-delimited. Tu TAREA EXCLUSIVA es extraer:
1. Cabecera del proyecto (obra, ubicación, cliente, costo base, plazo días)
2. Totales del bottom: COSTO DIRECTO, GASTOS GENERALES (%+monto), UTILIDAD (%+monto), SUB TOTAL, MOBILIARIO, IGV (%+monto), PRESUPUESTO TOTAL EJECUCION, SUPERVISION DE OBRA, VALOR REFERENCIAL

NO listes partidas. NO cuentes filas. NO inventes valores. Si campo no existe en input, devuelve null.

Output: JSON puro sin markdown sin explicación. Schema:

{
  "obra": str|null,
  "ubicacion": str|null,
  "cliente": str|null,
  "costoBase": str|null,
  "diasPlazo": int|null,
  "costoDirecto": num|null,
  "pctGg": num|null,
  "montoGg": num|null,
  "pctUtilidad": num|null,
  "montoUtilidad": num|null,
  "subTotal": num|null,
  "mobiliario": num|null,
  "pctIgv": num|null,
  "montoIgv": num|null,
  "presupuestoTotal": num|null,
  "supervision": num|null,
  "valorReferencial": num|null
}`;

// Pricing USD por 1M tokens
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0 },
  'claude-sonnet-4-5-20250929': { in: 3.0, out: 15.0 },
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
  'claude-opus-4-7': { in: 15.0, out: 75.0 },
};

/** Serializa XLSX a texto pipe-delimited · solo hoja "calendario" o primera */
function xlsxToPipeText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: 'buffer', cellNF: false, cellText: false });
  const sheetName = wb.SheetNames.find((n) => /calendario/i.test(n)) ?? wb.SheetNames[0];
  if (!sheetName) throw new Error('XLSX sin hojas');
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Hoja '${sheetName}' no encontrada`);
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return rows
    .map((r) =>
      r
        .map((c) => (c === null || c === undefined ? '' : String(c).replace(/\|/g, ' ').trim()))
        .join(' | '),
    )
    .filter((line) => line.replace(/\|/g, '').replace(/\s/g, '').length > 0)
    .join('\n');
}

function parseLlmJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Extrae totales de XLSX usando Claude Haiku 4.5.
 *
 * Lanza error si ANTHROPIC_API_KEY no configurada o si LLM devuelve JSON inválido.
 * Caller debe envolver en try/catch para fallback graceful.
 */
export async function parseLlmTotalesFromXlsx(buffer: Buffer): Promise<LlmTotalesResult> {
  const content = xlsxToPipeText(buffer);
  const client = getClient();
  const modelId = env.ANTHROPIC_MODEL_TOTALES;

  const t0 = Date.now();
  const msg = await client.messages.create({
    model: modelId,
    max_tokens: 1024,
    temperature: 0,
    system: PROMPT,
    messages: [{ role: 'user', content }],
  });
  const latencyMs = Date.now() - t0;

  const text = msg.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('');
  const parsed = parseLlmJson(text);
  if (!parsed) {
    throw new Error(`LLM ${modelId} devolvió JSON inválido. Raw: ${text.slice(0, 200)}`);
  }

  const price = PRICING[modelId] ?? { in: 1.0, out: 5.0 };
  const costUsd = (msg.usage.input_tokens / 1e6) * price.in + (msg.usage.output_tokens / 1e6) * price.out;

  // Coerce numéricos
  const toNum = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[, S/]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const toStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

  return {
    obra: toStr(parsed.obra),
    ubicacion: toStr(parsed.ubicacion),
    cliente: toStr(parsed.cliente),
    costoBase: toStr(parsed.costoBase),
    diasPlazo: toNum(parsed.diasPlazo),
    costoDirecto: toNum(parsed.costoDirecto),
    pctGg: toNum(parsed.pctGg),
    montoGg: toNum(parsed.montoGg),
    pctUtilidad: toNum(parsed.pctUtilidad),
    montoUtilidad: toNum(parsed.montoUtilidad),
    subTotal: toNum(parsed.subTotal),
    mobiliario: toNum(parsed.mobiliario),
    pctIgv: toNum(parsed.pctIgv),
    montoIgv: toNum(parsed.montoIgv),
    presupuestoTotal: toNum(parsed.presupuestoTotal),
    supervision: toNum(parsed.supervision),
    valorReferencial: toNum(parsed.valorReferencial),
    modelUsed: modelId,
    latencyMs,
    costUsd,
    tokensIn: msg.usage.input_tokens,
    tokensOut: msg.usage.output_tokens,
  };
}

// ─── Cross-validation ────────────────────────────────────────

export interface ValidationDiscrepancia {
  campo: string;
  deterministic: number | string | null;
  llm: number | string | null;
  diff: number | null;
  tipo: 'numero' | 'texto';
}

export interface ValidationResult {
  ok: boolean;
  totalChecks: number;
  passed: number;
  discrepancias: ValidationDiscrepancia[];
}

const TOLERANCIA_S = 1.0; // S/ 1 sol · tolerancia redondeo
const TOLERANCIA_PCT = 0.0005; // 0.05% · tolerancia porcentajes

/** Normaliza porcentaje · LLMs a veces devuelven 15 en vez de 0.15 */
function normalizePct(v: number | null): number | null {
  if (v === null) return null;
  // Si está entre 1-100 · asumimos formato porcentaje · convertir a decimal
  if (v > 1 && v <= 100) return v / 100;
  return v;
}

export function crossValidate(
  det: {
    costoDirecto: number | null;
    pctGg: number | null;
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
  },
  llm: LlmTotalesResult,
): ValidationResult {
  const discrepancias: ValidationDiscrepancia[] = [];

  const compareNum = (campo: string, dv: number | null, lv: number | null, tol: number) => {
    if (dv === null && lv === null) return true;
    // det tiene valor y la IA no lo extrajo → NO es discrepancia (deterministic es la fuente primaria; la IA solo cross-checkea)
    if (lv === null) return true;
    // det null pero la IA SÍ encontró algo → vale la pena revisarlo
    if (dv === null) {
      discrepancias.push({ campo, deterministic: dv, llm: lv, diff: null, tipo: 'numero' });
      return false;
    }
    const diff = Math.abs(dv - lv);
    if (diff > tol) {
      discrepancias.push({ campo, deterministic: dv, llm: lv, diff, tipo: 'numero' });
      return false;
    }
    return true;
  };

  const checks = [
    compareNum('costoDirecto', det.costoDirecto, llm.costoDirecto, TOLERANCIA_S),
    compareNum('pctGg', normalizePct(det.pctGg), normalizePct(llm.pctGg), TOLERANCIA_PCT),
    compareNum('montoGg', det.montoGg, llm.montoGg, TOLERANCIA_S),
    compareNum('pctUtilidad', normalizePct(det.pctUtilidad), normalizePct(llm.pctUtilidad), TOLERANCIA_PCT),
    compareNum('montoUtilidad', det.montoUtilidad, llm.montoUtilidad, TOLERANCIA_S),
    compareNum('subTotal', det.subTotal, llm.subTotal, TOLERANCIA_S),
    compareNum('mobiliario', det.mobiliario, llm.mobiliario, TOLERANCIA_S),
    compareNum('pctIgv', normalizePct(det.pctIgv), normalizePct(llm.pctIgv), TOLERANCIA_PCT),
    compareNum('montoIgv', det.montoIgv, llm.montoIgv, TOLERANCIA_S),
    compareNum('presupuestoTotal', det.presupuestoTotal, llm.presupuestoTotal, TOLERANCIA_S),
    compareNum('supervision', det.supervision, llm.supervision, TOLERANCIA_S),
    compareNum('valorReferencial', det.valorReferencial, llm.valorReferencial, TOLERANCIA_S),
  ];

  const passed = checks.filter(Boolean).length;
  return {
    ok: passed === checks.length,
    totalChecks: checks.length,
    passed,
    discrepancias,
  };
}
