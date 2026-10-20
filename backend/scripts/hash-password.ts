// Genera las líneas del .env con el usuario y la contraseña de LexSearch: `npm run auth:hash -w backend`.
// La contraseña se escribe sin que se vea y no se guarda en ningún lado: solo se imprime su hash.
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { hashPassword, MAX_PASSWORD_CHARS, MIN_PASSWORD_CHARS } from '../src/modules/auth/password.js';

let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY ?? false });

// With a terminal each question is asked in turn; piped input (a script) arrives line by line.
const lines: string[] = [];
let waiting: ((line: string) => void) | null = null;
rl.on('line', (line) => (waiting ? waiting(line) : lines.push(line)));

function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  return new Promise((resolve) => {
    const done = (line: string) => {
      waiting = null;
      if (hidden) process.stdout.write('\n');
      muted = false;
      resolve(line);
    };
    const queued = lines.shift();
    if (queued !== undefined) done(queued);
    else waiting = done;
  });
}

const username = (await ask('Usuario: ')).trim();
const password = await ask(`Contraseña (mínimo ${MIN_PASSWORD_CHARS} caracteres): `, true);
const again = await ask('Repetí la contraseña: ', true);
rl.close();

const problem =
  username === '' || /[\s=#'"]/.test(username)
    ? 'El usuario no puede estar vacío ni tener espacios, comillas, «=» o «#».'
    : password.length < MIN_PASSWORD_CHARS
      ? `La contraseña tiene que tener al menos ${MIN_PASSWORD_CHARS} caracteres.`
      : password.length > MAX_PASSWORD_CHARS
        ? `La contraseña no puede pasar de ${MAX_PASSWORD_CHARS} caracteres.`
        : password !== again
          ? 'Las dos contraseñas no coinciden.'
          : null;
if (problem) {
  console.error(problem);
  process.exit(1);
}

console.log('\nPegá estas dos líneas en el archivo .env (reemplazando las que ya haya) y reiniciá el sistema:\n');
console.log(`AUTH_USERNAME=${username}`);
console.log(`AUTH_PASSWORD_HASH=${await hashPassword(password)}`);
