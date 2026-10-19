module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverage: false,
  collectCoverageFrom: [
    'src/modules/auth/auth.service.ts',
    'src/modules/auth/strategies/jwt.strategy.ts',
    'src/common/guards/jwt-auth.guard.ts',
    'src/common/guards/roles.guard.ts',
    'src/modules/audit/audit.service.ts',
    'src/modules/business-registry/cnpj.ts',
    'src/modules/business-registry/business-registry.service.ts',
    'src/modules/finance/finance.service.ts',
    'src/modules/finance/gemini-insights.service.ts',
    'src/database/postgres-connection.ts',
    '!src/**/*.module.ts',
    '!src/**/*.dto.ts'
  ],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50
    }
  },
  clearMocks: true,
  restoreMocks: true
};
