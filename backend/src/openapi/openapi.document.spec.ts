import { buildOpenApiDocument } from './openapi.document';

describe('buildOpenApiDocument', () => {
  it('returns a serializable OpenAPI 3.1 contract with required paths and security', () => {
    const document = buildOpenApiDocument();
    const paths = document.paths as Record<string, unknown>;
    const requiredPaths = [
      '/health', '/health/ready', '/metrics', '/openapi.json',
      '/auth/register', '/auth/login', '/auth/me', '/auth/admin-check',
      '/auth/password-reset', '/auth/password-reset/confirm', '/audit-logs',
      '/business-registry/cnpj/{cnpj}', '/business-registry/profile',
      '/finance/transactions', '/finance/transactions/{id}', '/finance/transactions/{id}/refund',
      '/finance/transactions/bulk', '/finance/dashboard', '/finance/insights', '/finance/counterparties',
      '/finance/recurrences', '/finance/recurrences/{id}', '/finance/recurrences/run', '/finance/analytics',
      '/finance/attachments', '/finance/attachments/{id}', '/fiscal/calendar', '/fiscal/calendar/{id}',
      '/fiscal/calendar/generate-default', '/fiscal/export', '/privacy/export', '/privacy/erase'
    ];

    expect(document.openapi).toBe('3.1.0');
    for (const path of requiredPaths) expect(paths[path]).toBeDefined();
    expect(paths['/audit/events']).toBeUndefined();
    expect(paths['/auth/logout']).toBeUndefined();
    expect((document as Record<string, unknown>).security).toEqual([{ bearerAuth: [] }]);
    const components = document.components as Record<string, unknown>;
    expect((components.securitySchemes as Record<string, unknown>).bearerAuth).toBeDefined();
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });

  it('uses the JSON media type rather than the constant name in request bodies', () => {
    const document = buildOpenApiDocument();
    const paths = document.paths as Record<string, Record<string, { requestBody?: { content: Record<string, unknown> } }>>;
    const bodies = Object.values(paths).flatMap((path) => Object.values(path))
      .flatMap((operation) => operation.requestBody ? [operation.requestBody] : []);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body.content).toHaveProperty('application/json');
    expect(JSON.stringify(document)).not.toContain('JSON_MEDIA_TYPE');
  });
});
