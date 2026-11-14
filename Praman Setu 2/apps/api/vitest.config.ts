import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    env: {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret',
      OTP_PROVIDER: 'console',
      OTP_EXPOSE_DEV_CODE: 'false',
      ENABLE_DEMO_LOGIN: 'true',
      SEED_DEMO: 'true',
      MONGO_URI: '',
      MONGODB_URI: '',
      CORS_ORIGINS: 'http://localhost:5173',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/scripts/**', 'src/**/*.test.ts'],
    },
  },
});
