import type { RequestHandler } from 'express';
import { ForbiddenError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defense in depth against a page of another site sending requests that change things on behalf of the lawyer
 * (the cookie is already SameSite=Strict): a browser always says where a POST, PATCH or DELETE comes from
 * (the Origin header), and only this system's own address is accepted. Requests with no Origin (curl, the CI, other
 * programs) are not browsers and have no cookie of the lawyer to abuse.
 */
export function requireSameOrigin(allowedOrigin: string): RequestHandler {
  const hostOf = (value: string): string | null => {
    try {
      return new URL(value).host;
    } catch {
      return null;
    }
  };
  const allowedHost = hostOf(allowedOrigin);

  return (req, _res, next) => {
    const origin = req.get('origin');
    if (SAFE_METHODS.has(req.method) || origin === undefined) return next();
    const host = hostOf(origin);
    // The configured address, or the one the request was addressed to (the system opened by its own name or address).
    if (host !== null && (host === allowedHost || host === req.get('host'))) return next();
    throw new ForbiddenError('El pedido viene de otro sitio y no se acepta.');
  };
}
