import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// Un único .env en la raíz del repo (compartido con docker compose).
// Las variables ya definidas en el entorno tienen prioridad sobre el archivo.
const rootEnvFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // `prisma generate` no necesita conexión, así que no exigimos la variable acá.
    url: process.env.DATABASE_URL ?? '',
  },
});
