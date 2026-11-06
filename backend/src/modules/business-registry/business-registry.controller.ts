import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CompanyRole } from '../../generated/prisma/client';
import { AuthPrincipal } from '../../common/auth-principal';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessRegistryService } from './business-registry.service';
import { CompanyProfileService } from './company-profile.service';
import { SaveCompanyProfileDto } from './save-company-profile.dto';

@Controller('business-registry')
@UseGuards(JwtAuthGuard)
export class BusinessRegistryController {
  constructor(
    private readonly registry: BusinessRegistryService,
    private readonly profiles: CompanyProfileService
  ) {}

  @Get('profile')
  getProfile(@CurrentUser() principal: AuthPrincipal) {
    return this.profiles.getForCompany(principal);
  }

  @Put('profile')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  saveProfile(@Body() input: SaveCompanyProfileDto, @CurrentUser() principal: AuthPrincipal) {
    return this.profiles.saveForCompany(input.cnpj, principal);
  }

  @Get('cnpj/:cnpj')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  lookup(@Param('cnpj') cnpj: string, @CurrentUser() principal: AuthPrincipal) {
    return this.registry.lookup(cnpj, principal);
  }
}
