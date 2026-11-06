export interface MonthlyValue {
  monthKey: string;
  value: number;
}

export interface LinearTrend {
  slope: number;
  intercept: number;
}

export interface SeasonalIndexResult {
  index: number[] | null;
  monthsObserved: number;
  reason: string | null;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function calendarMonth(monthKey: string): number | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return null;
  return Number(monthKey.slice(5, 7));
}

function monthDate(monthKey: string): Date | null {
  const month = calendarMonth(monthKey);
  if (month === null) return null;
  const year = Number(monthKey.slice(0, 4));
  return new Date(Date.UTC(year, month - 1, 1));
}

function nextMonthKey(monthKey: string, offset: number): string {
  const date = monthDate(monthKey);
  if (!date) return monthKey;
  date.setUTCMonth(date.getUTCMonth() + offset);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}


export function linearTrend(values: number[]): LinearTrend | null {
  if (values.length < 3 || values.some((value) => !isFiniteNumber(value))) return null;

  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    const distance = index - meanX;
    numerator += distance * (values[index] - meanY);
    denominator += distance * distance;
  }

  if (denominator === 0) return null;
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  return Number.isFinite(slope) && Number.isFinite(intercept) ? { slope, intercept } : null;
}





export function seasonalIndex(monthly: MonthlyValue[]): SeasonalIndexResult {
  const valid = monthly.filter((item) => calendarMonth(item.monthKey) !== null && isFiniteNumber(item.value));
  const monthsObserved = new Set(valid.map((item) => item.monthKey)).size;
  if (monthsObserved < 24) {
    return {
      index: null,
      monthsObserved,
      reason: `É necessária uma base de pelo menos 24 meses observados; existem ${monthsObserved} meses.`
    };
  }

  const baseline = valid.reduce((sum, item) => sum + item.value, 0) / valid.length;
  if (!Number.isFinite(baseline) || baseline <= 0) {
    return {
      index: null,
      monthsObserved,
      reason: 'A média da série não é positiva; não há base válida para um índice sazonal multiplicativo.'
    };
  }

  const sums = Array.from({ length: 12 }, () => 0);
  const counts = Array.from({ length: 12 }, () => 0);
  for (const item of valid) {
    const month = calendarMonth(item.monthKey);
    if (month === null) continue;
    sums[month - 1] += item.value;
    counts[month - 1] += 1;
  }

  const index = sums.map((sum, month) => counts[month] === 0 ? 1 : sum / counts[month] / baseline);
  return {
    index: index.every((factor) => Number.isFinite(factor) && factor >= 0) ? index : null,
    monthsObserved,
    reason: index.every((factor) => Number.isFinite(factor) && factor >= 0) ? null : 'Não foi possível calcular fatores sazonais finitos.'
  };
}


export function projectNextWithSeasonalIndex(history: MonthlyValue[], months: number, index: number[] | null): MonthlyValue[] {
  if (months <= 0 || !Number.isInteger(months)) return [];
  const validHistory = history.filter((item) => monthDate(item.monthKey) !== null && isFiniteNumber(item.value));
  if (!validHistory.length) return [];

  const trend = linearTrend(validHistory.map((item) => item.value));
  const last = validHistory[validHistory.length - 1];
  const projected: MonthlyValue[] = [];
  for (let offset = 1; offset <= months; offset += 1) {
    const monthKey = nextMonthKey(last.monthKey, offset);
    const month = calendarMonth(monthKey) ?? 1;
    const baseline = trend ? trend.intercept + trend.slope * (validHistory.length - 1 + offset) : last.value;
    const factor = index?.[month - 1] ?? 1;
    const candidate = baseline * factor;
    projected.push({ monthKey, value: Number.isFinite(candidate) && candidate > 0 ? candidate : 0 });
  }
  return projected;
}

export function projectNext(history: MonthlyValue[], months: number): MonthlyValue[] {
  return projectNextWithSeasonalIndex(history, months, seasonalIndex(history).index);
}

export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
