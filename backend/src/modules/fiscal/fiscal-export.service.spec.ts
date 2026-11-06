import { describe, expect, it, jest } from '@jest/globals';
import type { AuthPrincipal } from '../../common/auth-principal';
import { FiscalExportService } from './fiscal-export.service';
import type { FiscalCalendarService } from './fiscal-calendar.service';

const principal: AuthPrincipal = { userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10', email: 'admin@example.test', companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8', role: 'ADMIN' as AuthPrincipal['role'] };
const item = {
  id: 'f47ac10b-58cc-11cf-a447-001122334455', companyId: principal.companyId, kind: 'MANUAL', title: 'Título; especial', description: 'Descrição com "aspas"', dueAt: '2026-12-20T00:00:00.000Z', status: 'PENDING' as const, source: 'MANUAL', periodKey: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', isOverdue: false, daysUntilDue: 10, version: 1
};

describe('FiscalExportService', () => {
  it('gera CSV com separador ponto e vírgula, CRLF e escape de aspas', async () => {
    const calendar = { list: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ items: [item], summary: { pending: 1, overdue: 0, dueSoon: 0, done: 0 } }) };
    const service = new FiscalExportService(calendar as unknown as FiscalCalendarService);
    const result = await service.exportCsv(principal, { from: '2026-12-01T00:00:00.000Z', to: '2026-12-31T23:59:59.999Z' });
    expect(result.contentType).toBe('text/csv');
    expect(result.body).toContain('\r\n');
    expect(result.body).toContain('Tipo;Título;Descrição');
    expect(result.body).toContain('"Título; especial"');
    expect(result.body).toContain('"Descrição com ""aspas"""');
    expect(calendar.list).toHaveBeenCalledWith(principal, expect.any(Object));
  });

  it('gera PDF 1.4 com apenas os itens retornados pelo calendário autenticado', async () => {
    const calendar = { list: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ items: [item], summary: { pending: 1, overdue: 0, dueSoon: 0, done: 0 } }) };
    const service = new FiscalExportService(calendar as unknown as FiscalCalendarService);
    const result = await service.exportPdf(principal, { from: '2026-12-01T00:00:00.000Z', to: '2026-12-31T23:59:59.999Z' });
    expect(result.contentType).toBe('application/pdf');
    expect(result.body.toString('latin1')).toMatch(/^%PDF-1\.4/);
    expect(result.body.toString('latin1')).toContain('Titulo; especial');
  });
});
