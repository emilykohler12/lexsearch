import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PROMPTS_DIR } from '../../config/paths.js';

/**
 * Prompts live in versioned files under backend/prompts/ (never hardcoded in the logic).
 * Changing a prompt means creating a new version file and pointing to it here, so the
 * interaction log always records which version produced each answer.
 */
export const PROMPT_VERSIONS = {
  ragAnswer: 'rag-answer.v1',
} as const;

export interface Prompt {
  version: string;
  text: string;
}

const cache = new Map<string, Prompt>();

export function loadPrompt(version: string): Prompt {
  let prompt = cache.get(version);
  if (!prompt) {
    const text = readFileSync(path.join(PROMPTS_DIR, `${version}.md`), 'utf8').trim();
    prompt = { version, text };
    cache.set(version, prompt);
  }
  return prompt;
}
