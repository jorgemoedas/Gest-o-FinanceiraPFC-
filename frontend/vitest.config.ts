import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': resolve(process.cwd(), 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
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
        'src/features/finance/format.ts',
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
