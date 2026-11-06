import { describe, expect, it } from '@jest/globals';
import { buildSimplePdf } from './pdf-report';

describe('buildSimplePdf', () => {
  it('gera PDF 1.4 válido com catálogo, xref, trailer e várias páginas', () => {
    const pdf = buildSimplePdf({ title: 'Calendário fiscal', subtitle: 'Referência', lines: Array.from({ length: 100 }, (_, index) => `Linha ${index} (teste) \\`) });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toMatch(/\/Count\s+3/);
    expect(text).toContain('xref');
    expect(text).toContain('trailer');
    expect(text).toContain('startxref');
    expect(text.endsWith('%%EOF\n')).toBe(true);
  });
});
