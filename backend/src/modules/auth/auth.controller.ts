import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CompanyRole } from '../../generated/prisma/client';
import { AuthPrincipal } from '../../common/auth-principal';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordResetConfirmDto, PasswordResetRequestDto } from './dto/password-reset.dto';
import { PasswordResetService } from './password-reset.service';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() input: RegisterDto) {
    return this.authService.register(input);
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() input: LoginDto) {
    return this.authService.login(input);
  }

  @Public()
  @Post('password-reset')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestPasswordReset(@Body() input: PasswordResetRequestDto) {
    return this.passwordReset.request(input);
  }

  @Public()
  @Post('password-reset/confirm')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  confirmPasswordReset(@Body() input: PasswordResetConfirmDto) {
    return this.passwordReset.confirm(input);
  }

  @Public()
  @Post('refresh')
  // Uma sessão normal renova só após expirar; dez/minuto tolera repetição de rede sem igualar o limite de credenciais.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  refresh(@Body() input: { refreshToken: string }) {
    return this.authService.refresh(input.refreshToken);
  }
  @Public()
  @Post('logout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  logout(@Body() input: { refreshToken?: string }) {
    return this.authService.logout(input.refreshToken);
  }
  @Get('me')
  me(@CurrentUser() user: AuthPrincipal) {
    return user;
  }

  @Get('admin-check')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @UseGuards(RolesGuard)
  adminCheck() {
    return { authorized: true };
  }
}
