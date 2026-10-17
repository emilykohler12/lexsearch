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
import { CalendarController } from './modules/calendar/calendar.controller.js';
import { calendarRouter } from './modules/calendar/calendar.routes.js';
import { CalendarService } from './modules/calendar/calendar.service.js';
import { NonWorkingDaysRepository } from './modules/calendar/non-working-days.repository.js';
import { CasesController } from './modules/cases/cases.controller.js';
import { CasesRepository } from './modules/cases/cases.repository.js';
import { casesRouter } from './modules/cases/cases.routes.js';
import { CasesService } from './modules/cases/cases.service.js';
import { ProceedingAnalysisService } from './modules/cases/proceeding-analysis.service.js';
import { ContradictionAnalysisService } from './modules/contradictions/contradiction-analysis.service.js';
import { ContradictionsController } from './modules/contradictions/contradictions.controller.js';
import { ContradictionsRepository } from './modules/contradictions/contradictions.repository.js';
import { contradictionsRouter } from './modules/contradictions/contradictions.routes.js';
import { ContradictionsService } from './modules/contradictions/contradictions.service.js';
import { ClientsController } from './modules/clients/clients.controller.js';
import { ClientsRepository } from './modules/clients/clients.repository.js';
import { clientsRouter } from './modules/clients/clients.routes.js';
import { ClientsService } from './modules/clients/clients.service.js';
import { DeadlineAnalysisService } from './modules/deadlines/deadline-analysis.service.js';
import { DeadlinesController } from './modules/deadlines/deadlines.controller.js';
import { DeadlinesRepository } from './modules/deadlines/deadlines.repository.js';
import { deadlinesRouter } from './modules/deadlines/deadlines.routes.js';
import { DeadlinesService } from './modules/deadlines/deadlines.service.js';
import { DocumentTextReader } from './modules/documents/document-text.js';
import { DocumentsController } from './modules/documents/documents.controller.js';
import { DocumentsRepository } from './modules/documents/documents.repository.js';
import { documentsRouter } from './modules/documents/documents.routes.js';
import { DocumentsService } from './modules/documents/documents.service.js';
import { IngestionQueue } from './modules/documents/ingestion/ingestion-queue.js';
import { IngestionService } from './modules/documents/ingestion/ingestion.service.js';
import { DraftsController } from './modules/drafts/drafts.controller.js';
import { DraftsRepository } from './modules/drafts/drafts.repository.js';
import { draftsRouter } from './modules/drafts/drafts.routes.js';
import { DraftsService } from './modules/drafts/drafts.service.js';
import type { EmbeddingProvider } from './modules/embeddings/embedding-provider.js';
import { healthRouter } from './modules/health/health.routes.js';
import { InteractionsController } from './modules/interactions/interactions.controller.js';
import { InteractionsRepository } from './modules/interactions/interactions.repository.js';
import { interactionsRouter } from './modules/interactions/interactions.routes.js';
import type { LlmProvider } from './modules/llm/llm-provider.js';
import { DeadlineWatcher } from './modules/notifications/deadline-watcher.js';
import { NotificationsController } from './modules/notifications/notifications.controller.js';
import { NotificationsRepository } from './modules/notifications/notifications.repository.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
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
  const casesRepository = new CasesRepository(db);
  const ingestion = new IngestionService({ repository: documentsRepository, storage, embeddings, ocr, logger });
  const queue = new IngestionQueue((id) => ingestion.process(id), logger);
  const documentsService = new DocumentsService({ repository: documentsRepository, storage, queue, cases: casesRepository });
  const interactionsRepository = new InteractionsRepository(db);
  const ragService = new RagService({
    repository: new RagRepository(db),
    embeddings,
    llm,
    interactions: interactionsRepository,
    logger,
  });
  const clientsRepository = new ClientsRepository(db);
  const clientsService = new ClientsService({
    repository: clientsRepository,
    llm,
    interactions: interactionsRepository,
    logger,
  });
  const notificationsRepository = new NotificationsRepository(db);
  const deadlinesRepository = new DeadlinesRepository(db);
  const calendarService = new CalendarService({
    repository: new NonWorkingDaysRepository(db),
    // Days the lawyer adds or removes can move the due date of deadlines already saved.
    afterChange: () => deadlinesService.recalculatePending(),
  });
  // Annotated: the calendar and the deadlines service refer to each other.
  const deadlinesService: DeadlinesService = new DeadlinesService({
    repository: deadlinesRepository,
    calendar: calendarService,
    clients: clientsRepository,
    cases: casesRepository,
    notifications: notificationsRepository,
    logger,
  });
  const casesService = new CasesService({
    repository: casesRepository,
    clients: clientsRepository,
    documents: documentsRepository,
    deadlines: deadlinesRepository,
  });
  const proceedingAnalysis = new ProceedingAnalysisService({
    cases: casesRepository,
    llm,
    ocr,
    interactions: interactionsRepository,
    logger,
  });
  const deadlineAnalysis = new DeadlineAnalysisService({ llm, ocr, interactions: interactionsRepository, logger });
  const deadlineWatcher = new DeadlineWatcher({
    deadlines: deadlinesRepository,
    notifications: notificationsRepository,
    logger,
  });
  const notificationsService = new NotificationsService({ repository: notificationsRepository, watcher: deadlineWatcher });
  const documentTextReader = new DocumentTextReader({ repository: documentsRepository, storage, ocr });
  const contradictionsRepository = new ContradictionsRepository(db);
  const contradictionsService = new ContradictionsService({
    repository: contradictionsRepository,
    cases: casesRepository,
    documents: documentsRepository,
  });
  const contradictionAnalysis = new ContradictionAnalysisService({
    cases: casesRepository,
    documents: documentsRepository,
    reader: documentTextReader,
    contradictions: contradictionsRepository,
    llm,
    interactions: interactionsRepository,
    logger,
  });
  const draftsService = new DraftsService({
    repository: new DraftsRepository(db),
    documents: documentsRepository,
    clients: clientsRepository,
    reader: documentTextReader,
    rag: ragService,
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
  app.use('/api/clients', clientsRouter(new ClientsController(clientsService)));
  app.use('/api/calendar', calendarRouter(new CalendarController(calendarService)));
  app.use(
    '/api/deadlines',
    deadlinesRouter(new DeadlinesController(deadlinesService, deadlineAnalysis), {
      tmpDir: storage.tmpDir,
      maxUploadBytes: deps.maxUploadMb * 1024 * 1024,
    }),
  );
  app.use(
    '/api/cases',
    casesRouter(new CasesController(casesService, proceedingAnalysis), {
      tmpDir: storage.tmpDir,
      maxUploadBytes: deps.maxUploadMb * 1024 * 1024,
    }),
  );
  app.use('/api/cases', contradictionsRouter(new ContradictionsController(contradictionsService, contradictionAnalysis)));
  app.use('/api/notifications', notificationsRouter(new NotificationsController(notificationsService)));
  app.use('/api/drafts', draftsRouter(new DraftsController(draftsService)));
  app.use('/api/interactions', interactionsRouter(new InteractionsController(interactionsRepository)));

  app.use(notFoundHandler);
  app.use(errorHandler({ maxUploadMb: deps.maxUploadMb }));

  return { app, queue, documentsService, deadlineWatcher };
}
