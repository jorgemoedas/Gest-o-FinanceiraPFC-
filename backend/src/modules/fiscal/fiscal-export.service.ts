import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '../../common/auth-principal';
import { buildSimplePdf } from './pdf-report';
import { FiscalCalendarService, type PublicObligation } from './fiscal-calendar.service';

function brazilDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

function csvCell(value: string | number | boolean | null): string {
  const text = value == null ? '' : String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function datePart(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'periodo' : date.toISOString().slice(0, 10).replace(/-/g, '');
}

function rowsFor(items: PublicObligation): string[] {
  return [
    items.kind,
    items.title,
    items.description,
    brazilDate(items.dueAt),
    items.status,
    items.source,
    items.periodKey,
    brazilDate(items.completedAt),
    items.isOverdue ? 'Sim' : 'Não',
    items.daysUntilDue,
    items.version
  ].map((value) => value == null ? '' : String(value));
}

@Injectable()
export class FiscalExportService {
  constructor(private readonly calendar: FiscalCalendarService) {}

  async exportCsv(principal: AuthPrincipal, query: { from: string; to: string }): Promise<{ fileName: string; contentType: 'text/csv'; body: string }> {
    const result = await this.calendar.list(principal, query);
    const header = ['Tipo', 'Título', 'Descrição', 'Vencimento', 'Status', 'Origem', 'Período', 'Concluído em', 'Atrasada', 'Dias até vencimento', 'Versão'];
    const body = [header, ...result.items.map(rowsFor)].map((row) => row.map((value) => csvCell(value)).join(';')).join('\r\n') + '\r\n';
    return {
      fileName: `calendario-fiscal-${datePart(query.from)}-${datePart(query.to)}.csv`,
      contentType: 'text/csv',
      body
    };
  }

  async exportPdf(principal: AuthPrincipal, query: { from: string; to: string }): Promise<{ fileName: string; contentType: 'application/pdf'; body: Buffer }> {
    const result = await this.calendar.list(principal, query);
    const lines = result.items.map((item) => rowsFor(item).join(' | '));
    const report = buildSimplePdf({
      title: 'Calendário fiscal',
      subtitle: `Período: ${brazilDate(query.from)} a ${brazilDate(query.to)} | Pendentes: ${result.summary.pending} | Atrasadas: ${result.summary.overdue}`,
      lines: lines.length ? lines : ['Nenhuma obrigação encontrada no período.']
    });
    return {
      fileName: `calendario-fiscal-${datePart(query.from)}-${datePart(query.to)}.pdf`,
      contentType: 'application/pdf',
      body: report
    };
  }
}
