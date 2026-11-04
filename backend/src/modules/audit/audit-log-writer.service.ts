import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';

export interface AuditWriteInput {
  action: string;
  actorUserId: string;
  companyId: string;
  entityType?: string;
  entityId?: string;
  requestId?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditLogWriter {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: AuditWriteInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, { userId: input.actorUserId, companyId: input.companyId });
      await tx.auditLog.create({
        data: {
          action: input.action,
          actorUserId: input.actorUserId,
          companyId: input.companyId,
          entityType: input.entityType,
          entityId: input.entityId,
          requestId: input.requestId,
          metadata: input.metadata
        }
      });
    });
  }
}
