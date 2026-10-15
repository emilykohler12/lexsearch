import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import type { DeadlinesController } from './deadlines.controller.js';

export function deadlinesRouter(controller: DeadlinesController, options: { tmpDir: string; maxUploadBytes: number }) {
  // Each analysis is a call to the model: keep bursts in check.
  const analyzeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Demasiados análisis seguidos. Esperá un minuto.' } },
  });

  // One document at a time; it is read and deleted, not kept.
  const upload = multer({
    dest: options.tmpDir,
    limits: { fileSize: options.maxUploadBytes, files: 1, fields: 5 },
    defParamCharset: 'utf8',
  });

  const router = Router();
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.post('/batch', controller.createBatch);
  router.post('/calculate', controller.calculate);
  router.post('/analyze', analyzeLimiter, upload.single('file'), controller.analyze);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.delete);
  return router;
}
