import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AlertsService } from './alerts.service';
import { MetricsService } from './metrics.service';

describe('AlertsService', () => {
  let metrics: MetricsService;
  let service: AlertsService;
  const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn(), verbose: jest.fn(), fatal: jest.fn(), setLogLevels: jest.fn() };
  const config = { get: jest.fn((key: string, fallback?: string) => fallback) } as unknown as ConfigService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-16T12:00:00.000Z'));
    jest.clearAllMocks();
    metrics = new MetricsService();
    service = new AlertsService(metrics, config, logger);
    logger.warn.mockClear();
  });

  afterEach(() => { jest.useRealTimers(); });

  it('dispara alerta para taxa de erro acima do limiar com amostras suficientes', () => {
    for (let index = 0; index < 5; index += 1) {
      metrics.recordRequest({ method: 'GET', route: '/api/items', statusCode: index < 2 ? 500 : 200, durationMs: 10 });
    }
    const active = service.evaluate();
    expect(active).toEqual([expect.objectContaining({ id: 'route_error:GET /api/items', severity: 'warning' })]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('não dispara alerta quando a taxa está abaixo do limiar ou há poucas amostras', () => {
    for (let index = 0; index < 4; index += 1) {
      metrics.recordRequest({ method: 'GET', route: '/api/items', statusCode: index === 0 ? 500 : 200, durationMs: 20 });
    }
    expect(service.evaluate()).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('envia o alerta ao destino HTTP simulado e ignora respostas 4xx na taxa de erro 5xx', async () => {
    const destination = {
      name: 'http-simulado',
      isConfigured: () => true,
      send: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };
    service = new AlertsService(metrics, config, logger, [destination]);
    logger.warn.mockClear();
    for (let index = 0; index < 5; index += 1) {
      metrics.recordRequest({ method: 'GET', route: '/api/items', statusCode: index < 2 ? 400 : 200, durationMs: 10 });
    }
    expect(service.evaluate()).toEqual([]);

    metrics.reset();
    for (let index = 0; index < 5; index += 1) {
      metrics.recordRequest({ method: 'GET', route: '/api/items', statusCode: index < 2 ? 500 : 200, durationMs: 10 });
    }
    expect(service.evaluate()).toEqual([expect.objectContaining({ id: 'route_error:GET /api/items' })]);
    expect(destination.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'route_error:GET /api/items' }));
  });

  it('deduplica alertas durante a janela de silêncio e volta a notificar após seu término', () => {
    for (let index = 0; index < 5; index += 1) {
      metrics.recordRequest({ method: 'POST', route: '/api/items', statusCode: 500, durationMs: 20 });
    }
    service.evaluate();
    service.evaluate();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(300_001);
    service.evaluate();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('avalia falhas de autenticação, limite de requisições e integrações na janela configurada', () => {
    for (let index = 0; index < 10; index += 1) metrics.recordOperationalEvent('authentication_failure');
    for (let index = 0; index < 5; index += 1) metrics.recordOperationalEvent('rate_limit');
    for (let index = 0; index < 3; index += 1) metrics.recordOperationalEvent('integration_failure', 'gemini');
    expect(service.evaluate().map(({ id }) => id)).toEqual(expect.arrayContaining([
      'authentication_failures', 'rate_limit_refusals', 'integration_failure:gemini'
    ]));
  });
});
