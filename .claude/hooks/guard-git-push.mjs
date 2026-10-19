// PreToolUse hook (Bash and PowerShell): protects the main branch, which publishes the Docker images by itself (CD).
//   - git push --force (also -f, --force-with-lease, +branch, --mirror) -> blocked, exit code 2
//   - deleting main or master on the remote                              -> blocked, exit code 2
//   - any other push that updates main or master (named in the command, or because it is the current branch)
//     -> asks the user to confirm
// The command line is read the way a shell would (quotes, ; && || |, nested bash -c / powershell -Command),
// so a commit message that mentions «git push» does not trigger it.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, block, readEvent } from './common.mjs';

const PROTECTED = new Set(['main', 'master']);

const ALLOW = { kind: 'allow' };
const blocked = (reason) => ({ kind: 'block', reason });
const ask = (reason) => ({ kind: 'ask', reason });
const RANK = { allow: 0, ask: 1, block: 2 };
const worst = (verdicts) => verdicts.reduce((a, b) => (RANK[b.kind] > RANK[a.kind] ? b : a), ALLOW);

const WHY_MAIN = 'la rama main publica las imágenes de Docker en ghcr.io por sí sola (CD)';
const FORCE =
  'Bloqueado: un push forzado (--force, -f, --force-with-lease o +rama) reescribe el historial del repositorio remoto y no se hace desde acá. ' +
  'Si de verdad hace falta, lo corre el abogado a mano en su terminal.';
const MIRROR = 'Bloqueado: git push --mirror pisa todas las ramas del remoto y no se hace desde acá.';
const DELETE_MAIN = 'Bloqueado: borrar main o master en el remoto no se hace desde acá.';
const ASK_MAIN = `Este push actualiza main (o master): ${WHY_MAIN}. ¿Lo confirmás?`;
const ASK_UNKNOWN = `No pude saber a qué rama va este push, así que no puedo asegurar que no vaya a main: ${WHY_MAIN}. ¿Lo confirmás?`;
const ASK_ALL = `Este push manda todas las ramas, también main: ${WHY_MAIN}. ¿Lo confirmás?`;

// ── Reading the command line ─────────────────────────────────────────────────

/** Splits a command line into simple commands (at ; & && || | ( ) and new lines outside quotes), each one a list of words. */
function splitCommands(line) {
  // A line that ends in \ (sh) or ` (PowerShell) goes on in the next one.
  const text = line.replace(/\\\r?\n/g, ' ').replace(/`\r?\n/g, ' ');
  const commands = [];
  let words = [];
  let word = null; // null: no word started (an empty pair of quotes still is a word)
  let quote = null;

  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && (c === '\\' || c === '`') && text[i + 1] === '"') word += text[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      word ??= '';
    } else if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '`') {
      endCommand();
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      word = (word ?? '') + c;
    }
  }
  endCommand();
  return commands;
}

/** The commands written inside $( ) in a word (a quoted string can hide them from the splitter). */
function substitutions(word) {
  const inner = [];
  for (let start = word.indexOf('$('); start !== -1; start = word.indexOf('$(', start + 2)) {
    let depth = 1;
    let i = start + 2;
    for (; i < word.length && depth > 0; i++) {
      if (word[i] === '(') depth++;
      else if (word[i] === ')') depth--;
    }
    inner.push(word.slice(start + 2, depth === 0 ? i - 1 : i));
  }
  return inner;
}

const WRAPPERS = new Set(['env', 'command', 'builtin', 'exec', 'nohup', 'time', 'sudo', 'nice', 'call', 'start']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Drops what comes before the program: VAR=value, env, sudo, time... */
function skipPrefixes(words) {
  let i = 0;
  while (i < words.length) {
    if (ASSIGNMENT.test(words[i])) {
      i++;
    } else if (WRAPPERS.has(words[i].toLowerCase())) {
      i++;
      while (i < words.length && (words[i].startsWith('-') || ASSIGNMENT.test(words[i]))) i++;
    } else {
      break;
    }
  }
  return words.slice(i);
}

const executableName = (word) => word.split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();

/** The script a shell receives as an argument (bash -c "...", powershell -Command ..., cmd /c ..., eval ...), if the command is one. */
function nestedScript(exe, words) {
  const at = (pattern) => words.findIndex((word, index) => index > 0 && pattern.test(word));
  if (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(exe)) {
    const i = at(/^-[a-z]*c$/);
    return i > 0 ? (words[i + 1] ?? null) : null;
  }
  if (['pwsh', 'powershell'].includes(exe)) {
    const i = at(/^-(command|c)$/i);
    return i > 0 ? words.slice(i + 1).join(' ') : null;
  }
  if (exe === 'cmd') {
    const i = at(/^\/[ck]$/i);
    return i > 0 ? words.slice(i + 1).join(' ') : null;
  }
  return exe === 'eval' ? words.slice(1).join(' ') : null;
}

// ── git ──────────────────────────────────────────────────────────────────────

const GIT_OPTIONS_WITH_VALUE = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);

/** What comes after git's own options: the subcommand, its arguments and the folder given with -C. */
function parseGit(words) {
  let i = 1;
  let repoDir = null;
  while (i < words.length && words[i].startsWith('-')) {
    if (words[i] === '-C') {
      repoDir = words[i + 1] ?? null;
      i += 2;
    } else {
      i += GIT_OPTIONS_WITH_VALUE.has(words[i]) ? 2 : 1;
    }
  }
  return { subcommand: words[i], args: words.slice(i + 1), repoDir };
}

const branches = new Map();

/** The branch that is checked out in `dir`; null when it cannot be known (not a repository, detached HEAD, no git). */
function currentBranch(dir) {
  if (!branches.has(dir)) {
    const result = spawnSync('git', ['-C', dir, 'branch', '--show-current'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    branches.set(dir, result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null);
  }
  return branches.get(dir);
}

function analyzePush(rawArgs, dir) {
  // Redirections (2>&1, > out.txt) are not arguments.
  const args = rawArgs.filter((arg) => !/^\d*[<>]/.test(arg));
  const flags = { force: false, mirror: false, delete: false, all: false, tags: false, dryRun: false };
  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const [name] = arg.slice(2).split('=');
      if (['force', 'force-with-lease', 'force-if-includes'].includes(name)) flags.force = true;
      else if (name === 'mirror') flags.mirror = true;
      else if (name === 'delete') flags.delete = true;
      else if (name === 'all' || name === 'branches') flags.all = true;
      else if (name === 'tags') flags.tags = true;
      else if (name === 'dry-run') flags.dryRun = true;
      else if (['push-option', 'repo', 'receive-pack', 'exec'].includes(name) && !arg.includes('=')) i++; // its value is the next word
    } else if (/^-[A-Za-z]+$/.test(arg)) {
      // Short flags can be joined (-fu): f is force, d is delete, n is dry run and o takes the next word as its value.
      if (arg.includes('f')) flags.force = true;
      if (arg.includes('d')) flags.delete = true;
      if (arg.includes('n')) flags.dryRun = true;
      if (arg.includes('o')) i++;
    } else if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
  }

  // A dry run sends nothing.
  if (flags.dryRun) return ALLOW;
  if (flags.force) return blocked(FORCE);
  if (flags.mirror) return blocked(MIRROR);

  const refspecs = positionals.slice(1); // the first word is the remote
  const verdicts = [];
  let unknown = false;
  const target = (name) => {
    if (name === 'HEAD' || name === '@') {
      const current = currentBranch(dir);
      if (current === null) unknown = true;
      return current ?? '';
    }
    return name.replace(/^refs\/heads\//, '');
  };

  if (flags.all) verdicts.push(ask(ASK_ALL));

  if (refspecs.length === 0 && !flags.all && !flags.tags) {
    // «git push» alone sends the current branch.
    const current = currentBranch(dir);
    if (current === null) unknown = true;
    else if (PROTECTED.has(current)) verdicts.push(ask(ASK_MAIN));
  }

  for (const spec of refspecs) {
    if (spec.startsWith('+')) return blocked(FORCE);
    const [source, destination = source] = spec.split(':', 2);
    const name = target(destination);
    const deletes = flags.delete || (spec.includes(':') && source === '');
    if (PROTECTED.has(name)) verdicts.push(deletes ? blocked(DELETE_MAIN) : ask(ASK_MAIN));
  }

  if (unknown) verdicts.push(ask(ASK_UNKNOWN));
  return worst(verdicts);
}

// ── Putting it together ──────────────────────────────────────────────────────

function analyze(text, cwd) {
  const verdicts = [];
  for (const raw of splitCommands(text)) {
    const words = skipPrefixes(raw);
    for (const word of raw) for (const inner of substitutions(word)) verdicts.push(analyze(inner, cwd));
    if (words.length === 0) continue;

    const exe = executableName(words[0]);
    if (exe === 'git') {
      const { subcommand, args, repoDir } = parseGit(words);
      if (subcommand === 'push') verdicts.push(analyzePush(args, repoDir ? path.resolve(cwd, repoDir) : cwd));
    } else {
      const script = nestedScript(exe, words);
      if (script !== null) verdicts.push(analyze(script, cwd));
    }
  }
  return worst(verdicts);
}

function main() {
  const event = readEvent();
  const command = event.tool_input?.command;
  // Nothing to look at unless the word «push» is somewhere in the command.
  if (typeof command !== 'string' || !/push/i.test(command)) return;

  let verdict;
  try {
    verdict = analyze(command, event.cwd ?? ROOT);
  } catch {
    // The command could not be read: if it looks like a push, let the user decide.
    verdict = /\bgit(\.exe)?\b[\s\S]*\bpush\b/i.test(command) ? ask(ASK_UNKNOWN) : ALLOW;
  }

  if (verdict.kind === 'block') return block(verdict.reason);
  if (verdict.kind === 'ask') {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: verdict.reason } }),
    );
  }
}

try {
  main();
} catch (error) {
  // Never block the shell because of a bug of this hook: say so, and let the command run.
  process.stderr.write(`El hook .claude/hooks/guard-git-push.mjs falló: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
