import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { AlertsService } from './alerts.service';
import { MetricsService } from './metrics.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService, private readonly alerts: AlertsService) {}

  @Get('metrics')
  snapshot() {
    return { ...this.metrics.snapshot(), activeAlerts: this.alerts.evaluate() };
  }
}
