import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticsReportSchema, getFinanceAnalytics } from './analytics';

const report = {
  currency: 'BRL',
  period: { from: '2026-07-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', months: 3 },
  monthly: [{ monthKey: '2026-09', income: 100, expense: 40, net: 60, transactionCount: 2 }],
  trend: {
    income: { direction: 'UP', slopePerMonth: 2, changePercent: 10, explanation: 'subindo' },
    expense: { direction: 'FLAT', slopePerMonth: 0, changePercent: null, explanation: 'estável' },
    net: { direction: 'UP', slopePerMonth: 2, changePercent: 10, explanation: 'subindo' }
  },
  seasonality: { index: null, monthsObserved: 1, explanation: 'sem base' },
  projection: [{ monthKey: '2026-10', income: 100, expense: 40, net: 60 }],
  projectionAssumptions: ['tendência linear dos meses observados', 'ausência de eventos atípicos futuros'],
  alerts: [{ code: 'OVERDUE_RECEIVABLES', severity: 'WARNING', title: 'Atrasadas', explanation: '55', source: { metric: 'receivables.overdue', value: 55, reference: '2026-10-05' } }]
};

afterEach(() => vi.unstubAllGlobals());

describe('finance analytics client', () => {
  it('accepts the strict report schema and rejects unknown fields', () => {
    expect(analyticsReportSchema.safeParse(report).success).toBe(true);
    expect(analyticsReportSchema.safeParse({ ...report, extra: true }).success).toBe(false);
  });

  it('calls the relative BFF path with same-origin credentials and validates the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(report), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getFinanceAnalytics({ months: 3, projectionMonths: 1 })).resolves.toEqual(report);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/finance/analytics?months=3&projectionMonths=1');
    expect(init.credentials).toBe('same-origin');
  });

  it('surfaces API status messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Sessão expirou.' }), { status: 401 })));
    await expect(getFinanceAnalytics({ months: 3, projectionMonths: 1 })).rejects.toThrow('Sessão expirou.');
  });
});
