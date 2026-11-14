import { config, isProduction } from './config';
import { createApp } from './app';
import { logger } from './logger';

async function main(): Promise<void> {
  const { app, store } = await createApp({ includeDemoUsers: !isProduction });
  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.env, store: store.kind },
      'Pramansetu API listening',
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
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
  logger.error(error, 'Failed to start API');
  process.exit(1);
});
