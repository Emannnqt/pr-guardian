// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { boundaryConfigs } from './eslint/boundaries.js';

export default defineConfig(
  {
    name: 'pr-guardian/ignores',
    // demo/ holds an intentionally insecure sample used to demonstrate the Action on a PR.
    ignores: ['dist/', 'dist-action/', 'coverage/', 'node_modules/', 'demo/'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    name: 'pr-guardian/language-options',
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    name: 'pr-guardian/typescript',
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  ...boundaryConfigs,
  {
    name: 'pr-guardian/tests',
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  prettier,
);
