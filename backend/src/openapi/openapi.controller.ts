import { Controller, Get } from '@nestjs/common';
import { buildOpenApiDocument } from './openapi.document';


@Controller()
export class OpenApiController {
  @Get('openapi.json')
  getDocument(): Record<string, unknown> {
    return buildOpenApiDocument();
  }
}
