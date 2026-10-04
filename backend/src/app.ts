import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import type { PrismaClient } from './generated/prisma/client.js';
import { buildOpenApiDocument } from './docs/openapi.js';
import type { FileStorage } from './lib/file-storage.js';
import type { Logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { DocumentsController } from './modules/documents/documents.controller.js';
import { DocumentsRepository } from './modules/documents/documents.repository.js';
import { documentsRouter } from './modules/documents/documents.routes.js';
import { DocumentsService } from './modules/documents/documents.service.js';
import { IngestionQueue } from './modules/documents/ingestion/ingestion-queue.js';
import { IngestionService } from './modules/documents/ingestion/ingestion.service.js';
import type { EmbeddingProvider } from './modules/embeddings/embedding-provider.js';
import { healthRouter } from './modules/health/health.routes.js';
import { InteractionsController } from './modules/interactions/interactions.controller.js';
import { InteractionsRepository } from './modules/interactions/interactions.repository.js';
import { interactionsRouter } from './modules/interactions/interactions.routes.js';
import type { LlmProvider } from './modules/llm/llm-provider.js';
import type { OcrEngine } from './modules/ocr/ocr-engine.js';
import { RagController } from './modules/rag/rag.controller.js';
import { RagRepository } from './modules/rag/rag.repository.js';
import { ragRouter } from './modules/rag/rag.routes.js';
import { RagService } from './modules/rag/rag.service.js';

export interface AppDeps {
  db: PrismaClient;
  storage: FileStorage;
  embeddings: EmbeddingProvider;
  ocr: OcrEngine;
  llm: LlmProvider | null;
  logger: Logger;
  corsOrigin: string;
  maxUploadMb: number;
}

/**
 * Builds the Express app with every dependency injected, so tests can swap the
 * embedding model, the OCR engine and the LLM for fakes and use a separate database.
 */
export function createApp(deps: AppDeps) {
  const { db, storage, embeddings, ocr, llm, logger } = deps;

  const documentsRepository = new DocumentsRepository(db);
  const ingestion = new IngestionService({ repository: documentsRepository, storage, embeddings, ocr, logger });
  const queue = new IngestionQueue((id) => ingestion.process(id), logger);
  const documentsService = new DocumentsService({ repository: documentsRepository, storage, queue });
  const interactionsRepository = new InteractionsRepository(db);
  const ragService = new RagService({
    repository: new RagRepository(db),
    embeddings,
    llm,
    interactions: interactionsRepository,
    logger,
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(
    pinoHttp({
      logger,
      // Log method, path and status only: URLs and bodies could contain client data.
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, path: req.url.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  // Swagger UI needs inline scripts, so it gets its own relaxed CSP; the API keeps the strict one.
  const openApiDocument = buildOpenApiDocument();
  app.get('/api/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
  app.use(
    '/api/docs',
    helmet({ contentSecurityPolicy: false }),
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, { customSiteTitle: 'LexSearch API' }),
  );

  app.use(helmet());
  app.use(cors({ origin: deps.corsOrigin }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 1000,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes. Esperá unos minutos.' } },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter({ db, embeddings, llm }));
  app.use(
    '/api/documents',
    documentsRouter(new DocumentsController(documentsService), {
      tmpDir: storage.tmpDir,
      maxUploadBytes: deps.maxUploadMb * 1024 * 1024,
    }),
  );
  app.use('/api/rag', ragRouter(new RagController(ragService)));
  app.use('/api/interactions', interactionsRouter(new InteractionsController(interactionsRepository)));

  app.use(notFoundHandler);
  app.use(errorHandler({ maxUploadMb: deps.maxUploadMb }));

  return { app, queue, documentsService };
}
