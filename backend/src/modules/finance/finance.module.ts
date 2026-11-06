import { Module } from '@nestjs/common';
import { AlertsService } from '../../common/observability/alerts.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { ObservabilityModule } from '../../common/observability/observability.module';
import { PrismaService } from '../../database/prisma.service';
import { AuditModule } from '../audit/audit.module';
import { BusinessRegistryModule } from '../business-registry/business-registry.module';
import { AnalyticsService } from './analytics.service';
import { AttachmentService } from './attachment.service';
import { createAttachmentStorage, type AttachmentStorage } from './attachment-storage';
import { BulkTransactionService } from './bulk-transaction.service';
import { FinanceController, FinanceControllerSupport } from './finance.controller';
import { CounterpartyService } from './counterparty.service';
import { FinanceService } from './finance.service';
import { GEMINI_OBSERVABILITY, GeminiInsightsService } from './gemini-insights.service';
import { RecurrenceService } from './recurrence.service';

export const ATTACHMENT_STORAGE = 'ATTACHMENT_STORAGE';

@Module({
  imports: [AuditModule, BusinessRegistryModule, ObservabilityModule],
  controllers: [FinanceController],
  providers: [
    FinanceControllerSupport,
    CounterpartyService,
    FinanceService,
    {
      provide: GEMINI_OBSERVABILITY,
      useFactory: (metrics: MetricsService, alerts: AlertsService) => ({ metrics, alerts }),
      inject: [MetricsService, AlertsService]
    },
    GeminiInsightsService,
    BulkTransactionService,
    RecurrenceService,
    AnalyticsService,
    {
      provide: ATTACHMENT_STORAGE,
      useFactory: (): AttachmentStorage => createAttachmentStorage()
    },
    {
      provide: AttachmentService,
      useFactory: (prisma: PrismaService, storage: AttachmentStorage) => new AttachmentService(prisma, storage),
      inject: [PrismaService, ATTACHMENT_STORAGE]
    }
  ]
})
export class FinanceModule {}
