import { Prisma } from '../../generated/prisma/client';

export interface DecimalComparisonMetric {
  amount: Prisma.Decimal;
  percent: Prisma.Decimal | null;
}

export function compareDecimals(current: Prisma.Decimal, previous: Prisma.Decimal): DecimalComparisonMetric {
  const amount = current.minus(previous);
  return {
    amount,
    percent: previous.isZero() ? null : amount.dividedBy(previous.abs()).times(100)
  };
}
