---
name: nueva-migracion
description: Crea una migración de Prisma escrita a mano (SQL con timestamp), actualiza schema.prisma y verifica que coincidan con prisma migrate diff. Usala cuando haya que agregar o cambiar tablas, columnas, índices o relaciones de la base de LexSearch.
---

# Nueva migración de Prisma

Las migraciones de LexSearch se escriben a mano y se aplican con `db:deploy`. No uses `prisma db push` (D8), ni `migrate reset` sobre la base de desarrollo, ni `db:migrate:dev` (existe, pero la convención es escribir el SQL). **Una migración que ya existe no se edita** (un hook lo bloquea): si algo quedó mal, se crea otra.

## Pasos

1. **Leé el estado actual.** Mirá `backend/prisma/schema.prisma` (convenciones: `@map("snake_case")` en columnas, `@@map("tabla_en_plural")`, ids `String @id @default(uuid()) @db.Uuid`, `createdAt`/`updatedAt` con `@map`, comentarios `///` en español sobre los valores posibles) y la última carpeta de `backend/prisma/migrations/` como modelo del formato.
2. **Elegí el nombre.** `backend/prisma/migrations/<AAAAMMDDHHMMSS>_<nombre_en_minusculas>/migration.sql`. El timestamp tiene que ser **posterior a la última migración** (se aplican por orden alfabético) y las existentes siguen el patrón `20261019120000_hearings`. Nombre corto en inglés, con guiones bajos.
3. **Editá `schema.prisma`.** Agregá o cambiá el modelo. Los modelos relacionados necesitan la relación en ambos lados. Lo que Prisma no modela (pgvector, columnas generadas, índices HNSW y GIN) está declarado en `schema.prisma` y escrito a mano en la migración inicial; no lo toques sin leer `docs/decisiones.md`.
4. **Escribí el SQL a mano** en `migration.sql`, con el mismo formato que genera Prisma, en este orden y con estos comentarios:
   - `-- CreateTable` (`CREATE TABLE "tabla" (...)` con `"id" UUID NOT NULL`, `TIMESTAMP(3)`, `TEXT`, `JSONB`, `TEXT[]`, `DEFAULT CURRENT_TIMESTAMP`, y `CONSTRAINT "tabla_pkey" PRIMARY KEY ("id")`; `updated_at` sin default)
   - `-- AlterTable` (`ALTER TABLE ... ADD COLUMN ...`), si cambia una tabla existente
   - `-- CreateIndex` (`CREATE INDEX "tabla_col_idx" ON "tabla"("col");` y `CREATE UNIQUE INDEX "tabla_col_key" ...`)
   - `-- AddForeignKey` (`ALTER TABLE ... ADD CONSTRAINT "tabla_col_fkey" FOREIGN KEY ... ON DELETE SET NULL|CASCADE|RESTRICT ON UPDATE CASCADE;`)

   Los nombres de índices y claves tienen que ser los que Prisma espera (`<tabla>_<columnas>_idx|key|pkey|fkey`), o el diff del paso 6 va a fallar.
5. **Aplicala** a la base de desarrollo (con Docker encendido, `npm run db:up`), desde la raíz:

   ```bash
   npm run db:migrate
   npm run db:generate -w backend
   ```

6. **Verificá que coincidan** (lo mismo que hace el CI), desde `backend/`:

   ```bash
   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
   ```

   Código 0 y «No difference detected» = bien. Código 2 = el SQL y `schema.prisma` no coinciden: el diff muestra qué falta. Corregí **el archivo nuevo** (si ya lo aplicaste y quedó mal, creá otra migración que lo arregle; no edites la aplicada).
7. **Actualizá lo que depende del modelo:** repositorio, schemas con zod (`*.schemas.ts`), `reset()` de `backend/tests/helpers/test-app.ts` (borrar las filas del modelo nuevo en el orden correcto de las relaciones), y la documentación en `backend/src/docs/openapi.ts` si cambia la API.
8. **Cerrá con** `npm run typecheck`, `npm run lint` y `npm test` (la base de pruebas `lexsearch_test` aplica las migraciones sola).

## Cuidado

- Los datos de clientes y expedientes son confidenciales: nunca pongas datos reales en una migración ni en un seed.
- Una columna `NOT NULL` nueva en una tabla con filas necesita `DEFAULT` (o hacerla en pasos), o la migración falla en la base de desarrollo.
- Nunca leas ni edites `.env`: la conexión sale de `DATABASE_URL`, documentada en `.env.example`.
