import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CompanyRole } from '../../generated/prisma/client';
import type { AuthPrincipal } from '../../common/auth-principal';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FiscalCalendarService } from './fiscal-calendar.service';
import { FiscalCalculationService, type CalculateMeiInput, type CalculateSimplesInput } from './fiscal-calculation.service';
import { FiscalExportService } from './fiscal-export.service';
import { FiscalCalculationDto } from './dto/fiscal-calculation.dto';
import { CreateFiscalObligationDto, FiscalCalendarQueryDto, FiscalExportQueryDto, GenerateDefaultFiscalCalendarDto, UpdateFiscalObligationStatusDto } from './dto/fiscal-obligation.dto';

@Controller('fiscal')
@UseGuards(JwtAuthGuard)
export class FiscalController {
  constructor(private readonly calendar: FiscalCalendarService, private readonly calculation: FiscalCalculationService, private readonly fiscalExport: FiscalExportService) {}

  @Post('calculate')
  calculate(@Body() input: FiscalCalculationDto) {
    const payload = input.toInput();
    return input.regime === 'SIMPLES_NACIONAL'
      ? this.calculation.calculateSimples(payload as CalculateSimplesInput)
      : this.calculation.calculateMei(payload as CalculateMeiInput);
  }

  @Get('calendar')
  list(@CurrentUser() principal: AuthPrincipal, @Query() query: FiscalCalendarQueryDto) {
    return this.calendar.list(principal, query);
  }

  @Post('calendar')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  create(@CurrentUser() principal: AuthPrincipal, @Body() input: CreateFiscalObligationDto) {
    return this.calendar.create(principal, input);
  }

  @Patch('calendar/:id')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  updateStatus(@CurrentUser() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: UpdateFiscalObligationStatusDto) {
    return this.calendar.updateStatus(principal, id, input);
  }

  @Delete('calendar/:id')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  remove(@CurrentUser() principal: AuthPrincipal, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.calendar.remove(principal, id);
  }

  @Post('calendar/generate-default')
  @UseGuards(RolesGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER)
  generateDefault(@CurrentUser() principal: AuthPrincipal, @Body() input: GenerateDefaultFiscalCalendarDto) {
    return this.calendar.generateDefault(principal, input);
  }

  @Get('export')
  async export(@CurrentUser() principal: AuthPrincipal, @Query() query: FiscalExportQueryDto, @Res() response: Response) {
    const result = query.format === 'pdf'
      ? await this.fiscalExport.exportPdf(principal, query)
      : await this.fiscalExport.exportCsv(principal, query);
    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    response.setHeader('Cache-Control', 'no-store');
    return response.send(result.body);
  }
}
