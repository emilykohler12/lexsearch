import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { EmbeddingProvider } from '../embeddings/embedding-provider.js';
import type { LlmProvider } from '../llm/llm-provider.js';

interface HealthDeps {
  db: PrismaClient;
  embeddings: EmbeddingProvider;
  llm: LlmProvider | null;
}

/** Lets the UI tell the lawyer what works right now (e.g. "falta la API key de Gemini"). */
export function healthRouter({ db, embeddings, llm }: HealthDeps) {
  const router = Router();
  router.get('/', async (_req, res) => {
    let database: 'ok' | 'error' = 'ok';
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }
    res.status(database === 'ok' ? 200 : 503).json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      embeddings: { model: embeddings.modelName, status: embeddings.status() },
      llm: llm ? { configured: true, provider: llm.providerName, model: llm.model } : { configured: false },
    });
  });
  return router;
}
