/**
 * Errors that are safe to show to the user. The central error handler turns them
 * into JSON responses; anything else becomes a generic 500.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'No se encontró el recurso solicitado') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(code: string, message: string) {
    super(503, code, message);
  }
}

/** Failures talking to an external AI provider (bad key, no credit, network...). */
export class UpstreamError extends AppError {
  constructor(code: string, message: string, statusCode = 502) {
    super(statusCode, code, message);
  }
}

/**
 * The message of a failure as it may be stored in the history of interactions: only those written for the
 * user. Anything else (a library error, a Prisma error, an SDK message) could repeat part of the case.
 */
export function safeErrorMessage(error: unknown): string {
  return error instanceof AppError ? error.message : 'Error interno';
}

/** The request comes from somewhere it should not (see the same-origin check). */
export class ForbiddenError extends AppError {
  constructor(message = 'No tenés permiso para hacer esto') {
    super(403, 'FORBIDDEN', message);
  }
}

/** No session, or it expired: the screen asks for the password again. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Iniciá sesión para continuar') {
    super(401, 'UNAUTHORIZED', message);
  }
}
