import { describe, expect, it } from 'vitest';
import { envSchema, productionConfigProblems } from './config';

const safeProduction = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/pramansetu',
  JWT_ACCESS_SECRET: 'a1'.repeat(24),
  JWT_REFRESH_SECRET: 'b2'.repeat(24),
  OTP_PEPPER: 'c3'.repeat(24),
  OTP_PROVIDER: 'msg91',
  MSG91_TEMPLATE_ID_EN: 'template',
  MSG91_AUTH_KEY: 'key',
  APP_ORIGIN: 'https://app.example',
  CORS_ORIGINS: 'https://app.example',
  COOKIE_SECURE: 'true',
  COOKIE_DOMAIN: 'app.example',
  ENABLE_DEMO_LOGIN: 'false',
  SEED_DEMO: 'false',
} as const;

describe('production configuration guard', () => {
  it('accepts strong, complete production settings', () => {
    const env = envSchema.parse(safeProduction);
    expect(productionConfigProblems(env)).toEqual([]);
  });

  it('refuses development defaults, demo login, and unsafe cookies', () => {
    const env = envSchema.parse({
      NODE_ENV: 'production',
      MONGODB_URI: '',
      JWT_ACCESS_SECRET: 'dev-access-secret-change-me-please',
      JWT_REFRESH_SECRET: 'dev-refresh-secret-change-me-please',
      OTP_PEPPER: 'dev-otp-pepper-change-me-please-32',
      OTP_PROVIDER: 'console',
      APP_ORIGIN: 'http://localhost:5173',
      CORS_ORIGINS: '*',
      COOKIE_SECURE: 'false',
      COOKIE_DOMAIN: '',
      ENABLE_DEMO_LOGIN: 'true',
      SEED_DEMO: 'true',
    });
    const problems = productionConfigProblems(env).join('\n');
    expect(problems).toContain('JWT_ACCESS_SECRET still looks like a development default');
    expect(problems).toContain('OTP_PROVIDER=console is not allowed');
    expect(problems).toContain('MONGODB_URI is required');
    expect(problems).toContain('APP_ORIGIN must be an https:// URL');
    expect(problems).toContain('COOKIE_SECURE must be true');
    expect(problems).toContain('COOKIE_DOMAIN is required');
    expect(problems).toContain('ENABLE_DEMO_LOGIN must be false');
    expect(problems).toContain('SEED_DEMO must be false');
    expect(problems).toContain('CORS_ORIGINS cannot contain a wildcard');
  });

  it('refuses identical secrets and missing TTS credentials', () => {
    const env = envSchema.parse({
      ...safeProduction,
      JWT_REFRESH_SECRET: safeProduction.JWT_ACCESS_SECRET,
      OTP_PEPPER: safeProduction.JWT_ACCESS_SECRET,
      TTS_PROVIDER: 'azure',
    });
    const problems = productionConfigProblems(env).join('\n');
    expect(problems).toContain('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
    expect(problems).toContain('OTP_PEPPER must be different');
    expect(problems).toContain('Azure TTS requires');
  });
});
