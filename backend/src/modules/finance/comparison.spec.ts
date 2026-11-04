import { Prisma } from '../../generated/prisma/client';
import { describe, expect, it } from '@jest/globals';
import { compareDecimals } from './comparison';

describe('compareDecimals', () => {
  it('returns a null percent when the previous period has a zero base', () => {
    const result = compareDecimals(new Prisma.Decimal('25.00'), new Prisma.Decimal('0.00'));

    expect(result.amount.toFixed(2)).toBe('25.00');
    expect(result.percent).toBeNull();
  });

  it('uses the absolute previous amount as divisor for a negative base', () => {
    const result = compareDecimals(new Prisma.Decimal('-50.00'), new Prisma.Decimal('-100.00'));

    expect(result.amount.toFixed(2)).toBe('50.00');
    expect(result.percent?.toFixed(2)).toBe('50.00');
  });
});
