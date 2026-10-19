import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { GeminiInsightsService } from './gemini-insights.service';

@Module({
  imports: [AuditModule],
  controllers: [FinanceController],
  providers: [FinanceService, GeminiInsightsService]
})
export class FinanceModule {}
