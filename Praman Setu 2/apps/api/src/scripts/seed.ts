import { seedStore } from '../seed';
import { createStore } from '../store';
import { logger } from '../logger';

async function main(): Promise<void> {
  const store = await createStore({ persist: true });
  try {
    const result = await seedStore(store, { includeDemoUsers: true });
    logger.info(result, 'Seed script finished');
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  logger.error(error, 'Seed script failed');
  process.exitCode = 1;
});
