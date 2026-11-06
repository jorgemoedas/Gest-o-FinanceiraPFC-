import { z } from 'zod';

export type SimplesAnnex = 'I' | 'II' | 'III' | 'IV' | 'V';
export type MeiActivity = 'COMMERCE_INDUSTRY' | 'SERVICES' | 'BOTH' | 'CARGO_TRANSPORT';

export interface SimplesInput {
  annex: SimplesAnnex;
  rbt12: string;
  monthRevenue: string;
}

export interface SimplesEstimate {
  ok: true;
  annex: SimplesAnnex;
  bracket: string;
  band: number;
  nominalRatePercent: string;
  deduction: string;
  effectiveRatePercent: string;
  effectiveRate: string;
  monthRevenue: string;
  estimatedTax: string;
  source: string;
}

export interface MeiInput {
  activity: MeiActivity;
  yearToDateRevenue: string;
  includeIcms: boolean;
  includeIss: boolean;
}

export interface MeiEstimate {
  ok: true;
  activity: MeiActivity;
  monthlyDas: string;
  annualLimit: string;
  yearToDateRevenue: string;
  remainingLimit: string;
  limitUsedPercent: string;
  exceedsLimit: false;
}

export type EstimateError = { ok: false; message: string };

export const TAX_YEAR = 2026;
export const SIMPLES_REVENUE_LIMIT = '4800000.00';
export const MEI_ANNUAL_REVENUE_LIMIT = '81000.00';
export const MEI_MONTHLY_MINIMUM_WAGE = '1621.00';
export const MEI_REGULAR_INSS = '81.05';
export const MEI_CARGO_INSS = '194.52';
export const MEI_ICMS = '1.00';
export const MEI_ISS = '5.00';
export const SIMPLES_FACTORS = {
  rbt12Threshold: '28',
  formula: '(RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12'
} as const;

const decimalText = z.string().regex(/^\d+(?:\.\d{1,2})?$/);
const annexSchema = z.enum(['I', 'II', 'III', 'IV', 'V']);
const simplesResponseSchema = z.object({
  regime: z.literal('SIMPLES_NACIONAL'),
  annex: annexSchema,
  rbt12: decimalText,
  monthlyRevenue: decimalText,
  band: z.number().int().min(1).max(6),
  nominalRatePercent: z.string(),
  deduction: decimalText,
  effectiveRatePercent: z.string(),
  effectiveRate: z.string(),
  monthlyTax: decimalText,
  rounding: z.literal('HALF_UP_2_DECIMAL_PLACES_ON_MONTHLY_TAX_ONLY'),
  source: z.string().url()
}).strict();
const meiResponseSchema = z.object({
  regime: z.literal('MEI_SIMEI'),
  year: z.literal(2026),
  activity: z.enum(['GENERAL', 'TRANSPORTADOR_AUTONOMO_CARGAS']),
  annualRevenue: decimalText,
  annualLimit: decimalText,
  inLimit: z.literal(true),
  inss: decimalText,
  icms: decimalText,
  iss: decimalText,
  monthlyDas: decimalText,
  remainingLimit: decimalText,
  limitUsedPercent: z.string(),
  rounding: z.literal('HALF_UP_2_DECIMAL_PLACES_ON_FIXED_DAS_SUM'),
  source: z.string().url()
}).strict();
export const taxCalculationResponseSchema = z.union([simplesResponseSchema, meiResponseSchema]);

export const taxCalculationRequestSchema = z.discriminatedUnion('regime', [
  z.object({ regime: z.literal('SIMPLES_NACIONAL'), annex: annexSchema, rbt12: decimalText, monthlyRevenue: decimalText }).strict(),
  z.object({ regime: z.literal('MEI_SIMEI'), annualRevenue: decimalText, activity: z.enum(['GENERAL', 'TRANSPORTADOR_AUTONOMO_CARGAS']).optional(), isIcmsTaxpayer: z.boolean().optional(), isIssTaxpayer: z.boolean().optional(), year: z.literal(2026).optional() }).strict()
]);

function normalizeDecimal(value: string): string {
  return value.trim().replace(',', '.');
}

async function readError(response: Response, fallback: string): Promise<never> {
  const payload: unknown = await response.json().catch(() => null);
  const message = typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
    ? payload.message
    : fallback;
  throw new Error(message);
}

async function requestCalculation(payload: z.infer<typeof taxCalculationRequestSchema>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch('/api/fiscal/calculate', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error('Não foi possível acessar o cálculo fiscal. Verifique sua conexão e tente novamente.');
  }
  if (!response.ok) return readError(response, 'O cálculo fiscal não pôde ser concluído.');
  return response.json().catch(() => null);
}

export async function calculateSimplesEstimate(input: SimplesInput): Promise<SimplesEstimate> {
  const payload = taxCalculationRequestSchema.parse({ regime: 'SIMPLES_NACIONAL', annex: input.annex, rbt12: normalizeDecimal(input.rbt12), monthlyRevenue: normalizeDecimal(input.monthRevenue) });
  const result = simplesResponseSchema.safeParse(await requestCalculation(payload));
  if (!result.success) throw new Error('A API fiscal retornou um cálculo do Simples em formato inválido.');
  return {
    ok: true,
    annex: result.data.annex,
    bracket: `Faixa ${result.data.band}`,
    band: result.data.band,
    nominalRatePercent: result.data.nominalRatePercent,
    deduction: result.data.deduction,
    effectiveRatePercent: result.data.effectiveRatePercent,
    effectiveRate: result.data.effectiveRate,
    monthRevenue: result.data.monthlyRevenue,
    estimatedTax: result.data.monthlyTax,
    source: result.data.source
  };
}

export async function calculateMeiEstimate(input: MeiInput): Promise<MeiEstimate> {
  const payload = taxCalculationRequestSchema.parse({
    regime: 'MEI_SIMEI',
    annualRevenue: normalizeDecimal(input.yearToDateRevenue),
    activity: input.activity === 'CARGO_TRANSPORT' ? 'TRANSPORTADOR_AUTONOMO_CARGAS' : 'GENERAL',
    isIcmsTaxpayer: input.includeIcms,
    isIssTaxpayer: input.includeIss,
    year: TAX_YEAR
  });
  const result = meiResponseSchema.safeParse(await requestCalculation(payload));
  if (!result.success) throw new Error('A API fiscal retornou um cálculo do MEI em formato inválido.');
  return {
    ok: true,
    activity: input.activity,
    monthlyDas: result.data.monthlyDas,
    annualLimit: result.data.annualLimit,
    yearToDateRevenue: result.data.annualRevenue,
    remainingLimit: result.data.remainingLimit,
    limitUsedPercent: result.data.limitUsedPercent,
    exceedsLimit: false
  };
}
