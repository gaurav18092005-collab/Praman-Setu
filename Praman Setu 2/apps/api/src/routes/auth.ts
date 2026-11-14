import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  mfaCodeSchema,
  otpRequestSchema,
  verifyOtpSchema,
  type Locale,
  LOCALES,
} from '@pramansetu/shared';
import {
  authenticate,
  clearRefreshCookie,
  createSession,
  isAdmin,
  isMfaEnabled,
  listSessions,
  optionalAuth,
  readRefreshCookie,
  requestMeta,
  requestOtp,
  revokeAllSessions,
  revokeRefreshToken,
  revokeSession,
  rotateRefreshToken,
  setRefreshCookie,
  setupMfa,
  signAccessToken,
  verifyMfa,
  verifyOtp,
  type AuthOptions,
} from '../auth';
import { demoLogin, demoLoginSchema } from '../demo';
import { ApiError, asyncHandler } from '../errors';
import { config, isProduction, isTest } from '../config';
import type { Store } from '../store';
import { publicUser } from '../utils';

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
};

function requestLocale(req: { headers: Record<string, string | string[] | undefined> }): Locale {
  const raw = req.headers['accept-language'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const first = value?.split(',')[0]?.trim().slice(0, 2).toLowerCase();
  return LOCALES.includes(first as Locale) ? (first as Locale) : 'en';
}

function limiter(name: string, windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    keyGenerator: (req) => `${name}:${req.ip ?? 'unknown'}`,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many requests. Please wait and try again.',
          retryAfterSeconds: Math.ceil(windowMs / 1000),
        },
      });
    },
  });
}

export function authRouter(store: Store, options: AuthOptions = {}): Router {
  const router = Router();
  router.use(noStore);

  const requestLimiter = limiter('otp-request', 15 * 60_000, 12);
  const verifyLimiter = limiter('otp-verify', 15 * 60_000, 30);
  const refreshLimiter = limiter('refresh', 15 * 60_000, 60);
  const mfaLimiter = limiter('mfa', 15 * 60_000, 15);

  router.get('/health', (_req, res) => {
    res.json({ ok: true, store: store.kind });
  });

  router.post(
    '/request-otp',
    requestLimiter,
    optionalAuth,
    asyncHandler(async (req, res) => {
      const input = otpRequestSchema.parse(req.body);
      if (input.purpose === 'admin_stepup') {
        throw new ApiError(400, 'That action needs an authenticator code.', 'otp_purpose_invalid');
      }
      if (input.purpose !== 'login' && !req.user) {
        throw new ApiError(401, 'Please sign in to continue.', 'auth_required');
      }
      const result = await requestOtp(
        store,
        { ...input, locale: input.locale ?? requestLocale(req) },
        options,
        requestMeta(req, config.otpPepper),
      );
      res.status(200).json(result);
    }),
  );

  router.post(
    '/verify-otp',
    verifyLimiter,
    asyncHandler(async (req, res) => {
      const input = verifyOtpSchema.parse(req.body);
      // Public OTP verification only signs people in. Destructive actions are
      // consumed by their authenticated account routes, so a purpose-bound
      // code can never mint a session or skip admin MFA.
      if (input.purpose !== 'login') {
        throw new ApiError(400, 'That code is not valid for this action.', 'otp_purpose_invalid');
      }
      const result = await verifyOtp(
        store,
        { ...input, locale: input.locale ?? requestLocale(req) },
        requestMeta(req, config.otpPepper),
      );
      setRefreshCookie(res, result.refreshToken);
      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        mfaRequired: result.mfaRequired,
        mfaEnabled: Boolean(result.user.mfaEnabled),
        expiresInSeconds: 12 * 60,
      });
    }),
  );

  router.post(
    '/refresh',
    refreshLimiter,
    asyncHandler(async (req, res) => {
      const token = readRefreshCookie(req);
      if (!token) throw new ApiError(401, 'Please sign in again.', 'invalid_refresh');
      const result = await rotateRefreshToken(
        store,
        token,
        requestMeta(req, config.otpPepper),
      );
      setRefreshCookie(res, result.refreshToken);
      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        mfaRequired: result.mfaRequired,
        mfaEnabled: Boolean(result.user.mfaEnabled),
        expiresInSeconds: 12 * 60,
      });
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const token = readRefreshCookie(req);
      if (token) await revokeRefreshToken(store, token);
      clearRefreshCookie(res);
      res.status(204).send();
    }),
  );

  router.get(
    '/me',
    authenticate,
    asyncHandler(async (req, res) => {
      if (!req.user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      res.json({
        user: publicUser(req.user),
        mfaRequired: isAdmin(req.user.role) && !req.session?.mfa,
        mfaEnabled: isMfaEnabled(req.user),
      });
    }),
  );

  router.get(
    '/sessions',
    authenticate,
    asyncHandler(async (req, res) => {
      if (!req.user || !req.session) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const sessions = await listSessions(store, req.user.id, req.session.id);
      res.json({
        sessions: sessions.map((session) => ({
          ...session,
          device: describeDevice(session.userAgent),
          ipMasked: session.ipHash ? `hash:${session.ipHash.slice(0, 8)}` : 'unknown',
        })),
      });
    }),
  );

  router.delete(
    '/sessions/:id',
    authenticate,
    asyncHandler(async (req, res) => {
      if (!req.user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const revoked = await revokeSession(store, req.user.id, req.params.id);
      if (!revoked) throw new ApiError(404, 'Session not found.', 'session_not_found');
      if (req.session?.id === req.params.id) clearRefreshCookie(res);
      res.status(204).send();
    }),
  );

  router.post(
    '/logout-all',
    authenticate,
    asyncHandler(async (req, res) => {
      if (!req.user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      await revokeAllSessions(store, req.user.id);
      clearRefreshCookie(res);
      res.status(204).send();
    }),
  );

  router.post(
    '/mfa/setup',
    authenticate,
    mfaLimiter,
    asyncHandler(async (req, res) => {
      if (!req.user) throw new ApiError(401, 'Please sign in.', 'auth_required');
      const result = await setupMfa(store, req.user);
      res.json(result);
    }),
  );

  router.post(
    '/mfa/verify',
    authenticate,
    mfaLimiter,
    asyncHandler(async (req, res) => {
      if (!req.user || !req.session) {
        throw new ApiError(401, 'Please sign in.', 'auth_required');
      }
      const { code } = mfaCodeSchema.parse(req.body);
      const result = await verifyMfa(store, req.user, req.session, code);
      const refreshed = await store.users.get(req.user.id);
      if (!refreshed) throw new ApiError(401, 'Please sign in.', 'auth_required');
      // Re-sign the access token so it carries mfa=true immediately.
      const session = await store.refreshTokens.get(req.session.id);
      if (!session) throw new ApiError(401, 'Please sign in again.', 'session_revoked');
      res.json({
        user: publicUser(refreshed),
        accessToken: signAccessToken(refreshed, session.id, session.mfa),
        mfaRequired: false,
        recoveryCodesRemaining: result.recoveryCodesRemaining,
      });
    }),
  );

  router.post(
    '/step-up',
    authenticate,
    mfaLimiter,
    asyncHandler(async (req, res) => {
      if (!req.user || !req.session) {
        throw new ApiError(401, 'Please sign in.', 'auth_required');
      }
      const { code } = mfaCodeSchema.parse(req.body);
      await verifyMfa(store, req.user, req.session, code, { stepUp: true });
      res.json({ ok: true, expiresInSeconds: 15 * 60 });
    }),
  );

  router.post(
    '/demo-login',
    asyncHandler(async (req, res) => {
      if (!config.enableDemoLogin || isProduction) {
        throw new ApiError(404, 'Not found', 'not_found');
      }
      const input = demoLoginSchema.parse(req.body ?? {});
      const user = await demoLogin(store, input.role);
      const session = await createSession(store, user, {
        ...requestMeta(req, config.otpPepper),
        mfa: user.role === 'user',
      });
      setRefreshCookie(res, session.refreshToken);
      res.json({
        user: session.user,
        accessToken: session.accessToken,
        mfaRequired: session.mfaRequired,
        mfaEnabled: Boolean(session.user.mfaEnabled),
      });
    }),
  );

  return router;
}

function describeDevice(userAgent: string): string {
  if (!userAgent || userAgent === 'unknown') return 'Unknown device';
  if (/android/i.test(userAgent)) return 'Android device';
  if (/iphone|ipad|ios/i.test(userAgent)) return 'iPhone or iPad';
  if (/windows/i.test(userAgent)) return 'Windows computer';
  if (/macintosh|mac os/i.test(userAgent)) return 'Mac';
  if (/linux/i.test(userAgent)) return 'Linux computer';
  return 'Browser';
}
