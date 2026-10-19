import { describe, expect, it } from 'vitest';
import { formatCurrency, formatDate, formatAxisMoney } from './format';
import { parseBrazilianAmount, transactionInputSchema, transactionListQuerySchema } from './validation';

describe('finance form validation', () => {
  it('parses Brazilian thousands and decimal separators without changing dot-decimal input', () => {
    expect(parseBrazilianAmount('1.250,50')).toBe(1250.5);
    expect(parseBrazilianAmount('1250.50')).toBe(1250.5);
  });

  it('accepts a valid positive entry and trims its description', () => {
    const result = transactionInputSchema.safeParse({
      type: 'INCOME',
      category: 'SALES',
      description: '  Serviço mensal  ',
      amount: '1.250,50',
      occurredAt: '2026-10-05'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(1250.5);
      expect(result.data.description).toBe('Serviço mensal');
    }
  });

  it('rejects invalid amounts, invalid calendar dates and uncontrolled categories', () => {
    const base = { type: 'EXPENSE', category: 'TAXES', description: 'Imposto', occurredAt: '2026-10-05' };
    expect(transactionInputSchema.safeParse({ ...base, amount: '0' }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ ...base, amount: '10', occurredAt: '2026-02-30' }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ ...base, amount: '10', category: 'TOKEN' }).success).toBe(false);
  });
});

describe('finance formatting', () => {
  it('formats currency and compact chart labels in pt-BR', () => {
    expect(formatCurrency(1234.5)).toContain('1.234,50');
    expect(formatAxisMoney(12500)).toContain('mil');
  });

  it('formats ISO timestamps in UTC to avoid shifting the selected transaction date', () => {
    expect(formatDate('2026-10-05T00:00:00.000Z')).toContain('05');
    expect(formatDate('invalid')).toBe('Data indisponível');
  });
});

describe('finance transaction history filters', () => {
  it('applies safe pagination defaults and accepts an inclusive date filter', () => {
    const result = transactionListQuerySchema.safeParse({ page: '2', limit: '20', type: 'EXPENSE', category: 'RENT', from: '2026-09-01', to: '2026-09-30' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ page: 2, limit: 20, type: 'EXPENSE', category: 'RENT' });
    expect(transactionListQuerySchema.parse({}).page).toBe(1);
    expect(transactionListQuerySchema.parse({}).limit).toBe(20);
  });

  it('rejects reversed dates and categories incompatible with the selected type', () => {
    expect(transactionListQuerySchema.safeParse({ from: '2026-10-01', to: '2026-09-30' }).success).toBe(false);
    expect(transactionListQuerySchema.safeParse({ type: 'INCOME', category: 'RENT' }).success).toBe(false);
    expect(transactionListQuerySchema.safeParse({ page: '0', limit: '101' }).success).toBe(false);
  });
});
