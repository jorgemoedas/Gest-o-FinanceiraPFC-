type PdfInput = { title: string; subtitle?: string; lines: string[] };

function ascii(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[€]/g, 'EUR')
    .replace(/[–—]/g, '-')
    .replace(/[…]/g, '...')
    .replace(/[^\x20-\x7E\t]/g, '?');
}

function escapePdf(value: string): string {
  return ascii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function chunks(lines: string[], size: number): string[][] {
  if (lines.length === 0) return [[]];
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += size) pages.push(lines.slice(index, index + size));
  return pages;
}

export function buildSimplePdf(input: PdfInput): Buffer {
  const title = ascii(input.title);
  const subtitle = input.subtitle ? ascii(input.subtitle) : undefined;
  const pageLines = chunks([title, ...(subtitle ? [subtitle] : []), '', ...input.lines.map(ascii)], 45);
  const objects: string[] = [];
  const pageObjectIds: number[] = [];

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  for (const lines of pageLines) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageObjectIds.push(pageId);
    const commands = ['BT', '/F1 10 Tf', '45 790 Td', ...lines.map((line, index) => `(${escapePdf(line)}) Tj${index === lines.length - 1 ? '' : ' 0 -15 Td'}`), 'ET'];
    const stream = commands.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`);
  }

  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`;
  const chunksOut: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets: number[] = [0];
  let offset = chunksOut[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const serialized = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'ascii');
    chunksOut.push(serialized);
    offset += serialized.length;
  });
  const xrefOffset = offset;
  const xref = [`xref`, `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (let index = 1; index < offsets.length; index += 1) xref.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `);
  xref.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`, `startxref`, String(xrefOffset), '%%EOF');
  chunksOut.push(Buffer.from(`${xref.join('\n')}\n`, 'ascii'));
  return Buffer.concat(chunksOut);
}
