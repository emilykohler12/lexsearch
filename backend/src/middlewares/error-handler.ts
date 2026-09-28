import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { AppError, NotFoundError } from '../lib/errors.js';

export function errorHandler(options: { maxUploadMb: number }): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) },
      });
      return;
    }

    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      const message = tooLarge
        ? `Uno de los archivos supera el máximo de ${options.maxUploadMb} MB`
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'Demasiados archivos en una sola subida'
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Los archivos deben enviarse en el campo "files"'
            : 'No se pudo procesar la subida de archivos';
      res.status(tooLarge ? 413 : 400).json({ error: { code: err.code, message } });
      return;
    }

    // body-parser errors (malformed JSON, body too large) carry a status and a type.
    const status = (err as { status?: number; type?: string }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const type = (err as { type?: string }).type;
      const message =
        type === 'entity.parse.failed'
          ? 'El cuerpo de la solicitud no es un JSON válido'
          : type === 'entity.too.large'
            ? 'La solicitud es demasiado grande'
            : 'Solicitud inválida';
      res.status(status).json({ error: { code: 'BAD_REQUEST', message } });
      return;
    }

    req.log.error({ err }, 'Unhandled error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado. Revisá los logs del servidor.' },
    });
  };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('La ruta solicitada no existe'));
};
