/**
 * Benchmark IA · parseo Cronograma Valorizado XLSX
 *
 * Compara: Gemini 2.0 Flash, Gemini 1.5 Pro, Claude Sonnet 4.5, Claude Haiku 4.5
 *
 * Métricas:
 *   - Latencia (ms)
 *   - Tokens entrada/salida
 *   - Costo USD por archivo
 *   - Accuracy números (vs ground truth)
 *   - Accuracy stats (total partidas, hojas, títulos, meses)
 *   - Robustez (3 corridas · varianza)
 *
 * Uso: node bench/parse-xlsx-bench.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(__dirname);
dotenv.config({ path: join(PROJECT_ROOT, '.env'), override: true });

// Resolver Anthropic key · acepta varias variantes · ignora vacíos
const pickKey = (...names) => {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.length > 10) return v;
  }
  return null;
};
const ANTHROPIC_KEY = pickKey('ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'CLAUDE_KEY', 'ANTHROPIC_KEY');
if (ANTHROPIC_KEY) process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY;

// ─── Config ──────────────────────────────────────────────────
const XLSX_PATH = String.raw`C:\Users\gabri\Downloads\CRONOGRAMA VALORIZADO PEZANTES.xlsx`;
const GROUND_TRUTH = JSON.parse(readFileSync(join(__dirname, 'ground-truth-pezantes.json'), 'utf8'));
const RUNS_PER_MODEL = Number(process.env.BENCH_RUNS ?? '3');

// Pricing USD por 1M tokens (estimaciones May 2026)
const PRICING = {
  'gemini-2.5-flash':            { in: 0.075, out: 0.30 },
  'gemini-2.5-pro':              { in: 1.25,  out: 5.00 },
  'gemini-3-pro-preview':        { in: 2.50,  out: 10.00 },
  'gemini-3-flash-preview':      { in: 0.15,  out: 0.60 },
  'claude-haiku-4-5-20251001':   { in: 1.00,  out: 5.00 },
  'claude-sonnet-4-5-20250929':  { in: 3.00,  out: 15.00 },
  'claude-sonnet-4-6':           { in: 3.00,  out: 15.00 },
  'claude-opus-4-7':             { in: 15.00, out: 75.00 },
};

// Filtros CLI: --provider=claude · --models=sonnet-4-5,sonnet-4-6,opus-4-7
const argProvider = process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1];
const argModels = process.argv.find((a) => a.startsWith('--models='))?.split('=')[1]?.split(',');

const ALL_MODELS = [
  { provider: 'gemini', id: 'gemini-2.5-flash' },
  { provider: 'gemini', id: 'gemini-2.5-pro' },
  { provider: 'gemini', id: 'gemini-3-flash-preview' },
  { provider: 'gemini', id: 'gemini-3-pro-preview' },
  { provider: 'claude', id: 'claude-haiku-4-5-20251001' },
  { provider: 'claude', id: 'claude-sonnet-4-5-20250929' },
  { provider: 'claude', id: 'claude-sonnet-4-6' },
  { provider: 'claude', id: 'claude-opus-4-7' },
];
let MODELS_TO_TEST = argProvider ? ALL_MODELS.filter((m) => m.provider === argProvider) : ALL_MODELS;
if (argModels) MODELS_TO_TEST = MODELS_TO_TEST.filter((m) => argModels.some((id) => m.id.includes(id)));

// ─── Prompt común ────────────────────────────────────────────
const PROMPT_INSTRUCCION = `Eres un parser estricto de Cronogramas Valorizados de construcción en Perú (formato CAPECO/S10).

Te paso datos XLSX serializados como tabla pipe-delimited. Extrae estructura JSON EXACTA según schema. Reglas absolutas:

1. NUNCA inventes números. Si dato no existe en input, usa null.
2. Partidas hoja = filas con código + unidad + metrado + PU + parcial. Suma debe igualar Costo Directo declarado.
3. Partidas título (summary) = filas con código + descripción pero SIN unidad/metrado/PU. NO sumas a CD directamente.
4. Distribución mensual: columnas después de "Parcial" hasta antes de "TOTAL".
5. Totales bottom (CD, GG, Util, IGV, Mobiliario, Presupuesto Total, Supervisión, Valor Referencial): extraer si aparecen.
6. NO truncar partidas · extraer TODAS (las hay >500).

Output: JSON puro · sin markdown · sin explicación.

Schema:
{
  "header": {"obra": str, "ubicacion": str, "cliente": str, "costoBase": str, "diasPlazo": int|null},
  "totales": {
    "costoDirecto": num, "pctGg": num, "montoGg": num,
    "pctUtilidad": num, "montoUtilidad": num, "subTotal": num,
    "mobiliario": num|null, "pctIgv": num, "montoIgv": num,
    "presupuestoTotal": num, "supervision": num|null, "valorReferencial": num
  },
  "stats": {"totalPartidas": int, "totalHojas": int, "totalTitulos": int, "totalMeses": int},
  "anomalias": [str]
}`;

// ─── Cargar y serializar XLSX ────────────────────────────────
function xlsxToPipeText(filePath) {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellNF: false, cellText: false });
  const sheetName = wb.SheetNames.find((n) => /calendario/i.test(n)) ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return rows
    .map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).replace(/\|/g, ' ').trim())).join(' | '))
    .filter((line) => line.replace(/\|/g, '').replace(/\s/g, '').length > 0)
    .join('\n');
}

// ─── Llamadas IA ─────────────────────────────────────────────
async function callGemini(modelId, prompt, content) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  });
  const t0 = Date.now();
  const result = await model.generateContent([{ text: prompt }, { text: content }]);
  const t1 = Date.now();
  const text = result.response.text();
  const usage = result.response.usageMetadata ?? {};
  return {
    latencyMs: t1 - t0,
    tokensIn: usage.promptTokenCount ?? 0,
    tokensOut: usage.candidatesTokenCount ?? 0,
    raw: text,
  };
}

async function callClaude(modelId, prompt, content) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const params = {
    model: modelId,
    max_tokens: 16000,
    system: prompt,
    messages: [{ role: 'user', content }],
  };
  // Opus 4.7 no acepta temperature
  if (!modelId.startsWith('claude-opus-4-7')) params.temperature = 0;
  const t0 = Date.now();
  const msg = await client.messages.create(params);
  const t1 = Date.now();
  const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  return {
    latencyMs: t1 - t0,
    tokensIn: msg.usage.input_tokens,
    tokensOut: msg.usage.output_tokens,
    raw: text,
  };
}

// ─── Scoring ─────────────────────────────────────────────────
function scoreOutput(parsed) {
  const gt = GROUND_TRUTH;
  const checks = {};
  const tolerancia = 1; // S/ 1

  // Header
  checks.obra = parsed.header?.obra?.includes('PEZANTES') ?? false;
  checks.cliente = parsed.header?.cliente?.includes('CAJAMARCA') ?? false;
  checks.plazo = parsed.header?.diasPlazo === gt.header.diasPlazo;

  // Totales
  const totales = parsed.totales ?? {};
  const cmp = (a, b) => a != null && b != null && Math.abs(a - b) <= tolerancia;
  checks.cd = cmp(totales.costoDirecto, gt.totales.costoDirecto);
  checks.gg = cmp(totales.montoGg, gt.totales.montoGg);
  checks.util = cmp(totales.montoUtilidad, gt.totales.montoUtilidad);
  checks.subTotal = cmp(totales.subTotal, gt.totales.subTotal);
  checks.mobiliario = cmp(totales.mobiliario, gt.totales.mobiliario);
  checks.igv = cmp(totales.montoIgv, gt.totales.montoIgv);
  checks.presupTotal = cmp(totales.presupuestoTotal, gt.totales.presupuestoTotal);
  checks.supervision = cmp(totales.supervision, gt.totales.supervision);
  checks.vr = cmp(totales.valorReferencial, gt.totales.valorReferencial);

  // Stats
  const stats = parsed.stats ?? {};
  checks.statsTotalPartidas = stats.totalPartidas === gt.stats.totalPartidas;
  checks.statsHojas = stats.totalHojas === gt.stats.totalHojas;
  checks.statsTitulos = stats.totalTitulos === gt.stats.totalTitulos;
  checks.statsMeses = stats.totalMeses === gt.stats.totalMeses;

  const totalChecks = Object.keys(checks).length;
  const passed = Object.values(checks).filter(Boolean).length;
  const accuracy = (passed / totalChecks) * 100;

  return { accuracy, checks, passed, totalChecks };
}

function parseJson(raw) {
  // Strip markdown si existe
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Intenta extraer primer objeto JSON
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }
}

// ─── Run benchmark ───────────────────────────────────────────
async function runModel(model, content, prompt) {
  const runs = [];
  for (let i = 0; i < RUNS_PER_MODEL; i++) {
    process.stdout.write(`  ${model.id} run ${i + 1}/${RUNS_PER_MODEL}... `);
    try {
      const res = model.provider === 'gemini'
        ? await callGemini(model.id, prompt, content)
        : await callClaude(model.id, prompt, content);
      const parsed = parseJson(res.raw);
      const score = parsed ? scoreOutput(parsed) : { accuracy: 0, passed: 0, totalChecks: 0, checks: {} };
      const price = PRICING[model.id];
      const costUsd = (res.tokensIn / 1e6) * price.in + (res.tokensOut / 1e6) * price.out;
      runs.push({
        latencyMs: res.latencyMs,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd,
        accuracy: score.accuracy,
        checksPassed: score.passed,
        totalChecks: score.totalChecks,
        checks: score.checks,
        jsonParsed: parsed !== null,
        rawSample: res.raw.slice(0, 200),
      });
      console.log(`✓ ${res.latencyMs}ms · ${score.accuracy.toFixed(0)}% acc · $${costUsd.toFixed(4)}`);
    } catch (e) {
      console.log(`✗ ERROR: ${e.message}`);
      runs.push({ error: e.message });
    }
  }
  // Promedios
  const valid = runs.filter((r) => !r.error);
  if (valid.length === 0) return { model: model.id, error: 'todos los runs fallaron', runs };
  const avg = (k) => valid.reduce((s, r) => s + r[k], 0) / valid.length;
  return {
    model: model.id,
    provider: model.provider,
    runs,
    avgLatencyMs: avg('latencyMs'),
    avgTokensIn: avg('tokensIn'),
    avgTokensOut: avg('tokensOut'),
    avgCostUsd: avg('costUsd'),
    avgAccuracy: avg('accuracy'),
    jsonParseRate: (valid.filter((r) => r.jsonParsed).length / valid.length) * 100,
  };
}

// ─── Main ────────────────────────────────────────────────────
(async () => {
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY no encontrada en .env');
    process.exit(1);
  }
  if (!ANTHROPIC_KEY) {
    console.error('⚠ Anthropic key no encontrada · skip Claude · esperaba ANTHROPIC_API_KEY|CLAUDE_API_KEY|CLAUDE_KEY|ANTHROPIC_KEY');
  }

  if (!existsSync(XLSX_PATH)) {
    console.error(`❌ Archivo no encontrado: ${XLSX_PATH}`);
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BENCHMARK IA · Parser Cronograma Valorizado Pezantes');
  console.log('═══════════════════════════════════════════════════════════════');

  console.log('\n📄 Serializando XLSX a texto...');
  const content = xlsxToPipeText(XLSX_PATH);
  console.log(`   ${content.length} chars · ~${Math.round(content.length / 4)} tokens estimados\n`);

  const results = [];
  for (const model of MODELS_TO_TEST) {
    if (model.provider === 'claude' && !ANTHROPIC_KEY) {
      console.log(`\n⊘ Skip ${model.id} · sin Anthropic key`);
      continue;
    }
    console.log(`\n🤖 ${model.id}`);
    const res = await runModel(model, content, PROMPT_INSTRUCCION);
    results.push(res);
  }

  // ─── Tabla final ──────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  RESULTADOS · promedios de 3 corridas');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const fmtMs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const fmt$ = (v) => `$${v.toFixed(4)}`;
  const fmtPct = (v) => `${v.toFixed(0)}%`;

  console.log('| Modelo                       | Latencia | Tokens In | Tokens Out | Costo    | Accuracy | JSON OK |');
  console.log('|------------------------------|----------|-----------|------------|----------|----------|---------|');
  for (const r of results) {
    if (r.error) {
      console.log(`| ${r.model.padEnd(28)} | ERROR    | -         | -          | -        | -        | -       |`);
      continue;
    }
    console.log(`| ${r.model.padEnd(28)} | ${fmtMs(r.avgLatencyMs).padEnd(8)} | ${String(Math.round(r.avgTokensIn)).padEnd(9)} | ${String(Math.round(r.avgTokensOut)).padEnd(10)} | ${fmt$(r.avgCostUsd).padEnd(8)} | ${fmtPct(r.avgAccuracy).padEnd(8)} | ${fmtPct(r.jsonParseRate).padEnd(7)} |`);
  }

  // Detalle checks fallados por modelo
  console.log('\n─── Detalle checks fallados ───');
  for (const r of results) {
    if (r.error || !r.runs[0]?.checks) continue;
    const fallados = Object.entries(r.runs[0].checks).filter(([_, v]) => !v).map(([k]) => k);
    if (fallados.length === 0) {
      console.log(`  ${r.model}: ✓ 100% checks pasados`);
    } else {
      console.log(`  ${r.model}: falla ${fallados.join(', ')}`);
    }
  }

  // Recomendación
  console.log('\n─── Recomendación ───');
  const validResults = results.filter((r) => !r.error);
  if (validResults.length > 0) {
    // Score compuesto: accuracy * 100 - latency_s * 2 - cost * 100
    const ranked = [...validResults].sort((a, b) => {
      const scoreA = a.avgAccuracy * 10 - (a.avgLatencyMs / 1000) * 2 - a.avgCostUsd * 1000;
      const scoreB = b.avgAccuracy * 10 - (b.avgLatencyMs / 1000) * 2 - b.avgCostUsd * 1000;
      return scoreB - scoreA;
    });
    console.log(`  🏆 Ganador: ${ranked[0].model}`);
    console.log(`     Accuracy ${ranked[0].avgAccuracy.toFixed(0)}% · ${fmtMs(ranked[0].avgLatencyMs)} · ${fmt$(ranked[0].avgCostUsd)}/archivo`);
  }

  // Guardar JSON
  const outFile = join(__dirname, 'results', `bench-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify({ groundTruth: GROUND_TRUTH, results }, null, 2));
  console.log(`\n💾 Detalle guardado: ${outFile}`);
})();
