import { describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({
  corsOrigins: ['https://app.example'],
  isProduction: true,
  isTest: false,
}));

import type { NextFunction, Request, Response } from 'express';
import { csrfProtection } from './security';

function response() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  } as unknown as Response & { statusCode: number; body: unknown };
}

describe('CSRF protection', () => {
  it('rejects a foreign Origin with a custom header', () => {
    const req = {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'x-requested-with': 'XMLHttpRequest',
      },
    } as unknown as Request;
    const res = response();
    const next = vi.fn() as NextFunction;
    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'csrf_failed' } });
  });

  it('rejects an Origin-less production POST', () => {
    const req = {
      method: 'POST',
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    } as unknown as Request;
    const res = response();
    const next = vi.fn() as NextFunction;
    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('rejects requests without the custom header', () => {
    const req = {
      method: 'POST',
      headers: { origin: 'https://app.example' },
    } as unknown as Request;
    const res = response();
    const next = vi.fn() as NextFunction;
    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('allows a same-origin request with the custom header and safe methods', () => {
    const req = {
      method: 'POST',
      headers: {
        origin: 'https://app.example',
        'x-requested-with': 'XMLHttpRequest',
      },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;
    csrfProtection(req, response(), next);
    expect(next).toHaveBeenCalledOnce();

    const get = { method: 'GET', headers: {} } as unknown as Request;
    const getNext = vi.fn() as NextFunction;
    csrfProtection(get, response(), getNext);
    expect(getNext).toHaveBeenCalledOnce();
  });
});
