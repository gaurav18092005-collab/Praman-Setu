import pino from 'pino';
import { isProduction, isTest } from './config';

export const logger = pino({
  level: isTest ? 'silent' : isProduction ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.phone',
      'req.body.email',
      'req.body.code',
      'req.body.refreshToken',
      'phone',
      'email',
      'code',
      'refreshToken',
      'password',
    ],
    censor: '[redacted]',
  },
  base: { app: 'pramansetu-api' },
});
