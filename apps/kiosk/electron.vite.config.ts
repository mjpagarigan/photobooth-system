import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['@grace-booth/shared'],
      },
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          'image-worker': resolve(import.meta.dirname, 'src/main/image/image-worker.ts'),
        },
      },
    },
  },
  preload: {
    ssr: {
      noExternal: ['@grace-booth/shared', 'zod'],
    },
    build: {
      externalizeDeps: {
        exclude: ['@grace-booth/shared', 'zod'],
      },
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/preload/index.ts'),
        output: {
          entryFileNames: '[name].cjs',
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    publicDir: resolve(import.meta.dirname, 'resources'),
    plugins: [tailwindcss(), react()],
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/renderer/index.html'),
      },
    },
  },
});
