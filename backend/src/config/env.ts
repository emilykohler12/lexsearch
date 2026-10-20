import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parseHash } from '../modules/auth/password.js';
import { isValidTotpSecret } from '../modules/auth/totp.js';
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
  // Por defecto la API escucha solo en esta computadora; dentro de un contenedor de Docker hay que usar 0.0.0.0.
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5180'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Acceso del abogado (un solo usuario). Sin contraseña el sistema queda abierto, y solo se permite fuera de producción.
  // El hash se genera con `npm run auth:hash -w backend` (ver D26).
  AUTH_USERNAME: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
  AUTH_PASSWORD_HASH: z.preprocess(emptyToUndefined, z.string().optional()),
  // Segundo factor: la clave compartida con la app de autenticación (se genera con `npm run auth:totp -w backend`).
  AUTH_TOTP_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  // Una sesión se cierra después de tantas horas sin usarla.
  AUTH_IDLE_HOURS: z.coerce.number().positive().max(24 * 30).default(12),
  // La cookie de sesión viaja solo por HTTPS. Por defecto, en producción sí.
  COOKIE_SECURE: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional()),

  // Cuántos proxies hay delante de la API (en Docker, Caddy y nginx: 2). Sin esto solo se confía en esta computadora.
  TRUST_PROXY_HOPS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(5).optional()),

  DATABASE_URL: z.url({ message: 'DATABASE_URL debe ser una URL de conexión de PostgreSQL' }),

  STORAGE_DIR: z.string().default('storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(200).default(50),

  EMBEDDING_MODEL: z.string().default('Xenova/multilingual-e5-base'),
  MODELS_CACHE_DIR: z.string().default('.cache/models'),
  // Fragments found only "by meaning" need at least this similarity to be shown (see docs/decisiones.md, D5).
  SEARCH_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.8),

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

/** Problems of the access settings, in Spanish; empty when they are fine. */
export function authProblems(values: Pick<Env, 'NODE_ENV' | 'AUTH_USERNAME' | 'AUTH_PASSWORD_HASH' | 'AUTH_TOTP_SECRET'>): string[] {
  const { NODE_ENV, AUTH_USERNAME, AUTH_PASSWORD_HASH, AUTH_TOTP_SECRET } = values;
  if (!AUTH_USERNAME !== !AUTH_PASSWORD_HASH) return ['AUTH_USERNAME y AUTH_PASSWORD_HASH van juntos: falta uno de los dos.'];
  // A hash that is not one would make every login fail with no explanation.
  if (AUTH_PASSWORD_HASH && !parseHash(AUTH_PASSWORD_HASH)) {
    return ['AUTH_PASSWORD_HASH no tiene el formato esperado (scrypt:…): generalo de nuevo con `npm run auth:hash -w backend`.'];
  }
  if (AUTH_TOTP_SECRET && !isValidTotpSecret(AUTH_TOTP_SECRET)) {
    return ['AUTH_TOTP_SECRET no es una clave válida (tiene que ser base32 y de al menos 16 caracteres): generala de nuevo con `npm run auth:totp -w backend`.'];
  }
  if (AUTH_TOTP_SECRET && !AUTH_USERNAME) return ['AUTH_TOTP_SECRET necesita usuario y contraseña: definí también AUTH_USERNAME y AUTH_PASSWORD_HASH.'];
  if (NODE_ENV === 'production' && AUTH_USERNAME && !AUTH_TOTP_SECRET) {
    return ['En producción el ingreso lleva un segundo factor: definí AUTH_TOTP_SECRET (se genera con `npm run auth:totp -w backend`).'];
  }
  if (NODE_ENV === 'production' && !AUTH_USERNAME) {
    return ['En producción hace falta usuario y contraseña: definí AUTH_USERNAME y AUTH_PASSWORD_HASH (se genera con `npm run auth:hash -w backend`).'];
  }
  return [];
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast with a readable message instead of crashing later on a missing setting.
    console.error(`Configuración inválida en .env:\n${z.prettifyError(parsed.error)}`);
    process.exit(1);
  }
  const problems = authProblems(parsed.data);
  if (problems.length > 0) {
    console.error(`Configuración inválida en .env:\n${problems.join('\n')}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const storageDir = resolveFromBackend(env.STORAGE_DIR);
export const modelsCacheDir = resolveFromBackend(env.MODELS_CACHE_DIR);
/** Spanish language data for OCR, downloaded once. */
export const ocrCacheDir = path.join(modelsCacheDir, 'tesseract');
