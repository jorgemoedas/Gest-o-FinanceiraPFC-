import { OpenApiController } from './openapi.controller';

describe('OpenApiController', () => {
  it('returns the OpenAPI document', () => {
    const document = new OpenApiController().getDocument();
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths).toBeDefined();
  });
});
