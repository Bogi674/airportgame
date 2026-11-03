import { fileURLToPath, URL } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

const alias = (dir: string): string => fileURLToPath(new URL(`./src/${dir}`, import.meta.url));

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@sim': alias('sim'),
      '@render': alias('render'),
      '@ui': alias('ui'),
      '@data': alias('data'),
      '@shared': alias('shared'),
    },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: 'hidden' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
