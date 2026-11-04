import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

/**
 * Todas as entradas monetárias e alíquotas deste módulo são strings decimais.
 * Isso evita que um Number seja criado no limite do serviço ou no caminho de
 * cálculo. O Decimal é configurado com precisão muito superior à necessária
 * para o teto do Simples e só há arredondamento no valor monetário final.
 */
const ExactDecimal = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
type Exact = InstanceType<typeof ExactDecimal>;

export type SimplesAnnex = 'I' | 'II' | 'III' | 'IV' | 'V';
export type MeiActivity = 'GENERAL' | 'TRANSPORTADOR_AUTONOMO_CARGAS';

export const SIMPLES_TABLE_SOURCE_URL = 'https://normasinternet2.receita.fazenda.gov.br/api/consulta-externa/ato/92278/anexo/';
export const SIMPLES_FORMULA_SOURCE_URL = 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm';
export const MEI_2026_SOURCE_URL = 'https://www8.receita.fazenda.gov.br/simplesnacional/noticias/NoticiaCompleta.aspx?id=c3b2044c-ff97-432a-b33c-ecf2a3df6dc3';

const BAND_ZERO = '0.00';
const BAND_START = '0.01';
const BAND_180000 = '180000.00';
const BAND_180000_START = '180000.01';
const BAND_360000 = '360000.00';
const BAND_360000_START = '360000.01';
const BAND_720000 = '720000.00';
const BAND_720000_START = '720000.01';
const BAND_1800000 = '1800000.00';
const BAND_1800000_START = '1800000.01';
const BAND_3600000 = '3600000.00';
const BAND_3600000_START = '3600000.01';
const BAND_4800000 = '4800000.00';

export interface SimplesBand {
  readonly band: 1 | 2 | 3 | 4 | 5 | 6;
  /** Inclusive lower boundary, represented as decimal text. */
  readonly lower: string;
  /** Inclusive upper boundary, represented as decimal text. */
  readonly upper: string;
  /** Nominal rate in percentage points, not a fraction. */
  readonly nominalRatePercent: string;
  readonly deduction: string;
}

export const SIMPLES_TABLES: Readonly<Record<SimplesAnnex, readonly SimplesBand[]>> = {
  I: [
    { band: 1, lower: BAND_START, upper: BAND_180000, nominalRatePercent: '4.00', deduction: BAND_ZERO },
    { band: 2, lower: BAND_180000_START, upper: BAND_360000, nominalRatePercent: '7.30', deduction: '5940.00' },
    { band: 3, lower: BAND_360000_START, upper: BAND_720000, nominalRatePercent: '9.50', deduction: '13860.00' },
    { band: 4, lower: BAND_720000_START, upper: BAND_1800000, nominalRatePercent: '10.70', deduction: '22500.00' },
    { band: 5, lower: BAND_1800000_START, upper: BAND_3600000, nominalRatePercent: '14.30', deduction: '87300.00' },
    { band: 6, lower: BAND_3600000_START, upper: BAND_4800000, nominalRatePercent: '19.00', deduction: '378000.00' }
  ],
  II: [
    { band: 1, lower: BAND_START, upper: BAND_180000, nominalRatePercent: '4.50', deduction: BAND_ZERO },
    { band: 2, lower: BAND_180000_START, upper: BAND_360000, nominalRatePercent: '7.80', deduction: '5940.00' },
    { band: 3, lower: BAND_360000_START, upper: BAND_720000, nominalRatePercent: '10.00', deduction: '13860.00' },
    { band: 4, lower: BAND_720000_START, upper: BAND_1800000, nominalRatePercent: '11.20', deduction: '22500.00' },
    { band: 5, lower: BAND_1800000_START, upper: BAND_3600000, nominalRatePercent: '14.70', deduction: '85500.00' },
    { band: 6, lower: BAND_3600000_START, upper: BAND_4800000, nominalRatePercent: '30.00', deduction: BAND_720000 }
  ],
  III: [
    { band: 1, lower: BAND_START, upper: BAND_180000, nominalRatePercent: '6.00', deduction: BAND_ZERO },
    { band: 2, lower: BAND_180000_START, upper: BAND_360000, nominalRatePercent: '11.20', deduction: '9360.00' },
    { band: 3, lower: BAND_360000_START, upper: BAND_720000, nominalRatePercent: '13.50', deduction: '17640.00' },
    { band: 4, lower: BAND_720000_START, upper: BAND_1800000, nominalRatePercent: '16.00', deduction: '35640.00' },
    { band: 5, lower: BAND_1800000_START, upper: BAND_3600000, nominalRatePercent: '21.00', deduction: '125640.00' },
    { band: 6, lower: BAND_3600000_START, upper: BAND_4800000, nominalRatePercent: '33.00', deduction: '648000.00' }
  ],
  IV: [
    { band: 1, lower: BAND_START, upper: BAND_180000, nominalRatePercent: '4.50', deduction: BAND_ZERO },
    { band: 2, lower: BAND_180000_START, upper: BAND_360000, nominalRatePercent: '9.00', deduction: '8100.00' },
    { band: 3, lower: BAND_360000_START, upper: BAND_720000, nominalRatePercent: '10.20', deduction: '12420.00' },
    { band: 4, lower: BAND_720000_START, upper: BAND_1800000, nominalRatePercent: '14.00', deduction: '39780.00' },
    { band: 5, lower: BAND_1800000_START, upper: BAND_3600000, nominalRatePercent: '22.00', deduction: '183780.00' },
    { band: 6, lower: BAND_3600000_START, upper: BAND_4800000, nominalRatePercent: '33.00', deduction: '828000.00' }
  ],
  V: [
    { band: 1, lower: BAND_START, upper: BAND_180000, nominalRatePercent: '15.50', deduction: BAND_ZERO },
    { band: 2, lower: BAND_180000_START, upper: BAND_360000, nominalRatePercent: '18.00', deduction: '4500.00' },
    { band: 3, lower: BAND_360000_START, upper: BAND_720000, nominalRatePercent: '19.50', deduction: '9900.00' },
    { band: 4, lower: BAND_720000_START, upper: BAND_1800000, nominalRatePercent: '20.50', deduction: '17100.00' },
    { band: 5, lower: BAND_1800000_START, upper: BAND_3600000, nominalRatePercent: '23.00', deduction: '62100.00' },
    { band: 6, lower: BAND_3600000_START, upper: BAND_4800000, nominalRatePercent: '30.50', deduction: '540000.00' }
  ]
};

export interface CalculateSimplesInput {
  annex: SimplesAnnex;
  /** Receita bruta acumulada nos 12 meses anteriores (RBT12). */
  rbt12: string;
  /** Receita bruta do período de apuração sobre a qual incide a alíquota. */
  monthlyRevenue: string;
}

export interface SimplesCalculationResult {
  regime: 'SIMPLES_NACIONAL';
  annex: SimplesAnnex;
  rbt12: string;
  monthlyRevenue: string;
  band: SimplesBand['band'];
  nominalRatePercent: string;
  deduction: string;
  /** Percentage points, retained as a decimal string without intermediate rounding. */
  effectiveRatePercent: string;
  /** Fractional rate, retained as a decimal string without intermediate rounding. */
  effectiveRate: string;
  /** Monthly tax rounded once, to two decimal places, with half-up rounding. */
  monthlyTax: string;
  rounding: 'HALF_UP_2_DECIMAL_PLACES_ON_MONTHLY_TAX_ONLY';
  source: typeof SIMPLES_FORMULA_SOURCE_URL;
}

export interface CalculateMeiInput {
  /** Revenue accumulated in the calendar year, in decimal text. */
  annualRevenue: string;
  activity?: MeiActivity;
  isIcmsTaxpayer?: boolean;
  isIssTaxpayer?: boolean;
  /** The 2026 fixed DAS table is the only monthly amount confirmed here. */
  year?: 2026;
}

export interface MeiCalculationResult {
  regime: 'MEI_SIMEI';
  year: 2026;
  activity: MeiActivity;
  annualRevenue: string;
  annualLimit: string;
  inLimit: true;
  inss: string;
  icms: string;
  iss: string;
  monthlyDas: string;
  remainingLimit: string;
  limitUsedPercent: string;
  rounding: 'HALF_UP_2_DECIMAL_PLACES_ON_FIXED_DAS_SUM';
  source: typeof MEI_2026_SOURCE_URL;
}

const MEI_2026 = {
  GENERAL_LIMIT: '81000.00',
  TRANSPORT_LIMIT: '251600.00',
  GENERAL_INSS: '81.05',
  TRANSPORT_INSS: '194.52',
  ICMS: '1.00',
  ISS: '5.00'
} as const;

function decimalText(value: Exact): string {
  return value.toString();
}

function validateMeiInput(input: CalculateMeiInput): void {
  if (!input || input.year !== undefined && input.year !== 2026) throw new BadRequestException('A tabela de DAS confirmada pelo simulador é a do ano-calendário 2026.');
  if (input.activity !== undefined && input.activity !== 'GENERAL' && input.activity !== 'TRANSPORTADOR_AUTONOMO_CARGAS') throw new BadRequestException('Atividade MEI inválida.');
}

@Injectable()
export class FiscalCalculationService {
  calculateSimples(input: CalculateSimplesInput): SimplesCalculationResult {
    if (!input || !Object.prototype.hasOwnProperty.call(SIMPLES_TABLES, input.annex)) {
      throw new BadRequestException('O anexo deve ser I, II, III, IV ou V.');
    }

    const rbt12 = this.money(input.rbt12, 'RBT12');
    const monthlyRevenue = this.money(input.monthlyRevenue, 'receita mensal');
    const maximum = new ExactDecimal(BAND_4800000);
    if (rbt12.isZero()) throw new BadRequestException('RBT12 deve ser maior que zero.');
    if (rbt12.gt(maximum)) throw new BadRequestException('RBT12 não pode exceder R$ 4.800.000,00.');
    if (monthlyRevenue.isZero()) throw new BadRequestException('A receita mensal deve ser maior que zero.');

    const table = SIMPLES_TABLES[input.annex];
    const band = table.find((candidate) => {
      const lower = new ExactDecimal(candidate.lower);
      const upper = new ExactDecimal(candidate.upper);
      return rbt12.gte(lower) && rbt12.lte(upper);
    });
    if (!band) throw new BadRequestException('A receita está fora das faixas do Simples Nacional.');

    const nominalRatePercent = new ExactDecimal(band.nominalRatePercent);
    const deduction = new ExactDecimal(band.deduction);
    // LC 123/2006, art. 18, § 1º-A: (RBT12 × Aliq − PD) / RBT12.
    // Aliq is stored in percentage points, so divide by 100 only here.
    const effectiveRate = rbt12.mul(nominalRatePercent).div('100').sub(deduction).div(rbt12);
    const effectiveRatePercent = effectiveRate.mul('100');
    const monthlyTax = monthlyRevenue.mul(effectiveRate).toDecimalPlaces(2, ExactDecimal.ROUND_HALF_UP);

    return {
      regime: 'SIMPLES_NACIONAL',
      annex: input.annex,
      rbt12: rbt12.toFixed(2),
      monthlyRevenue: monthlyRevenue.toFixed(2),
      band: band.band,
      nominalRatePercent: nominalRatePercent.toFixed(2),
      deduction: deduction.toFixed(2),
      effectiveRatePercent: decimalText(effectiveRatePercent),
      effectiveRate: decimalText(effectiveRate),
      monthlyTax: monthlyTax.toFixed(2),
      rounding: 'HALF_UP_2_DECIMAL_PLACES_ON_MONTHLY_TAX_ONLY',
      source: SIMPLES_FORMULA_SOURCE_URL
    };
  }

  /** Alias explícito para chamadas que usam o nome legal completo do regime. */
  calculateSimplesNacional(input: CalculateSimplesInput): SimplesCalculationResult {
    return this.calculateSimples(input);
  }

  calculateMei(input: CalculateMeiInput): MeiCalculationResult {
    validateMeiInput(input);
    const activity = input.activity ?? 'GENERAL';
    const annualRevenue = this.money(input.annualRevenue, 'receita anual do MEI');
    const annualLimit = new ExactDecimal(activity === 'GENERAL' ? MEI_2026.GENERAL_LIMIT : MEI_2026.TRANSPORT_LIMIT);
    if (annualRevenue.isZero()) throw new BadRequestException('A receita anual do MEI deve ser maior que zero.');
    if (annualRevenue.gt(annualLimit)) {
      throw new BadRequestException(`A receita anual excede o limite do MEI de R$ ${annualLimit.toFixed(2)}.`);
    }

    const inss = new ExactDecimal(activity === 'GENERAL' ? MEI_2026.GENERAL_INSS : MEI_2026.TRANSPORT_INSS);
    const icms = input.isIcmsTaxpayer ? new ExactDecimal(MEI_2026.ICMS) : new ExactDecimal(BAND_ZERO);
    const iss = input.isIssTaxpayer ? new ExactDecimal(MEI_2026.ISS) : new ExactDecimal(BAND_ZERO);
    const monthlyDas = inss.add(icms).add(iss).toDecimalPlaces(2, ExactDecimal.ROUND_HALF_UP);

    return {
      regime: 'MEI_SIMEI',
      year: 2026,
      activity,
      annualRevenue: annualRevenue.toFixed(2),
      annualLimit: annualLimit.toFixed(2),
      inLimit: true,
      inss: inss.toFixed(2),
      icms: icms.toFixed(2),
      iss: iss.toFixed(2),
      monthlyDas: monthlyDas.toFixed(2),
      remainingLimit: annualLimit.sub(annualRevenue).toFixed(2),
      limitUsedPercent: annualRevenue.div(annualLimit).mul('100').toString(),
      rounding: 'HALF_UP_2_DECIMAL_PLACES_ON_FIXED_DAS_SUM',
      source: MEI_2026_SOURCE_URL
    };
  }

  calculateMEI(input: CalculateMeiInput): MeiCalculationResult {
    return this.calculateMei(input);
  }

  private money(value: unknown, label: string): Exact {
    // Deliberately reject Number: accepting it would already have crossed the
    // binary floating-point boundary before Decimal could protect the value.
    if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
      throw new BadRequestException(`${label} deve ser uma string decimal não negativa com até duas casas.`);
    }
    const amount = new ExactDecimal(value);
    if (!amount.isFinite() || amount.isNegative()) {
      throw new BadRequestException(`${label} deve ser uma string decimal não negativa.`);
    }
    return amount;
  }
}
