import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      'apps/api/dist-seed/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      'apps/web/e2e/.artifacts/**',
      'apps/api/prisma/migrations/**',
      'apps/api/storage/**',
      'apps/api/src/generated/**',
      'docs/**',
      'release/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'], sourceType: 'module' },
    },
  },
  {
    files: ['apps/web/**/*.{ts,vue}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      'apps/api/**/*.ts',
      'packages/**/*.ts',
      'scripts/**/*.mjs',
      '*.mjs',
      'apps/web/e2e/**',
      'apps/web/playwright.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['scripts/**', 'apps/api/prisma/**', 'apps/web/e2e/**'],
    rules: { 'no-console': 'off' },
  },
);
