import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': resolve(process.cwd(), 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/features/auth/validation.ts',
        'src/features/auth/api-message.ts',
        'src/features/auth/form-errors.ts',
        'src/lib/auth-proxy.ts',
        'src/features/business-registry/business-registry-client.ts',
        'src/features/finance/validation.ts',
        'src/features/finance/bulk.ts',
        'src/features/finance/recurrence.ts',
        'src/features/finance/analytics.ts',
        'src/features/finance/attachments.ts',
        'src/features/finance/format.ts',
        'src/features/fiscal/calendar.ts',
        'src/features/fiscal/export.ts',
        'src/features/auth/password-reset-client.ts',
        'src/features/privacy/privacy-client.ts',
        'src/features/tax/simulator.ts'
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        branches: 50,
        functions: 50,
        lines: 50,
        statements: 50
      }
    }
  }
});
