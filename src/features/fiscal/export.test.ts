import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFiscalCsv, downloadFiscalPdf } from './export';

afterEach(() => vi.unstubAllGlobals());

describe('fiscal export client', () => {
  it('baixa CSV com credentials same-origin e link temporário', async () => {
    const anchor = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() };
    const fetchMock = vi.fn().mockResolvedValue(new Response('Tipo;Título\r\n', { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="calendario.csv"' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:calendar'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild: vi.fn() } });
    await downloadFiscalCsv({ from: '2026-12-01T00:00:00.000Z', to: '2026-12-31T23:59:59.999Z' });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('format=csv'), expect.objectContaining({ credentials: 'same-origin' }));
    expect(anchor.download).toBe('calendario.csv');
    expect(anchor.click).toHaveBeenCalled();
  });

  it('propaga mensagem de erro da API PDF', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Falha no PDF' }), { status: 500, headers: { 'Content-Type': 'application/json' } })));
    await expect(downloadFiscalPdf({ from: '2026-12-01T00:00:00.000Z', to: '2026-12-31T23:59:59.999Z' })).rejects.toThrow('Falha no PDF');
  });
});
