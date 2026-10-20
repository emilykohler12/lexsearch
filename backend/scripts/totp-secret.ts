// Genera la clave del segundo factor para el .env: `npm run auth:totp -w backend [usuario]`.
// Se agrega a una app de autenticación (Google Authenticator, Microsoft Authenticator, Aegis, 1Password…) con «Ingresar
// una clave de configuración» y desde ahí la app muestra un código de 6 dígitos que cambia cada 30 segundos.
import { generateTotpSecret, otpauthUri } from '../src/modules/auth/totp.js';

const secret = generateTotpSecret();
const account = process.argv[2] ?? 'abogada';

console.log('\nPegá esta línea en el archivo .env y reiniciá el sistema:\n');
console.log(`AUTH_TOTP_SECRET=${secret}\n`);
console.log('En tu app de autenticación elegí «agregar cuenta» → «ingresar una clave de configuración» y cargá:');
console.log(`  Cuenta: LexSearch (${account})`);
console.log(`  Clave:  ${secret.match(/.{1,4}/g)?.join(' ')}`);
console.log('  Tipo:   basado en tiempo\n');
console.log('Si tu app lee códigos QR, también sirve esta dirección (se puede convertir en QR con cualquier generador local):');
console.log(`  ${otpauthUri(secret, account)}\n`);
console.log('Guardá la clave en un lugar seguro: con ella se vuelve a armar la app si perdés el teléfono.');
