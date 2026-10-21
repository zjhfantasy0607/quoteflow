import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import { sharedAlias } from './vite.config.ts';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: sharedAlias },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
  },
});
