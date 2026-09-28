import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Works from both src/ (tsx) and dist/ (compiled): both sit one level below the package root.
export const BACKEND_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
export const PROMPTS_DIR = path.join(BACKEND_ROOT, 'prompts');

/** Resolves a path from the env: absolute paths are kept, relative ones hang from backend/. */
export function resolveFromBackend(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(BACKEND_ROOT, p);
}
