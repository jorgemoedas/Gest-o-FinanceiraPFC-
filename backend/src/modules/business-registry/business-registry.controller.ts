import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthPrincipal } from '../../common/auth-principal';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BusinessRegistryService } from './business-registry.service';

@Controller('business-registry')
@UseGuards(JwtAuthGuard)
export class BusinessRegistryController {
  constructor(private readonly registry: BusinessRegistryService) {}

  @Get('cnpj/:cnpj')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  lookup(@Param('cnpj') cnpj: string, @CurrentUser() principal: AuthPrincipal) {
    return this.registry.lookup(cnpj, principal);
  }
}
