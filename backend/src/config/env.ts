import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { REPO_ROOT, resolveFromBackend } from './paths.js';

// Single .env at the repo root, shared with docker compose.
// Variables already present in the environment take precedence over the file.
const envFile = path.join(REPO_ROOT, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5180'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url({ message: 'DATABASE_URL debe ser una URL de conexión de PostgreSQL' }),

  STORAGE_DIR: z.string().default('storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(200).default(50),

  EMBEDDING_MODEL: z.string().default('Xenova/multilingual-e5-base'),
  MODELS_CACHE_DIR: z.string().default('.cache/models'),

  GEMINI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  // Comma-separated; used in order when the main model is overloaded, out of quota, retired or too slow.
  GEMINI_FALLBACK_MODELS: z
    .string()
    .default('gemini-3.5-flash')
    .transform((value) => value.split(',').map((m) => m.trim()).filter(Boolean)),
  GEMINI_THINKING_LEVEL: z.preprocess(emptyToUndefined, z.enum(['minimal', 'low', 'medium', 'high']).optional()),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast with a readable message instead of crashing later on a missing setting.
    console.error(`Configuración inválida en .env:\n${z.prettifyError(parsed.error)}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const storageDir = resolveFromBackend(env.STORAGE_DIR);
export const modelsCacheDir = resolveFromBackend(env.MODELS_CACHE_DIR);
