import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';
import { AuditQueryDto } from './dto/audit-query.dto';

function dateFilter(query: AuditQueryDto): Prisma.DateTimeFilter {
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  if (from && to && from.getTime() > to.getTime()) throw new BadRequestException('A data inicial deve ser anterior ou igual à data final.');
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(principal: AuthPrincipal, query: AuditQueryDto) {
    const createdAt = dateFilter(query);

    const where: Prisma.AuditLogWhereInput = {
      companyId: principal.companyId,
      ...(query.action ? { action: { contains: query.action.trim(), mode: 'insensitive' } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {})
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      return Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: query.limit,
          select: {
            id: true,
            actorUserId: true,
            action: true,
            entityType: true,
            entityId: true,
            requestId: true,
            metadata: true,
            createdAt: true
          }
        }),
        tx.auditLog.count({ where })
      ]);
    });

    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit)
    };
  }
}
