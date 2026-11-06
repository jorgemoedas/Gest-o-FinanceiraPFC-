import { Inject, Injectable, LoggerService, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JSON_LOGGER, createJsonLogger } from './logger';
import { MetricsService } from './metrics.service';
import {
  AlertDestination,
  createAlertDestinations,
  StructuredLogAlertDestination
} from './alert-destination';

export const ALERT_DESTINATIONS = 'ALERT_DESTINATIONS';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export interface ActiveAlert {
  id: string;
  severity: AlertSeverity;
  message: string;
  startedAt: string;
  lastNotifiedAt: string;
}

interface AlertThresholds {
  errorRatePercent: number;
  minRouteRequests: number;
  latencyP95Ms: number;
  authFailures: number;
  rateLimits: number;
  integrationFailures: number;
  windowMs: number;
  silenceMs: number;
}

type AlertCandidate = { severity: AlertSeverity; message: string };

function positiveNumber(config: ConfigService, key: string, fallback: number): number {
  const value = Number(config.get<string>(key, String(fallback)));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function addRouteCandidates(
  candidates: Map<string, AlertCandidate>,
  route: { method: string; route: string; count: number; errors: number; serverErrors?: number; p95Ms: number },
  thresholds: AlertThresholds,
  safeRoute: string
): void {
  const serverErrors = route.serverErrors ?? route.errors;
  const errorRate = serverErrors * 100 / route.count;
  if (route.count >= thresholds.minRouteRequests && errorRate >= thresholds.errorRatePercent) {
    candidates.set(`route_error:${safeRoute}`, {
      severity: serverErrors === route.count ? 'critical' : 'warning',
      message: `Taxa de erro elevada em ${safeRoute}.`
    });
  }
  if (route.p95Ms >= thresholds.latencyP95Ms) {
    candidates.set(`route_latency:${safeRoute}`, {
      severity: route.p95Ms >= thresholds.latencyP95Ms * 2 ? 'critical' : 'warning',
      message: `Latência p95 acima do limiar em ${safeRoute}.`
    });
  }
}

function addOperationalCandidates(
  candidates: Map<string, AlertCandidate>,
  events: ReturnType<MetricsService['operationalCounts']>,
  thresholds: AlertThresholds
): void {
  if (events.authenticationFailures >= thresholds.authFailures) {
    candidates.set('authentication_failures', { severity: 'warning', message: 'Volume elevado de falhas de autenticação.' });
  }
  if (events.rateLimits >= thresholds.rateLimits) {
    candidates.set('rate_limit_refusals', { severity: 'warning', message: 'Volume elevado de recusas por limite de requisições.' });
  }
  for (const [integration, count] of Object.entries(events.integrationFailures)) {
    if (count < thresholds.integrationFailures) continue;
    candidates.set(`integration_failure:${integration}`, {
      severity: count >= thresholds.integrationFailures * 2 ? 'critical' : 'warning',
      message: `Falhas repetidas na integração ${integration}.`
    });
  }
}

@Injectable()
export class AlertsService {
  private readonly logger: LoggerService;
  private readonly active = new Map<string, ActiveAlert>();
  private readonly lastNotified = new Map<string, number>();
  private readonly thresholds: AlertThresholds;
  private readonly destinations: AlertDestination[];

  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
    @Optional() @Inject(JSON_LOGGER) logger?: LoggerService,
    @Optional() @Inject(ALERT_DESTINATIONS) destinations?: AlertDestination[]
  ) {
    this.logger = logger ?? createJsonLogger();
    this.thresholds = {
      errorRatePercent: positiveNumber(config, 'ALERT_ERROR_RATE_PERCENT', 20),
      minRouteRequests: positiveNumber(config, 'ALERT_MIN_ROUTE_REQUESTS', 5),
      latencyP95Ms: positiveNumber(config, 'ALERT_LATENCY_P95_MS', 1000),
      authFailures: positiveNumber(config, 'ALERT_AUTH_FAILURES_THRESHOLD', 10),
      rateLimits: positiveNumber(config, 'ALERT_RATE_LIMIT_THRESHOLD', 5),
      integrationFailures: positiveNumber(config, 'ALERT_INTEGRATION_FAILURES_THRESHOLD', 3),
      windowMs: positiveNumber(config, 'ALERT_WINDOW_SECONDS', 300) * 1000,
      silenceMs: positiveNumber(config, 'ALERT_SILENCE_SECONDS', 300) * 1000
    };
    this.destinations = [
      new StructuredLogAlertDestination(this.logger),
      ...(destinations ?? createAlertDestinations(config))
    ];
    if (!this.destinations.some((destination) => destination.name !== 'structured_log' && destination.isConfigured?.())) {
      this.logger.warn({ message: 'observability.alert.external_destination_not_configured' }, 'OBSERVABILITY');
    }
  }

  evaluate(snapshot = this.metrics.snapshot()): ActiveAlert[] {
    const now = Date.now();
    const candidates = this.collectCandidates(snapshot, now);
    this.removeInactive(candidates);
    for (const [id, candidate] of candidates) {
      const existing = this.active.get(id);
      const last = this.lastNotified.get(id) ?? 0;
      const entry: ActiveAlert = {
        id,
        severity: candidate.severity,
        message: candidate.message,
        startedAt: existing?.startedAt ?? new Date(now).toISOString(),
        lastNotifiedAt: existing?.lastNotifiedAt ?? new Date(last || now).toISOString()
      };
      if (!existing || now - last >= this.thresholds.silenceMs) {
        entry.lastNotifiedAt = new Date(now).toISOString();
        this.lastNotified.set(id, now);
        this.deliver(entry);
      }
      this.active.set(id, entry);
    }
    return this.listActive();
  }

  private collectCandidates(snapshot: ReturnType<MetricsService['snapshot']>, now: number): Map<string, AlertCandidate> {
    const candidates = new Map<string, AlertCandidate>();
    for (const route of snapshot.byRoute) {
      addRouteCandidates(candidates, route, this.thresholds, this.safeRoute(`${route.method} ${route.route}`));
    }
    addOperationalCandidates(candidates, this.metrics.operationalCounts(this.thresholds.windowMs, now), this.thresholds);
    return candidates;
  }

  private removeInactive(candidates: Map<string, AlertCandidate>): void {
    for (const id of this.active.keys()) {
      if (!candidates.has(id)) this.active.delete(id);
    }
  }

  listActive(): ActiveAlert[] {
    return Array.from(this.active.values(), (alert) => ({ ...alert }));
  }

  private safeRoute(route: string): string {
    return route.replace(/\b\d{14}\b/g, ':cnpj').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id');
  }

  private deliver(alert: ActiveAlert): void {
    for (const destination of this.destinations) {
      void Promise.resolve(destination.send(alert)).catch(() => {
        this.logger.warn({ message: 'observability.alert.delivery_failed', destination: destination.name ?? 'unknown' }, 'OBSERVABILITY');
      });
    }
  }
}
