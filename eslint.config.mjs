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
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      'apps/api/prisma/migrations/**',
      'apps/api/storage/**',
      'docs/**',
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
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', 'scripts/**/*.mjs', '*.mjs'],
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
    files: ['scripts/**', 'apps/api/prisma/**'],
    rules: { 'no-console': 'off' },
  },
);
