import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../app';
import { config } from '../config';
import { logger } from '../logger';

/**
 * Playwright-only API entry point. The six-digit code is injected through
 * createApp() rather than an environment variable, so this deterministic path
 * can never be enabled in a normal development or production server.
 */
if (config.env !== 'test') {
  throw new Error('The E2E server requires NODE_ENV=test.');
}
if (!config.enableDemoLogin || !config.seedDemo) {
  throw new Error('The E2E server requires ENABLE_DEMO_LOGIN=true and SEED_DEMO=true.');
}

const code = process.env.E2E_OTP ?? '123456';
if (!/^\d{6}$/.test(code)) {
  throw new Error('E2E_OTP must be exactly six digits.');
}

const storeFile = resolve(process.cwd(), config.storeFile);
if (process.env.E2E_RESET_STORE === 'true' && existsSync(storeFile)) {
  rmSync(storeFile, { force: true });
}

async function main(): Promise<void> {
  const { app, store } = await createApp({
    persist: true,
    includeDemoUsers: true,
    codeGenerator: () => code,
  });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env, store: store.kind }, 'E2E API listening');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down E2E API');
    server.close(async () => {
      await store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error(error, 'Failed to start E2E API');
  process.exit(1);
});
