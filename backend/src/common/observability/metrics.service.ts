import { Injectable } from '@nestjs/common';

export interface RequestMetricInput {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

export interface RouteMetricSnapshot {
  method: string;
  route: string;
  count: number;
  errors: number;
  serverErrors: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface MetricsSnapshot {
  uptimeSeconds: number;
  totalRequests: number;
  totalErrors: number;
  byRoute: RouteMetricSnapshot[];
}

export interface OperationalCounts {
  authenticationFailures: number;
  rateLimits: number;
  integrationFailures: Record<string, number>;
}

type OperationalEvent = { type: 'authentication_failure' | 'rate_limit' | 'integration_failure'; integration?: string; at: number };

interface RouteMetric {
  method: string;
  route: string;
  count: number;
  errors: number;
  serverErrors: number;
  durations: number[];
}

type NormalizedMetric = { method: string; route: string; durationMs: number; isError: boolean; isServerError: boolean };

function normalizeMetric(input: RequestMetricInput): NormalizedMetric {
  const method = input.method.trim().toUpperCase() || 'UNKNOWN';
  const route = input.route.split('?')[0] || '/';
  const durationMs = Number.isFinite(input.durationMs) && input.durationMs >= 0 ? input.durationMs : 0;
  const statusCode = Number.isFinite(input.statusCode) ? input.statusCode : 500;
  return { method, route, durationMs, isError: statusCode >= 400, isServerError: statusCode >= 500 };
}

@Injectable()
export class MetricsService {
  private static readonly maxRoutes = 100;
  private static readonly maxSamplesPerRoute = 500;
  private startedAt = Date.now();
  private totalRequests = 0;
  private totalErrors = 0;
  private readonly routes = new Map<string, RouteMetric>();
  private readonly operationalEvents: OperationalEvent[] = [];

  recordOperationalEvent(type: OperationalEvent['type'], integration?: string): void {
    const safeIntegration = integration === 'gemini' || integration === 'receitaws' ? integration : undefined;
    this.operationalEvents.push({ type, ...(safeIntegration ? { integration: safeIntegration } : {}), at: Date.now() });
    this.pruneOperationalEvents(Date.now() - 10 * 60_000);
  }

  operationalCounts(windowMs: number, now = Date.now()): OperationalCounts {
    this.pruneOperationalEvents(now - Math.max(windowMs, 10 * 60_000));
    const recent = this.operationalEvents.filter((event) => event.at >= now - windowMs);
    const integrationFailures: Record<string, number> = {};
    for (const event of recent) {
      if (event.type === 'integration_failure' && event.integration) {
        integrationFailures[event.integration] = (integrationFailures[event.integration] ?? 0) + 1;
      }
    }
    return {
      authenticationFailures: recent.filter((event) => event.type === 'authentication_failure').length,
      rateLimits: recent.filter((event) => event.type === 'rate_limit').length,
      integrationFailures
    };
  }

  recordRequest(input: RequestMetricInput): void {
    const normalized = normalizeMetric(input);

    this.totalRequests += 1;
    if (normalized.isError) this.totalErrors += 1;

    const metric = this.getOrCreateMetric(normalized);
    if (!metric) return;
    metric.count += 1;
    if (normalized.isError) metric.errors += 1;
    if (normalized.isServerError) metric.serverErrors += 1;
    metric.durations.push(normalized.durationMs);
    if (metric.durations.length > MetricsService.maxSamplesPerRoute) metric.durations.shift();
  }

  private getOrCreateMetric(input: NormalizedMetric): RouteMetric | undefined {
    const key = `${input.method} ${input.route}`;
    const current = this.routes.get(key);
    if (current) return current;
    if (this.routes.size >= MetricsService.maxRoutes) return undefined;
    const metric = { method: input.method, route: input.route, count: 0, errors: 0, serverErrors: 0, durations: [] };
    this.routes.set(key, metric);
    return metric;
  }

  snapshot(): MetricsSnapshot {
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      byRoute: Array.from(this.routes.values(), (metric) => {
        const sorted = [...metric.durations].sort((left, right) => left - right);
        return {
          method: metric.method,
          route: metric.route,
          count: metric.count,
          errors: metric.errors,
          serverErrors: metric.serverErrors,
          p50Ms: this.percentile(sorted, 0.5),
          p95Ms: this.percentile(sorted, 0.95),
          maxMs: sorted.at(-1) ?? 0
        };
      })
    };
  }

  reset(): void {
    this.startedAt = Date.now();
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.routes.clear();
    this.operationalEvents.length = 0;
  }

  private pruneOperationalEvents(cutoff: number): void {
    while (this.operationalEvents.length && this.operationalEvents[0].at < cutoff) this.operationalEvents.shift();
  }

  private percentile(sorted: number[], fraction: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
    return sorted[index] ?? 0;
  }
}
