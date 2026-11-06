import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { MetricsController } from './metrics.controller';

describe('MetricsController security', () => {
  it('protege /metrics com o guard JWT e não marca a rota como pública', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, MetricsController) as Function[];

    expect(guards).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, MetricsController.prototype.snapshot)).not.toBe(true);
  });
});
