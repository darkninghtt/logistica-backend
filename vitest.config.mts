import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/global-setup.ts'],
    // Las pruebas de integración comparten una sola BD: se ejecutan una archivo a la vez
    fileParallelism: false,
  },
});
