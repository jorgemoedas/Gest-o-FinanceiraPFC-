import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FiscalController } from './fiscal.controller';
import { FiscalCalendarService } from './fiscal-calendar.service';
import { FiscalCalculationService } from './fiscal-calculation.service';
import { FiscalExportService } from './fiscal-export.service';

@Module({
  imports: [AuditModule],
  controllers: [FiscalController],
  providers: [FiscalCalendarService, FiscalCalculationService, FiscalExportService],
  exports: [FiscalCalendarService, FiscalCalculationService, FiscalExportService]
})
export class FiscalModule {}
