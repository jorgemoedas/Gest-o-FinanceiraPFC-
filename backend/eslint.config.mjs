import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';
import { sharedEslintIgnores } from '../eslint.config.mjs';

export default [
  {
    ignores: [
      ...sharedEslintIgnores,
      'src/generated/**',
      '**/*.spec.ts'
    ]
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      sonarjs
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'warn'
    },
    rules: {


      'sonarjs/cyclomatic-complexity': ['warn', { threshold: 10 }],
      'sonarjs/cognitive-complexity': ['warn', 15],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-params': ['warn', { max: 4 }],
      'sonarjs/no-duplicate-string': ['warn', { threshold: 3 }],
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-dead-store': 'warn',
      'no-unreachable': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' }
      ]
    }
  }
];
