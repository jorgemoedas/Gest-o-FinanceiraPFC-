import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(principal: AuthPrincipal, query: AuditQueryDto) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('A data inicial deve ser anterior ou igual à data final.');
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;

    const where: Prisma.AuditLogWhereInput = {
      companyId: principal.companyId,
      ...(query.action ? { action: { contains: query.action.trim(), mode: 'insensitive' } } : {}),
      ...(from || to ? { createdAt } : {})
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
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
      this.prisma.auditLog.count({ where })
    ]);

    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit)
    };
  }
}
