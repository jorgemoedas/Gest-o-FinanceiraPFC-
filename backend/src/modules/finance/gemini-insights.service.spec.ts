import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthPrincipal } from '../../common/auth-principal';
import { RateLimitException } from '../../common/exceptions/rate-limit.exception';
import { AuditLogWriter } from '../audit/audit-log-writer.service';
import { FinanceService } from './finance.service';
import { GeminiInsightsService } from './gemini-insights.service';

const principal: AuthPrincipal = {
  userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  email: 'owner@example.test',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  role: 'OWNER' as AuthPrincipal['role']
};

const dashboard = {
  currency: 'BRL',
  period: { months: 6, from: '2026-05-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
  summary: { income: 1000, expense: 300, net: 700, transactionCount: 2 },
  monthly: [{ month: '2026-10', label: 'out/26', income: 1000, expense: 300, net: 700 }],
  expensesByCategory: [{ category: 'TAXES', amount: 300, sharePercent: 100 }],
  recentTransactions: [{ description: 'texto pessoal que não deve ir ao Gemini' }]
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('GeminiInsightsService', () => {
  const config = { get: jest.fn() } as unknown as ConfigService;
  const finance = { getDashboard: jest.fn() } as unknown as FinanceService;
  const audit = { write: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogWriter;
  let service: GeminiInsightsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GeminiInsightsService(config, finance, audit);
  });

  it('does not call Gemini when there are no database transactions', async () => {
    jest.mocked(finance.getDashboard).mockResolvedValue({ ...dashboard, summary: { ...dashboard.summary, transactionCount: 0 } } as never);
    const fetch = jest.spyOn(global, 'fetch');
    const result = await service.create(principal, 6);
    expect(result.generated).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it('requires a server-side key only when generating an insight and logs the attempt', async () => {
    jest.mocked(finance.getDashboard).mockResolvedValue(dashboard as never);
    jest.mocked(config.get).mockReturnValue(undefined);
    await expect(service.create(principal, 6)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FINANCE_GEMINI_INSIGHTS_REQUESTED',
      metadata: expect.objectContaining({ result: 'missing_key' })
    }));
  });

  it('sends only aggregate metrics to Gemini and extracts generated text', async () => {
    jest.mocked(finance.getDashboard).mockResolvedValue(dashboard as never);
    jest.mocked(config.get).mockImplementation(((key: string, fallback?: string) => {
      if (key === 'GEMINI_API_KEY') return 'unit-test-key';
      if (key === 'GEMINI_MODEL') return fallback ?? 'gemini-3.8-flash';
      return fallback;
    }) as never);
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Despesas representam 30% das entradas.' }] }]
    }));

    const result = await service.create(principal, 6);
    const requestBody = JSON.parse(String(fetch.mock.calls[0][1]?.body)) as { model: string; input: string };
    expect(result).toMatchObject({ generated: true, model: 'gemini-3.8-flash', insights: 'Despesas representam 30% das entradas.' });
    expect(fetch.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ 'x-goog-api-key': 'unit-test-key' });
    expect(requestBody.model).toBe('gemini-3.8-flash');
    expect(requestBody.input).toContain('"income":1000');
    expect(requestBody.input).not.toContain('texto pessoal');
    expect(requestBody.input).not.toContain(principal.companyId);
    fetch.mockRestore();
  });

  it("converts the provider's quota response to a safe throttling message", async () => {
    jest.mocked(finance.getDashboard).mockResolvedValue(dashboard as never);
    jest.mocked(config.get).mockImplementation(((key: string, fallback?: string) => key === 'GEMINI_API_KEY' ? 'unit-test-key' : fallback) as never);
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 429 }));
    await expect(service.create(principal, 6)).rejects.toBeInstanceOf(RateLimitException);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ result: 'provider_429' })
    }));
    fetch.mockRestore();
  });

  it("maps a temporary provider 503 to a retryable service-unavailable response", async () => {
    jest.mocked(finance.getDashboard).mockResolvedValue(dashboard as never);
    jest.mocked(config.get).mockImplementation(((key: string, fallback?: string) => key === 'GEMINI_API_KEY' ? 'unit-test-key' : fallback) as never);
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));
    await expect(service.create(principal, 6)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ result: 'provider_503', model: 'gemini-3.5-flash-lite' })
    }));
    fetch.mockRestore();
  });

  it('uses one low-cost fallback after a primary 503 and reports the model that generated the insight', async () => {
    jest.mocked(finance.getDashboard).mockResolvedValue(dashboard as never);
    jest.mocked(config.get).mockImplementation(((key: string, fallback?: string) => key === 'GEMINI_API_KEY' ? 'unit-test-key' : fallback) as never);
    const fetch = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ output_text: 'As despesas equivalem a 30% das entradas.' }));

    const result = await service.create(principal, 6);
    const models = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).model);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(models).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(result).toMatchObject({ generated: true, model: 'gemini-3.5-flash-lite', insights: 'As despesas equivalem a 30% das entradas.' });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ result: 'success_fallback', model: 'gemini-3.5-flash-lite' })
    }));
    fetch.mockRestore();
  });
});
