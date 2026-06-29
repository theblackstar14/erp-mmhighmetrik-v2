import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Cargar .env desde raíz monorepo · override fuerza re-leer (evita
// que vars vacías en shell bloqueen valores del archivo .env)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16).default('dev_session_secret_change_in_prod_pls'),
  NAS_URL: z.string().url(),
  NAS_USER: z.string(),
  NAS_PASS: z.string(),
  NAS_ROOT: z.string().default('/ERP/01_Proyectos'), // base proyectos (obras)
  NAS_ROOT_ADMIN: z.string().default('/ERP/02_Administracion'), // base administración (oficina/empresa)
  NAS_TLS_INSECURE: z.coerce.boolean().default(true),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_TOTALES: z.string().default('claude-haiku-4-5-20251001'),
  MPXJ_LIB_PATH: z.string().optional(),
  JAVA_BIN: z.string().default('java'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export const env = envSchema.parse(process.env);
