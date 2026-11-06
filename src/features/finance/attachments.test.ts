import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteTransactionAttachment,
  listTransactionAttachments,
  uploadTransactionAttachment
} from './attachments';

const ids = {
  transaction: 'f47ac10b-58cc-11cf-a447-001122334455',
  attachment: 'f47ac10b-58cc-11cf-a447-001122334456'
};
const attachment = {
  id: ids.attachment,
  transactionId: ids.transaction,
  fileName: 'nota.pdf',
  contentType: 'application/pdf',
  byteSize: 4,
  checksum: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  createdAt: '2026-11-09T12:00:00.000Z'
};

function file(name: string, type: string, bytes = 'test'): File {
  const blob = new Blob([bytes], { type });
  return Object.assign(blob, { name }) as File;
}

afterEach(() => vi.unstubAllGlobals());

describe('finance attachment client', () => {
  it('lists attachments with same-origin credentials and validates the strict response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([attachment]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listTransactionAttachments(ids.transaction)).resolves.toEqual([attachment]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/finance/attachments?transactionId=${ids.transaction}`);
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('content-type')).toBeNull();
  });

  it('uploads a file as FormData without setting multipart Content-Type manually', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(attachment), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadTransactionAttachment({ transactionId: ids.transaction, file: file('nota.pdf', 'application/pdf') })).resolves.toEqual(attachment);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).get('content-type')).toBeNull();
    const form = init.body as FormData;
    expect(form.get('transactionId')).toBe(ids.transaction);
    expect((form.get('file') as File).name).toBe('nota.pdf');
  });

  it('rejects files that are too large or have an unsupported type before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadTransactionAttachment({ transactionId: ids.transaction, file: file('nota.pdf', 'application/zip') })).rejects.toThrow('tipo');
    const oversized = {
      name: 'nota.pdf',
      type: 'application/pdf',
      size: 5 * 1024 * 1024 + 1,
      arrayBuffer: async () => new ArrayBuffer(1)
    } as unknown as File;
    await expect(uploadTransactionAttachment({ transactionId: ids.transaction, file: oversized })).rejects.toThrow('5 MB');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes by id and validates the strict confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ removed: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteTransactionAttachment(ids.attachment)).resolves.toEqual({ removed: true });
    expect(fetchMock).toHaveBeenCalledWith(`/api/finance/attachments/${ids.attachment}`, expect.objectContaining({ method: 'DELETE', credentials: 'same-origin' }));
  });
});
