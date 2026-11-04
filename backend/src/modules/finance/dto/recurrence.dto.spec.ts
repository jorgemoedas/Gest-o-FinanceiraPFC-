import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateRecurrenceDto, RunDueRecurrencesDto, SetRecurrenceActiveDto, UpdateRecurrenceDto } from './recurrence.dto';

const valid = {
  type: 'INCOME',
  category: 'SALES',
  description: 'Mensalidade',
  amount: 100.25,
  frequency: 'MONTHLY',
  intervalCount: 1,
  startDate: '2026-01-31T00:00:00.000Z'
};

describe('Recurrence DTOs', () => {
  it('accepts a valid recurrence with ISO dates', () => {
    const dto = plainToInstance(CreateRecurrenceDto, valid);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects more than two decimal places and invalid dates', () => {
    const dto = plainToInstance(CreateRecurrenceDto, { ...valid, amount: 10.123, startDate: 'not-a-date' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('validates update version and run limit as ISO dates', () => {
    expect(validateSync(plainToInstance(UpdateRecurrenceDto, { version: 2, amount: 10.5 }))).toHaveLength(0);
    expect(validateSync(plainToInstance(SetRecurrenceActiveDto, { isActive: true, version: 1 }))).toHaveLength(0);
    expect(validateSync(plainToInstance(RunDueRecurrencesDto, { until: '2026-12-31T00:00:00.000Z' }))).toHaveLength(0);
  });
});
