import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import type { DocumentsController } from './documents.controller.js';

export const MAX_FILES_PER_UPLOAD = 20;

// The browsers' built-in PDF viewers can be blocked by helmet's `object-src 'none'`.
// Originals are served with their exact Content-Type plus `nosniff` (both set elsewhere),
// so the browser never runs them as a page even without a CSP.
const allowPdfViewer: RequestHandler = (_req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  next();
};

export function documentsRouter(controller: DocumentsController, options: { tmpDir: string; maxUploadBytes: number }) {
  const upload = multer({
    dest: options.tmpDir,
    limits: { fileSize: options.maxUploadBytes, files: MAX_FILES_PER_UPLOAD, fields: 10 },
    // Spanish file names ("Contestación_demanda.pdf") arrive as UTF-8.
    defParamCharset: 'utf8',
  });

  const router = Router();
  router.get('/', controller.list);
  router.post('/', upload.array('files', MAX_FILES_PER_UPLOAD), controller.upload);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.delete);
  router.get('/:id/file', allowPdfViewer, controller.downloadFile);
  router.post('/:id/reprocess', controller.reprocess);
  return router;
}
