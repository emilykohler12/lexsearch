// Shared by the hooks in this folder (Node scripts, so they run the same on Windows, macOS and Linux).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The project root: this file lives in <root>/.claude/hooks/. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The event Claude Code sends on stdin (a JSON object). */
export function readEvent() {
  return JSON.parse(readFileSync(0, 'utf8'));
}

/** A path the way the hooks compare it: relative to the root, with forward slashes and in lowercase (Windows ignores case). */
export function relativeToRoot(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join('/').toLowerCase();
}

/** Blocks the tool call: exit code 2, and `message` goes to Claude. Call it as the last thing a hook does. */
export function block(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}
