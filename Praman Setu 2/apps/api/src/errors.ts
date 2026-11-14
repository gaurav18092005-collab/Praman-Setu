import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`, 'not_found'));
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Please check the information you entered.',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  // Duplicate key from MongoDB
  if (typeof error === 'object' && error && (error as { code?: number }).code === 11000) {
    res.status(409).json({
      error: { code: 'duplicate', message: 'This record already exists.' },
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected error';
  logger.error({ err: error, path: req.originalUrl }, 'Unhandled request error');
  res.status(500).json({
    error: {
      code: 'server_error',
      message: 'Something went wrong on our side. Please try again.',
    },
  });
  void message;
}

/** Strips keys that could be used for NoSQL injection. */
export function sanitizeKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sanitizeKeys(item)) as unknown as T;
  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith('$') || key.includes('.')) continue;
      clean[key] = sanitizeKeys(entry);
    }
    return clean as T;
  }
  return value;
}

/**
 * We never accept Aadhaar numbers. This catches both a dedicated field and a
 * 12-digit number inside free text before it reaches storage or logs.
 */
export function containsAadhaarLike(value: unknown): boolean {
  if (typeof value === 'string') {
    return /\b\d{4}\s?\d{4}\s?\d{4}\b/.test(value);
  }
  if (Array.isArray(value)) return value.some(containsAadhaarLike);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
      if (/aadhaar|aadhar|uidai/i.test(key)) return true;
      return containsAadhaarLike(entry);
    });
  }
  return false;
}

export function rejectAadhaar(req: Request, _res: Response, next: NextFunction): void {
  if (containsAadhaarLike(req.body)) {
    next(
      new ApiError(
        400,
        'Please do not enter an Aadhaar number. Pramansetu never asks for or stores it.',
        'aadhaar_rejected',
      ),
    );
    return;
  }
  next();
}
