import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { CompanyRole, Prisma } from '../../generated/prisma/client';
import type { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';
import type { AttachmentStorage } from './attachment-storage';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_TRANSACTION = 10;
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/csv',
  'text/plain'
] as const;

const EXTENSIONS_BY_CONTENT_TYPE: Record<(typeof ALLOWED_CONTENT_TYPES)[number], readonly string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'text/csv': ['.csv'],
  'text/plain': ['.txt']
};

const publicAttachmentSelect = {
  id: true,
  transactionId: true,
  fileName: true,
  contentType: true,
  byteSize: true,
  checksum: true,
  createdAt: true
} as const;

const attachmentWithStorageSelect = {
  ...publicAttachmentSelect,
  storageKey: true
} as const;

type AttachmentPublicRow = Prisma.FinanceAttachmentGetPayload<{ select: typeof publicAttachmentSelect }>;

export type PublicAttachment = {
  id: string;
  transactionId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksum: string;
  createdAt: string;
};

function toPublicAttachment(row: AttachmentPublicRow): PublicAttachment {
  return {
    id: row.id,
    transactionId: row.transactionId,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    checksum: row.checksum,
    createdAt: row.createdAt.toISOString()
  };
}

function auditMetadata(row: {
  transactionId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksum: string;
}): Prisma.InputJsonObject {
  return {
    transactionId: row.transactionId,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    checksum: row.checksum
  };
}

function assertWritable(principal: AuthPrincipal): void {
  if (principal.role === CompanyRole.READ_ONLY) {
    throw new ForbiddenException('O perfil somente leitura não pode alterar anexos.');
  }
}

function assertSafePathSegment(value: string, message: string): void {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new BadRequestException(message);
  }
}

function validateUploadBytes(bytes: Buffer): void {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new BadRequestException('O anexo não pode estar vazio.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new PayloadTooLargeException('O anexo deve ter no máximo 5 MB.');
}

function validateUploadFileName(fileName: string): void {
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 200 || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new BadRequestException('O nome do arquivo é inválido.');
  }
}

function validateUploadExtension(fileName: string, contentType: string): void {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const allowedExtensions = EXTENSIONS_BY_CONTENT_TYPE[contentType as (typeof ALLOWED_CONTENT_TYPES)[number]];
  if (!allowedExtensions?.includes(extension)) throw new BadRequestException('A extensão do arquivo não corresponde ao tipo informado.');
}

function validateUpload(principal: AuthPrincipal, input: {
  transactionId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}): { byteSize: number; checksum: string; storageKey: string } {
  validateUploadBytes(input.bytes);
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
    throw new BadRequestException('O tipo de arquivo não é permitido.');
  }
  validateUploadFileName(input.fileName);
  validateUploadExtension(input.fileName, input.contentType);

  assertSafePathSegment(principal.companyId, 'A empresa autenticada é inválida.');
  assertSafePathSegment(input.transactionId, 'O lançamento informado é inválido.');

  return {
    byteSize: input.bytes.length,
    checksum: createHash('sha256').update(input.bytes).digest('hex'),
    storageKey: `${principal.companyId}/${input.transactionId}/${randomUUID()}`
  };
}

@Injectable()
export class AttachmentService {
  constructor(private readonly prisma: PrismaService, private readonly storage: AttachmentStorage) {}

  async list(principal: AuthPrincipal, transactionId: string): Promise<PublicAttachment[]> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const rows = await tx.financeAttachment.findMany({
        where: { companyId: principal.companyId, transactionId },
        orderBy: { createdAt: 'asc' },
        select: publicAttachmentSelect
      });
      return rows.map(toPublicAttachment);
    });
  }

  async upload(principal: AuthPrincipal, input: {
    transactionId: string;
    fileName: string;
    contentType: string;
    bytes: Buffer;
  }): Promise<PublicAttachment> {
    assertWritable(principal);
    const validated = validateUpload(principal, input);
    try {
      await this.storage.save(validated.storageKey, input.bytes);
    } catch (error) {
      await this.storage.remove(validated.storageKey).catch(() => undefined);
      throw error;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await setTenantContext(tx, principal);
        const transaction = await tx.financeTransaction.findFirst({
          where: { id: input.transactionId, companyId: principal.companyId },
          select: { id: true }
        });
        if (!transaction) {
          throw new NotFoundException('Lançamento não encontrado nesta empresa.');
        }

        const attachmentCount = await tx.financeAttachment.count({
          where: { companyId: principal.companyId, transactionId: input.transactionId }
        });
        if (attachmentCount >= MAX_ATTACHMENTS_PER_TRANSACTION) {
          throw new BadRequestException('Um lançamento pode ter no máximo 10 anexos.');
        }

        const attachment = await tx.financeAttachment.create({
          data: {
            companyId: principal.companyId,
            transactionId: input.transactionId,
            uploadedByUserId: principal.userId,
            fileName: input.fileName,
            contentType: input.contentType,
            byteSize: validated.byteSize,
            storageKey: validated.storageKey,
            checksum: validated.checksum
          },
          select: attachmentWithStorageSelect
        });

        await tx.auditLog.create({
          data: {
            actorUserId: principal.userId,
            companyId: principal.companyId,
            action: 'FINANCE_ATTACHMENT_ADDED',
            entityType: 'FinanceAttachment',
            entityId: attachment.id,
            metadata: auditMetadata(attachment)
          }
        });

        return toPublicAttachment(attachment);
      });
    } catch (error) {
      await this.storage.remove(validated.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async download(principal: AuthPrincipal, id: string): Promise<{ attachment: PublicAttachment; bytes: Buffer }> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const attachment = await tx.financeAttachment.findFirst({
        where: { id, companyId: principal.companyId },
        select: attachmentWithStorageSelect
      });
      if (!attachment) throw new NotFoundException('Anexo não encontrado.');

      const bytes = await this.storage.read(attachment.storageKey);
      return { attachment: toPublicAttachment(attachment), bytes };
    });
  }

  async remove(principal: AuthPrincipal, id: string): Promise<{ removed: true }> {
    assertWritable(principal);
    const removed = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const attachment = await tx.financeAttachment.findFirst({
        where: { id, companyId: principal.companyId },
        select: attachmentWithStorageSelect
      });
      if (!attachment) throw new NotFoundException('Anexo não encontrado.');

      await tx.financeAttachment.delete({
        where: { id_companyId: { id, companyId: principal.companyId } }
      });
      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'FINANCE_ATTACHMENT_REMOVED',
          entityType: 'FinanceAttachment',
          entityId: attachment.id,
          metadata: auditMetadata(attachment)
        }
      });
      return attachment;
    });

    await this.storage.remove(removed.storageKey);
    return { removed: true };
  }
}
