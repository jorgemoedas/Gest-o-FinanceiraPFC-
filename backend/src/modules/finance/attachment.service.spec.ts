import { BadRequestException, ForbiddenException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AuthPrincipal } from '../../common/auth-principal';
import { setTenantContext } from '../../database/tenant-context';
import { AttachmentService } from './attachment.service';
import type { AttachmentStorage } from './attachment-storage';

jest.mock('../../database/tenant-context', () => ({ setTenantContext: jest.fn(async () => undefined) }));

const principal: AuthPrincipal = {
  userId: '2e6a9f72-3ae9-4cd2-bfea-d77a900b7a10',
  email: 'admin@example.test',
  companyId: '02b5e2d4-bf6a-4b06-b4a3-2b2da1be16e8',
  role: 'ADMIN' as AuthPrincipal['role']
};
const transactionId = 'f47ac10b-58cc-11cf-a447-001122334455';
const attachmentId = 'f47ac10b-58cc-11cf-a447-001122334456';
const otherCompanyId = 'f47ac10b-58cc-11cf-a447-001122334457';

class InMemoryAttachmentStorage implements AttachmentStorage {
  readonly files = new Map<string, Buffer>();
  saves: Array<{ key: string; bytes: Buffer }> = [];
  removals: string[] = [];
  failSave = false;

  async save(key: string, bytes: Buffer): Promise<void> {
    if (this.failSave) throw new Error('storage save failed');
    this.saves.push({ key, bytes });
    this.files.set(key, Buffer.from(bytes));
  }

  async read(key: string): Promise<Buffer> {
    const bytes = this.files.get(key);
    if (!bytes) throw new Error('missing file');
    return Buffer.from(bytes);
  }

  async remove(key: string): Promise<void> {
    this.removals.push(key);
    this.files.delete(key);
  }
}

function publicRow(overrides: Record<string, unknown> = {}) {
  return {
    id: attachmentId,
    transactionId,
    fileName: 'comprovante.pdf',
    contentType: 'application/pdf',
    byteSize: 4,
    checksum: '3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7',
    createdAt: new Date('2026-11-09T12:00:00.000Z'),
    storageKey: `${principal.companyId}/${transactionId}/file-id`,
    ...overrides
  };
}

describe('AttachmentService', () => {
  const globalFinanceTransaction = {
    findFirst: jest.fn<(...args: any[]) => Promise<any>>()
  };
  const globalFinanceAttachment = {
    findMany: jest.fn<(...args: any[]) => Promise<any>>(),
    findFirst: jest.fn<(...args: any[]) => Promise<any>>(),
    count: jest.fn<(...args: any[]) => Promise<any>>(),
    create: jest.fn<(...args: any[]) => Promise<any>>(),
    delete: jest.fn<(...args: any[]) => Promise<any>>()
  };
  const globalAuditLog = { create: jest.fn<(...args: any[]) => Promise<any>>() };
  const globalPrisma = {
    financeTransaction: globalFinanceTransaction,
    financeAttachment: globalFinanceAttachment,
    auditLog: globalAuditLog,
    $transaction: jest.fn<(...args: any[]) => Promise<any>>()
  };

  const txFinanceTransaction = { findFirst: jest.fn<(...args: any[]) => Promise<any>>() };
  const txFinanceAttachment = {
    findMany: jest.fn<(...args: any[]) => Promise<any>>(),
    findFirst: jest.fn<(...args: any[]) => Promise<any>>(),
    count: jest.fn<(...args: any[]) => Promise<any>>(),
    create: jest.fn<(...args: any[]) => Promise<any>>(),
    delete: jest.fn<(...args: any[]) => Promise<any>>()
  };
  const txAuditLog = { create: jest.fn<(...args: any[]) => Promise<any>>() };
  const tx = {
    financeTransaction: txFinanceTransaction,
    financeAttachment: txFinanceAttachment,
    auditLog: txAuditLog,
    $queryRaw: jest.fn()
  };
  let service: AttachmentService;
  let storage: InMemoryAttachmentStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new InMemoryAttachmentStorage();
    txFinanceTransaction.findFirst.mockResolvedValue({ id: transactionId });
    txFinanceAttachment.findMany.mockResolvedValue([publicRow()]);
    txFinanceAttachment.findFirst.mockResolvedValue(publicRow());
    txFinanceAttachment.count.mockResolvedValue(0);
    txFinanceAttachment.create.mockResolvedValue(publicRow());
    txFinanceAttachment.delete.mockResolvedValue(publicRow());
    txAuditLog.create.mockResolvedValue({});
    globalPrisma.$transaction.mockImplementation(async (callback: unknown) => (callback as (value: typeof tx) => Promise<unknown>)(tx));
    service = new AttachmentService(globalPrisma as never, storage);
  });

  it('lists tenant attachments without exposing storageKey', async () => {
    const result = await service.list(principal, transactionId);

    expect(setTenantContext).toHaveBeenCalledWith(tx, principal);
    expect(txFinanceAttachment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: principal.companyId, transactionId }
    }));
    expect(result).toEqual([expect.objectContaining({ id: attachmentId, createdAt: '2026-11-09T12:00:00.000Z' })]);
    expect(result[0]).not.toHaveProperty('storageKey');
    expect(globalFinanceAttachment.findMany).not.toHaveBeenCalled();
  });

  it('uploads valid content with SHA-256 checksum and audited metadata', async () => {
    const bytes = Buffer.from('test');
    const result = await service.upload(principal, {
      transactionId,
      fileName: 'comprovante.pdf',
      contentType: 'application/pdf',
      bytes
    });

    expect(storage.saves).toHaveLength(1);
    expect(storage.saves[0].key).toMatch(new RegExp(`^${principal.companyId}/${transactionId}/[0-9a-f-]+$`));
    expect(txFinanceTransaction.findFirst).toHaveBeenCalledWith({ where: { id: transactionId, companyId: principal.companyId }, select: { id: true } });
    expect(txFinanceAttachment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        companyId: principal.companyId,
        uploadedByUserId: principal.userId,
        byteSize: 4,
        checksum: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
      })
    }));
    expect(txAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'FINANCE_ATTACHMENT_ADDED',
        entityType: 'FinanceAttachment',
        metadata: expect.not.objectContaining({ storageKey: expect.anything() })
      })
    }));
    expect(result).not.toHaveProperty('storageKey');
    expect(globalPrisma.financeAttachment.create).not.toHaveBeenCalled();
  });

  it('rejects unsupported type, oversized content and path-like filename before storage', async () => {
    await expect(service.upload(principal, {
      transactionId,
      fileName: 'comprovante.pdf',
      contentType: 'application/zip',
      bytes: Buffer.from('x')
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upload(principal, {
      transactionId,
      fileName: 'malware.exe',
      contentType: 'application/pdf',
      bytes: Buffer.from('x')
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upload(principal, {
      transactionId,
      fileName: 'comprovante.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.alloc(5 * 1024 * 1024 + 1)
    })).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(service.upload(principal, {
      transactionId,
      fileName: 'nota..pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('x')
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.saves).toHaveLength(0);
    expect(globalPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('compensates the stored file when the transaction belongs to another company', async () => {
    txFinanceTransaction.findFirst.mockResolvedValueOnce(null);
    await expect(service.upload(principal, {
      transactionId,
      fileName: 'comprovante.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('x')
    })).rejects.toBeInstanceOf(NotFoundException);

    expect(storage.saves).toHaveLength(1);
    expect(storage.removals).toEqual([storage.saves[0].key]);
    expect(txFinanceAttachment.create).not.toHaveBeenCalled();
    expect(globalPrisma.financeTransaction.findFirst).not.toHaveBeenCalled();
    expect(otherCompanyId).not.toBe(principal.companyId);
  });

  it('compensates the stored file when metadata persistence fails', async () => {
    txFinanceAttachment.create.mockRejectedValueOnce(new Error('database failure'));
    await expect(service.upload(principal, {
      transactionId,
      fileName: 'comprovante.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('x')
    })).rejects.toThrow('database failure');
    expect(storage.removals).toEqual([storage.saves[0].key]);
  });

  it('rejects READ_ONLY writes', async () => {
    const readOnly = { ...principal, role: 'READ_ONLY' as AuthPrincipal['role'] };
    await expect(service.upload(readOnly, {
      transactionId,
      fileName: 'comprovante.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('x')
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(readOnly, attachmentId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(globalPrisma.$transaction).not.toHaveBeenCalled();
    expect(storage.saves).toHaveLength(0);
  });

  it('downloads bytes only after finding the attachment in the tenant and removes after commit', async () => {
    storage.files.set(publicRow().storageKey, Buffer.from('arquivo'));
    const downloaded = await service.download(principal, attachmentId);
    expect(downloaded.bytes).toEqual(Buffer.from('arquivo'));
    expect(downloaded.attachment).not.toHaveProperty('storageKey');
    expect(txFinanceAttachment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: attachmentId, companyId: principal.companyId } }));

    await expect(service.remove(principal, attachmentId)).resolves.toEqual({ removed: true });
    expect(txFinanceAttachment.delete).toHaveBeenCalledWith({ where: { id_companyId: { id: attachmentId, companyId: principal.companyId } } });
    expect(storage.removals).toEqual([publicRow().storageKey]);
    expect(txAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'FINANCE_ATTACHMENT_REMOVED' }) }));
  });
});
