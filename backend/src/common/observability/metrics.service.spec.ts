import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('calculates p50 and p95 and counts errors', () => {
    const metrics = new MetricsService();
    [10, 20, 30, 40, 50].forEach((durationMs) => {
      metrics.recordRequest({ method: 'get', route: '/health', statusCode: durationMs === 50 ? 500 : 200, durationMs });
    });

    expect(metrics.snapshot()).toMatchObject({ totalRequests: 5, totalErrors: 1 });
    expect(metrics.snapshot().byRoute[0]).toMatchObject({ method: 'GET', route: '/health', count: 5, errors: 1, p50Ms: 30, p95Ms: 50, maxMs: 50 });
  });

  it('keeps at most 500 duration samples per route and supports reset', () => {
    const metrics = new MetricsService();
    for (let index = 0; index < 501; index += 1) {
      metrics.recordRequest({ method: 'GET', route: '/sample', statusCode: 200, durationMs: index });
    }

    expect(metrics.snapshot().byRoute[0]).toMatchObject({ count: 501, p50Ms: 250, p95Ms: 475, maxMs: 500 });
    metrics.reset();
    expect(metrics.snapshot()).toEqual({ uptimeSeconds: 0, totalRequests: 0, totalErrors: 0, byRoute: [] });
  });
});
