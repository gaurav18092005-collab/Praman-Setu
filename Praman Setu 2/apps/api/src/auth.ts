import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import {
  DEFAULT_TRANSLATIONS,
  flattenTranslations,
  type Locale,
  type PublicUser,
} from '@pramansetu/shared';
import { config, isProduction } from './config';
import { ApiError } from './errors';
import { logger } from './logger';
import type {
  AuthAttemptDoc,
  OtpDoc,
  OtpPurpose,
  SessionDoc,
  Store,
  UserDoc,
} from './store';
import { newId, sha256 } from './store';
import { identifierOf, maskEmail, maskPhone, normalisePhone, publicUser } from './utils';

export type AuthRole = UserDoc['role'];

const EDITOR_ROLES: AuthRole[] = ['editor', 'admin', 'superadmin'];
const ADMIN_ROLES: AuthRole[] = ['viewer', 'editor', 'admin', 'superadmin'];
const STEP_UP_MINUTES = 15;

export function canEdit(role: AuthRole): boolean {
  return EDITOR_ROLES.includes(role);
}

export function isAdminRole(role: AuthRole): boolean {
  return ADMIN_ROLES.includes(role);
}

export function isAdmin(role: AuthRole): boolean {
  return isAdminRole(role);
}

export interface AccessPayload {
  sub: string;
  role: UserDoc['role'];
  sid: string;
  tv: number;
  mfa: boolean;
  type: 'access';
  jti: string;
  iss: string;
  aud: string;
}

export interface AuthMeta {
  ipHash: string;
  userAgent: string;
}

export interface AuthOptions {
  /** Tests inject a deterministic code. Never expose this through env. */
  codeGenerator?: (input: { identifier: string; purpose: OtpPurpose }) => string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  session: SessionDoc;
  user: PublicUser;
  mfaRequired: boolean;
}

export function signAccessToken(
  user: UserDoc,
  sessionId: string,
  mfa: boolean,
): string {
  const payload: Omit<AccessPayload, 'jti' | 'iss' | 'aud'> = {
    sub: user.id,
    role: user.role,
    sid: sessionId,
    tv: user.tokenVersion ?? 0,
    mfa,
    type: 'access',
  };
  return jwt.sign(payload, config.accessSecret, {
    expiresIn: config.accessTtl as jwt.SignOptions['expiresIn'],
    issuer: config.appOrigin,
    audience: 'pramansetu-web',
    jwtid: newId(),
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  try {
    const payload = jwt.verify(token, config.accessSecret, {
      issuer: config.appOrigin,
      audience: 'pramansetu-web',
    }) as AccessPayload;
    if (payload.type !== 'access' || !payload.sid) throw new Error('wrong token type');
    return payload;
  } catch {
    throw new ApiError(401, 'Your session has expired. Please sign in again.', 'session_expired');
  }
}

export function tokenHash(token: string): string {
  return createHmac('sha256', config.refreshSecret).update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function otpHash(
  otpId: string,
  identifier: string,
  purpose: OtpPurpose,
  code: string,
): string {
  return createHmac('sha256', config.otpPepper)
    .update(`${otpId}:${identifier}:${purpose}:${code}`)
    .digest('hex');
}

export function hashIdentifier(identifier: string): string {
  return createHmac('sha256', config.otpPepper)
    .update(`identifier:${identifier}`)
    .digest('hex')
    .slice(0, 32);
}

function nowIso(): string {
  return new Date().toISOString();
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

export function requestMeta(req: Request, salt: string): AuthMeta {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || req.ip;
  return {
    ipHash: createHmac('sha256', salt).update(ip || 'unknown').digest('hex').slice(0, 32),
    userAgent: (req.headers['user-agent'] ?? 'unknown').slice(0, 240),
  };
}

export async function auditAuth(
  store: Store,
  action: string,
  input: {
    userId?: string;
    identifier?: string;
    ipHash?: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await store.auditLogs.insert({
    id: newId(),
    actorId: input.userId ?? 'system',
    actorName: input.identifier
      ? `auth:${hashIdentifier(input.identifier).slice(0, 10)}`
      : 'auth:system',
    action,
    entity: 'auth',
    entityId: input.identifier ? hashIdentifier(input.identifier) : 'system',
    after: input.detail,
    at: nowIso(),
    ipHash: input.ipHash ?? '',
  });
}

async function currentSession(
  store: Store,
  userId: string,
  sessionId: string,
): Promise<SessionDoc | null> {
  const session = await store.refreshTokens.get(sessionId);
  if (!session || session.userId !== userId || session.revokedAt) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  if (new Date(session.absoluteExpiresAt).getTime() <= Date.now()) return null;
  return session;
}

async function revokeFamily(store: Store, familyId: string): Promise<void> {
  const sessions = await store.refreshTokens.find((doc) => doc.familyId === familyId);
  for (const session of sessions) {
    if (!session.revokedAt) {
      await store.refreshTokens.updateAtomic(
        { id: session.id, revokedAt: null },
        { revokedAt: nowIso() },
      );
    }
  }
}

async function revokeOldestSessions(store: Store, userId: string): Promise<void> {
  const sessions = await store.refreshTokens.find(
    (doc) => doc.userId === userId && !doc.revokedAt,
  );
  if (sessions.length <= config.maxSessions) return;
  const oldest = sessions
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(config.maxSessions);
  for (const session of oldest) {
    await store.refreshTokens.updateAtomic(
      { id: session.id, revokedAt: null },
      { revokedAt: nowIso() },
    );
  }
}

export async function createSession(
  store: Store,
  user: UserDoc,
  input: AuthMeta & {
    mfa?: boolean;
    familyId?: string;
    absoluteExpiresAt?: string;
    lastReauthAt?: string;
  },
): Promise<IssuedSession> {
  const now = new Date();
  const sessionId = newId();
  const familyId = input.familyId ?? sessionId;
  const refreshToken = randomBytes(32).toString('base64url');
  const mfa = input.mfa ?? !isAdmin(user.role);
  const lastReauthAt = input.lastReauthAt ?? (mfa ? now.toISOString() : now.toISOString());
  const session: SessionDoc = {
    id: sessionId,
    userId: user.id,
    familyId,
    tokenVersion: user.tokenVersion ?? 0,
    tokenHash: tokenHash(refreshToken),
    mfa,
    lastReauthAt,
    createdAt: nowIso(),
    lastUsedAt: nowIso(),
    expiresAt: addDays(now, config.sessionIdleDays).toISOString(),
    absoluteExpiresAt:
      input.absoluteExpiresAt ?? addDays(now, config.sessionAbsoluteDays).toISOString(),
    revokedAt: null,
    replacedBy: null,
    ipHash: input.ipHash,
    userAgent: input.userAgent,
  };
  await store.refreshTokens.insert(session);
  await revokeOldestSessions(store, user.id);
  return {
    accessToken: signAccessToken(user, session.id, session.mfa),
    refreshToken,
    session,
    user: publicUser(user),
    mfaRequired: isAdmin(user.role) && !session.mfa,
  };
}

/** Backwards-compatible wrapper used by tests and internal callers. */
export async function issueTokens(
  store: Store,
  user: UserDoc,
  meta: AuthMeta = { ipHash: '', userAgent: 'unknown' },
): Promise<IssuedSession> {
  return createSession(store, user, meta);
}

export async function rotateRefreshToken(
  store: Store,
  token: string,
  meta: AuthMeta = { ipHash: '', userAgent: 'unknown' },
): Promise<IssuedSession> {
  const hash = tokenHash(token);
  const stored = await store.refreshTokens.findOne((doc) => doc.tokenHash === hash);
  if (!stored) {
    throw new ApiError(401, 'Please sign in again.', 'invalid_refresh');
  }
  if (stored.revokedAt) {
    await revokeFamily(store, stored.familyId);
    await auditAuth(store, 'refresh_reuse_detected', {
      userId: stored.userId,
      ipHash: meta.ipHash,
      detail: { familyId: stored.familyId },
    });
    throw new ApiError(401, 'Please sign in again.', 'refresh_reused');
  }
  if (new Date(stored.expiresAt).getTime() <= Date.now()) {
    throw new ApiError(401, 'Please sign in again.', 'refresh_expired');
  }
  if (new Date(stored.absoluteExpiresAt).getTime() <= Date.now()) {
    throw new ApiError(401, 'Please sign in again.', 'refresh_expired');
  }
  const user = await store.users.get(stored.userId);
  if (!user || user.status !== 'active') {
    throw new ApiError(401, 'Please sign in again.', 'user_not_found');
  }
  if ((user.tokenVersion ?? 0) !== (stored.tokenVersion ?? 0)) {
    await revokeFamily(store, stored.familyId);
    throw new ApiError(401, 'Please sign in again.', 'session_revoked');
  }

  const replacementId = newId();
  const rotated = await store.refreshTokens.updateAtomic(
    { id: stored.id, revokedAt: null },
    { revokedAt: nowIso(), replacedBy: replacementId, lastUsedAt: nowIso() },
  );
  if (!rotated) {
    await revokeFamily(store, stored.familyId);
    await auditAuth(store, 'refresh_reuse_detected', {
      userId: stored.userId,
      ipHash: meta.ipHash,
      detail: { familyId: stored.familyId },
    });
    throw new ApiError(401, 'Please sign in again.', 'refresh_reused');
  }
  return createSession(store, user, {
    ...meta,
    mfa: stored.mfa,
    familyId: stored.familyId,
    absoluteExpiresAt: stored.absoluteExpiresAt,
    lastReauthAt: stored.lastReauthAt,
  });
}

export async function revokeRefreshToken(store: Store, token: string): Promise<void> {
  const hash = tokenHash(token);
  const stored = await store.refreshTokens.findOne((doc) => doc.tokenHash === hash);
  if (stored && !stored.revokedAt) {
    await store.refreshTokens.updateAtomic(
      { id: stored.id, revokedAt: null },
      { revokedAt: nowIso() },
    );
  }
}

export async function revokeSession(
  store: Store,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const session = await store.refreshTokens.get(sessionId);
  if (!session || session.userId !== userId) return false;
  const updated = await store.refreshTokens.updateAtomic(
    { id: sessionId, revokedAt: null },
    { revokedAt: nowIso() },
  );
  return Boolean(updated);
}

export async function revokeAllSessions(store: Store, userId: string): Promise<void> {
  const user = await store.users.get(userId);
  if (user) {
    await store.users.update(userId, { tokenVersion: (user.tokenVersion ?? 0) + 1 });
  }
  const sessions = await store.refreshTokens.find(
    (doc) => doc.userId === userId && !doc.revokedAt,
  );
  for (const session of sessions) {
    await store.refreshTokens.updateAtomic(
      { id: session.id, revokedAt: null },
      { revokedAt: nowIso() },
    );
  }
}

export async function listSessions(
  store: Store,
  userId: string,
  currentId?: string,
): Promise<
  Array<{
    id: string;
    current: boolean;
    mfa: boolean;
    createdAt: string;
    lastUsedAt: string;
    absoluteExpiresAt: string;
    ipHash: string;
    userAgent: string;
  }>
> {
  const sessions = await store.refreshTokens.find(
    (doc) => doc.userId === userId && !doc.revokedAt,
  );
  return sessions
    .filter((doc) => new Date(doc.expiresAt).getTime() > Date.now())
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .map((session) => ({
      id: session.id,
      current: session.id === currentId,
      mfa: session.mfa,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      ipHash: session.ipHash,
      userAgent: session.userAgent,
    }));
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

function storeOf(req: Request): Store {
  const store = req.store ?? (req.app.locals.store as Store | undefined);
  if (!store) throw new ApiError(500, 'Store not configured');
  return store;
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearer(req);
  if (!token) {
    next();
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    const user = await storeOf(req).users.get(payload.sub);
    if (!user || user.status !== 'active' || (user.tokenVersion ?? 0) !== payload.tv) {
      next();
      return;
    }
    const session = await currentSession(storeOf(req), user.id, payload.sid);
    if (!session) {
      next();
      return;
    }
    req.user = user;
    req.session = session;
    req.accessPayload = payload;
  } catch {
    // Anonymous access stays available; protected routes enforce auth themselves.
  }
  next();
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearer(req);
  if (!token) {
    next(new ApiError(401, 'Please sign in to continue.', 'auth_required'));
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    const store = storeOf(req);
    const user = await store.users.get(payload.sub);
    if (!user || user.status !== 'active') {
      throw new ApiError(401, 'Please sign in again.', 'user_not_found');
    }
    if ((user.tokenVersion ?? 0) !== payload.tv) {
      throw new ApiError(401, 'Your session has ended. Please sign in again.', 'session_revoked');
    }
    const session = await currentSession(store, user.id, payload.sid);
    if (!session) {
      throw new ApiError(401, 'Your session has ended. Please sign in again.', 'session_revoked');
    }
    req.user = user;
    req.session = session;
    req.accessPayload = payload;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: AuthRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, 'Please sign in to continue.', 'auth_required'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ApiError(403, 'You do not have permission to do that.', 'forbidden'));
      return;
    }
    if (isAdmin(req.user.role) && !req.session?.mfa) {
      next(
        new ApiError(
          403,
          'Two-step verification is required for this account.',
          'mfa_required',
        ),
      );
      return;
    }
    next();
  };
}

export const requireAdminRead = requireRole(...ADMIN_ROLES);
export const requireAdminWrite = requireRole(...EDITOR_ROLES);
export const requireSuperAdmin = requireRole('superadmin');

export function requireStepUp(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.session) {
    next(new ApiError(401, 'Please sign in to continue.', 'auth_required'));
    return;
  }
  const last = new Date(req.session.lastReauthAt).getTime();
  if (!Number.isFinite(last) || Date.now() - last > STEP_UP_MINUTES * 60_000) {
    next(
      new ApiError(
        403,
        'Please confirm your identity again to make this change.',
        'step_up_required',
      ),
    );
    return;
  }
  next();
}

export interface OtpDelivery {
  send(input: {
    identifier: string;
    channel: 'phone' | 'email';
    code: string;
    locale: Locale;
  }): Promise<void>;
}

const consoleDelivery: OtpDelivery = {
  async send({ identifier, channel, code }) {
    if (isProduction) {
      throw new ApiError(503, 'OTP delivery is not configured.', 'otp_provider_missing');
    }
    const masked = channel === 'phone' ? `+91••••••${identifier.slice(-4)}` : maskEmail(identifier);
    // The one permitted code log: development console provider only.
    logger.info(`OTP for ${masked}: ${code}`);
  },
};

function requireSetting(name: string, value: string | undefined): string {
  if (!value) {
    throw new ApiError(
      503,
      `OTP delivery is not configured. Set ${name} in the server environment.`,
      'otp_provider_missing',
    );
  }
  return value;
}

async function requestProvider(
  url: string,
  init: RequestInit,
  provider: string,
): Promise<void> {
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    logger.error({ err: error, provider }, 'OTP provider request failed');
    throw new ApiError(502, 'We could not send the code. Please try again.', 'otp_delivery_failed');
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    logger.error(
      { provider, status: response.status, detail: detail.slice(0, 500) },
      'OTP provider rejected the request',
    );
    throw new ApiError(502, 'We could not send the code. Please try again.', 'otp_delivery_failed');
  }
}

function postJson(
  url: string,
  body: Record<string, unknown>,
  provider: string,
  headers: Record<string, string> = {},
): Promise<void> {
  return requestProvider(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    provider,
  );
}

const msg91Delivery: OtpDelivery = {
  async send({ identifier, channel, code, locale }) {
    if (channel !== 'phone') {
      throw new ApiError(400, 'MSG91 delivers SMS codes only.', 'otp_channel_unsupported');
    }
    const authkey = requireSetting('MSG91_AUTH_KEY', config.msg91AuthKey);
    const templateId = requireSetting(
      `MSG91_TEMPLATE_ID_${locale.toUpperCase()}`,
      config.msg91TemplateIds[locale],
    );
    const query = new URLSearchParams({
      template_id: templateId,
      mobile: `91${identifier}`,
      authkey,
    });
    await postJson(
      `https://control.msg91.com/api/v5/otp?${query.toString()}`,
      { otp: code },
      'msg91',
    );
  },
};

const twilioDelivery: OtpDelivery = {
  async send({ identifier, channel, code, locale }) {
    if (channel !== 'phone') {
      throw new ApiError(400, 'Twilio delivers SMS codes only.', 'otp_channel_unsupported');
    }
    const accountSid = requireSetting('TWILIO_ACCOUNT_SID', config.twilioAccountSid);
    const authToken = requireSetting('TWILIO_AUTH_TOKEN', config.twilioAuthToken);
    const from = requireSetting('TWILIO_FROM', config.twilioFrom);
    const body = new URLSearchParams({
      To: `+91${identifier}`,
      From: from,
      Body: otpSmsText(locale, code),
    });
    await requestProvider(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      },
      'twilio',
    );
  },
};

const resendDelivery: OtpDelivery = {
  async send({ identifier, channel, code, locale }) {
    if (channel !== 'email') {
      throw new ApiError(
        400,
        'The email provider delivers email codes only.',
        'otp_channel_unsupported',
      );
    }
    const apiKey = requireSetting('RESEND_API_KEY', config.resendApiKey);
    const copy = otpEmailCopy(locale, code);
    await postJson(
      'https://api.resend.com/emails',
      {
        from: config.mailFrom,
        to: [identifier],
        subject: copy.subject,
        text: copy.text,
        html: copy.html,
      },
      'resend',
      { authorization: `Bearer ${apiKey}` },
    );
  },
};

const unsupportedDelivery: OtpDelivery = {
  async send() {
    throw new ApiError(
      503,
      'OTP delivery is not configured. Set a provider in the server environment.',
      'otp_provider_missing',
    );
  },
};

function deliveryForProvider(): OtpDelivery {
  switch (config.otpProvider) {
    case 'console':
      return isProduction ? unsupportedDelivery : consoleDelivery;
    case 'msg91':
      return msg91Delivery;
    case 'twilio':
      return twilioDelivery;
    case 'email':
      return resendDelivery;
    default:
      return unsupportedDelivery;
  }
}

function translationValue(locale: Locale, key: string): string {
  const en = flattenTranslations(DEFAULT_TRANSLATIONS.en);
  const tree = DEFAULT_TRANSLATIONS[locale] as unknown;
  const flat = locale === 'en' ? en : flattenTranslations(tree);
  return flat[key] || en[key] || '';
}

export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

export function otpSmsText(locale: Locale, code: string): string {
  const body = interpolate(translationValue(locale, 'otp.sms.body'), { code });
  const webotp = interpolate(translationValue(locale, 'otp.sms.webotp'), {
    code,
    domain: config.appHost,
  });
  return `${body}\n${webotp}`;
}

export function otpEmailCopy(
  locale: Locale,
  code: string,
): { subject: string; text: string; html: string } {
  const subject = interpolate(translationValue(locale, 'otp.email.subject'), { code });
  const greeting = translationValue(locale, 'otp.email.greeting');
  const body = interpolate(translationValue(locale, 'otp.email.body'), { code });
  const warning = translationValue(locale, 'otp.email.warning');
  const ignore = translationValue(locale, 'otp.email.ignore');
  const expiry = translationValue(locale, 'otp.email.expiry');
  const text = `${greeting}\n\n${body}\n${expiry}\n\n${warning}\n\n${ignore}`;
  const html = `<p>${greeting}</p><p><strong>${body}</strong></p><p>${expiry}</p><p>${warning}</p><p>${ignore}</p>`;
  return { subject, text, html };
}

export const OTP_MESSAGES: Record<Locale, string> = {
  en: 'We sent a 6-digit code. It is valid for 5 minutes.',
  hi: 'हमने 6 अंकों का कोड भेजा है। यह 5 मिनट के लिए मान्य है।',
  pa: 'ਅਸੀਂ 6 ਅੰਕਾਂ ਦਾ ਕੋਡ ਭੇਜਿਆ ਹੈ। ਇਹ 5 ਮਿੰਟ ਲਈ ਵੈਧ ਹੈ।',
  ur: 'ہم نے 6 ہندسوں کا کوڈ بھیجا ہے۔ یہ 5 منٹ کے لیے درست ہے۔',
  mr: 'आम्ही 6 अंकांचा कोड पाठवला आहे. तो 5 मिनिटांसाठी वैध आहे.',
};

export interface RequestOtpResult {
  ok: true;
  channel: 'phone' | 'email';
  expiresInSeconds: number;
  resendAfterSeconds: number;
  devCode?: string;
}

async function latestOtp(
  store: Store,
  identifier: string,
): Promise<OtpDoc | null> {
  const docs = await store.otps.find(
    (doc) => doc.identifier === identifier && !doc.consumedAt,
  );
  return docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

async function attemptRecord(
  store: Store,
  identifier: string,
): Promise<AuthAttemptDoc | null> {
  return store.authAttempts.findOne((doc) => doc.identifier === identifier);
}

function lockoutSeconds(record: AuthAttemptDoc | null): number {
  if (!record?.lockedUntil) return 0;
  return Math.max(0, Math.ceil((new Date(record.lockedUntil).getTime() - Date.now()) / 1000));
}

async function registerFailure(
  store: Store,
  identifier: string,
): Promise<{ locked: boolean; retryAfterSeconds: number; remaining: number }> {
  const now = new Date();
  const existing = await attemptRecord(store, identifier);
  const firstFailureAt = existing?.firstFailureAt ?? now.toISOString();
  const failures = (existing?.failures ?? 0) + 1;
  const lockoutCount = existing?.lockoutCount ?? 0;
  if (failures >= config.otpMaxAttempts) {
    const minutes = config.otpLockoutMinutes * Math.min(2 ** lockoutCount, 8);
    const lockedUntil = new Date(now.getTime() + minutes * 60_000).toISOString();
    if (existing) {
      await store.authAttempts.update(existing.id, {
        failures: 0,
        firstFailureAt,
        lockedUntil,
        lockoutCount: lockoutCount + 1,
        updatedAt: now.toISOString(),
      });
    } else {
      await store.authAttempts.insert({
        id: newId(),
        identifier,
        failures: 0,
        firstFailureAt,
        lockedUntil,
        lockoutCount: 1,
        updatedAt: now.toISOString(),
      });
    }
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((new Date(lockedUntil).getTime() - now.getTime()) / 1000),
      remaining: 0,
    };
  }
  if (existing) {
    await store.authAttempts.update(existing.id, {
      failures,
      lockedUntil: null,
      updatedAt: now.toISOString(),
    });
  } else {
    await store.authAttempts.insert({
      id: newId(),
      identifier,
      failures,
      firstFailureAt,
      lockedUntil: null,
      lockoutCount: 0,
      updatedAt: now.toISOString(),
    });
  }
  return {
    locked: false,
    retryAfterSeconds: 0,
    remaining: Math.max(0, config.otpMaxAttempts - failures),
  };
}

async function clearFailures(store: Store, identifier: string): Promise<void> {
  const existing = await attemptRecord(store, identifier);
  if (existing) await store.authAttempts.delete(existing.id);
}

async function enforceSendLimits(
  store: Store,
  identifier: string,
  ipHash: string,
  purpose: string,
): Promise<void> {
  const now = Date.now();
  const sends = await store.otpSends.find((doc) => doc.identifier === identifier);
  const latest = sends
    .filter((doc) => (doc.purpose ?? 'login') === purpose)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (latest) {
    const elapsed = now - new Date(latest.at).getTime();
    if (elapsed < config.otpResendSeconds * 1000) {
      throw new ApiError(
        429,
        'Please wait before asking for another code.',
        'otp_cooldown',
        {
          retryAfterSeconds: Math.ceil((config.otpResendSeconds * 1000 - elapsed) / 1000),
        },
      );
    }
  }
  const hourAgo = now - 60 * 60_000;
  const dayAgo = now - 24 * 60 * 60_000;
  const hourly = sends.filter((doc) => new Date(doc.at).getTime() > hourAgo).length;
  if (hourly >= config.otpSendsPerHour) {
    const oldest = sends
      .filter((doc) => new Date(doc.at).getTime() > hourAgo)
      .sort((a, b) => a.at.localeCompare(b.at))[0];
    throw new ApiError(429, 'Too many code requests. Please wait.', 'otp_rate_limited', {
      retryAfterSeconds: oldest
        ? Math.max(1, Math.ceil((new Date(oldest.at).getTime() + 3_600_000 - now) / 1000))
        : 3600,
    });
  }
  const daily = sends.filter((doc) => new Date(doc.at).getTime() > dayAgo).length;
  if (daily >= config.otpSendsPerDay) {
    throw new ApiError(429, 'Too many code requests. Please wait.', 'otp_rate_limited', {
      retryAfterSeconds: 3600,
    });
  }
  const all = await store.otpSends.find();
  const ipHourly = all.filter(
    (doc) => doc.ipHash === ipHash && new Date(doc.at).getTime() > hourAgo,
  ).length;
  if (ipHourly >= config.otpIpSendsPerHour) {
    throw new ApiError(429, 'Too many code requests. Please wait.', 'otp_rate_limited', {
      retryAfterSeconds: 3600,
    });
  }
  // Keep the local store from growing without bound; MongoDB has a TTL index.
  if (all.length > 5000) {
    await store.otpSends.deleteWhere(
      (doc) => new Date(doc.at).getTime() < now - 3 * 24 * 60 * 60_000,
    );
  }
}

export async function requestOtp(
  store: Store,
  input: { phone?: string; email?: string; purpose: OtpPurpose; locale?: Locale },
  options: AuthOptions = {},
  meta: AuthMeta = { ipHash: '', userAgent: 'unknown' },
): Promise<RequestOtpResult> {
  const { identifier, channel } = identifierOf(input);
  if (!identifier) throw new ApiError(400, 'Enter a phone number or email.', 'invalid_identifier');
  if (channel === 'phone' && !/^[6-9]\d{9}$/.test(identifier)) {
    throw new ApiError(400, 'Enter a valid Indian mobile number.', 'invalid_identifier');
  }
  if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    throw new ApiError(400, 'Enter a valid email address.', 'invalid_identifier');
  }

  const existingAttempt = await attemptRecord(store, identifier);
  const lockedFor = lockoutSeconds(existingAttempt);
  if (lockedFor > 0) {
    throw new ApiError(429, 'Too many wrong codes. Please wait.', 'otp_locked', {
      retryAfterSeconds: lockedFor,
    });
  }
  await enforceSendLimits(store, identifier, meta.ipHash, input.purpose);

  const user = channel === 'phone'
    ? await store.users.findOne((doc) => doc.phone === identifier)
    : await store.users.findOne((doc) => doc.email === identifier);
  const locale: Locale = input.locale ?? user?.language ?? 'en';

  const code =
    options.codeGenerator?.({ identifier, purpose: input.purpose }) ??
    String(randomInt(0, 1_000_000)).padStart(6, '0');
  const otpId = randomUUID();
  const now = new Date();
  const doc: OtpDoc = {
    id: otpId,
    identifier,
    channel,
    purpose: input.purpose,
    codeHash: otpHash(otpId, identifier, input.purpose, code),
    expiresAt: addMinutes(now, config.otpTtlMinutes).toISOString(),
    createdAt: now.toISOString(),
    attempts: 0,
    consumedAt: null,
    lastSentAt: now.toISOString(),
  };

  // One live code per identifier: issuing a new one invalidates earlier codes.
  const previous = await store.otps.find(
    (item) => item.identifier === identifier && !item.consumedAt,
  );
  for (const item of previous) {
    await store.otps.updateAtomic(
      { id: item.id, consumedAt: null },
      { consumedAt: now.toISOString() },
    );
  }
  await store.otps.insert(doc);
  try {
    await deliveryForProvider().send({ identifier, channel, code, locale });
  } catch (error) {
    await store.otps.delete(doc.id);
    throw error;
  }
  await store.otpSends.insert({
    id: newId(),
    identifier,
    ipHash: meta.ipHash,
    purpose: input.purpose,
    at: now.toISOString(),
  });
  await auditAuth(store, 'otp_requested', {
    userId: user?.id,
    identifier,
    ipHash: meta.ipHash,
    detail: { channel, purpose: input.purpose },
  });

  return {
    ok: true,
    channel,
    expiresInSeconds: config.otpTtlMinutes * 60,
    resendAfterSeconds: config.otpResendSeconds,
    devCode:
      config.otpExposeDevCode && config.otpProvider === 'console' && !isProduction
        ? code
        : undefined,
  };
}

export interface VerifyOtpResult extends IssuedSession {
  purpose: OtpPurpose;
}

export async function verifyOtp(
  store: Store,
  input: {
    phone?: string;
    email?: string;
    code: string;
    purpose: OtpPurpose;
    name?: string;
    locale?: Locale;
  },
  meta: AuthMeta = { ipHash: '', userAgent: 'unknown' },
): Promise<VerifyOtpResult> {
  const { identifier, channel } = identifierOf(input);
  const existingAttempt = await attemptRecord(store, identifier);
  const lockedFor = lockoutSeconds(existingAttempt);
  if (lockedFor > 0) {
    throw new ApiError(429, 'Too many wrong codes. Please wait.', 'otp_locked', {
      retryAfterSeconds: lockedFor,
    });
  }

  const latest = await latestOtp(store, identifier);
  if (!latest) {
    throw new ApiError(400, 'That code is not valid. Please request a new one.', 'otp_invalid');
  }
  if (latest.purpose !== input.purpose) {
    throw new ApiError(400, 'That code is not valid for this action.', 'otp_invalid');
  }
  if (new Date(latest.expiresAt).getTime() <= Date.now()) {
    throw new ApiError(400, 'That code has expired. Please request a new one.', 'otp_expired');
  }
  if (latest.attempts >= config.otpMaxAttempts) {
    throw new ApiError(429, 'Too many wrong codes. Please request a new one.', 'otp_locked', {
      retryAfterSeconds: config.otpLockoutMinutes * 60,
    });
  }

  const expected = otpHash(latest.id, identifier, latest.purpose, input.code);
  if (!safeEqual(expected, latest.codeHash)) {
    const failure = await registerFailure(store, identifier);
    await store.otps.updateAtomic(
      { id: latest.id, consumedAt: null, attempts: { $lt: config.otpMaxAttempts } },
      { attempts: latest.attempts + 1 },
    );
    await auditAuth(store, failure.locked ? 'otp_locked' : 'otp_failed', {
      identifier,
      ipHash: meta.ipHash,
      detail: { purpose: input.purpose, remaining: failure.remaining },
    });
    if (failure.locked) {
      throw new ApiError(429, 'Too many wrong codes. Please wait.', 'otp_locked', {
        retryAfterSeconds: failure.retryAfterSeconds,
      });
    }
    throw new ApiError(400, 'That code is not correct.', 'otp_invalid', {
      attemptsRemaining: failure.remaining,
    });
  }

  // Compare-and-set makes double consumption impossible under parallel requests.
  const consumed = await store.otps.updateAtomic(
    {
      id: latest.id,
      consumedAt: null,
      expiresAt: { $gt: new Date().toISOString() },
      attempts: { $lt: config.otpMaxAttempts },
    },
    { consumedAt: new Date().toISOString() },
  );
  if (!consumed) {
    throw new ApiError(400, 'That code is not valid. Please request a new one.', 'otp_invalid');
  }
  await clearFailures(store, identifier);

  let user = channel === 'phone'
    ? await store.users.findOne((doc) => doc.phone === identifier)
    : await store.users.findOne((doc) => doc.email === identifier);

  if (!user) {
    if (input.purpose !== 'login') {
      throw new ApiError(400, 'That code is not valid for this action.', 'otp_invalid');
    }
    const createdAt = nowIso();
    user = {
      id: newId(),
      ...(channel === 'phone' ? { phone: normalisePhone(identifier) } : { email: identifier }),
      name: input.name,
      language: input.locale ?? 'en',
      role: 'user',
      status: 'active',
      tokenVersion: 0,
      mfaSecret: null,
      mfaRecoveryCodes: [],
      mfaEnrolledAt: null,
      profiles: [],
      notificationPrefs: { deadlines: true, schemeUpdates: true, documentNudges: true },
      speechPrefs: { speed: 1, autoReadQuestions: false },
      createdAt,
      updatedAt: createdAt,
    };
    await store.users.insert(user);
  }

  if (user.status !== 'active') {
    throw new ApiError(403, 'This account is not active.', 'account_inactive');
  }

  const needsMfa = isAdmin(user.role) && input.purpose !== 'admin_stepup';
  const issued = await createSession(store, user, {
    ...meta,
    mfa: !needsMfa,
    lastReauthAt: nowIso(),
  });
  await auditAuth(store, 'login', {
    userId: user.id,
    identifier,
    ipHash: meta.ipHash,
    detail: { channel, purpose: input.purpose, mfaRequired: needsMfa },
  });
  return { ...issued, purpose: input.purpose };
}

/**
 * Purpose-bound destructive actions must consume an OTP without minting a new
 * login session. Used for account deletion and changing a phone/email.
 */
export async function verifyOtpAction(
  store: Store,
  input: {
    phone?: string;
    email?: string;
    code: string;
    purpose: 'delete_account' | 'change_contact';
  },
  meta: AuthMeta = { ipHash: '', userAgent: 'unknown' },
): Promise<{ identifier: string; user: UserDoc | null }> {
  const { identifier } = identifierOf(input);
  const existingAttempt = await attemptRecord(store, identifier);
  const lockedFor = lockoutSeconds(existingAttempt);
  if (lockedFor > 0) {
    throw new ApiError(429, 'Too many wrong codes. Please wait.', 'otp_locked', {
      retryAfterSeconds: lockedFor,
    });
  }
  const latest = await latestOtp(store, identifier);
  if (!latest || new Date(latest.expiresAt).getTime() <= Date.now()) {
    throw new ApiError(400, 'That code has expired or is not valid.', 'otp_expired');
  }
  if (latest.purpose !== input.purpose) {
    throw new ApiError(400, 'That code is not valid for this action.', 'otp_invalid');
  }
  if (latest.attempts >= config.otpMaxAttempts) {
    throw new ApiError(429, 'Too many wrong codes. Please request a new one.', 'otp_locked', {
      retryAfterSeconds: config.otpLockoutMinutes * 60,
    });
  }
  const expected = otpHash(latest.id, identifier, latest.purpose, input.code);
  if (!safeEqual(expected, latest.codeHash)) {
    const failure = await registerFailure(store, identifier);
    await store.otps.updateAtomic(
      { id: latest.id, consumedAt: null, attempts: { $lt: config.otpMaxAttempts } },
      { attempts: latest.attempts + 1 },
    );
    await auditAuth(store, failure.locked ? 'otp_locked' : 'otp_failed', {
      identifier,
      ipHash: meta.ipHash,
      detail: { purpose: input.purpose },
    });
    if (failure.locked) {
      throw new ApiError(429, 'Too many wrong codes. Please wait.', 'otp_locked', {
        retryAfterSeconds: failure.retryAfterSeconds,
      });
    }
    throw new ApiError(400, 'That code is not correct.', 'otp_invalid');
  }
  const consumed = await store.otps.updateAtomic(
    {
      id: latest.id,
      consumedAt: null,
      expiresAt: { $gt: new Date().toISOString() },
    },
    { consumedAt: new Date().toISOString() },
  );
  if (!consumed) {
    throw new ApiError(400, 'That code is not valid. Please request a new one.', 'otp_invalid');
  }
  await clearFailures(store, identifier);
  const user =
    latest.channel === 'phone'
      ? await store.users.findOne((doc) => doc.phone === identifier)
      : await store.users.findOne((doc) => doc.email === identifier);
  await auditAuth(store, input.purpose, {
    userId: user?.id,
    identifier,
    ipHash: meta.ipHash,
    detail: { purpose: input.purpose },
  });
  return { identifier, user };
}

export async function setupMfa(
  store: Store,
  user: UserDoc,
): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string; recoveryCodes: string[] }> {
  if (!isAdmin(user.role)) {
    throw new ApiError(403, 'Two-step verification is for admin accounts.', 'forbidden');
  }
  const secret = generateSecret();
  const otpauthUrl = generateURI({
    issuer: config.adminMfaIssuer,
    label: user.email ?? user.phone ?? user.id,
    secret,
  });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
    margin: 1,
    width: 240,
    color: { dark: '#102141', light: '#FFFDF8' },
  });
  const recoveryCodes = Array.from({ length: 10 }, () =>
    randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)?.join('-') ?? '',
  );
  await store.users.update(user.id, {
    mfaSecret: secret,
    mfaRecoveryCodes: recoveryCodes.map((value) => sha256(value)),
    mfaEnrolledAt: null,
    updatedAt: nowIso(),
  });
  await auditAuth(store, 'mfa_setup_started', {
    userId: user.id,
    ipHash: '',
    detail: {},
  });
  return { secret, otpauthUrl, qrDataUrl, recoveryCodes };
}

export async function verifyMfa(
  store: Store,
  user: UserDoc,
  session: SessionDoc,
  code: string,
  options: { stepUp?: boolean } = {},
): Promise<{ recoveryCodesRemaining?: number }> {
  if (!isAdmin(user.role)) {
    throw new ApiError(403, 'Two-step verification is for admin accounts.', 'forbidden');
  }
  if (!user.mfaSecret) {
    throw new ApiError(400, 'Set up two-step verification first.', 'mfa_enroll_required');
  }
  const normalised = code.trim();
  let valid = false;
  let recoveryIndex = -1;
  if (/^\d{6}$/.test(normalised)) {
    valid = verifySync({ secret: user.mfaSecret, token: normalised, epochTolerance: 30 }).valid;
  } else {
    const hash = sha256(normalised.toUpperCase());
    recoveryIndex = (user.mfaRecoveryCodes ?? []).indexOf(hash);
    valid = recoveryIndex >= 0;
  }
  if (!valid) {
    await auditAuth(store, 'mfa_failed', {
      userId: user.id,
      ipHash: session.ipHash,
      detail: { stepUp: Boolean(options.stepUp) },
    });
    throw new ApiError(400, 'That authenticator code is not valid.', 'mfa_invalid');
  }
  let remaining: number | undefined;
  if (recoveryIndex >= 0) {
    const codes = [...(user.mfaRecoveryCodes ?? [])];
    codes.splice(recoveryIndex, 1);
    await store.users.update(user.id, { mfaRecoveryCodes: codes });
    remaining = codes.length;
  }
  if (!user.mfaEnrolledAt) {
    await store.users.update(user.id, { mfaEnrolledAt: nowIso(), updatedAt: nowIso() });
  }
  await store.refreshTokens.update(session.id, {
    mfa: true,
    lastReauthAt: nowIso(),
    lastUsedAt: nowIso(),
  });
  await auditAuth(store, options.stepUp ? 'step_up' : 'mfa_verified', {
    userId: user.id,
    ipHash: session.ipHash,
    detail: { recovery: recoveryIndex >= 0 },
  });
  return { recoveryCodesRemaining: remaining };
}

export function isMfaEnabled(user: UserDoc): boolean {
  return Boolean(user.mfaSecret && user.mfaEnrolledAt);
}

export function refreshCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
  domain?: string;
} {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: config.sessionIdleDays * 24 * 60 * 60 * 1000,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(config.refreshCookieName, token, refreshCookieOptions());
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(config.refreshCookieName, {
    ...refreshCookieOptions(),
    maxAge: undefined,
  });
}

export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === config.refreshCookieName) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}
