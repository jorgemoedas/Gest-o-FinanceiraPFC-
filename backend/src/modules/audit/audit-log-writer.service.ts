import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface AuditWriteInput {
  action: string;
  actorUserId?: string;
  companyId?: string;
  entityType?: string;
  entityId?: string;
  requestId?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditLogWriter {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: AuditWriteInput): Promise<void> {
    await this.prisma.auditLog.create({
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
  }
}
