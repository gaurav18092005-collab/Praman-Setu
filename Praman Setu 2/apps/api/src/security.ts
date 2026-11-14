import type { NextFunction, Request, Response } from 'express';
import { corsOrigins, isProduction, isTest } from './config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cookie-authenticated requests need an Origin match and a custom header.
 * A cross-site form cannot set X-Requested-With, and CORS blocks the fetch.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (isTest || SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (origin && !corsOrigins.includes(origin.replace(/\/$/, ''))) {
    res.status(403).json({
      error: { code: 'csrf_failed', message: 'This request could not be verified.' },
    });
    return;
  }
  if (!origin && isProduction) {
    res.status(403).json({
      error: { code: 'csrf_failed', message: 'This request could not be verified.' },
    });
    return;
  }
  const requestedWith = req.headers['x-requested-with'];
  const csrfToken = req.headers['x-csrf-token'];
  if (!requestedWith && !csrfToken) {
    res.status(403).json({
      error: { code: 'csrf_failed', message: 'This request could not be verified.' },
    });
    return;
  }
  next();
}
