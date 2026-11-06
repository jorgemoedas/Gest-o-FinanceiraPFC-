import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateFiscalObligationDto, FiscalCalendarQueryDto, GenerateDefaultFiscalCalendarDto, UpdateFiscalObligationStatusDto } from './fiscal-obligation.dto';

function errors<T extends object>(type: new () => T, value: Record<string, unknown>) {
  return validateSync(plainToInstance(type, value), { whitelist: true, forbidNonWhitelisted: true });
}

describe('fiscal obligation DTOs', () => {
  it('aceita calendário, obrigação, status e regime válidos', () => {
    expect(errors(FiscalCalendarQueryDto, { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T23:59:59.999Z', status: 'PENDING' })).toHaveLength(0);
    expect(errors(CreateFiscalObligationDto, { kind: 'MANUAL', title: 'Entrega', dueAt: '2026-01-20T00:00:00.000Z', description: null })).toHaveLength(0);
    expect(errors(UpdateFiscalObligationStatusDto, { status: 'DONE', version: 1 })).toHaveLength(0);
    expect(errors(GenerateDefaultFiscalCalendarDto, { regime: 'MEI', from: '2026-01-01T00:00:00.000Z', to: '2026-02-28T23:59:59.999Z' })).toHaveLength(0);
  });

  it('rejeita status, datas, versão, regime e propriedades desconhecidas', () => {
    expect(errors(FiscalCalendarQueryDto, { from: 'invalid', to: '2026-01-01T00:00:00.000Z' })).not.toHaveLength(0);
    expect(errors(CreateFiscalObligationDto, { kind: 'MANUAL', title: '', dueAt: 'invalid' })).not.toHaveLength(0);
    expect(errors(UpdateFiscalObligationStatusDto, { status: 'INVALID', version: 0 })).not.toHaveLength(0);
    expect(errors(GenerateDefaultFiscalCalendarDto, { regime: 'LUCRO_REAL', from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T00:00:00.000Z' })).not.toHaveLength(0);
    expect(errors(CreateFiscalObligationDto, { kind: 'MANUAL', title: 'x', dueAt: '2026-01-01T00:00:00.000Z', companyId: 'não aceitar' })).not.toHaveLength(0);
  });
});
