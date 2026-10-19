// Tests of the hooks, end to end: each case spawns the real script and sends it the JSON event on stdin, as Claude Code does.
// Run with:  node --test .claude/hooks/hooks.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOKS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HOOKS, '..', '..');

function run(script, event) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(HOOKS, script)], {
    input: JSON.stringify(event),
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, ms: Date.now() - started };
}

const fileEvent = (tool, file, extra = {}) => ({
  hook_event_name: 'PreToolUse',
  tool_name: tool,
  tool_input: { file_path: file, ...extra },
  cwd: ROOT,
});

const inRoot = (...parts) => path.join(ROOT, ...parts);

describe('protect-files (PreToolUse: Edit, Write, MultiEdit)', () => {
  const protect = (tool, file, extra) => run('protect-files.mjs', fileEvent(tool, file, extra));

  for (const name of ['.env', 'backend/.env', 'frontend/.env.local', '.env.production', '.ENV', '.env.', '.env..', 'backend/.env.test']) {
    it(`blocks editing ${name}`, () => {
      const result = protect('Edit', inRoot(name), { old_string: 'a', new_string: 'b' });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /archivo de secretos/);
    });
  }

  it('blocks writing .env and a stream of it (Windows)', () => {
    assert.equal(protect('Write', inRoot('.env'), { content: 'x' }).status, 2);
    assert.equal(protect('Write', inRoot('.env::$DATA'), { content: 'x' }).status, 2);
  });

  it('blocks MultiEdit on .env', () => {
    assert.equal(protect('MultiEdit', inRoot('.env'), { edits: [{ old_string: 'a', new_string: 'b' }] }).status, 2);
  });

  it('resolves a relative path against the working directory of the event', () => {
    const result = run('protect-files.mjs', { ...fileEvent('Edit', 'backend/.env'), cwd: ROOT });
    assert.equal(result.status, 2);
  });

  it('allows .env.example and files whose name only looks like .env', () => {
    for (const name of ['.env.example', 'backend/.env.example', '.env.example.', 'docs/.environment.md', 'backend/src/environment.ts', 'env.ts']) {
      const result = protect('Write', inRoot(name), { content: 'x' });
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
      assert.equal(result.stderr, '');
    }
  });

  it('blocks editing a migration that already exists, and the lock file', () => {
    const first = protect('Edit', inRoot('backend/prisma/migrations/20260928040000_init/migration.sql'), { old_string: 'a', new_string: 'b' });
    assert.equal(first.status, 2);
    assert.match(first.stderr, /ya existe/);
    assert.match(first.stderr, /migraci[oó]n nueva/);
    assert.equal(protect('Write', inRoot('backend/prisma/migrations/migration_lock.toml'), { content: 'x' }).status, 2);
    assert.equal(protect('Write', inRoot('Backend/Prisma/Migrations/20260928040000_init/migration.sql'), { content: 'x' }).status, 2); // other case
  });

  it('allows creating a migration that does not exist yet', () => {
    const result = protect('Write', inRoot('backend/prisma/migrations/29990101000000_prueba/migration.sql'), { content: 'SELECT 1;' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
  });

  it('lets everything else through, silently', () => {
    for (const name of ['backend/src/app.ts', 'frontend/src/App.tsx', 'README.md', 'backend/prisma/schema.prisma']) {
      const result = protect('Edit', inRoot(name), { old_string: 'a', new_string: 'b' });
      assert.equal(result.status, 0);
      assert.equal(result.stdout + result.stderr, '');
    }
  });

  it('does nothing when the event has no file', () => {
    assert.equal(run('protect-files.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {} }).status, 0);
  });

  it('blocks, with a message, when the hook cannot read its event', () => {
    const result = spawnSync(process.execPath, [path.join(HOOKS, 'protect-files.mjs')], { input: 'esto no es JSON', encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /por seguridad se bloquea/);
  });
});

describe('guard-git-push (PreToolUse: Bash and PowerShell)', () => {
  const dirs = [];
  const repo = (branch) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hook-repo-'));
    assert.equal(spawnSync('git', ['init', '-q', '-b', branch, dir]).status, 0);
    dirs.push(dir);
    return dir;
  };
  after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  const onMain = repo('main');
  const onFeature = repo('feature');
  const notARepo = mkdtempSync(path.join(os.tmpdir(), 'hook-plain-'));
  dirs.push(notARepo);

  const verdict = (command, cwd = onFeature, tool = 'Bash') => {
    const result = run('guard-git-push.mjs', { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command }, cwd });
    if (result.status === 2) return { kind: 'block', ...result };
    if (result.stdout.trim()) {
      assert.equal(result.status, 0, result.stderr);
      const decision = JSON.parse(result.stdout).hookSpecificOutput;
      assert.equal(decision.hookEventName, 'PreToolUse');
      return { kind: decision.permissionDecision, reason: decision.permissionDecisionReason, ...result };
    }
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return { kind: 'allow', ...result };
  };

  const cases = [
    // pushes that update main: the user is asked
    ['git push origin main', 'ask'],
    ['git push origin master', 'ask'],
    ['git push origin HEAD:main', 'ask'],
    ['git push origin HEAD:refs/heads/master', 'ask'],
    ['git push origin feature:main', 'ask'],
    ['git push origin refs/heads/main:refs/heads/main', 'ask'],
    ['git push --all', 'ask'],
    ['git push -u origin main', 'ask'],
    ['git add . && git commit -m "x" && git push origin main', 'ask'],
    ['cd backend && git push origin main', 'ask'],
    ['git -C backend push origin master', 'ask'],
    ['git -c core.editor=true push origin main', 'ask'],
    ['GIT_TRACE=1 git push origin main', 'ask'],
    ['git push origin main 2>&1', 'ask'],
    ['"C:\\Program Files\\Git\\cmd\\git.exe" push origin main', 'ask'],
    ['git.exe push origin main', 'ask'],
    ['sh -c \'git push origin main\'', 'ask'],
    ['bash -lc "git push origin main"', 'ask'],
    ['powershell -NoProfile -Command "git push origin main"', 'ask'],
    ['echo "$(git push origin main)"', 'ask'],
    ['git push origin feature && git push origin main', 'ask'],
    // forced pushes and mirrors: blocked
    ['git push --force', 'block'],
    ['git push -f origin feature', 'block'],
    ['git push origin feature --force', 'block'],
    ['git push --force-with-lease origin feature', 'block'],
    ['git push -uf origin feature', 'block'],
    ['git push origin +feature', 'block'],
    ['git push origin +main:main', 'block'],
    ['git push --mirror', 'block'],
    ['bash -c "git push -f"', 'block'],
    ['git add . && git push --force origin main', 'block'],
    // deleting main: blocked; deleting another branch is fine
    ['git push origin :main', 'block'],
    ['git push origin --delete master', 'block'],
    ['git push origin --delete feature', 'allow'],
    // what is not a push to main
    ['git push origin feature/x', 'allow'],
    ['git push -u origin feature', 'allow'],
    ['git push --dry-run origin main', 'allow'],
    ['git push -n origin main', 'allow'],
    ['git push --tags', 'allow'],
    ['git push origin tag v1.0.0', 'allow'],
    ['git commit -m "no hagas git push origin main"', 'allow'],
    ["git commit -m 'git push --force'", 'allow'],
    ['echo git push --force', 'allow'],
    ['grep "git push" README.md', 'allow'],
    ['git status', 'allow'],
    ['npm test', 'allow'],
    ['git pull origin main', 'allow'],
    ['gh pr create --title x', 'allow'],
  ];
  for (const [command, expected] of cases) {
    it(`${expected}: ${command}`, () => {
      assert.equal(verdict(command).kind, expected);
    });
  }

  it('looks at the current branch when the push does not name one', () => {
    assert.equal(verdict('git push', onMain).kind, 'ask');
    assert.equal(verdict('git push origin', onMain).kind, 'ask');
    assert.equal(verdict('git push -u origin HEAD', onMain).kind, 'ask');
    assert.equal(verdict('git push', onFeature).kind, 'allow');
    assert.equal(verdict('git push origin', onFeature).kind, 'allow');
    assert.equal(verdict('git push -u origin HEAD', onFeature).kind, 'allow');
    assert.equal(verdict('git push origin feature', onMain).kind, 'allow'); // main is checked out, but feature is what goes
  });

  it('asks when it cannot tell which branch goes', () => {
    const result = verdict('git push', notARepo);
    assert.equal(result.kind, 'ask');
    assert.match(result.reason, /no pude saber/i);
  });

  it('also reads what the PowerShell tool runs', () => {
    assert.equal(verdict('git push origin main; Write-Output listo', onFeature, 'PowerShell').kind, 'ask');
    assert.equal(verdict('& git push --force', onFeature, 'PowerShell').kind, 'block');
    assert.equal(verdict('git status; git log --oneline', onFeature, 'PowerShell').kind, 'allow');
  });

  it('explains itself in Spanish', () => {
    const asked = verdict('git push origin main');
    assert.match(asked.reason, /publica las imágenes de Docker/);
    assert.match(asked.reason, /¿Lo confirmás\?/);
    const forced = verdict('git push --force');
    assert.match(forced.stderr, /Bloqueado: un push forzado/);
  });

  it('reads a command that goes on in the next line', () => {
    assert.equal(verdict('git push \\\n  origin main').kind, 'ask');
    assert.equal(verdict('git push `\n  --force', onFeature, 'PowerShell').kind, 'block');
  });
});

describe('lint-edited-file (PostToolUse: Edit, Write, MultiEdit)', () => {
  const lint = (file) => run('lint-edited-file.mjs', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: file }, tool_response: {}, cwd: ROOT });

  /** Runs `work` with a temporary file that is always removed afterwards. */
  const withFile = (relative, content, work) => {
    const file = inRoot(relative);
    assert.equal(existsSync(file), false, `${relative} should not exist before the test`);
    writeFileSync(file, content);
    try {
      return work(file);
    } finally {
      rmSync(file, { force: true });
    }
  };

  it('stays silent for files that are not .ts or .tsx', () => {
    for (const name of ['README.md', 'backend/package.json', '.claude/hooks/common.mjs']) {
      const result = lint(inRoot(name));
      assert.equal(result.status, 0);
      assert.equal(result.stdout + result.stderr, '');
    }
  });

  it('stays silent for a .ts file that is not there or is outside the workspaces', () => {
    assert.equal(lint(inRoot('backend/src/no-existe.ts')).status, 0);
    withFile('hook-test-fuera.ts', 'const nothing = 1;\n', (file) => {
      const result = lint(file);
      assert.equal(result.status, 0);
      assert.equal(result.stdout + result.stderr, '');
    });
  });

  it('passes a clean file of each workspace', () => {
    for (const name of ['backend/src/lib/errors.ts', 'frontend/src/lib/format.ts']) {
      const result = lint(inRoot(name));
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
    }
  });

  it('shows the errors of a backend file', () => {
    withFile('backend/src/hook-test-backend.ts', 'export const used = 1;\nconst nothing = 2;\n', (file) => {
      const result = lint(file);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /backend\/src\/hook-test-backend\.ts/);
      assert.match(result.stderr, /no-unused-vars/);
    });
  });

  it('shows the errors of a frontend file, with the rules of the frontend', () => {
    const broken = "import { useState } from 'react';\nexport function Broken({ on }: { on: boolean }) {\n  if (on) useState(0);\n  return null;\n}\n";
    withFile('frontend/src/HookTestBroken.tsx', broken, (file) => {
      const result = lint(file);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /rules-of-hooks/);
    });
  });

  it('does not show warnings', () => {
    withFile('backend/src/hook-test-warning.ts', "console.log('hola');\nexport {};\n", (file) => {
      // The configuration does report it as a warning...
      const eslint = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'), 'src/hook-test-warning.ts'], {
        cwd: inRoot('backend'),
        encoding: 'utf8',
      });
      assert.equal(eslint.status, 0);
      assert.match(eslint.stdout, /no-console/);
      // ...and the hook keeps quiet about it.
      const result = lint(file);
      assert.equal(result.status, 0);
      assert.equal(result.stdout + result.stderr, '');
    });
  });

  it('does not complain about files the configuration ignores', () => {
    withFile('backend/src/generated/hook-test-ignored.ts', 'const nothing = 2;\n', (file) => {
      const result = lint(file);
      assert.equal(result.status, 0);
      assert.equal(result.stdout + result.stderr, '');
    });
  });

  it('is fast enough to run after every edit', () => {
    const result = lint(inRoot('backend/src/app.ts'));
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.ms < 15_000, `took ${result.ms} ms`);
  });
});

describe('.claude/settings.json', () => {
  const entries = () => {
    const settings = JSON.parse(readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
    return Object.entries(settings.hooks).flatMap(([event, groups]) => groups.flatMap((group) => group.hooks.map((hook) => ({ event, matcher: group.matcher, hook }))));
  };

  it('runs every hook as a Node script that exists', () => {
    assert.ok(entries().length >= 3);
    for (const { hook } of entries()) {
      assert.equal(hook.type, 'command');
      assert.equal(hook.command, 'node');
      assert.equal(hook.args.length, 1);
      const script = hook.args[0].replace('${CLAUDE_PROJECT_DIR}', ROOT);
      assert.ok(existsSync(script), `${script} does not exist`);
      assert.ok(Number.isInteger(hook.timeout) && hook.timeout > 0);
    }
  });

  it('puts each hook on the right event and tools', () => {
    const find = (script) => entries().find(({ hook }) => hook.args[0].endsWith(script));
    assert.deepEqual([find('protect-files.mjs').event, find('protect-files.mjs').matcher], ['PreToolUse', 'Edit|Write|MultiEdit']);
    assert.deepEqual([find('guard-git-push.mjs').event, find('guard-git-push.mjs').matcher], ['PreToolUse', 'Bash|PowerShell']);
    assert.deepEqual([find('lint-edited-file.mjs').event, find('lint-edited-file.mjs').matcher], ['PostToolUse', 'Edit|Write|MultiEdit']);
  });
});
