import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(import.meta.dirname, 'src/renderer'),
    },
  },
  test: {
    coverage: {
      exclude: ['out/**', 'release/**', 'src/renderer/main.tsx'],
      reporter: ['text', 'html', 'lcov'],
    },
    environment: 'node',
    fileParallelism: false,
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
