import { Global, Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { MetricsService } from './metrics.service';

@Global()
@Module({ providers: [MetricsService, AlertsService], exports: [MetricsService, AlertsService] })
export class ObservabilityModule {}
