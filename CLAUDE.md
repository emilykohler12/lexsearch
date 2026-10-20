# LexSearch

Sistema de IA para un único abogado (no es multiusuario): biblioteca consultable con RAG, borradores de escritos, fichas de cliente, plazos, expedientes con línea de tiempo, detector de contradicciones, vigía normativo (Boletín Oficial de la Nación y de Misiones) y simulador de audiencia. **Todo lo que genera la IA es una propuesta** que el abogado revisa: nada se guarda ni se da por cierto sin que lo confirme.

Estado: fases 0 a 9 hechas; la 10 está a medias: ya tiene login (usuario, contraseña y segundo factor), HTTPS (Caddy) y copias de seguridad cifradas; faltan elegir el servidor y la anonimización. Hasta entonces el sistema escucha solo en `127.0.0.1` y no se expone a internet. El porqué de cada decisión técnica está en `docs/decisiones.md` (D1 a D26; la revisión de seguridad, en D26): leelo antes de cambiar la arquitectura. El resumen de funciones, en `README.md`.

## Stack

Monorepo npm con dos workspaces (Node ≥ 24):

- `backend/`: Express 5 + TypeScript (ESM `NodeNext`, estricto) + Prisma 7 sobre PostgreSQL 17 con pgvector (Docker). Tests con vitest.
- `frontend/`: React 19 + Vite 8 + Tailwind 4 + React Router 8 + TanStack Query 5.
- IA: Gemini detrás de la interfaz `LlmProvider`. Los embeddings (`Xenova/multilingual-e5-base`) y el OCR (Tesseract) corren en la máquina: los documentos no salen de ella para indexarse.

## Estructura

- `backend/src/modules/<tema>/`: un módulo por tema, con capas `routes → controller → service → repository` (sin lógica de negocio en los controllers) y `*.schemas.ts` con zod para validar entradas y armar las respuestas. Módulos: documents, embeddings, ocr, rag, llm, drafts, clients, cases, deadlines, calendar, notifications, contradictions, normative, hearings, estimates, auth, interactions, health.
- `backend/src/app.ts` arma la app con todas las dependencias inyectadas (los tests reemplazan el LLM, los embeddings y el OCR); `server.ts` la arranca. `lib/errors.ts` y `middlewares/error-handler.ts` convierten los errores en respuestas con mensajes seguros para mostrar.
- `backend/src/docs/openapi.ts`: documentación de la API (Swagger en `/api/docs`); todo endpoint nuevo se documenta ahí.
- `backend/prompts/<nombre>.v<N>.md`: prompts versionados, registrados en `backend/src/modules/llm/prompts.ts` (`PROMPT_VERSIONS`).
- `backend/prisma/`: `schema.prisma` y `migrations/`. El cliente de Prisma (`backend/src/generated/`) se genera con `db:generate` y no se commitea.
- `backend/tests/`: `unit/`, `integration/`, `helpers/` (los simulados y `createTestApp`) y `fixtures/`.
- `frontend/src/`: `pages/` (una por ruta, enrutadas en `App.tsx`), `features/<tema>/` (piezas de cada pantalla), `components/` (compartidos: `ui.tsx`, `fields.tsx`, `Layout.tsx`), `api/` (cliente, hooks de TanStack Query y tipos), `hooks/` y `lib/`.

## Comandos (desde la raíz)

| Comando | Qué hace |
| --- | --- |
| `npm run setup` | Primera vez: levanta la base en Docker (`db:up`) y aplica las migraciones (`db:migrate`) |
| `npm run db:up` / `npm run db:down` | Enciende / apaga el contenedor de PostgreSQL (puerto 5433, solo en `127.0.0.1`) |
| `npm run dev` | API (puerto 4000) y web (5180) con recarga automática |
| `npm run lint` · `npm run typecheck` · `npm run build` | Controles de calidad y compilación de backend y frontend |
| `npm run test:unit` | Tests unitarios (no necesitan base) |
| `npm test` | Unitarios + de integración (necesita la base en Docker) |
| `npm run models:download` | Descarga y prueba el modelo local de embeddings |
| `npm run auth:hash -w backend` | Genera `AUTH_USERNAME` y `AUTH_PASSWORD_HASH` para el `.env` (la contraseña no se guarda) |
| `npm run auth:totp -w backend` | Genera `AUTH_TOTP_SECRET` (segundo factor) y muestra cómo cargarlo en la app de autenticación |

Solo en el backend (`npm run <script> -w backend`): `test:integration`, `db:deploy` (aplica las migraciones; es lo que hace `npm run db:migrate`), `db:migrate:dev`, `db:generate` (también corre en el `postinstall`) y `db:studio`.

## Reglas del proyecto

**Migraciones de Prisma**
- Se escriben a mano: `backend/prisma/migrations/<AAAAMMDDHHMMSS>_<nombre>/migration.sql`, con el formato de las existentes, y se aplican con `npm run db:migrate`. No usar `prisma db push` (D8) ni `migrate reset` sobre la base de desarrollo; `db:migrate:dev` existe, pero la convención es escribir el SQL y aplicarlo con `db:deploy`.
- `schema.prisma` y las migraciones tienen que coincidir: el CI corre `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` contra la base ya migrada y falla si hay diferencia. Verificalo igual antes de commitear.
- Una migración que ya existe no se edita: se crea otra. Lo que Prisma no modela (pgvector, columnas generadas, índices HNSW y GIN) está escrito a mano en la migración inicial y declarado en `schema.prisma`.

**Prompts**
- Un prompt que ya se usó no se edita: se crea la versión siguiente (`v2`, `v3`…) y se cambia su entrada en `PROMPT_VERSIONS`, porque el historial de interacciones guarda qué versión produjo cada respuesta (D10). Si todavía no se commiteó, se puede ajustar en el mismo archivo.
- Los textos de documentos, normas, escritos y conversaciones que se mandan al modelo van entre delimitadores con sufijo aleatorio y se tratan como datos, no como instrucciones.

**Citas verificadas.** Lo que el modelo cita se busca en el servidor en el texto original (`modules/llm/quote-locator.ts`): se muestra el texto original, nunca la copia del modelo, y una frase que no aparece no se presenta como cita. Las salidas estructuradas se validan con zod; el armado de pedidos y la normalización de respuestas son funciones puras, separadas de la llamada al modelo, para poder probarlas.

**Tests**
- Nunca llaman a Gemini: usan `FakeLlmProvider`, `FakeEmbeddingProvider`, `FakeOcrEngine` y `FakeNormativeSource` de `backend/tests/helpers/fakes.ts`, que `createTestApp()` (`tests/helpers/test-app.ts`) inyecta en la app.
- Los de integración usan la base `lexsearch_test`: `TEST_DATABASE_URL` tiene que terminar en `_test` (el setup lo verifica y aplica las migraciones). Corren de a un archivo y cada archivo borra lo que crea. Cada archivo arma su propia app: los endpoints con límite de pedidos se prueban con límites inyectables (como `hearingLimits`) o repartidos en archivos.

**Idioma.** El código (identificadores, comentarios, nombres de archivo) está en inglés; todo lo que ve el usuario —interfaz, mensajes de error de la API, prompts, documentación— está en español rioplatense (voseo: «elegí», «tocá»).

**Datos confidenciales.** Los datos de clientes y expedientes están protegidos por secreto profesional.
- Con la contraseña puesta (`AUTH_*`) todo `/api` pide sesión salvo `/api/health` y `/api/auth/*`; en producción la API no arranca sin ella. Los errores que se guardan en el historial pasan por `safeErrorMessage` (`lib/errors.ts`): nunca `error.message` crudo.
- Los logs registran método, ruta, estado, ids, cantidades y tiempos; nunca contenido de documentos, preguntas, respuestas ni textos de escritos (D9). Lo que lleva contenido viaja en el cuerpo (POST), no en la URL. Se loguea con el `logger` (pino), no con `console.log`.
- A Gemini viaja solo lo que cada tarea necesita. En el plan gratuito Google puede usarlo para mejorar sus productos: antes de trabajar con datos reales hay que activar la facturación (D4, D12).
- No leas ni copies el `.env` (tiene `GEMINI_API_KEY`): las variables están documentadas en `.env.example`.

**Interfaz.** Las confirmaciones usan el componente `Dialog` de `components/ui.tsx` (no `window.confirm`); lo que se edita se guarda con «Guardar» o Ctrl+S (`useSaveShortcut`) y avisa al salir con cambios sin guardar (`useUnsavedChanges`). Pantallas apiladas, sin textos de ayuda de más, que funcionen a 375 px de ancho (botones táctiles de 44 px: `min-h-11 sm:min-h-0`).

## Antes de dar algo por terminado

`npm run lint`, `npm run typecheck` y `npm run test:unit`. Si tocaste rutas, repositorios, migraciones o la base, corré también `npm test` (con la base en Docker). Un endpoint nuevo lleva su entrada en `openapi.ts` y su test de integración.

## Git y CI

- Cada push a `main` corre el CI y, si pasa, **publica las imágenes de Docker** en ghcr.io (`.github/workflows/ci.yml`): no se sube a `main` sin que el abogado lo pida.
- Commits: mensaje corto en español (hasta 10 palabras) y sin líneas `Co-Authored-By`, como el resto del historial.

## Claude Code

Los hooks de `.claude/settings.json` son scripts de Node (`.claude/hooks/*.mjs`, para que corran igual en Windows) y protegen lo que no se toca desde acá:
- **No se editan** `.env` ni `.env.*` (salvo `.env.example`), ni los archivos que ya existen en `backend/prisma/migrations/`. Crear una migración nueva sí se puede.
- **Push:** `git push --force` (también `-f`, `--force-with-lease`, `+rama`, `--mirror`) y borrar `main` se bloquean; cualquier push que actualice `main` o `master` le pide confirmación al abogado.
- **ESLint:** al editar un `.ts` o `.tsx` de `backend/` o `frontend/` corre ESLint sobre ese archivo y muestra los errores: corregilos antes de seguir.

Si se toca un hook, se prueba con `node --test .claude/hooks/hooks.test.mjs`.
