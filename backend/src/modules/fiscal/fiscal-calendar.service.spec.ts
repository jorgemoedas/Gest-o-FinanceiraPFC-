import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AuthPrincipal } from '../../common/auth-principal';
import { FiscalCalendarService } from './fiscal-calendar.service';
import { setTenantContext } from '../../database/tenant-context';

jest.mock('../../database/tenant-context', () => ({ setTenantContext: jest.fn(async () => undefined) }));

const principal: AuthPrincipal = { userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10', email: 'admin@example.test', companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8', role: 'ADMIN' as AuthPrincipal['role'] };
const id = 'f47ac10b-58cc-11cf-a447-001122334455';
const now = Date.now();
const date = (offsetDays: number) => new Date(now + offsetDays * 86_400_000);
const row = (overrides: Record<string, unknown> = {}) => ({
  id, companyId: principal.companyId, kind: 'MANUAL', title: 'Obrigação', description: 'Descrição', dueAt: date(2), status: 'PENDING', source: 'MANUAL', periodKey: null, completedAt: null, version: 1, createdAt: date(-10), updatedAt: date(-1), ...overrides
});

describe('FiscalCalendarService', () => {
  const fiscalObligation = {
    findMany: jest.fn<(...args: any[]) => Promise<any>>(),
    findFirst: jest.fn<(...args: any[]) => Promise<any>>(),
    create: jest.fn<(...args: any[]) => Promise<any>>(),
    updateMany: jest.fn<(...args: any[]) => Promise<any>>(),
    deleteMany: jest.fn<(...args: any[]) => Promise<any>>()
  };
  const auditLog = { create: jest.fn<(...args: any[]) => Promise<any>>() };
  const tx = { fiscalObligation, auditLog, $queryRaw: jest.fn() };
  const globalPrisma = { fiscalObligation: { findMany: jest.fn() }, $transaction: jest.fn<(...args: any[]) => Promise<any>>() };
  let service: FiscalCalendarService;

  beforeEach(() => {
    jest.clearAllMocks();
    fiscalObligation.findMany.mockResolvedValue([]);
    fiscalObligation.findFirst.mockResolvedValue(row());
    fiscalObligation.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
    fiscalObligation.updateMany.mockResolvedValue({ count: 1 });
    fiscalObligation.deleteMany.mockResolvedValue({ count: 1 });
    auditLog.create.mockResolvedValue({});
    globalPrisma.$transaction.mockImplementation(async (callback: unknown) => (callback as (value: typeof tx) => Promise<unknown>)(tx));
    service = new FiscalCalendarService(globalPrisma as never);
  });

  it('lista por empresa e calcula resumo de pendentes, atrasadas, próximas e concluídas', async () => {
    fiscalObligation.findMany.mockResolvedValueOnce([
      row({ id, dueAt: date(-2), status: 'PENDING' }),
      row({ id: `${id.slice(0, -1)}6`, dueAt: date(3), status: 'PENDING' }),
      row({ id: `${id.slice(0, -1)}7`, dueAt: date(20), status: 'PENDING' }),
      row({ id: `${id.slice(0, -1)}8`, dueAt: date(1), status: 'DONE' })
    ]);
    const result = await service.list(principal, { from: '2020-01-01T00:00:00.000Z', to: '2030-01-01T00:00:00.000Z' });
    expect(result.summary).toEqual({ pending: 3, overdue: 1, dueSoon: 1, done: 1 });
    expect(result.items[0]).toEqual(expect.objectContaining({ dueAt: expect.any(String), daysUntilDue: expect.any(Number), isOverdue: true }));
    expect(fiscalObligation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companyId: principal.companyId }) }));
    expect(setTenantContext).toHaveBeenCalledWith(tx, principal);
    expect(globalPrisma.fiscalObligation.findMany).not.toHaveBeenCalled();
  });

  it('cria obrigação manual e audita na mesma transação', async () => {
    const result = await service.create(principal, { kind: 'MANUAL', title: '  Entrega  ', dueAt: '2026-12-20T00:00:00.000Z', description: '  nota  ' });
    expect(result).toEqual(expect.objectContaining({ title: 'Entrega', source: 'MANUAL' }));
    expect(fiscalObligation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ companyId: principal.companyId, kind: 'MANUAL', title: 'Entrega', description: 'nota' }) }));
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'FISCAL_OBLIGATION_CREATED', entityType: 'FiscalObligation', companyId: principal.companyId }) }));
  });

  it('rejeita status inválido e papel somente leitura antes da escrita', async () => {
    await expect(service.updateStatus(principal, id, { status: 'WRONG' as never, version: 1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ ...principal, role: 'READ_ONLY' as AuthPrincipal['role'] }, { kind: 'MANUAL', title: 'x', dueAt: '2026-12-20T00:00:00.000Z' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(globalPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('usa versão otimista e audita alteração de status', async () => {
    fiscalObligation.findFirst.mockResolvedValueOnce(row({ version: 2 })).mockResolvedValueOnce(row({ version: 3, status: 'DONE', completedAt: new Date() }));
    const result = await service.updateStatus(principal, id, { status: 'DONE', version: 2 });
    expect(result.status).toBe('DONE');
    expect(fiscalObligation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id, companyId: principal.companyId, version: 2 } }));
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'FISCAL_OBLIGATION_STATUS_CHANGED' }) }));
  });

  it('retorna conflito quando a versão não é mais atual', async () => {
    fiscalObligation.findFirst.mockResolvedValue(row({ version: 2 }));
    fiscalObligation.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateStatus(principal, id, { status: 'DONE', version: 1 })).rejects.toBeInstanceOf(ConflictException);
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('remove com isolamento por empresa e audita a remoção', async () => {
    await expect(service.remove(principal, id)).resolves.toEqual({ removed: true });
    expect(fiscalObligation.deleteMany).toHaveBeenCalledWith({ where: { id, companyId: principal.companyId } });
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'FISCAL_OBLIGATION_REMOVED', entityId: id }) }));
  });

  it('gera calendário mensal e na segunda chamada apenas contabiliza itens existentes', async () => {
    fiscalObligation.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ periodKey: '2026-01' }, { periodKey: '2026-02' }]);
    const first = await service.generateDefault(principal, { regime: 'MEI', from: '2026-01-01T00:00:00.000Z', to: '2026-02-28T23:59:59.999Z' });
    expect(first).toEqual({ created: 2, skipped: 0 });
    expect(fiscalObligation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'DAS_MEI', source: 'SYSTEM_RULE', periodKey: '2026-01', dueAt: new Date('2026-02-20T00:00:00.000Z') }) }));
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'FISCAL_OBLIGATIONS_GENERATED' }) }));
    const second = await service.generateDefault(principal, { regime: 'MEI', from: '2026-01-01T00:00:00.000Z', to: '2026-02-28T23:59:59.999Z' });
    expect(second).toEqual({ created: 0, skipped: 2 });
  });
});
