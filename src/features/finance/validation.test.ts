import { describe, expect, it } from 'vitest';
import { formatCurrency, formatDate, formatAxisMoney } from './format';
import { counterpartyInputSchema, parseBrazilianAmount, transactionInputSchema, transactionListQuerySchema, transactionUpdateSchema } from './validation';

const validEntry = {
  type: 'INCOME',
  category: 'SALES',
  description: 'Serviço mensal',
  amount: '1.250,50',
  occurredAt: '2026-10-05'
};

describe('finance form validation', () => {
  it('parses Brazilian thousands and decimal separators without changing dot-decimal input', () => {
    expect(parseBrazilianAmount('1.250,50')).toBe(1250.5);
    expect(parseBrazilianAmount('1250.50')).toBe(1250.5);
    expect(parseBrazilianAmount('1.250')).toBe(1250);
    expect(parseBrazilianAmount('1.005')).toBe(1005);
    expect(Number.isNaN(parseBrazilianAmount('1250.505'))).toBe(true);
    expect(Number.isNaN(parseBrazilianAmount('1,234'))).toBe(true);
  });

  it('accepts a valid positive entry and trims its description', () => {
    const result = transactionInputSchema.safeParse({ ...validEntry, description: '  Serviço mensal  ' });
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

  it('accepts pending entries with due dates and trims subcategories', () => {
    const result = transactionInputSchema.safeParse({
      ...validEntry,
      status: 'PENDING',
      dueAt: '2026-10-25',
      subcategory: '  Loja física  '
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subcategory).toBe('Loja física');
      expect(result.data.status).toBe('PENDING');
    }
  });

  it('accepts an optional counterparty UUID and validates its name and role', () => {
    const id = '5d2a9a0e-339a-470e-9cc0-4624044cae86';
    const linked = transactionInputSchema.safeParse({ ...validEntry, counterpartyId: id });
    expect(linked.success).toBe(true);
    expect(transactionInputSchema.safeParse({ ...validEntry, counterpartyId: 'f47ac10b-58cc-11cf-a447-001122334455' }).success).toBe(true);
    expect(counterpartyInputSchema.parse({ name: '  Loja Exemplo ', role: 'CUSTOMER' })).toEqual({ name: 'Loja Exemplo', role: 'CUSTOMER' });
    expect(counterpartyInputSchema.safeParse({ name: '  ', role: 'CUSTOMER' }).success).toBe(false);
    expect(transactionUpdateSchema.safeParse({ counterpartyId: 'not-a-uuid' }).success).toBe(false);
  });

  it('allows clearing a due date but does not permit internal cancellation states in an edit request', () => {
    expect(transactionUpdateSchema.safeParse({ dueAt: null }).success).toBe(true);
    expect(transactionUpdateSchema.safeParse({ status: 'REVERSED' }).success).toBe(false);
    expect(transactionUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('normalizes optional CNPJ without accepting provider data supplied by the browser', () => {
    expect(counterpartyInputSchema.parse({ name: 'Loja', role: 'CUSTOMER', cnpj: '11.222.333/0001-81' }).cnpj).toBe('11222333000181');
    expect(counterpartyInputSchema.safeParse({ name: 'Loja', role: 'CUSTOMER', cnpj: '123' }).success).toBe(false);
    expect(counterpartyInputSchema.safeParse({ name: 'Loja', role: 'CUSTOMER', legalName: 'Injected' }).success).toBe(false);
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
  it('applies safe pagination defaults and accepts inclusive dates and overdue status', () => {
    const result = transactionListQuerySchema.safeParse({
      page: '2',
      limit: '20',
      type: 'EXPENSE',
      category: 'RENT',
      status: 'OVERDUE',
      from: '2026-09-01',
      to: '2026-09-30'
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ page: 2, limit: 20, type: 'EXPENSE', category: 'RENT', status: 'OVERDUE' });
    expect(transactionListQuerySchema.parse({}).page).toBe(1);
    expect(transactionListQuerySchema.parse({}).limit).toBe(20);
  });

  it('accepts the dedicated refunded status filter', () => {
    expect(transactionListQuerySchema.parse({ status: 'REFUNDED' }).status).toBe('REFUNDED');
  });

  it('rejects reversed dates and categories incompatible with the selected type', () => {
    expect(transactionListQuerySchema.safeParse({ from: '2026-10-01', to: '2026-09-30' }).success).toBe(false);
    expect(transactionListQuerySchema.safeParse({ type: 'INCOME', category: 'RENT' }).success).toBe(false);
    expect(transactionListQuerySchema.safeParse({ page: '0', limit: '101' }).success).toBe(false);
  });
});
