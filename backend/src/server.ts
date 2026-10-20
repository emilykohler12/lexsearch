import { createApp } from './app.js';
import { env, modelsCacheDir, ocrCacheDir, storageDir } from './config/env.js';
import { FileStorage } from './lib/file-storage.js';
import { logger } from './lib/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { EMBEDDING_DIMENSIONS } from './modules/embeddings/embedding-provider.js';
import { LocalEmbeddingProvider } from './modules/embeddings/local-embedding-provider.js';
import { GeminiLlmProvider } from './modules/llm/gemini-llm-provider.js';
import { BoletinOficialSource } from './modules/normative/sources/boletin-oficial.js';
import { BoletinOficialMisionesSource } from './modules/normative/sources/misiones.js';
import { TesseractOcrEngine } from './modules/ocr/tesseract-ocr-engine.js';

const db = createPrismaClient(env.DATABASE_URL);
const storage = new FileStorage(storageDir);
await storage.init();

const embeddings = new LocalEmbeddingProvider({
  modelName: env.EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
  cacheDir: modelsCacheDir,
  minRelevantSimilarity: env.SEARCH_MIN_SIMILARITY,
  logger,
});

const ocr = new TesseractOcrEngine({ language: 'spa', cachePath: ocrCacheDir, logger });

const llm = env.GEMINI_API_KEY
  ? new GeminiLlmProvider({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
      fallbackModels: env.GEMINI_FALLBACK_MODELS,
      thinkingLevel: env.GEMINI_THINKING_LEVEL,
      logger,
    })
  : null;

const auth =
  env.AUTH_USERNAME && env.AUTH_PASSWORD_HASH
    ? {
        username: env.AUTH_USERNAME,
        passwordHash: env.AUTH_PASSWORD_HASH,
        idleHours: env.AUTH_IDLE_HOURS,
        secureCookie: (env.COOKIE_SECURE ?? String(env.NODE_ENV === 'production')) === 'true',
      }
    : null;
if (!auth) logger.warn('Sin usuario ni contraseña (AUTH_USERNAME / AUTH_PASSWORD_HASH): el sistema está abierto a quien llegue a esta dirección.');

const { app, queue, documentsService, deadlineWatcher, normativeWatcher } = createApp({
  db,
  storage,
  embeddings,
  ocr,
  llm,
  logger,
  corsOrigin: env.CORS_ORIGIN,
  maxUploadMb: env.MAX_UPLOAD_MB,
  auth,
  ...(env.TRUST_PROXY_HOPS && { trustProxyHops: env.TRUST_PROXY_HOPS }),
  normativeSources: [new BoletinOficialSource(), new BoletinOficialMisionesSource()],
});

const server = app.listen(env.PORT, env.HOST, (error?: Error) => {
  // Express 5 hands the error to this function when the server can't start (for example, when the
  // port is taken). Without this check the log would say it is listening when it is not.
  if (error) {
    const taken = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
    logger.fatal(
      { err: error },
      taken
        ? `El puerto ${env.PORT} ya está en uso: ¿hay otro LexSearch abierto? Cerralo, o cambiá PORT en el archivo .env.`
        : 'No se pudo iniciar el servidor',
    );
    process.exit(1);
  }
  logger.info(`LexSearch API escuchando en http://${env.HOST}:${env.PORT} (docs: /api/docs)`);
  if (!llm) {
    logger.warn('GEMINI_API_KEY no configurada: la búsqueda funciona, las respuestas con IA quedan desactivadas');
  }
});

// Load the embedding model in the background so the first upload/search doesn't wait for it.
embeddings.warmUp().catch((error: unknown) => {
  logger.error({ err: error }, 'No se pudo cargar el modelo de embeddings (¿sin conexión la primera vez?)');
});
ocr.warmUp().catch((error: unknown) => {
  logger.error({ err: error }, 'No se pudo cargar el OCR (¿sin conexión la primera vez?)');
});

// Warns about deadlines that are about to expire: now, and then every hour.
const stopDeadlineWatcher = deadlineWatcher.start();

// Reads the Boletín Oficial a little after starting (if the last check is old) and then every three hours.
const stopNormativeWatcher = normativeWatcher.start();

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
  stopDeadlineWatcher();
  stopNormativeWatcher();
  // Documents interrupted here stay PENDING/PROCESSING and are resumed on the next start.
  await Promise.race([queue.idle(), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  await ocr.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
