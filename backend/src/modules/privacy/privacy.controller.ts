import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { AuthPrincipal } from '../../common/auth-principal';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrivacyService } from './privacy.service';

class ErasePrivacyDataDto {
  @IsString()
  @MaxLength(40)
  confirmation!: string;
}

@Controller('privacy')
@UseGuards(JwtAuthGuard)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('export')
  exportData(@CurrentUser() principal: AuthPrincipal) {
    return this.privacy.exportData(principal);
  }

  @Post('erase')
  eraseData(@CurrentUser() principal: AuthPrincipal, @Body() input: ErasePrivacyDataDto) {
    return this.privacy.eraseData(principal, input);
  }
}
