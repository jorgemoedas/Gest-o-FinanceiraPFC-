import {
  BadRequestException,
  Body,
  Controller,
  Injectable,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CompanyRole } from '../../generated/prisma/client';
import { CounterpartyListQueryDto } from './dto/counterparty-list-query.dto';
import { CreateCounterpartyDto } from './dto/create-counterparty.dto';
import { AuthPrincipal } from '../../common/auth-principal';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { InsightsQueryDto } from './dto/insights-query.dto';
import { TransactionListQueryDto } from './dto/transaction-list-query.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { BulkUpdateTransactionsDto } from './dto/bulk-update-transactions.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { CreateRecurrenceDto, RunDueRecurrencesDto } from './dto/recurrence.dto';
import { PatchRecurrenceDto } from './dto/patch-recurrence.dto';
import { FinanceService } from './finance.service';
import { AnalyticsService } from './analytics.service';
import { AttachmentService } from './attachment.service';
import { BulkTransactionService } from './bulk-transaction.service';
import { CounterpartyService } from './counterparty.service';
import { GeminiInsightsService } from './gemini-insights.service';
import { RecurrenceService } from './recurrence.service';

type UploadedFileLike = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

function safeDownloadName(fileName: string): string {
  const cleaned = fileName.replace(/[\u0000-\u001f"\\]/g, '_').replace(/[\r\n]/g, '');
  return cleaned.slice(0, 120) || 'anexo';
}

@Injectable()
export class FinanceControllerSupport {
  constructor(
    readonly counterparties: CounterpartyService,
    readonly recurrences: RecurrenceService,
    readonly analytics: AnalyticsService,
    readonly attachments: AttachmentService
  ) {}
}

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly bulkTransactions: BulkTransactionService,
    private readonly gemini: GeminiInsightsService,
    private readonly support: FinanceControllerSupport
  ) {}

  @Get('counterparties')
  listCounterparties(@CurrentUser() principal: AuthPrincipal, @Query() query: CounterpartyListQueryDto) {
    return this.support.counterparties.list(principal, query);
  }

  @Post('counterparties')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  createCounterparty(@CurrentUser() principal: AuthPrincipal, @Body() input: CreateCounterpartyDto) {
    return this.support.counterparties.create(principal, input);
  }

  @Get('dashboard')
  dashboard(@CurrentUser() principal: AuthPrincipal, @Query() query: DashboardQueryDto) {
    return this.finance.getDashboard(principal, query.months);
  }

  @Get('analytics')
  analyticsReport(@CurrentUser() principal: AuthPrincipal, @Query() query: AnalyticsQueryDto) {
    return this.support.analytics.report(principal, query);
  }

  @Get('transactions')
  listTransactions(@CurrentUser() principal: AuthPrincipal, @Query() query: TransactionListQueryDto) {
    return this.finance.listTransactions(principal, query);
  }

  @Post('transactions')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  createTransaction(@CurrentUser() principal: AuthPrincipal, @Body() input: CreateTransactionDto) {
    return this.finance.createTransaction(principal, input);
  }

  @Patch('transactions/bulk')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  bulkUpdateTransactions(@CurrentUser() principal: AuthPrincipal, @Body() input: BulkUpdateTransactionsDto) {
    return this.bulkTransactions.updateMany(principal, input);
  }

  @Patch('transactions/:id')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  updateTransaction(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateTransactionDto
  ) {
    return this.finance.updateTransaction(principal, id, input);
  }

  @Delete('transactions/:id')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  cancelTransaction(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string
  ) {
    return this.finance.cancelTransaction(principal, id);
  }

  @Post('transactions/:id/refund')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  refundTransaction(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string
  ) {
    return this.finance.refundTransaction(principal, id);
  }

  @Get('recurrences')
  listRecurrences(@CurrentUser() principal: AuthPrincipal, @Query() query: { page?: string; limit?: string }) {
    return this.support.recurrences.list(principal, {
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 50
    });
  }

  @Post('recurrences')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  createRecurrence(@CurrentUser() principal: AuthPrincipal, @Body() input: CreateRecurrenceDto) {
    return this.support.recurrences.create(principal, input);
  }

  @Post('recurrences/run')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  runDueRecurrences(@CurrentUser() principal: AuthPrincipal, @Body() input: RunDueRecurrencesDto) {
    return this.support.recurrences.runDue(principal, new Date(input.until));
  }

  @Patch('recurrences/:id')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  patchRecurrence(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: PatchRecurrenceDto
  ) {
    const { isActive, ...fields } = input;
    if (isActive === undefined) return this.support.recurrences.update(principal, id, fields);
    if (Object.keys(fields).length > 1) {
      throw new BadRequestException('Altere os campos ou a situação da recorrência em requisições separadas.');
    }
    return this.support.recurrences.setActive(principal, id, isActive, input.version);
  }

  @Get('attachments')
  listAttachments(@CurrentUser() principal: AuthPrincipal, @Query('transactionId') transactionId: string) {
    return this.support.attachments.list(principal, transactionId);
  }

  @Post('attachments')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @CurrentUser() principal: AuthPrincipal,
    @Body('transactionId') transactionId: string,
    @UploadedFile() file: UploadedFileLike | undefined
  ) {
    if (!file) throw new BadRequestException('Envie um arquivo para anexar ao lançamento.');
    return this.support.attachments.upload(principal, {
      transactionId,
      fileName: file.originalname,
      contentType: file.mimetype,
      bytes: file.buffer
    });
  }

  @Get('attachments/:id')
  async downloadAttachment(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() response: Response
  ) {
    const result = await this.support.attachments.download(principal, id);
    response.setHeader('Content-Type', result.attachment.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${safeDownloadName(result.attachment.fileName)}"`);
    response.setHeader('Cache-Control', 'no-store');
    return response.send(result.bytes);
  }

  @Delete('attachments/:id')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  removeAttachment(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string
  ) {
    return this.support.attachments.remove(principal, id);
  }

  @Post('insights')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  insights(@CurrentUser() principal: AuthPrincipal, @Body() query: InsightsQueryDto) {
    return this.gemini.create(principal, query.months);
  }
}