import { createApp } from './app.js';
import { env, modelsCacheDir, storageDir } from './config/env.js';
import { FileStorage } from './lib/file-storage.js';
import { logger } from './lib/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { EMBEDDING_DIMENSIONS } from './modules/embeddings/embedding-provider.js';
import { LocalEmbeddingProvider } from './modules/embeddings/local-embedding-provider.js';
import { GeminiLlmProvider } from './modules/llm/gemini-llm-provider.js';

const db = createPrismaClient(env.DATABASE_URL);
const storage = new FileStorage(storageDir);
await storage.init();

const embeddings = new LocalEmbeddingProvider({
  modelName: env.EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
  cacheDir: modelsCacheDir,
  logger,
});

const llm = env.GEMINI_API_KEY
  ? new GeminiLlmProvider({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
      fallbackModels: env.GEMINI_FALLBACK_MODELS,
      thinkingLevel: env.GEMINI_THINKING_LEVEL,
      logger,
    })
  : null;

const { app, queue, documentsService } = createApp({
  db,
  storage,
  embeddings,
  llm,
  logger,
  corsOrigin: env.CORS_ORIGIN,
  maxUploadMb: env.MAX_UPLOAD_MB,
});

const server = app.listen(env.PORT, '127.0.0.1', () => {
  logger.info(`LexSearch API escuchando en http://localhost:${env.PORT} (docs: /api/docs)`);
  if (!llm) {
    logger.warn('GEMINI_API_KEY no configurada: la búsqueda funciona, las respuestas con IA quedan desactivadas');
  }
});

// Load the embedding model in the background so the first upload/search doesn't wait for it.
embeddings.warmUp().catch((error: unknown) => {
  logger.error({ err: error }, 'No se pudo cargar el modelo de embeddings (¿sin conexión la primera vez?)');
});

documentsService
  .resumeUnfinished()
  .then((count) => {
    if (count > 0) logger.info({ count }, 'Resuming documents left unprocessed by a restart');
  })
  .catch((error: unknown) => logger.error({ err: error }, 'Could not resume unfinished documents'));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  server.close();
  // Documents interrupted here stay PENDING/PROCESSING and are resumed on the next start.
  await Promise.race([queue.idle(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
