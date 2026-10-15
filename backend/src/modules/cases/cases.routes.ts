import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import type { CasesController } from './cases.controller.js';

export function casesRouter(controller: CasesController, options: { tmpDir: string; maxUploadBytes: number }) {
  // Each reading is a call to the model: keep bursts in check.
  const analyzeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Demasiados análisis seguidos. Esperá un minuto.' } },
  });

  // One file at a time; it is read and deleted, not kept.
  const upload = multer({
    dest: options.tmpDir,
    limits: { fileSize: options.maxUploadBytes, files: 1, fields: 5 },
    defParamCharset: 'utf8',
  });

  const router = Router();
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.delete);
  router.get('/:id/timeline', controller.timeline);
  router.post('/:id/proceedings', controller.createProceeding);
  router.post('/:id/proceedings/batch', controller.createProceedings);
  router.post('/:id/proceedings/analyze', analyzeLimiter, upload.single('file'), controller.analyze);
  router.patch('/:id/proceedings/:proceedingId', controller.updateProceeding);
  router.delete('/:id/proceedings/:proceedingId', controller.deleteProceeding);
  return router;
}
