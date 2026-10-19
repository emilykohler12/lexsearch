// PostToolUse hook (Edit, Write, MultiEdit): after a .ts or .tsx file is edited, runs ESLint on that file only,
// in its workspace (backend or frontend, each with its own configuration), and shows Claude the errors.
// It never gets in the way: a file outside both workspaces, a file that is not there, or ESLint failing on its
// own are all silent or non-blocking. Warnings are not shown (--quiet).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, block, readEvent, relativeToRoot } from './common.mjs';

const WORKSPACES = ['backend', 'frontend'];
const ESLINT = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
const TIMEOUT_MS = 25_000;

function main() {
  const event = readEvent();
  const target = event.tool_input?.file_path;
  if (typeof target !== 'string' || !/\.tsx?$/i.test(target)) return;

  const file = path.resolve(event.cwd ?? ROOT, target);
  if (!existsSync(file) || !existsSync(ESLINT)) return;

  const relative = relativeToRoot(file);
  const workspace = WORKSPACES.find((name) => relative.startsWith(`${name}/`));
  if (!workspace) return;

  const cwd = path.join(ROOT, workspace);
  const result = spawnSync(process.execPath, [ESLINT, '--quiet', '--no-warn-ignored', path.relative(cwd, file)], {
    cwd,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    windowsHide: true,
  });

  if (result.error) {
    // Could not even run (timeout, no Node): tell the user, but do not block anything.
    process.stderr.write(`No se pudo correr ESLint sobre ${relative}: ${result.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (result.status === 1) {
    return block(`ESLint encontró errores en ${relative} (el archivo que acabás de editar). Corregilos:\n${result.stdout.trim()}`);
  }
  if (result.status !== 0) {
    process.stderr.write(`ESLint no pudo revisar ${relative} (código ${result.status}): ${(result.stderr || result.stdout).trim().slice(0, 500)}\n`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`El hook .claude/hooks/lint-edited-file.mjs falló: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
