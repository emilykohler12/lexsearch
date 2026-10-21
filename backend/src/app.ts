import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import type { PrismaClient } from './generated/prisma/client.js';
import { buildOpenApiDocument } from './docs/openapi.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { AuthService, type AuthConfig } from './modules/auth/auth.service.js';
import type { FileStorage } from './lib/file-storage.js';
import type { Logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { requireSameOrigin } from './middlewares/same-origin.js';
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
import { EstimateAnalysisService } from './modules/estimates/estimate-analysis.service.js';
import { EstimatesController } from './modules/estimates/estimates.controller.js';
import { EstimatesRepository } from './modules/estimates/estimates.repository.js';
import { estimatesRouter } from './modules/estimates/estimates.routes.js';
import { EstimatesService } from './modules/estimates/estimates.service.js';
import type { EmbeddingProvider } from './modules/embeddings/embedding-provider.js';
import { healthRouter } from './modules/health/health.routes.js';
import { HearingSimulator } from './modules/hearings/hearing-simulator.js';
import { HearingsController } from './modules/hearings/hearings.controller.js';
import { HearingsRepository } from './modules/hearings/hearings.repository.js';
import { hearingsRouter, type HearingLimits } from './modules/hearings/hearings.routes.js';
import { HearingsService } from './modules/hearings/hearings.service.js';
import { InteractionsController } from './modules/interactions/interactions.controller.js';
import { InteractionsRepository } from './modules/interactions/interactions.repository.js';
import { interactionsRouter } from './modules/interactions/interactions.routes.js';
import type { LlmProvider } from './modules/llm/llm-provider.js';
import { NormativeAnalyzer } from './modules/normative/normative-analyzer.js';
import { NormativeController } from './modules/normative/normative.controller.js';
import { NormativeRepository } from './modules/normative/normative.repository.js';
import { normativeRouter } from './modules/normative/normative.routes.js';
import { NormativeService } from './modules/normative/normative.service.js';
import { NormativeWatcher } from './modules/normative/normative-watcher.js';
import type { NormativeSource } from './modules/normative/sources/normative-source.js';
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
  /** Where the norms come from: the national Boletín Oficial and the provincial one (tests pass fakes). */
  normativeSources: NormativeSource[];
  /** Start the normative checks by themselves when the topics change. On unless a test needs it quiet. */
  normativeAutoRun?: boolean;
  /** Requests per minute of the audiencia simulator (tests that run dozens of practices raise them). */
  hearingLimits?: HearingLimits;
  /** The access of the lawyer; null leaves the system open (only outside production). */
  auth?: AuthConfig | null;
  /** How many proxies stand in front of the API (see where it is used). */
  trustProxyHops?: number;
  /** Failed logins allowed per 15 minutes (tests lower it). */
  loginAttempts?: number;
  /** Injectable clock for what depends on the date (the normative check). */
  now?: () => Date;
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
  const normativeRepository = new NormativeRepository(db);
  const normativeWatcher = new NormativeWatcher({
    sources: deps.normativeSources,
    repository: normativeRepository,
    analyzer: new NormativeAnalyzer({ llm, interactions: interactionsRepository, logger }),
    logger,
    ...(deps.now && { now: deps.now }),
  });
  const normativeService = new NormativeService({
    repository: normativeRepository,
    watcher: normativeWatcher,
    clients: clientsRepository,
    cases: casesRepository,
    sources: deps.normativeSources,
    aiConfigured: llm !== null,
    autoRun: deps.normativeAutoRun ?? true,
    ...(deps.now && { now: deps.now }),
  });
  const draftsRepository = new DraftsRepository(db);
  const draftsService = new DraftsService({
    repository: draftsRepository,
    documents: documentsRepository,
    clients: clientsRepository,
    reader: documentTextReader,
    rag: ragService,
    llm,
    interactions: interactionsRepository,
    logger,
  });

  const hearingsService = new HearingsService({
    repository: new HearingsRepository(db),
    simulator: new HearingSimulator({ llm, interactions: interactionsRepository, logger }),
    cases: casesRepository,
    drafts: draftsRepository,
    documents: documentsRepository,
    reader: documentTextReader,
    logger,
  });

  const estimatesService = new EstimatesService({ repository: new EstimatesRepository(db), cases: casesRepository });
  const estimateAnalysis = new EstimateAnalysisService({ rag: ragService, cases: casesRepository, llm, interactions: interactionsRepository, logger });

  const authController = new AuthController(deps.auth ? new AuthService(deps.auth, deps.now ? () => deps.now!().getTime() : undefined) : null, logger);

  const app = express();
  app.disable('x-powered-by');
  // In Docker two proxies (Caddy and nginx) stand in front of the API: TRUST_PROXY_HOPS says how many, so the address
  // of whoever asks (and the limit of login attempts) is the real one. Without it only the local machine is trusted.
  app.set('trust proxy', deps.trustProxyHops ?? 'loopback');

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
  // The documentation of the API is for whoever is logged in.
  app.use(['/api/openapi.json', '/api/docs'], authController.requireSession);
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
      // The pages poll (documents being indexed, the bulletin check, the health check): that is normal use, not abuse.
      limit: 3000,
      skip: (req) => req.path === '/health',
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMIT', message: 'Demasiadas solicitudes. Esperá unos minutos.' } },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter({ db, embeddings, llm }));
  // What changes things only accepts requests that come from this system's own pages.
  app.use('/api', requireSameOrigin(deps.corsOrigin));
  app.use('/api/auth', authRouter(authController, deps.loginAttempts));
  // Everything below needs an open session (the health check and the login above do not).
  app.use('/api', authController.requireSession);
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
  app.use('/api/normativa', normativeRouter(new NormativeController(normativeService)));
  app.use('/api/drafts', draftsRouter(new DraftsController(draftsService)));
  app.use('/api/hearings', hearingsRouter(new HearingsController(hearingsService), deps.hearingLimits));
  app.use('/api/estimates', estimatesRouter(new EstimatesController(estimatesService, estimateAnalysis)));
  app.use('/api/interactions', interactionsRouter(new InteractionsController(interactionsRepository)));

  app.use(notFoundHandler);
  app.use(errorHandler({ maxUploadMb: deps.maxUploadMb }));

  return { app, queue, documentsService, deadlineWatcher, normativeWatcher };
}
