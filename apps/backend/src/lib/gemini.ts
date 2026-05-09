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
