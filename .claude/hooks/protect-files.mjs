// PreToolUse hook (Edit, Write, MultiEdit): files that must not be edited from here.
//   - .env and .env.* (they hold the Gemini key), except .env.example
//   - files that already exist under backend/prisma/migrations/ (an applied migration is never rewritten:
//     a new migration is created instead). Creating a new migration folder or file is allowed.
// It blocks with exit code 2 and a message Claude can act on. If the hook itself fails it also blocks:
// a protection that fails silently is worse than one that gets in the way.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, block, readEvent, relativeToRoot } from './common.mjs';

const MIGRATIONS = 'backend/prisma/migrations/';

/** The file name the way Windows sees it: no case, no trailing dots or spaces, and «name:stream» is a stream of «name». */
function windowsName(file) {
  return path.basename(file).split(':')[0].replace(/[. ]+$/, '').toLowerCase();
}

function main() {
  const event = readEvent();
  const target = event.tool_input?.file_path;
  if (typeof target !== 'string' || target === '') return;

  const file = path.resolve(event.cwd ?? ROOT, target);
  const name = windowsName(file);

  if ((name === '.env' || name.startsWith('.env.')) && name !== '.env.example') {
    return block(
      `Bloqueado: ${path.basename(file)} es un archivo de secretos (el .env tiene la clave de Gemini) y no se edita desde acá. ` +
        'Si hace falta una variable nueva, agregala con un valor de ejemplo en .env.example y que el abogado la copie a su .env a mano.',
    );
  }

  const relative = relativeToRoot(file);
  if (relative.startsWith(MIGRATIONS) && existsSync(file)) {
    return block(
      `Bloqueado: la migración ${relative} ya existe, y una migración existente no se edita (puede estar aplicada en la base). ` +
        'Creá una migración nueva (carpeta backend/prisma/migrations/AAAAMMDDHHMMSS_nombre/migration.sql) con el cambio y verificá con ' +
        '`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`.',
    );
  }
}

try {
  main();
} catch (error) {
  block(`El hook .claude/hooks/protect-files.mjs falló (${error instanceof Error ? error.message : error}): por seguridad se bloquea la edición. Revisá el hook.`);
}
