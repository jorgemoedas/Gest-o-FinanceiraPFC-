import { z } from 'zod';
import { fiscalCalendarQuerySchema } from './calendar';

export const fiscalExportFormatSchema = z.enum(['csv', 'pdf']);
export const fiscalExportRequestSchema = fiscalCalendarQuerySchema.omit({ status: true }).extend({ format: fiscalExportFormatSchema }).strict();
export type FiscalExportRequest = z.infer<typeof fiscalExportRequestSchema>;
export type FiscalExportFormat = z.infer<typeof fiscalExportFormatSchema>;

async function readExportError(response: Response): Promise<never> {
  const payload: unknown = await response.json().catch(() => null);
  const message = typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
    ? payload.message
    : 'A exportação fiscal não pôde ser concluída.';
  throw new Error(message);
}

function fileName(response: Response, format: FiscalExportFormat): string {
  const fallback = `calendario-fiscal.${format}`;
  const header = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] || fallback;
}

export async function downloadFiscalExport(input: FiscalExportRequest): Promise<void> {
  const query = fiscalExportRequestSchema.parse(input);
  let response: Response;
  try {
    const params = new URLSearchParams({ from: query.from, to: query.to, format: query.format });
    response = await fetch(`/api/fiscal/export?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: query.format === 'pdf' ? 'application/pdf' : 'text/csv' }
    });
  } catch {
    throw new Error('Não foi possível acessar a exportação fiscal. Verifique sua conexão e tente novamente.');
  }
  if (!response.ok) return readExportError(response);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName(response, query.format);
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function downloadFiscalCsv(input: Omit<FiscalExportRequest, 'format'>): Promise<void> {
  return downloadFiscalExport({ ...input, format: 'csv' });
}

export function downloadFiscalPdf(input: Omit<FiscalExportRequest, 'format'>): Promise<void> {
  return downloadFiscalExport({ ...input, format: 'pdf' });
}
