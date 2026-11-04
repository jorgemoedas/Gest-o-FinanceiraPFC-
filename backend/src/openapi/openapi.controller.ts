import { Controller, Get } from '@nestjs/common';
import { buildOpenApiDocument } from './openapi.document';

// O bootstrap deve excluir `openapi.json` do global prefix `api/v1` para manter GET /openapi.json.
@Controller()
export class OpenApiController {
  @Get('openapi.json')
  getDocument(): Record<string, unknown> {
    return buildOpenApiDocument();
  }
}
