import { describe, expect, it } from '@jest/globals';
import { linearTrend, percentChange, projectNext, seasonalIndex } from './analytics-math';

describe('analytics math', () => {
  it('calculates a least-squares increasing trend', () => {
    expect(linearTrend([2, 4, 6, 8])).toEqual({ slope: 2, intercept: 2 });
  });

  it('returns null for a short or degenerate trend', () => {
    expect(linearTrend([1, 2])).toBeNull();
    expect(linearTrend([4, 4, 4])).toEqual({ slope: 0, intercept: 4 });
  });

  it('calculates down, flat and percent changes with zero and negative bases', () => {
    expect(linearTrend([9, 6, 3])).toEqual({ slope: -3, intercept: 9 });
    expect(linearTrend([7, 7, 7])?.slope).toBe(0);
    expect(percentChange(12, 0)).toBeNull();
    expect(percentChange(-5, -10)).toBe(50);
    expect(percentChange(5, -10)).toBe(150);
  });

  it('requires at least 24 observed months for seasonality', () => {
    const result = seasonalIndex(Array.from({ length: 12 }, (_, index) => ({ monthKey: `2026-${String(index + 1).padStart(2, '0')}`, value: 100 })));
    expect(result.index).toBeNull();
    expect(result.monthsObserved).toBe(12);
    expect(result.reason).toContain('24');
  });

  it('calculates a twelve-position calendar index from two years', () => {
    const history = Array.from({ length: 24 }, (_, index) => ({
      monthKey: `${2025 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
      value: (index % 12 === 0 ? 200 : 100)
    }));
    const result = seasonalIndex(history);
    expect(result.index).toHaveLength(12);
    expect(result.index?.[0]).toBeGreaterThan(1);
    expect(result.reason).toBeNull();
  });

  it('projects the next months without producing negative values', () => {
    const result = projectNext([
      { monthKey: '2026-01', value: 10 },
      { monthKey: '2026-02', value: 5 },
      { monthKey: '2026-03', value: 0 }
    ], 2);
    expect(result).toEqual([
      { monthKey: '2026-04', value: 0 },
      { monthKey: '2026-05', value: 0 }
    ]);
    expect(result.every((item) => item.value >= 0 && Number.isFinite(item.value))).toBe(true);
  });

  it('keeps the current plateau when a short series has no trend', () => {
    expect(projectNext([{ monthKey: '2026-01', value: 12 }, { monthKey: '2026-02', value: 12 }], 1)).toEqual([{ monthKey: '2026-03', value: 12 }]);
  });
});
