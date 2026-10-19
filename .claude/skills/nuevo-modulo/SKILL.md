---
name: nuevo-modulo
description: Crea un módulo nuevo del backend de LexSearch con el patrón de los existentes (routes, controller, service, repository, schemas con zod), lo registra en app.ts, lo documenta en openapi.ts y le escribe tests. Usala cuando haya que agregar un tema o recurso nuevo a la API.
---

# Nuevo módulo del backend

Un módulo por tema en `backend/src/modules/<tema>/`, con capas `routes → controller → service → repository`. **Sin lógica de negocio en los controllers.** El patrón sale de módulos reales: `clients` (CRUD completo con IA y rate limit) y `notifications` (chico, con repositorio y servicio simples). Leelos antes de escribir y copiá su estilo.

## Archivos (nombre del tema en inglés, minúsculas; ej. `things`)

`backend/src/modules/things/`:

1. **`things.schemas.ts`**: schemas de zod de las entradas, tipos inferidos y los DTO de salida.
   - Un campo de texto sin límite es un hallazgo: `z.string().trim().max(N)`.
   - Las entradas de actualización se arman con `.partial()` sobre los mismos campos **sin defaults** (un default dentro de `.partial()` pisaría campos que el pedido no mencionó).
   - `toThingDto(row)`: arma la respuesta explícitamente, campo por campo; nunca devuelvas la fila de Prisma tal cual.
   - Mensajes de validación en español rioplatense (el locale de zod ya está configurado en `lib/validation.ts`).
2. **`things.repository.ts`**: `class ThingsRepository { constructor(private readonly db: PrismaClient) {} }`. Solo acceso a datos con el cliente de `../../generated/prisma/client.js`, sin reglas de negocio. Los listados traen solo lo que la pantalla muestra (sin textos largos).
3. **`things.service.ts`**: `class ThingsService { constructor(private readonly deps: {...}) {} }` con las dependencias inyectadas (`repository`, y si usa IA `llm: LlmProvider | null`, `interactions`, `logger`). Acá va la lógica de negocio. Errores de `lib/errors.ts` con mensajes en español seguros para mostrar: `NotFoundError('La cosa no existe o fue eliminada')`, `BadRequestError`, `ConflictError`, `ServiceUnavailableError`. Si hay IA y `llm` es `null`, `ServiceUnavailableError`.
4. **`things.controller.ts`**: `class ThingsController { constructor(private readonly service: ThingsService) {} }` con métodos flecha `create = async (req, res) => {...}`. Cada uno: valida con `parseInput(schema, req.body | req.params)` (`uuidParamsSchema` para `:id`), llama al servicio y responde con el DTO (`201` al crear, `204` sin cuerpo al borrar). Sin `try/catch`: Express 5 pasa los errores de los handlers `async` al manejador central.
5. **`things.routes.ts`**: `export function thingsRouter(controller: ThingsController) { const router = Router(); ... return router; }`. Si el endpoint llama al modelo, lleva su `rateLimit` (`windowMs: 60_000`, `limit`, `standardHeaders: 'draft-8'`, `legacyHeaders: false`, mensaje `{ error: { code: 'RATE_LIMIT', message: '... Esperá un minuto.' } }`). Si recibe archivos, `multer` con `limits.fileSize` basado en `maxUploadBytes` (mirá `deadlines.routes.ts`). Lo que lleva contenido de clientes o documentos viaja en el cuerpo (POST), nunca en la URL.

Si hay IA: el armado del pedido y la normalización de la respuesta van en funciones puras en un archivo aparte (como `clients/client-intake.ts`), la salida se valida con zod, el prompt va versionado (usá la skill `nuevo-prompt`) y lo que el modelo cita se verifica con `modules/llm/quote-locator.ts`. Todo lo que genera la IA es una propuesta: no se guarda sin que el abogado confirme.

## Base de datos

Si el módulo necesita tablas, usá la skill `nueva-migracion` primero (SQL a mano, `schema.prisma` y verificación con `prisma migrate diff`) y agregá el borrado de sus filas a `reset()` en `backend/tests/helpers/test-app.ts`.

## Registro en `backend/src/app.ts`

1. Imports de `ThingsController`, `ThingsRepository`, `thingsRouter` y `ThingsService` (orden alfabético por ruta, junto a los demás).
2. En `createApp`, junto a los demás: `const thingsRepository = new ThingsRepository(db);` y `const thingsService = new ThingsService({ repository: thingsRepository, ... })`. Si necesita una dependencia nueva (una fuente externa, por ejemplo), se agrega a `AppDeps` para que los tests la reemplacen con un simulado.
3. Montaje: `app.use('/api/things', thingsRouter(new ThingsController(thingsService)));` junto a los demás `app.use('/api/...')`.

## Documentación en `backend/src/docs/openapi.ts`

Todo endpoint nuevo se documenta ahí: un `tags` nuevo con su descripción en español (en la lista `tags`, si el tema es nuevo) y las rutas en `paths`, con el patrón de los existentes: `tags`, `summary` en español, `requestBody: { required: true, ...json(jsonSchema(createThingSchema)) }` importando el schema, `parameters: [idParam]` para `/{id}`, y `responses` con `errorResponse` para 400/404/429/502/503 según corresponda. Si el endpoint usa IA, aclarar en la `description` que devuelve una propuesta y no guarda nada.

## Tests

Nunca llaman a Gemini: `FakeLlmProvider`, `FakeEmbeddingProvider`, `FakeOcrEngine`, `FakeNormativeSource` de `backend/tests/helpers/fakes.ts`, inyectados por `createTestApp()`. Podés delegar en el subagente `escritor-tests`.

- **Unitarios** (`backend/tests/unit/things.test.ts`): schemas, DTO y las funciones puras. No necesitan base.
- **Integración** (`backend/tests/integration/things.test.ts`): un archivo por módulo, con `const ctx = await createTestApp({ llm })`, `afterAll(() => ctx.close())`, `beforeEach(() => ctx.reset())` y `supertest`. Probá: caso feliz, validación (400 con mensaje en español), inexistente (404), y que los errores no filtren contenido. Datos ficticios siempre. Los límites de pedidos se prueban con límites inyectables o repartidos en archivos.

## Frontend (si el módulo tiene pantalla)

`frontend/src/pages/` (una por ruta, enrutada en `App.tsx`), `frontend/src/features/<tema>/`, y hooks y tipos en `frontend/src/api/`. Respetá las reglas de interfaz de `CLAUDE.md` (Dialog en vez de `window.confirm`, Ctrl+S, 375 px de ancho).

## Cerrar

`npm run lint`, `npm run typecheck`, `npm run test:unit` y, como tocaste rutas y base, `npm test` (con Docker encendido). Si el módulo maneja datos de clientes o llama a Gemini, pasá el subagente `revisor-datos-sensibles` (y `revisor-rag` si hay citas). Los logs llevan ids, cantidades y tiempos, nunca contenido (D9).
