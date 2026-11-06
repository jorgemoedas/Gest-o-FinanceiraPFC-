import { z } from 'zod';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const allowedAttachmentContentTypes = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/csv',
  'text/plain'
] as const;

export const attachmentContentTypeSchema = z.enum(allowedAttachmentContentTypes);
export const publicAttachmentSchema = z.object({
  id: z.string().uuid(),
  transactionId: z.string().uuid(),
  fileName: z.string().min(1).max(200),
  contentType: attachmentContentTypeSchema,
  byteSize: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime({ offset: true })
}).strict();
export const attachmentListResponseSchema = z.array(publicAttachmentSchema);
export const deleteAttachmentResponseSchema = z.object({ removed: z.literal(true) }).strict();

function isFileLike(value: unknown): value is File {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<File>;
  return typeof candidate.name === 'string' && typeof candidate.type === 'string' && typeof candidate.size === 'number' && typeof candidate.arrayBuffer === 'function';
}

export const uploadTransactionAttachmentInputSchema = z.object({
  transactionId: z.string().uuid(),
  file: z.custom<File>(isFileLike, 'Selecione um arquivo válido.')
}).strict();

export type PublicAttachment = z.infer<typeof publicAttachmentSchema>;
export type UploadTransactionAttachmentInput = z.infer<typeof uploadTransactionAttachmentInputSchema>;

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message)) {
      const first = message.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
      if (first) return first;
    }
  }
  return fallback;
}

async function readPayload(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init.headers ?? {}) }
    });
  } catch {
    throw new Error('Não foi possível acessar os anexos financeiros. Verifique sua conexão e tente novamente.');
  }

  const payload = await readPayload(response);
  if (!response.ok) throw new Error(errorMessage(payload, 'A operação de anexo não pôde ser concluída.'));
  return payload;
}

function assertUploadFile(file: File): void {
  if (file.size <= 0) throw new Error('O arquivo não pode estar vazio.');
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('O arquivo deve ter no máximo 5 MB.');
  if (!(allowedAttachmentContentTypes as readonly string[]).includes(file.type)) throw new Error('O tipo de arquivo não é permitido.');
  if (!file.name || file.name.length > 200 || file.name.includes('/') || file.name.includes('\\') || file.name.includes('..')) {
    throw new Error('O nome do arquivo é inválido.');
  }
}

export async function listTransactionAttachments(transactionId: string): Promise<PublicAttachment[]> {
  const parsedId = z.string().uuid().safeParse(transactionId);
  if (!parsedId.success) throw new Error('Identificador de lançamento inválido.');
  const payload = await requestJson(`/api/finance/attachments?transactionId=${encodeURIComponent(parsedId.data)}`);
  const parsed = attachmentListResponseSchema.safeParse(payload);
  if (!parsed.success) throw new Error('A API retornou uma lista de anexos inválida.');
  return parsed.data;
}

export async function uploadTransactionAttachment(input: UploadTransactionAttachmentInput): Promise<PublicAttachment> {
  const parsedInput = uploadTransactionAttachmentInputSchema.safeParse(input);
  if (!parsedInput.success) throw new Error(parsedInput.error.issues[0]?.message ?? 'Confira o arquivo selecionado.');
  assertUploadFile(parsedInput.data.file);

  const form = new FormData();
  form.append('transactionId', parsedInput.data.transactionId);
  form.append('file', parsedInput.data.file, parsedInput.data.file.name);
  const payload = await requestJson('/api/finance/attachments', { method: 'POST', body: form });
  const parsed = publicAttachmentSchema.safeParse(payload);
  if (!parsed.success) throw new Error('A API retornou um anexo inválido.');
  return parsed.data;
}

export async function deleteTransactionAttachment(id: string): Promise<{ removed: true }> {
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) throw new Error('Identificador de anexo inválido.');
  const payload = await requestJson(`/api/finance/attachments/${encodeURIComponent(parsedId.data)}`, { method: 'DELETE' });
  const parsed = deleteAttachmentResponseSchema.safeParse(payload);
  if (!parsed.success) throw new Error('A API retornou uma confirmação de remoção inválida.');
  return parsed.data;
}
