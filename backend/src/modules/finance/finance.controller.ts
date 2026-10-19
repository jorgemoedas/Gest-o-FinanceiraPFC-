import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CompanyRole } from '../../generated/prisma/client';
import { AuthPrincipal } from '../../common/auth-principal';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { InsightsQueryDto } from './dto/insights-query.dto';
import { TransactionListQueryDto } from './dto/transaction-list-query.dto';
import { FinanceService } from './finance.service';
import { GeminiInsightsService } from './gemini-insights.service';

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly gemini: GeminiInsightsService
  ) {}

  @Get('dashboard')
  dashboard(@CurrentUser() principal: AuthPrincipal, @Query() query: DashboardQueryDto) {
    return this.finance.getDashboard(principal.companyId, query.months);
  }

  @Get('transactions')
  listTransactions(@CurrentUser() principal: AuthPrincipal, @Query() query: TransactionListQueryDto) {
    return this.finance.listTransactions(principal.companyId, query);
  }

  @Post('transactions')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  createTransaction(@CurrentUser() principal: AuthPrincipal, @Body() input: CreateTransactionDto) {
    return this.finance.createTransaction(principal, input);
  }

  @Post('insights')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  insights(@CurrentUser() principal: AuthPrincipal, @Body() query: InsightsQueryDto) {
    return this.gemini.create(principal, query.months);
  }
}
