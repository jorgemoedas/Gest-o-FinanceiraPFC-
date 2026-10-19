import { describe, expect, it } from 'vitest';
import {
  calculateMeiEstimate,
  calculateSimplesEstimate,
  MEI_ANNUAL_REVENUE_LIMIT,
  MEI_CARGO_INSS,
  MEI_REGULAR_INSS,
  SIMPLES_REVENUE_LIMIT,
  TAX_YEAR
} from './simulator';

describe('calculateSimplesEstimate', () => {
  it('usa alíquota da primeira faixa e calcula a estimativa mensal', () => {
    const result = calculateSimplesEstimate({ annex: 'I', rbt12: 180_000, monthRevenue: 12_500 });
    expect(result).toMatchObject({
      ok: true,
      bracket: 'Até R$ 180.000',
      nominalRatePercent: 4,
      effectiveRatePercent: 4,
      estimatedTax: 500
    });
  });

  it('aplica a parcela a deduzir da faixa correta', () => {
    const result = calculateSimplesEstimate({ annex: 'I', rbt12: 200_000, monthRevenue: 30_000 });
    expect(result).toMatchObject({
      ok: true,
      bracket: 'R$ 180.000,01 a R$ 360.000',
      nominalRatePercent: 7.3,
      deduction: 5_940,
      effectiveRatePercent: 4.33,
      estimatedTax: 1_299
    });
  });

  it.each([
    ['II', 7.8, 5_940],
    ['III', 11.2, 9_360],
    ['IV', 9, 8_100],
    ['V', 18, 4_500]
  ] as const)('carrega a primeira faixa oficial do Anexo %s', (annex, nominalRatePercent, deduction) => {
    const result = calculateSimplesEstimate({ annex, rbt12: 200_000, monthRevenue: 10_000 });
    expect(result).toMatchObject({ ok: true, nominalRatePercent, deduction });
  });

  it('aceita o limite superior tabulado e recusa RBT12 fora do escopo', () => {
    expect(calculateSimplesEstimate({ annex: 'I', rbt12: SIMPLES_REVENUE_LIMIT, monthRevenue: 1 }).ok).toBe(true);
    expect(calculateSimplesEstimate({ annex: 'I', rbt12: SIMPLES_REVENUE_LIMIT + 1, monthRevenue: 1 })).toMatchObject({ ok: false });
    expect(calculateSimplesEstimate({ annex: 'I', rbt12: 0, monthRevenue: 1 })).toMatchObject({ ok: false });
  });

  it('recusa receita mensal negativa, NaN e infinito', () => {
    for (const monthRevenue of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(calculateSimplesEstimate({ annex: 'I', rbt12: 90_000, monthRevenue })).toMatchObject({ ok: false });
    }
  });
});

describe('calculateMeiEstimate', () => {
  it('registra a base legal do ano de referência', () => {
    expect(TAX_YEAR).toBe(2026);
    expect(MEI_ANNUAL_REVENUE_LIMIT).toBe(81_000);
  });

  it('calcula a guia mensal ordinária com adicional de ISS', () => {
    const result = calculateMeiEstimate({
      activity: 'SERVICES', yearToDateRevenue: 40_500, monthsActive: 12, includeIcms: false, includeIss: true
    });
    expect(result).toMatchObject({
      ok: true,
      monthlyDas: 86.05,
      annualLimit: 81_000,
      remainingLimit: 40_500,
      limitUsedPercent: 50,
      exceedsLimit: false
    });
  });

  it('usa o limite proporcional de R$ 6.750 por mês ativo', () => {
    const result = calculateMeiEstimate({
      activity: 'COMMERCE_INDUSTRY', yearToDateRevenue: 41_000, monthsActive: 6, includeIcms: true, includeIss: false
    });
    expect(result).toMatchObject({ ok: true, monthlyDas: 82.05, annualLimit: 40_500, exceedsLimit: true });
  });

  it('inclui os adicionais selecionados e a contribuição diferenciada do transportador', () => {
    const result = calculateMeiEstimate({
      activity: 'CARGO_TRANSPORT', yearToDateRevenue: 0, monthsActive: 12, includeIcms: true, includeIss: true
    });
    expect(MEI_CARGO_INSS).toBe(194.52);
    expect(MEI_REGULAR_INSS).toBe(81.05);
    expect(result).toMatchObject({ ok: true, monthlyDas: 200.52, exceedsLimit: false });
  });

  it('recusa período e faturamento inválidos', () => {
    expect(calculateMeiEstimate({ activity: 'BOTH', yearToDateRevenue: 0, monthsActive: 0, includeIcms: true, includeIss: true })).toMatchObject({ ok: false });
    expect(calculateMeiEstimate({ activity: 'BOTH', yearToDateRevenue: -1, monthsActive: 12, includeIcms: true, includeIss: true })).toMatchObject({ ok: false });
    expect(calculateMeiEstimate({ activity: 'BOTH', yearToDateRevenue: Number.NaN, monthsActive: 12, includeIcms: true, includeIss: true })).toMatchObject({ ok: false });
  });

  it('recusa categoria de atividade MEI não suportada', () => {
    expect(calculateMeiEstimate({
      activity: 'INVALID' as never,
      yearToDateRevenue: 0,
      monthsActive: 12,
      includeIcms: false,
      includeIss: false
    })).toMatchObject({ ok: false, message: 'Selecione uma categoria de atividade MEI válida.' });
  });
});
