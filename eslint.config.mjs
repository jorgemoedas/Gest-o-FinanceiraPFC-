import { createRequire } from 'node:module';


const require = createRequire(new URL('./backend/package.json', import.meta.url));
const tsParser = require('@typescript-eslint/parser');
const tseslint = require('@typescript-eslint/eslint-plugin');

export const sharedEslintIgnores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/coverage/**'
];

export default [
  { ignores: [...sharedEslintIgnores, 'backend/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' }
    },
    plugins: { '@typescript-eslint': tseslint },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unreachable': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' }
      ]
    }
  }
];
