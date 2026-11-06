import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { describe, expect, it } from '@jest/globals';
import {
  FiscalCalculationService,
  SIMPLES_TABLES,
  type SimplesAnnex,
  type SimplesBand
} from './fiscal-calculation.service';

const source = 'LC 123/2006, art. 18, § 1º-A + tabela do Anexo correspondente na Resolução CGSN 140/2018 (Receita Federal)';
const service = new FiscalCalculationService();
const annexes = Object.keys(SIMPLES_TABLES) as SimplesAnnex[];
const ExactTestDecimal = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

function expectedEffectiveRatePercent(rbt12: string, band: SimplesBand): string {
  return new ExactTestDecimal(rbt12)
    .mul(band.nominalRatePercent)
    .div('100')
    .sub(band.deduction)
    .div(rbt12)
    .mul('100')
    .toString();
}

function expectedTax(rbt12: string, monthlyRevenue: string, band: SimplesBand): string {
  return new ExactTestDecimal(monthlyRevenue)
    .mul(new ExactTestDecimal(rbt12).mul(band.nominalRatePercent).div('100').sub(band.deduction).div(rbt12))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

describe('FiscalCalculationService — Simples Nacional com decimal.js', () => {
  for (const annex of annexes) {
    describe(`Anexo ${annex}`, () => {
      for (const band of SIMPLES_TABLES[annex]) {
        for (const boundary of ['lower', 'upper'] as const) {
          const rbt12 = band[boundary];
          it(`faixa ${band.band}: limite ${boundary} ${rbt12} — esperado da ${source}`, () => {
            const result = service.calculateSimples({ annex, rbt12, monthlyRevenue: '1234.56' });




            expect(result.band).toBe(band.band);
            expect(result.nominalRatePercent).toBe(new Decimal(band.nominalRatePercent).toFixed(2));
            expect(result.deduction).toBe(new Decimal(band.deduction).toFixed(2));
            expect(result.effectiveRatePercent).toBe(expectedEffectiveRatePercent(rbt12, band));
            expect(result.monthlyTax).toBe(expectedTax(rbt12, '1234.56', band));
            expect(result.rbt12).toBe(new Decimal(rbt12).toFixed(2));
          });
        }
      }
    });
  }

  it('faz memória completa do Anexo I em RBT12 de R$ 500.000,00 — esperado oficial: efetiva 6,728% e DAS demonstrativo R$ 672,80', () => {
    const result = service.calculateSimples({ annex: 'I', rbt12: '500000.00', monthlyRevenue: '10000.00' });
    expect(result).toMatchObject({
      band: 3,
      nominalRatePercent: '9.50',
      deduction: '13860.00',
      effectiveRatePercent: '6.728',
      effectiveRate: '0.06728',
      monthlyTax: '672.80'
    });


  });

  it('faz memória completa do Anexo III em RBT12 de R$ 1.000.000,00 — esperado oficial: efetiva 12,436% e DAS demonstrativo R$ 6.218,00', () => {
    const result = service.calculateSimples({ annex: 'III', rbt12: '1000000.00', monthlyRevenue: '50000.00' });
    expect(result).toMatchObject({
      band: 4,
      nominalRatePercent: '16.00',
      deduction: '35640.00',
      effectiveRatePercent: '12.436',
      effectiveRate: '0.12436',
      monthlyTax: '6218.00'
    });


  });

  it('faz memória completa do Anexo V com centavos — esperado oficial: efetiva 19,895% e DAS demonstrativo R$ 2.456,17', () => {
    const result = service.calculateSimples({ annex: 'V', rbt12: '2000000.00', monthlyRevenue: '12345.67' });
    expect(result).toMatchObject({
      band: 5,
      nominalRatePercent: '23.00',
      deduction: '62100.00',
      effectiveRatePercent: '19.895',
      effectiveRate: '0.19895',
      monthlyTax: '2456.17'
    });


  });

  it('arredonda apenas o tributo final por half-up, sem arredondar a alíquota efetiva', () => {
    const result = service.calculateSimples({ annex: 'I', rbt12: '180000.00', monthlyRevenue: '0.13' });
    expect(result.effectiveRatePercent).toBe('4');
    expect(result.monthlyTax).toBe('0.01');
  });

  it.each([
    ['negative RBT12', { annex: 'I' as SimplesAnnex, rbt12: '-0.01', monthlyRevenue: '1.00' }],
    ['zero RBT12', { annex: 'I' as SimplesAnnex, rbt12: '0.00', monthlyRevenue: '1.00' }],
    ['RBT12 acima do teto', { annex: 'V' as SimplesAnnex, rbt12: '4800000.01', monthlyRevenue: '1.00' }],
    ['negative receita mensal', { annex: 'II' as SimplesAnnex, rbt12: '180000.00', monthlyRevenue: '-0.01' }],
    ['zero receita mensal', { annex: 'II' as SimplesAnnex, rbt12: '180000.00', monthlyRevenue: '0.00' }],
    ['Number binário em RBT12', { annex: 'III' as SimplesAnnex, rbt12: 180000 as unknown as string, monthlyRevenue: '1.00' }],
    ['mais de duas casas', { annex: 'IV' as SimplesAnnex, rbt12: '180000.001', monthlyRevenue: '1.00' }]
  ])('%s é rejeitado antes do cálculo', (_name, input) => {
    expect(() => service.calculateSimples(input)).toThrow(BadRequestException);
  });
});

describe('FiscalCalculationService — MEI/SIMEI 2026 com decimal.js', () => {
  it('aceita exatamente o teto geral de R$ 81.000,00 e soma DAS 2026 completo R$ 87,05', () => {
    const result = service.calculateMei({
      annualRevenue: '81000.00',
      activity: 'GENERAL',
      isIcmsTaxpayer: true,
      isIssTaxpayer: true
    });
    expect(result).toMatchObject({
      annualLimit: '81000.00',
      inLimit: true,
      inss: '81.05',
      icms: '1.00',
      iss: '5.00',
      monthlyDas: '87.05'
    });

  });

  it('aceita centavos dentro do limite e calcula só a parcela de INSS quando não há ICMS/ISS', () => {
    const result = service.calculateMei({ annualRevenue: '80999.99', activity: 'GENERAL' });
    expect(result.inLimit).toBe(true);
    expect(result.monthlyDas).toBe('81.05');
  });

  it('aceita o limite oficial do MEI transportador de cargas e DAS 2026 de R$ 200,52 com ICMS e ISS', () => {
    const result = service.calculateMei({
      annualRevenue: '251600.00',
      activity: 'TRANSPORTADOR_AUTONOMO_CARGAS',
      isIcmsTaxpayer: true,
      isIssTaxpayer: true
    });
    expect(result).toMatchObject({ annualLimit: '251600.00', inss: '194.52', icms: '1.00', iss: '5.00', monthlyDas: '200.52' });

  });

  it.each([
    ['negative annual revenue', '-0.01', 'GENERAL'],
    ['zero annual revenue', '0.00', 'GENERAL'],
    ['above general annual limit', '81000.01', 'GENERAL'],
    ['above transport annual limit', '251600.01', 'TRANSPORTADOR_AUTONOMO_CARGAS']
  ])('%s é rejeitado', (_name, annualRevenue, activity) => {
    expect(() => service.calculateMei({ annualRevenue, activity: activity as 'GENERAL' | 'TRANSPORTADOR_AUTONOMO_CARGAS' })).toThrow(BadRequestException);
  });

  it('rejeita ano cujo DAS mensal ainda não foi confirmado por fonte oficial no escopo desta entrega', () => {
    expect(() => service.calculateMei({ annualRevenue: '81000.00', year: 2027 as 2026 })).toThrow(BadRequestException);
  });
});
