import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config, corsOrigins, isProduction, isTest } from './config';
import { rejectAadhaar, sanitizeKeys, errorHandler, notFoundHandler } from './errors';
import { logger } from './logger';
import { csrfProtection } from './security';
import { seedStore } from './seed';
import type { AuthOptions } from './auth';
import { createStore, type Store } from './store';
import { adminRouter } from './routes/admin';
import { applicationsRouter, notificationsRouter } from './routes/applications';
import { authRouter } from './routes/auth';
import { contentRouter } from './routes/content';
import { eligibilityRouter } from './routes/eligibility';
import { accountRouter, profilesRouter } from './routes/profiles';
import { schemesRouter } from './routes/schemes';
import { speechRouter } from './routes/speech';

export interface CreateAppOptions {
  store?: Store;
  persist?: boolean;
  seed?: boolean;
  includeDemoUsers?: boolean;
  /** Test-only deterministic OTP; never read from environment variables. */
  codeGenerator?: AuthOptions['codeGenerator'];
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<{ app: Express; store: Store }> {
  const store = options.store ?? (await createStore({ persist: options.persist }));
  if (options.seed !== false) {
    await seedStore(store, {
      includeDemoUsers:
        options.includeDemoUsers ?? (config.seedDemo && !isProduction && config.enableDemoLogin),
    });
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals.store = store;

  app.use((req, res, next) => {
    const id = req.headers['x-request-id']?.toString() || randomUUID();
    res.setHeader('x-request-id', id);
    next();
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", ...corsOrigins],
          fontSrc: ["'self'", 'data:'],
          mediaSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      hsts: isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: config.hstsPreload }
        : false,
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (corsOrigins.includes(origin.replace(/\/$/, ''))) return callback(null, true);
        return callback(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept-Language',
        'X-Requested-With',
        'X-CSRF-Token',
      ],
      credentials: true,
      maxAge: 86400,
    }),
  );
  app.use(csrfProtection);
  app.use(express.json({ limit: '100kb' }));
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeKeys(req.body);
    }
    next();
  });
  app.use(rejectAadhaar);
  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/api/health',
      },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url, id: req.id }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => isTest,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      store: store.kind,
      env: config.env,
      time: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRouter(store, { codeGenerator: options.codeGenerator }));
  app.use('/api/profiles', profilesRouter(store));
  app.use('/api/account', accountRouter(store));
  app.use('/api/eligibility', eligibilityRouter(store));
  app.use('/api/schemes', schemesRouter(store));
  app.use('/api/applications', applicationsRouter(store));
  app.use('/api/notifications', notificationsRouter(store));
  app.use('/api/speech', speechRouter());
  app.use('/api/admin', adminRouter(store));
  app.use('/api', contentRouter(store));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, store };
}
