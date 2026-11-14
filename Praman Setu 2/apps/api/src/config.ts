import 'dotenv/config';
import { z } from 'zod';

const booleanEnv = (fallback: boolean) =>
  z
    .preprocess((value) => {
      if (value === undefined || value === '') return fallback;
      if (typeof value === 'boolean') return value;
      return String(value).toLowerCase() === 'true';
    }, z.boolean())
    .default(fallback);

export const envSchema = z.object({
  // An unset NODE_ENV must never silently unlock development behaviour.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  MONGODB_URI: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-please'),
  OTP_PEPPER: z.string().min(16).default('dev-otp-pepper-change-me-please-32'),
  ACCESS_TOKEN_TTL: z.string().default('12m'),
  SESSION_IDLE_DAYS: z.coerce.number().int().positive().default(14),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().positive().default(90),
  MAX_SESSIONS: z.coerce.number().int().positive().max(20).default(5),
  COOKIE_SECURE: booleanEnv(false),
  COOKIE_DOMAIN: z.string().optional(),
  OTP_PROVIDER: z.enum(['console', 'msg91', 'twilio', 'email']).default('console'),
  OTP_EXPOSE_DEV_CODE: booleanEnv(false),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().max(15).default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(5),
  OTP_RESEND_SECONDS: z.coerce.number().int().positive().default(30),
  OTP_SENDS_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_SENDS_PER_DAY: z.coerce.number().int().positive().default(10),
  OTP_IP_SENDS_PER_HOUR: z.coerce.number().int().positive().default(20),
  OTP_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  MSG91_TEMPLATE_ID_EN: z.string().optional(),
  MSG91_TEMPLATE_ID_HI: z.string().optional(),
  MSG91_TEMPLATE_ID_PA: z.string().optional(),
  MSG91_TEMPLATE_ID_UR: z.string().optional(),
  MSG91_TEMPLATE_ID_MR: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('no-reply@pramansetu.app'),
  ENABLE_DEMO_LOGIN: booleanEnv(false),
  SEED_DEMO: booleanEnv(false),
  SEED_ADMIN_PHONE: z.string().default('9999999999'),
  SEED_DEMO_PHONE: z.string().default('9876543210'),
  ADMIN_MFA_ISSUER: z.string().default('Pramansetu'),
  AUTH_EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  RATE_LIMIT_REDIS_URL: z.string().optional(),
  TTS_PROVIDER: z.enum(['none', 'azure', 'google']).default('none'),
  TTS_MAX_CHARS: z.coerce.number().int().positive().max(5000).default(600),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().optional(),
  GOOGLE_TTS_API_KEY: z.string().optional(),
  AI_EXPLANATIONS: booleanEnv(false),
  ANTHROPIC_API_KEY: z.string().optional(),
  STORE_FILE: z.string().optional(),
  HSTS_PRELOAD: booleanEnv(false),
});

export const env = envSchema.parse(process.env);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';

const DEV_SECRET_MARKERS = ['dev-', 'change-me', 'secret', 'password'];
const lookedLikeDefault = (value: string): boolean =>
  DEV_SECRET_MARKERS.some((marker) => value.toLowerCase().includes(marker));

export type EnvConfig = z.infer<typeof envSchema>;

/** Pure so tests can prove that unsafe production settings are rejected. */
export function productionConfigProblems(env: EnvConfig): string[] {
  const problems: string[] = [];
  const strong = (name: string, value: string) => {
    if (value.length < 32) problems.push(`${name} must be at least 32 characters`);
    if (lookedLikeDefault(value)) problems.push(`${name} still looks like a development default`);
  };
  strong('JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET);
  strong('JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET);
  strong('OTP_PEPPER', env.OTP_PEPPER);
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (env.OTP_PEPPER === env.JWT_ACCESS_SECRET || env.OTP_PEPPER === env.JWT_REFRESH_SECRET) {
    problems.push('OTP_PEPPER must be different from the JWT secrets');
  }
  if (env.OTP_PROVIDER === 'console') {
    problems.push('OTP_PROVIDER=console is not allowed in production');
  }
  if (env.OTP_EXPOSE_DEV_CODE) {
    problems.push('OTP_EXPOSE_DEV_CODE must be false in production');
  }
  if (!env.MONGODB_URI) problems.push('MONGODB_URI is required in production');
  if (!env.APP_ORIGIN.startsWith('https://')) {
    problems.push('APP_ORIGIN must be an https:// URL in production');
  }
  if (!env.COOKIE_SECURE) problems.push('COOKIE_SECURE must be true in production');
  if (!env.COOKIE_DOMAIN) problems.push('COOKIE_DOMAIN is required in production');
  if (env.ENABLE_DEMO_LOGIN) problems.push('ENABLE_DEMO_LOGIN must be false in production');
  if (env.SEED_DEMO) problems.push('SEED_DEMO must be false in production');
  if (env.CORS_ORIGINS.split(',').some((origin) => origin.trim() === '*')) {
    problems.push('CORS_ORIGINS cannot contain a wildcard in production');
  }
  if (env.OTP_PROVIDER === 'msg91' && !env.MSG91_TEMPLATE_ID_EN && !env.MSG91_TEMPLATE_ID) {
    problems.push('Set MSG91_TEMPLATE_ID_EN (or MSG91_TEMPLATE_ID) in production');
  }
  if (
    env.OTP_PROVIDER === 'twilio' &&
    (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM)
  ) {
    problems.push('Twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM');
  }
  if (env.OTP_PROVIDER === 'email' && !env.RESEND_API_KEY) {
    problems.push('The email provider requires RESEND_API_KEY');
  }
  if (env.TTS_PROVIDER === 'azure' && (!env.AZURE_SPEECH_KEY || !env.AZURE_SPEECH_REGION)) {
    problems.push('Azure TTS requires AZURE_SPEECH_KEY and AZURE_SPEECH_REGION');
  }
  if (env.TTS_PROVIDER === 'google' && !env.GOOGLE_TTS_API_KEY) {
    problems.push('Google TTS requires GOOGLE_TTS_API_KEY');
  }
  return problems;
}

if (isProduction) {
  const problems = productionConfigProblems(env);
  if (problems.length) {
    throw new Error(`Unsafe production configuration:\n- ${problems.join('\n- ')}`);
  }
}

if (env.OTP_EXPOSE_DEV_CODE && env.NODE_ENV !== 'development') {
  throw new Error('OTP_EXPOSE_DEV_CODE is only allowed when NODE_ENV=development.');
}
if (env.ENABLE_DEMO_LOGIN && env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
  throw new Error('ENABLE_DEMO_LOGIN is only allowed in development or test.');
}

export const corsOrigins = Array.from(
  new Set([
    ...env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean),
    ...(isProduction ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
  ]),
);

const appOrigin = (() => {
  try {
    return new URL(env.APP_ORIGIN);
  } catch {
    return new URL('http://localhost:5173');
  }
})();

export const config = {
  env: env.NODE_ENV,
  port: env.PORT,
  appOrigin: env.APP_ORIGIN.replace(/\/$/, ''),
  appHost: appOrigin.host,
  mongoUri: env.MONGODB_URI || '',
  accessSecret: env.JWT_ACCESS_SECRET,
  refreshSecret: env.JWT_REFRESH_SECRET,
  otpPepper: env.OTP_PEPPER,
  accessTtl: env.ACCESS_TOKEN_TTL,
  sessionIdleDays: env.SESSION_IDLE_DAYS,
  sessionAbsoluteDays: env.SESSION_ABSOLUTE_DAYS,
  maxSessions: env.MAX_SESSIONS,
  cookieSecure: env.COOKIE_SECURE || isProduction,
  cookieDomain: env.COOKIE_DOMAIN,
  refreshCookieName: 'ps_refresh',
  otpProvider: env.OTP_PROVIDER,
  otpExposeDevCode: env.OTP_EXPOSE_DEV_CODE,
  otpTtlMinutes: env.OTP_TTL_MINUTES,
  otpMaxAttempts: env.OTP_MAX_ATTEMPTS,
  otpResendSeconds: env.OTP_RESEND_SECONDS,
  otpSendsPerHour: env.OTP_SENDS_PER_HOUR,
  otpSendsPerDay: env.OTP_SENDS_PER_DAY,
  otpIpSendsPerHour: env.OTP_IP_SENDS_PER_HOUR,
  otpLockoutMinutes: env.OTP_LOCKOUT_MINUTES,
  msg91AuthKey: env.MSG91_AUTH_KEY,
  msg91SenderId: env.MSG91_SENDER_ID,
  msg91TemplateId: env.MSG91_TEMPLATE_ID,
  msg91TemplateIds: {
    en: env.MSG91_TEMPLATE_ID_EN || env.MSG91_TEMPLATE_ID,
    hi: env.MSG91_TEMPLATE_ID_HI || env.MSG91_TEMPLATE_ID_EN || env.MSG91_TEMPLATE_ID,
    pa: env.MSG91_TEMPLATE_ID_PA || env.MSG91_TEMPLATE_ID_EN || env.MSG91_TEMPLATE_ID,
    ur: env.MSG91_TEMPLATE_ID_UR || env.MSG91_TEMPLATE_ID_EN || env.MSG91_TEMPLATE_ID,
    mr: env.MSG91_TEMPLATE_ID_MR || env.MSG91_TEMPLATE_ID_EN || env.MSG91_TEMPLATE_ID,
  },
  twilioAccountSid: env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: env.TWILIO_AUTH_TOKEN,
  twilioFrom: env.TWILIO_FROM,
  resendApiKey: env.RESEND_API_KEY,
  mailFrom: env.MAIL_FROM,
  enableDemoLogin: env.ENABLE_DEMO_LOGIN,
  seedDemo: env.SEED_DEMO,
  seedAdminPhone: env.SEED_ADMIN_PHONE,
  seedDemoPhone: env.SEED_DEMO_PHONE,
  adminMfaIssuer: env.ADMIN_MFA_ISSUER,
  authEventRetentionDays: env.AUTH_EVENT_RETENTION_DAYS,
  redisUrl: env.RATE_LIMIT_REDIS_URL,
  ttsProvider: env.TTS_PROVIDER,
  ttsMaxChars: env.TTS_MAX_CHARS,
  azureSpeechKey: env.AZURE_SPEECH_KEY,
  azureSpeechRegion: env.AZURE_SPEECH_REGION,
  googleTtsApiKey: env.GOOGLE_TTS_API_KEY,
  aiExplanations: env.AI_EXPLANATIONS,
  storeFile: env.STORE_FILE || '.data/db.json',
  hstsPreload: env.HSTS_PRELOAD,
} as const;
