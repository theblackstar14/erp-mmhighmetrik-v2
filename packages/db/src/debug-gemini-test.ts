/**
 * Test rápido Gemini · 5 recursos · ver si funciona y cuánto tarda
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const apiKey = process.env.GEMINI_API_KEY!;
const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

console.log(`API key: ${apiKey.slice(0, 10)}...`);
console.log(`Model: ${model}`);

const { GoogleGenerativeAI } = await import('@google/generative-ai');

const genAI = new GoogleGenerativeAI(apiKey);
const m = genAI.getGenerativeModel({ model });

const t0 = Date.now();
console.log('Llamando Gemini con prompt corto...');
const result = await m.generateContent('Responde con JSON: [{"test": 1, "ok": true}]');
const elapsed = Date.now() - t0;
console.log(`Respuesta en ${elapsed}ms:`);
console.log(result.response.text());
