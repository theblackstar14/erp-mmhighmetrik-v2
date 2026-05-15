/**
 * LLM parser · Valorización mensual XLSX (formato flexible)
 *
 * Maneja MÚLTIPLES formatos S10:
 *   - 9 hojas (RES. VALO, K, Reajuste, VALO N, ...) · rich format
 *   - 2 hojas (CARATULA + VAL SMP) · simple format
 *   - cualquier otro variant
 *
 * Estrategia: LLM Claude Haiku 4.5 extrae schema unificado. Backend valida cuadre
 * y cross-check con partidas del proyecto.
 *
 * Output schema neutral · mapea a tablas `valorizaciones` + `valorizacionesPartidas`.
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

export interface ValLlmPartida {
  codigo: string;
  descripcion: string;
  unidad: string | null;
  metradoContractual: number | null;
  precioUnitario: number | null;
  parcialContractual: number | null;
  metradoAnterior: number;
  parcialAnterior: number;
  pctAnterior: number;
  metradoActual: number;
  parcialActual: number;
  pctActual: number;
  metradoAcumulado: number;
  parcialAcumulado: number;
  pctAcumulado: number;
  metradoSaldo: number | null;
  parcialSaldo: number | null;
  pctSaldo: number | null;
}

export interface ValLlmResult {
  // Cabecera
  numero: number; // 1, 2, 3...
  obra: string | null;
  contratista: string | null;
  entidad: string | null;
  ubicacion: string | null;
  fechaDesde: string | null; // ISO yyyy-mm-dd
  fechaHasta: string | null;
  mesPeriodo: string | null; // '2026-04'
  costoBase: string | null; // 'Marzo 2026'
  // Totales
  montoCd: number; // V = Σ parciales actuales hojas
  pctGg: number | null;
  montoGg: number | null;
  pctUtilidad: number | null;
  montoUtilidad: number | null;
  subtotal: number | null;
  mobiliario: number | null;
  pctIgv: number | null;
  montoIgv: number;
  presupuestoTotal: number | null;
  supervision: number | null;
  valorReferencial: number | null;
  pctAvanceMensual: number | null;
  pctAvanceAcumulado: number | null;
  // Reajuste (opcional · solo si trae)
  kCalculado: number | null;
  reajustePresente: number | null;
  // Detalle
  partidas: ValLlmPartida[];
  // Meta
  modelUsed: string;
  latencyMs: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

const PROMPT = `Eres parser estricto de Valorización Mensual de Obra Perú (formato CAPECO/S10).

Input: XLSX pipe-delimited por hoja. Output: JSON puro · array compacto por partida para ahorrar tokens.

Reglas ABSOLUTAS:
1. NUNCA inventes números. null si no existe.
2. NUNCA truncar partidas · extraer TODAS (100-1000+).
3. Códigos: "01", "01.01.01.01.01" (jerárquicos).
4. Detectar hoja detalle: "VAL N", "VAL SMP", "VALO N" · cols "PARTIDA | DESC | UND | METRADO | PU | PARCIAL | ANTERIOR | ACTUAL | ACUMULADO | SALDO"
5. Cabecera: hoja "CARATULA" o primeras filas hoja principal.
6. Totales bottom: CD · GG (% + monto) · UTIL · SUBTOTAL · MOBILIARIO · IGV · PRESUP TOTAL · SUPERVISIÓN · VR
7. % avance mensual + acumulado.
8. Reajuste K · si hoja "K"/"Reajuste" · sino null.
9. Número val: "VALORIZACION N°001" etc.
10. Período: ISO yyyy-mm-dd.

Output: JSON SIN markdown SIN explicación.

Schema · partidas como ARRAY de arrays para reducir tokens:

{
  "numero": int,
  "obra": str|null,
  "contratista": str|null,
  "entidad": str|null,
  "fechaDesde": "yyyy-mm-dd"|null,
  "fechaHasta": "yyyy-mm-dd"|null,
  "mesPeriodo": "yyyy-mm"|null,
  "costoBase": str|null,
  "montoCd": num,
  "pctGg": num|null, "montoGg": num|null,
  "pctUtilidad": num|null, "montoUtilidad": num|null,
  "subtotal": num|null, "mobiliario": num|null,
  "pctIgv": num|null, "montoIgv": num,
  "presupuestoTotal": num|null, "supervision": num|null, "valorReferencial": num|null,
  "pctAvanceMensual": num|null, "pctAvanceAcumulado": num|null,
  "kCalculado": num|null, "reajustePresente": num|null,
  "partidasHeader": ["codigo","descripcion","unidad","metradoContractual","precioUnitario","parcialContractual","metradoAnterior","parcialAnterior","metradoActual","parcialActual","metradoAcumulado","parcialAcumulado"],
  "partidas": [
    ["01", "I.E. ...", null, null, null, null, 0, 0, 0, 0, 0, 0],
    ["01.01.01.01.01", "CAMPAMENTO", "Glb", 1, 51740, 51740, 0, 0, 1, 51740, 1, 51740],
    ...
  ]
}

NO calcular pcts · backend los infiere. NO incluir saldos · backend los infiere.
Truncar descripciones largas a 60 chars.

IMPORTANTE · OPTIMIZACIÓN OUTPUT:
- SKIP partidas donde TODOS los valores ejecución (metradoAnterior, parcialAnterior, metradoActual, parcialActual, metradoAcumulado, parcialAcumulado) son 0. NO las incluyas en el array.
- SOLO incluye partidas con AL MENOS UN valor de ejecución > 0.
- Las partidas no ejecutadas serán inferidas por el backend desde el cronograma del proyecto · NO las repitas acá.

Esto reduce drásticamente el output. Para valorización N°01 esperar solo 10-50 partidas en lugar de 500+.`;

// Pricing USD per 1M tokens
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0 },
  'claude-sonnet-4-5-20250929': { in: 3.0, out: 15.0 },
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
};

function xlsxToPipeText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: 'buffer', cellNF: false, cellText: false });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const lines = rows
      .map((r) =>
        r
          .map((c) => (c === null || c === undefined ? '' : String(c).replace(/\|/g, ' ').trim()))
          .join(' | '),
      )
      .filter((line) => line.replace(/\|/g, '').replace(/\s/g, '').length > 0);
    if (lines.length === 0) continue;
    parts.push(`### Hoja: ${sheetName}\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

function parseLlmJson(raw: string): Record<string, unknown> | null {
  // Strip code fences (multiline) · acepta ```json...``` o ```...```
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/, '');
    cleaned = cleaned.replace(/\n?\s*```\s*$/, '');
  }
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Extraer primer objeto JSON balanced
    const start = cleaned.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let end = -1;
    for (let i = start; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[, S/%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toNumDefault(v: unknown, def = 0): number {
  return toNum(v) ?? def;
}

/** Normaliza pct · si LLM devuelve 18 (porcentaje) en vez de 0.18 (decimal) */
function normalizePct(v: number | null): number | null {
  if (v === null) return null;
  if (v > 1 && v <= 100) return v / 100;
  return v;
}

export async function parseValorizacionLlm(buffer: Buffer): Promise<ValLlmResult> {
  const content = xlsxToPipeText(buffer);
  const client = getClient();
  const modelId = env.ANTHROPIC_MODEL_TOTALES; // reusa mismo modelo · default haiku-4-5

  const t0 = Date.now();
  // Streaming · max_tokens 32K excede timeout no-stream de 10min
  const stream = client.messages.stream({
    model: modelId,
    max_tokens: 64000, // Haiku 4.5 max · output puede ser grande con 1000+ partidas
    temperature: 0,
    system: PROMPT,
    messages: [{ role: 'user', content }],
  });
  const msg = await stream.finalMessage();
  const latencyMs = Date.now() - t0;

  const text = msg.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('');
  const parsed = parseLlmJson(text);
  if (!parsed) {
    // Debug · guardar raw a tmp para inspección
    try {
      const fs = await import('node:fs');
      const tmpPath = `/tmp/val-llm-debug-${Date.now()}.txt`;
      fs.writeFileSync(tmpPath, text);
      console.error(`[valorizacionLlm] JSON inválido · raw guardado en ${tmpPath} · len=${text.length} · stopReason=${msg.stop_reason}`);
    } catch {}
    throw new Error(
      `LLM ${modelId} devolvió JSON inválido. stopReason=${msg.stop_reason} len=${text.length}. Inicio: ${text.slice(0, 200)} ··· Final: ${text.slice(-200)}`,
    );
  }

  const price = PRICING[modelId] ?? { in: 1.0, out: 5.0 };
  const costUsd =
    (msg.usage.input_tokens / 1e6) * price.in +
    (msg.usage.output_tokens / 1e6) * price.out;

  // Schema compacto · array de arrays con header explícito
  const rawPartidas = Array.isArray(parsed.partidas) ? parsed.partidas : [];
  const header = Array.isArray(parsed.partidasHeader) ? (parsed.partidasHeader as string[]) : [];
  const idx = (name: string) => header.indexOf(name);
  const idxCodigo = idx('codigo');
  const idxDesc = idx('descripcion');
  const idxUnidad = idx('unidad');
  const idxMetrCont = idx('metradoContractual');
  const idxPu = idx('precioUnitario');
  const idxParcCont = idx('parcialContractual');
  const idxMetrAnt = idx('metradoAnterior');
  const idxParcAnt = idx('parcialAnterior');
  const idxMetrAct = idx('metradoActual');
  const idxParcAct = idx('parcialActual');
  const idxMetrAcum = idx('metradoAcumulado');
  const idxParcAcum = idx('parcialAcumulado');

  const partidas: ValLlmPartida[] = rawPartidas
    .map((row: unknown): ValLlmPartida | null => {
      // Soporta tanto array compacto como objeto (compat)
      const isArr = Array.isArray(row);
      const get = (objKey: string, arrIdx: number): unknown =>
        isArr ? (row as unknown[])[arrIdx] : (row as Record<string, unknown>)[objKey];

      const codigo = String(get('codigo', idxCodigo) ?? '').trim();
      if (!codigo) return null;

      const metrCont = toNum(get('metradoContractual', idxMetrCont));
      const parcCont = toNum(get('parcialContractual', idxParcCont));
      const parcAcum = toNumDefault(get('parcialAcumulado', idxParcAcum));
      const parcAct = toNumDefault(get('parcialActual', idxParcAct));
      const parcAnt = toNumDefault(get('parcialAnterior', idxParcAnt));
      const denom = parcCont && parcCont > 0 ? parcCont : null;
      const pctAcum = denom ? parcAcum / denom : 0;
      const pctAct = denom ? parcAct / denom : 0;
      const pctAnt = denom ? parcAnt / denom : 0;
      const parcSaldo = denom ? parcCont! - parcAcum : null;
      const pctSaldo = denom ? 1 - pctAcum : null;

      return {
        codigo,
        descripcion: String(get('descripcion', idxDesc) ?? '').trim(),
        unidad: (() => {
          const v = get('unidad', idxUnidad);
          return v ? String(v) : null;
        })(),
        metradoContractual: metrCont,
        precioUnitario: toNum(get('precioUnitario', idxPu)),
        parcialContractual: parcCont,
        metradoAnterior: toNumDefault(get('metradoAnterior', idxMetrAnt)),
        parcialAnterior: parcAnt,
        pctAnterior: pctAnt,
        metradoActual: toNumDefault(get('metradoActual', idxMetrAct)),
        parcialActual: parcAct,
        pctActual: pctAct,
        metradoAcumulado: toNumDefault(get('metradoAcumulado', idxMetrAcum)),
        parcialAcumulado: parcAcum,
        pctAcumulado: pctAcum,
        metradoSaldo: null,
        parcialSaldo: parcSaldo,
        pctSaldo,
      };
    })
    .filter((p: ValLlmPartida | null): p is ValLlmPartida => p !== null);

  return {
    numero: toNumDefault(parsed.numero, 1),
    obra: parsed.obra ? String(parsed.obra) : null,
    contratista: parsed.contratista ? String(parsed.contratista) : null,
    entidad: parsed.entidad ? String(parsed.entidad) : null,
    ubicacion: parsed.ubicacion ? String(parsed.ubicacion) : null,
    fechaDesde: parsed.fechaDesde ? String(parsed.fechaDesde) : null,
    fechaHasta: parsed.fechaHasta ? String(parsed.fechaHasta) : null,
    mesPeriodo: parsed.mesPeriodo ? String(parsed.mesPeriodo) : null,
    costoBase: parsed.costoBase ? String(parsed.costoBase) : null,
    montoCd: toNumDefault(parsed.montoCd),
    pctGg: normalizePct(toNum(parsed.pctGg)),
    montoGg: toNum(parsed.montoGg),
    pctUtilidad: normalizePct(toNum(parsed.pctUtilidad)),
    montoUtilidad: toNum(parsed.montoUtilidad),
    subtotal: toNum(parsed.subtotal),
    mobiliario: toNum(parsed.mobiliario),
    pctIgv: normalizePct(toNum(parsed.pctIgv)),
    montoIgv: toNumDefault(parsed.montoIgv),
    presupuestoTotal: toNum(parsed.presupuestoTotal),
    supervision: toNum(parsed.supervision),
    valorReferencial: toNum(parsed.valorReferencial),
    pctAvanceMensual: normalizePct(toNum(parsed.pctAvanceMensual)),
    pctAvanceAcumulado: normalizePct(toNum(parsed.pctAvanceAcumulado)),
    kCalculado: toNum(parsed.kCalculado),
    reajustePresente: toNum(parsed.reajustePresente),
    partidas,
    modelUsed: modelId,
    latencyMs,
    costUsd,
    tokensIn: msg.usage.input_tokens,
    tokensOut: msg.usage.output_tokens,
  };
}

// ─── Cross-validation ────────────────────────────────────────

export interface ValLlmValidation {
  okCuadre: boolean;
  diffCuadre: number; // Σ parciales hoja - montoCd declarado
  codesMatchPct: number; // 0-100 · % codes en valorización que existen en proyecto
  codesNoMatch: string[]; // primeros 20 codes sin match
  warnings: string[];
}

const TOLERANCIA_CUADRE = 1.0; // S/ 1

/**
 * Valida resultado LLM:
 *   - Σ parciales actuales hojas == montoCd declarado (±1 sol)
 *   - codes valorización ⊂ codes proyecto.partidas
 */
export function validateValLlm(
  llm: ValLlmResult,
  proyectoPartidasCodes: Set<string>,
): ValLlmValidation {
  const warnings: string[] = [];

  // Cuadre: Σ parcialesActual de hojas (no summary) == montoCd
  const hojas = llm.partidas.filter(
    (p) => p.unidad && p.metradoContractual !== null && p.precioUnitario !== null,
  );
  const sumActual = hojas.reduce((s, p) => s + (p.parcialActual ?? 0), 0);
  const diffCuadre = Number((sumActual - llm.montoCd).toFixed(2));
  const okCuadre = Math.abs(diffCuadre) <= TOLERANCIA_CUADRE;
  if (!okCuadre) {
    warnings.push(
      `Cuadre falla · Σ parciales hojas=${sumActual.toFixed(2)} vs montoCd declarado=${llm.montoCd.toFixed(2)} · diff=${diffCuadre}`,
    );
  }

  // Codes match
  const codesNoMatch: string[] = [];
  let matched = 0;
  for (const p of llm.partidas) {
    if (proyectoPartidasCodes.has(p.codigo)) {
      matched++;
    } else {
      if (codesNoMatch.length < 20) codesNoMatch.push(p.codigo);
    }
  }
  const codesMatchPct = llm.partidas.length > 0 ? (matched / llm.partidas.length) * 100 : 0;
  if (codesMatchPct < 80) {
    warnings.push(
      `Solo ${codesMatchPct.toFixed(0)}% de partidas matchean con proyecto (${matched}/${llm.partidas.length}) · verifica que la valorización corresponde a este proyecto`,
    );
  }

  return {
    okCuadre,
    diffCuadre,
    codesMatchPct,
    codesNoMatch,
    warnings,
  };
}
