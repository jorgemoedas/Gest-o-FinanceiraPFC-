export type SimplesAnnex = 'I' | 'II' | 'III' | 'IV' | 'V';
export type MeiActivity = 'COMMERCE_INDUSTRY' | 'SERVICES' | 'BOTH' | 'CARGO_TRANSPORT';

export interface SimplesInput {
  annex: SimplesAnnex;
  rbt12: number;
  monthRevenue: number;
}

export interface SimplesEstimate {
  ok: true;
  annex: SimplesAnnex;
  bracket: string;
  nominalRatePercent: number;
  deduction: number;
  effectiveRatePercent: number;
  monthRevenue: number;
  estimatedTax: number;
}

export interface MeiInput {
  activity: MeiActivity;
  yearToDateRevenue: number;
  monthsActive: number;
  includeIcms: boolean;
  includeIss: boolean;
}

export interface MeiEstimate {
  ok: true;
  activity: MeiActivity;
  monthlyDas: number;
  annualLimit: number;
  yearToDateRevenue: number;
  remainingLimit: number;
  limitUsedPercent: number;
  exceedsLimit: boolean;
}

export type EstimateError = { ok: false; message: string };

interface Bracket {
  maxRevenue: number;
  label: string;
  nominalRatePercent: number;
  deduction: number;
}

export const TAX_YEAR = 2026;
export const SIMPLES_REVENUE_LIMIT = 4_800_000;
export const MEI_ANNUAL_REVENUE_LIMIT = 81_000;
export const MEI_MONTHLY_REVENUE_LIMIT = 6_750;
export const MEI_MONTHLY_MINIMUM_WAGE = 1_621;
export const MEI_REGULAR_INSS = 81.05;
export const MEI_CARGO_INSS = 194.52;
export const MEI_ICMS = 1;
export const MEI_ISS = 5;
export const SIMPLES_FACTORS = {
  rbt12Threshold: 28,
  formula: '(RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12'
} as const;

const bands: Record<SimplesAnnex, readonly Bracket[]> = {
  I: [
    { maxRevenue: 180_000, label: 'Até R$ 180.000', nominalRatePercent: 4, deduction: 0 },
    { maxRevenue: 360_000, label: 'R$ 180.000,01 a R$ 360.000', nominalRatePercent: 7.3, deduction: 5_940 },
    { maxRevenue: 720_000, label: 'R$ 360.000,01 a R$ 720.000', nominalRatePercent: 9.5, deduction: 13_860 },
    { maxRevenue: 1_800_000, label: 'R$ 720.000,01 a R$ 1.800.000', nominalRatePercent: 10.7, deduction: 22_500 },
    { maxRevenue: 3_600_000, label: 'R$ 1.800.000,01 a R$ 3.600.000', nominalRatePercent: 14.3, deduction: 87_300 },
    { maxRevenue: 4_800_000, label: 'R$ 3.600.000,01 a R$ 4.800.000', nominalRatePercent: 19, deduction: 378_000 }
  ],
  II: [
    { maxRevenue: 180_000, label: 'Até R$ 180.000', nominalRatePercent: 4.5, deduction: 0 },
    { maxRevenue: 360_000, label: 'R$ 180.000,01 a R$ 360.000', nominalRatePercent: 7.8, deduction: 5_940 },
    { maxRevenue: 720_000, label: 'R$ 360.000,01 a R$ 720.000', nominalRatePercent: 10, deduction: 13_860 },
    { maxRevenue: 1_800_000, label: 'R$ 720.000,01 a R$ 1.800.000', nominalRatePercent: 11.2, deduction: 22_500 },
    { maxRevenue: 3_600_000, label: 'R$ 1.800.000,01 a R$ 3.600.000', nominalRatePercent: 14.7, deduction: 85_500 },
    { maxRevenue: 4_800_000, label: 'R$ 3.600.000,01 a R$ 4.800.000', nominalRatePercent: 30, deduction: 720_000 }
  ],
  III: [
    { maxRevenue: 180_000, label: 'Até R$ 180.000', nominalRatePercent: 6, deduction: 0 },
    { maxRevenue: 360_000, label: 'R$ 180.000,01 a R$ 360.000', nominalRatePercent: 11.2, deduction: 9_360 },
    { maxRevenue: 720_000, label: 'R$ 360.000,01 a R$ 720.000', nominalRatePercent: 13.5, deduction: 17_640 },
    { maxRevenue: 1_800_000, label: 'R$ 720.000,01 a R$ 1.800.000', nominalRatePercent: 16, deduction: 35_640 },
    { maxRevenue: 3_600_000, label: 'R$ 1.800.000,01 a R$ 3.600.000', nominalRatePercent: 21, deduction: 125_640 },
    { maxRevenue: 4_800_000, label: 'R$ 3.600.000,01 a R$ 4.800.000', nominalRatePercent: 33, deduction: 648_000 }
  ],
  IV: [
    { maxRevenue: 180_000, label: 'Até R$ 180.000', nominalRatePercent: 4.5, deduction: 0 },
    { maxRevenue: 360_000, label: 'R$ 180.000,01 a R$ 360.000', nominalRatePercent: 9, deduction: 8_100 },
    { maxRevenue: 720_000, label: 'R$ 360.000,01 a R$ 720.000', nominalRatePercent: 10.2, deduction: 12_420 },
    { maxRevenue: 1_800_000, label: 'R$ 720.000,01 a R$ 1.800.000', nominalRatePercent: 14, deduction: 39_780 },
    { maxRevenue: 3_600_000, label: 'R$ 1.800.000,01 a R$ 3.600.000', nominalRatePercent: 22, deduction: 183_780 },
    { maxRevenue: 4_800_000, label: 'R$ 3.600.000,01 a R$ 4.800.000', nominalRatePercent: 33, deduction: 828_000 }
  ],
  V: [
    { maxRevenue: 180_000, label: 'Até R$ 180.000', nominalRatePercent: 15.5, deduction: 0 },
    { maxRevenue: 360_000, label: 'R$ 180.000,01 a R$ 360.000', nominalRatePercent: 18, deduction: 4_500 },
    { maxRevenue: 720_000, label: 'R$ 360.000,01 a R$ 720.000', nominalRatePercent: 19.5, deduction: 9_900 },
    { maxRevenue: 1_800_000, label: 'R$ 720.000,01 a R$ 1.800.000', nominalRatePercent: 20.5, deduction: 17_100 },
    { maxRevenue: 3_600_000, label: 'R$ 1.800.000,01 a R$ 3.600.000', nominalRatePercent: 23, deduction: 62_100 },
    { maxRevenue: 4_800_000, label: 'R$ 3.600.000,01 a R$ 4.800.000', nominalRatePercent: 30.5, deduction: 540_000 }
  ]
};

function roundToCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function calculateSimplesEstimate(input: SimplesInput): SimplesEstimate | EstimateError {
  if (!isFiniteNonNegative(input.rbt12) || input.rbt12 <= 0) {
    return { ok: false, message: 'Informe um RBT12 positivo para estimar a alíquota efetiva.' };
  }
  if (input.rbt12 > SIMPLES_REVENUE_LIMIT) {
    return { ok: false, message: 'O RBT12 informado ultrapassa o limite anual considerado nesta simulação (R$ 4.800.000).' };
  }
  if (!isFiniteNonNegative(input.monthRevenue)) {
    return { ok: false, message: 'Informe uma receita mensal válida, igual ou maior que zero.' };
  }

  const bracket = bands[input.annex]?.find((item) => input.rbt12 <= item.maxRevenue);
  if (!bracket) return { ok: false, message: 'Selecione um Anexo válido (I a V).' };

  const effectiveRatePercent = Math.max(
    0,
    ((input.rbt12 * (bracket.nominalRatePercent / 100) - bracket.deduction) / input.rbt12) * 100
  );
  const estimatedTax = roundToCents(input.monthRevenue * (effectiveRatePercent / 100));

  return {
    ok: true,
    annex: input.annex,
    bracket: bracket.label,
    nominalRatePercent: bracket.nominalRatePercent,
    deduction: bracket.deduction,
    effectiveRatePercent: roundToCents(effectiveRatePercent),
    monthRevenue: roundToCents(input.monthRevenue),
    estimatedTax
  };
}

export function calculateMeiEstimate(input: MeiInput): MeiEstimate | EstimateError {
  if (!(['COMMERCE_INDUSTRY', 'SERVICES', 'BOTH', 'CARGO_TRANSPORT'] as const).includes(input.activity)) {
    return { ok: false, message: 'Selecione uma categoria de atividade MEI válida.' };
  }
  if (!Number.isInteger(input.monthsActive) || input.monthsActive < 1 || input.monthsActive > 12) {
    return { ok: false, message: 'Informe de 1 a 12 meses de atividade no ano.' };
  }
  if (!isFiniteNonNegative(input.yearToDateRevenue)) {
    return { ok: false, message: 'Informe o faturamento acumulado no ano, igual ou maior que zero.' };
  }
  if (typeof input.includeIcms !== 'boolean' || typeof input.includeIss !== 'boolean') {
    return { ok: false, message: 'Informe se há adicional de ICMS e/ou ISS no DAS.' };
  }

  const inss = input.activity === 'CARGO_TRANSPORT' ? MEI_CARGO_INSS : MEI_REGULAR_INSS;
  const monthlyDas = roundToCents(
    inss + (input.includeIcms ? MEI_ICMS : 0) + (input.includeIss ? MEI_ISS : 0)
  );
  const annualLimit = MEI_MONTHLY_REVENUE_LIMIT * input.monthsActive;

  return {
    ok: true,
    activity: input.activity,
    monthlyDas,
    annualLimit,
    yearToDateRevenue: roundToCents(input.yearToDateRevenue),
    remainingLimit: roundToCents(Math.max(0, annualLimit - input.yearToDateRevenue)),
    limitUsedPercent: roundToCents((input.yearToDateRevenue / annualLimit) * 100),
    exceedsLimit: input.yearToDateRevenue > annualLimit
  };
}
