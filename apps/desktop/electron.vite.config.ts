import { resolve } from 'node:path';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['@rus-trade/shared'],
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: ['@rus-trade/shared'],
      },
      rollupOptions: {
        output: {
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [vue()],
  },
});
