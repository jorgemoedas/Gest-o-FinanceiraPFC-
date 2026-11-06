import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FiscalCalculationService, SIMPLES_TABLES, type SimplesAnnex } from '../../../backend/src/modules/fiscal/fiscal-calculation.service';
import { calculateMeiEstimate, calculateSimplesEstimate, type MeiActivity } from './simulator';

const exactService = new FiscalCalculationService();
const annexes = Object.keys(SIMPLES_TABLES) as SimplesAnnex[];
const boundaryCases = annexes.flatMap((annex) => SIMPLES_TABLES[annex].flatMap((band) => [
  { annex, rbt12: band.lower, band: band.band },
  { annex, rbt12: band.upper, band: band.band }
]));

beforeEach(() => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    try {
      const result = payload.regime === 'SIMPLES_NACIONAL'
        ? exactService.calculateSimples(payload as never)
        : exactService.calculateMei(payload as never);
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: error instanceof Error ? error.message : 'Erro fiscal' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('calculateSimplesEstimate', () => {
  it.each(boundaryCases)('compara a fronteira $annex/$band/$rbt12 ao serviço decimal.js', async ({ annex, rbt12, band }) => {
    const expected = exactService.calculateSimples({ annex, rbt12, monthlyRevenue: '1234.56' });
    const result = await calculateSimplesEstimate({ annex, rbt12, monthRevenue: '1234.56' });
    expect(result).toMatchObject({
      ok: true,
      annex,
      band,
      nominalRatePercent: expected.nominalRatePercent,
      deduction: expected.deduction,
      effectiveRatePercent: expected.effectiveRatePercent,
      effectiveRate: expected.effectiveRate,
      monthRevenue: expected.monthlyRevenue,
      estimatedTax: expected.monthlyTax
    });
  });

  it('preserva a transição de faixa no limite e o arredondamento final em centavos', async () => {
    const before = await calculateSimplesEstimate({ annex: 'I', rbt12: '180000.00', monthRevenue: '0.13' });
    const after = await calculateSimplesEstimate({ annex: 'I', rbt12: '180000.01', monthRevenue: '0.13' });
    expect(before).toMatchObject({ band: 1, estimatedTax: '0.01' });
    expect(after).toMatchObject({ band: 2, estimatedTax: '0.01' });
  });

  it('aceita o teto do Simples e rejeita faturamento acima dele pelo serviço', async () => {
    await expect(calculateSimplesEstimate({ annex: 'V', rbt12: '4800000.00', monthRevenue: '1.00' })).resolves.toMatchObject({ band: 6 });
    await expect(calculateSimplesEstimate({ annex: 'V', rbt12: '4800000.01', monthRevenue: '1.00' })).rejects.toThrow('não pode exceder');
  });
});

describe('calculateMeiEstimate', () => {
  it('compara o limite geral e a soma DAS 2026 com o serviço decimal.js', async () => {
    const expected = exactService.calculateMei({ annualRevenue: '81000.00', activity: 'GENERAL', isIcmsTaxpayer: true, isIssTaxpayer: true });
    const result = await calculateMeiEstimate({ activity: 'SERVICES', yearToDateRevenue: '81000.00', includeIcms: true, includeIss: true });
    expect(result).toMatchObject({
      ok: true,
      monthlyDas: expected.monthlyDas,
      annualLimit: expected.annualLimit,
      yearToDateRevenue: expected.annualRevenue,
      remainingLimit: expected.remainingLimit,
      limitUsedPercent: expected.limitUsedPercent,
      exceedsLimit: false
    });
  });

  it.each([
    ['SERVICES', '80999.99', 'GENERAL', '87.05'],
    ['CARGO_TRANSPORT', '251600.00', 'TRANSPORTADOR_AUTONOMO_CARGAS', '200.52']
  ] as const)('preserva a fronteira MEI %s/%s', async (activity, revenue, backendActivity, monthlyDas) => {
    const result = await calculateMeiEstimate({ activity, yearToDateRevenue: revenue, includeIcms: true, includeIss: true });
    const expected = exactService.calculateMei({ annualRevenue: revenue, activity: backendActivity, isIcmsTaxpayer: true, isIssTaxpayer: true });
    expect(result).toMatchObject({ monthlyDas: expected.monthlyDas, annualLimit: expected.annualLimit, remainingLimit: expected.remainingLimit });
    expect(result.monthlyDas).toBe(activity === 'CARGO_TRANSPORT' ? '200.52' : monthlyDas);
  });

  it('rejeita faturamento MEI acima do limite confirmado pelo serviço', async () => {
    await expect(calculateMeiEstimate({ activity: 'SERVICES', yearToDateRevenue: '81000.01', includeIcms: false, includeIss: false })).rejects.toThrow('excede o limite');
  });

  it('envia somente atividade MEI suportada ao backend', async () => {
    const fetchMock = vi.mocked(fetch);
    await calculateMeiEstimate({ activity: 'BOTH' as MeiActivity, yearToDateRevenue: '40500.00', includeIcms: false, includeIss: true });
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ regime: 'MEI_SIMEI', activity: 'GENERAL', annualRevenue: '40500.00', year: 2026 });
  });
});
