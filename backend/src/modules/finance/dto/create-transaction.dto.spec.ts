import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateTransactionDto } from './create-transaction.dto';

describe('CreateTransactionDto', () => {
  it('accepts a valid RFC UUID that is not version 4', () => {
    const dto = plainToInstance(CreateTransactionDto, {
      type: 'INCOME',
      category: 'SALES',
      description: 'Receita teste',
      amount: 100,
      occurredAt: '2026-10-05',
      counterpartyId: 'f47ac10b-58cc-11cf-a447-001122334455'
    });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects control characters in the description and subcategory', () => {
    const dto = plainToInstance(CreateTransactionDto, {
      type: 'EXPENSE',
      category: 'SUPPLIERS',
      description: `Compra${String.fromCharCode(1)}de insumo`,
      subcategory: `Insumos${String.fromCharCode(31)}`,
      amount: 50,
      occurredAt: '2026-10-05'
    });

    const problemas = validateSync(dto).map((erro) => erro.property);
    expect(problemas).toContain('description');
    expect(problemas).toContain('subcategory');
  });
});
