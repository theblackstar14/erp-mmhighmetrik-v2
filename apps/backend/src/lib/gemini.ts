import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../env.js';

let _client: GoogleGenerativeAI | null = null;

export function getGemini() {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY no configurada en .env');
  }
  if (!_client) {
    _client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }
  return _client;
}

export const CONTRACT_PARSER_PROMPT = `Eres experto en contratación pública peruana. Analiza el contrato adjunto y extrae los siguientes campos en JSON estricto.

Si un campo no está presente, devuelve null. NO inventes datos.

ESQUEMA JSON (devuelve EXACTAMENTE este shape):

{
  "proyecto": {
    "nombre": "string · objeto del contrato",
    "ubicacion": "string · departamento/provincia/distrito",
    "codigoCui": "string · Código Único Inversión (solo obras públicas)",
    "etapa": "string · Etapa I/II/etc"
  },
  "contrato": {
    "numeroContrato": "string · ej. 037-2025-GAF-MSS",
    "numeroProcesoLicitacion": "string · ej. LP Abreviada 004-2025-CS-MSS",
    "tipoModalidad": "suma_alzada | precios_unitarios | mixto | llave_en_mano",
    "marcoLegal": "string · Ley + DS reglamento",
    "montoContractual": "number · monto en S/ con IGV",
    "moneda": "PEN | USD",
    "diasPlazo": "number · días calendario de ejecución",
    "fechaBuenaPro": "YYYY-MM-DD",
    "fechaConsentimiento": "YYYY-MM-DD",
    "fechaFirmaContrato": "YYYY-MM-DD",
    "fechaInicio": "YYYY-MM-DD · si está definida",
    "fechaFin": "YYYY-MM-DD · calculada desde inicio + plazo"
  },
  "entidadContratante": {
    "razonSocial": "string · nombre completo",
    "ruc": "string · 11 dígitos",
    "tipoEntidad": "municipalidad | gobierno_regional | ministerio | empresa_publica | privado",
    "domicilio": "string",
    "representante": "string · nombre completo",
    "dniRepresentante": "string · 8 dígitos",
    "cargoRepresentante": "string"
  },
  "contratista": {
    "esConsorcio": "boolean",
    "nombreConsorcio": "string · si es consorcio (CONSORCIO X)",
    "razonSocial": "string · si NO es consorcio",
    "ruc": "string · si NO es consorcio",
    "domicilio": "string",
    "representanteComun": "string",
    "dniRepresentante": "string",
    "email": "string"
  },
  "consorcioIntegrantes": [
    { "razonSocial": "string", "ruc": "string", "pctParticipacion": "number 0-1 si declarado, sino null" }
  ],
  "adelantos": {
    "directoPct": "number 0-1 · ej. 0.10 = 10%",
    "materialesPct": "number 0-1",
    "avancePct": "number 0-1 · si aplica"
  },
  "garantias": {
    "fielCumplimientoPct": "number 0-1 · default 0.10",
    "retencionPct": "number 0-1 · si aplica retención en lugar de carta fianza"
  },
  "penalidades": {
    "formulaMora": "string · ej. 0.10 × monto / (F × plazo)",
    "factorF": "number · 0.40 (≤60d) | 0.25 (60-120d) | 0.15 (>120d)",
    "topePct": "number 0-1 · ej. 0.10 = 10% del monto"
  }
}

Reglas:
- Devuelve SOLO el JSON, sin texto adicional ni markdown
- Si el campo no aparece en el contrato, usa null
- Fechas en formato ISO YYYY-MM-DD
- Montos como número (sin "S/" ni separadores)
- RUCs y DNIs como string sin espacios
- Para "factorF" deduce según diasPlazo
`;

export type IuClassificationResult = {
  recursoId: string;
  iuCodigo: string | null;
  confianza: number; // 0-1
  razon: string;
};

/**
 * Clasifica recursos en IUs INEI usando Gemini batch.
 * Devuelve array · 1 sugerencia por recurso.
 */
export async function classifyRecursosWithGemini(
  recursos: Array<{ id: string; codigo: string; descripcion: string; unidad: string; tipo: string }>,
  ius: Array<{ codigo: string; descripcion: string; categoria: string | null }>,
): Promise<IuClassificationResult[]> {
  const genAI = getGemini();
  const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });

  const prompt = `Eres experto en clasificación de recursos de construcción según el catálogo INEI Perú para fórmula polinómica de reajuste.

CATÁLOGO ÍNDICES UNIFICADOS DISPONIBLES:
${ius.map((iu) => `  ${iu.codigo} · ${iu.descripcion}${iu.categoria ? ` (${iu.categoria})` : ''}`).join('\n')}

RECURSOS A CLASIFICAR:
${recursos.map((r, i) => `  ${i + 1}. id=${r.id} · "${r.descripcion}" · ${r.unidad} · tipo=${r.tipo} · cod=${r.codigo}`).join('\n')}

Tarea: para CADA recurso de la lista, asigna el IU INEI más apropiado del catálogo.

Reglas:
- Devuelve SOLO JSON array · sin markdown
- 1 objeto por recurso · mismo orden
- iuCodigo del catálogo (string 2-3 chars) o null si NO encaja en ningún IU
- confianza 0-1 (0.9+ alta · 0.7-0.9 media · <0.7 baja · pon null para no clasificar)
- razon: breve (max 50 chars) explicando match

Ejemplos:
- "CEMENTO PORTLAND TIPO I" → IU 21 (Cemento Portland tipo I) · confianza 0.99
- "ACERO CORRUGADO 1/2"" → IU 01 (Acero corrugado) · confianza 0.95
- "MANO DE OBRA OPERARIO" → IU 47 (Mano de obra) · confianza 0.98
- "TUBERIA PVC SAP 20mm" → IU 73 (Tubería PVC SAP) · confianza 0.92
- "CALAMINA GALVANIZADA" → IU 60 (Plancha galvanizada) · confianza 0.85
- "TRAPO INDUSTRIAL" → null · confianza 0.3 (no encaja en catálogo)

FORMATO RESPUESTA:
[
  {"recursoId": "uuid-del-recurso", "iuCodigo": "21", "confianza": 0.99, "razon": "Cemento Portland Tipo I exacto"},
  {"recursoId": "uuid-otro", "iuCodigo": null, "confianza": 0.2, "razon": "Recurso no encaja en catálogo"}
]

IMPORTANTE: Devuelve EXACTAMENTE ${recursos.length} objetos, uno por cada recurso.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as IuClassificationResult[];
    if (!Array.isArray(parsed)) throw new Error('No es array');
    return parsed.map((r) => ({
      recursoId: String(r.recursoId),
      iuCodigo: r.iuCodigo ? String(r.iuCodigo).trim() : null,
      confianza: Number(r.confianza ?? 0),
      razon: String(r.razon ?? ''),
    }));
  } catch (e) {
    throw new Error(
      `Gemini devolvió JSON inválido. Respuesta primer 500: ${text.slice(0, 500)}`,
    );
  }
}

export async function parseContractWithGemini(pdfBuffer: Buffer): Promise<Record<string, unknown>> {
  const genAI = getGemini();
  const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: pdfBuffer.toString('base64'),
      },
    },
    CONTRACT_PARSER_PROMPT,
  ]);

  const text = result.response.text();
  // Remover markdown code fences si Gemini los agregó
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Gemini devolvió JSON inválido. Respuesta: ${text.slice(0, 500)}...`,
    );
  }
}
