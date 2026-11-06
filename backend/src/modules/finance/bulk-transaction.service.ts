import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceAdjustmentKind, FinanceCategory, FinanceEntryType, FinanceTransactionStatus, Prisma } from '../../generated/prisma/client';
import type { AuthPrincipal } from '../../common/auth-principal';
import { PrismaService } from '../../database/prisma.service';
import { setTenantContext } from '../../database/tenant-context';
import type { BulkUpdateTransactionsDto } from './dto/bulk-update-transactions.dto';

const CATEGORIES_BY_TYPE: Record<FinanceEntryType, readonly FinanceCategory[]> = {
  [FinanceEntryType.INCOME]: [FinanceCategory.SALES, FinanceCategory.SERVICES, FinanceCategory.OTHER],
  [FinanceEntryType.EXPENSE]: [
    FinanceCategory.TAXES,
    FinanceCategory.RENT,
    FinanceCategory.PAYROLL,
    FinanceCategory.UTILITIES,
    FinanceCategory.MARKETING,
    FinanceCategory.TRANSPORT,
    FinanceCategory.SUPPLIERS,
    FinanceCategory.OTHER
  ]
};

const transactionSelect = {
  id: true,
  type: true,
  category: true,
  subcategory: true,
  counterpartyId: true,
  counterparty: { select: { id: true, name: true, role: true } },
  description: true,
  amount: true,
  occurredAt: true,
  dueAt: true,
  status: true,
  reversalOfId: true,
  adjustmentKind: true,
  reversedAt: true,
  version: true,
  reversal: { select: { id: true, adjustmentKind: true } }
} as const;

type TransactionRecord = Prisma.FinanceTransactionGetPayload<{ select: typeof transactionSelect }>;
type BulkChanges = BulkUpdateTransactionsDto['changes'];
type BulkItem = BulkUpdateTransactionsDto['items'][number];
type BulkUpdateContext = {
  tx: Prisma.TransactionClient;
  principal: AuthPrincipal;
  items: BulkItem[];
  byId: Map<string, TransactionRecord>;
  changes: BulkChanges;
  data: Prisma.FinanceTransactionUpdateManyMutationInput;
};

type PublicTransaction = Omit<TransactionRecord, 'amount' | 'status' | 'reversalOfId' | 'reversedAt' | 'adjustmentKind' | 'reversal' | 'dueAt'> & {
  amount: number;
  dueAt: Date | null;
  hasAdjustment: boolean;
  status: FinanceTransactionStatus | 'OVERDUE' | 'REFUNDED';
};

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function toPublicTransaction(row: TransactionRecord): PublicTransaction {
  const overdue = row.status === FinanceTransactionStatus.PENDING && row.dueAt !== null && row.dueAt < startOfUtcDay();
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    subcategory: row.subcategory,
    counterpartyId: row.counterpartyId,
    counterparty: row.counterparty,
    description: row.description,
    amount: row.amount.toNumber(),
    occurredAt: row.occurredAt,
    dueAt: row.dueAt,
    version: row.version,
    hasAdjustment: Boolean(row.reversalOfId || row.reversal),
    status: row.adjustmentKind === FinanceAdjustmentKind.REFUND
      ? 'REFUNDED'
      : row.adjustmentKind === FinanceAdjustmentKind.VOID || row.status === FinanceTransactionStatus.REVERSED
        ? FinanceTransactionStatus.REVERSED
        : overdue ? 'OVERDUE' : row.status
  };
}

function snapshot(row: TransactionRecord) {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    subcategory: row.subcategory,
    counterpartyId: row.counterpartyId,
    description: row.description,
    amount: row.amount.toFixed(2),
    occurredAt: row.occurredAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    status: row.status,
    reversalOfId: row.reversalOfId,
    adjustmentKind: row.adjustmentKind,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    version: row.version
  };
}

function changedData(changes: BulkChanges): Prisma.FinanceTransactionUpdateManyMutationInput {
  const data: Prisma.FinanceTransactionUpdateManyMutationInput = { version: { increment: 1 } };
  if (changes.category !== undefined) data.category = changes.category;
  if (changes.subcategory !== undefined) data.subcategory = typeof changes.subcategory === 'string' ? changes.subcategory.trim() : null;
  if (changes.status !== undefined) data.status = changes.status;
  if (changes.dueAt !== undefined) data.dueAt = changes.dueAt === null ? null : new Date(changes.dueAt);
  return data;
}

function validatePrincipal(principal: AuthPrincipal): void {
  if (!principal?.companyId || !principal.userId) throw new BadRequestException('É necessário informar um tenant e usuário autenticados.');
}

function validateItems(input: BulkUpdateTransactionsDto): string[] {
  if (!Array.isArray(input?.items) || input.items.length === 0 || input.items.length > 100) {
    throw new BadRequestException('Selecione entre 1 e 100 lançamentos.');
  }
  const ids = input.items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new BadRequestException('Não é permitido repetir lançamentos na edição em lote.');
  return ids;
}

function validateChanges(input: BulkUpdateTransactionsDto): BulkChanges {
  const changes = input.changes ?? {};
  if (Object.keys(changes).length === 0) throw new BadRequestException('Informe ao menos um campo para atualizar.');
  if (changes.status !== undefined && ![FinanceTransactionStatus.PAID, FinanceTransactionStatus.PENDING].includes(changes.status)) {
    throw new BadRequestException('A situação deve ser paga ou pendente.');
  }
  return changes;
}

function validateBulkInput(principal: AuthPrincipal, input: BulkUpdateTransactionsDto): { ids: string[]; changes: BulkChanges } {
  validatePrincipal(principal);
  return { ids: validateItems(input), changes: validateChanges(input) };
}

function categoryChanged(existing: TransactionRecord, changes: BulkChanges): boolean {
  return changes.category !== undefined && changes.category !== existing.category;
}

function subcategoryChanged(existing: TransactionRecord, changes: BulkChanges): boolean {
  const value = typeof changes.subcategory === 'string' ? changes.subcategory.trim() : null;
  return changes.subcategory !== undefined && value !== existing.subcategory;
}

function statusChanged(existing: TransactionRecord, changes: BulkChanges): boolean {
  return changes.status !== undefined && changes.status !== existing.status;
}

function dueDateChanged(existing: TransactionRecord, changes: BulkChanges): boolean {
  const value = changes.dueAt === null ? null : new Date(changes.dueAt as string).getTime();
  return changes.dueAt !== undefined && value !== (existing.dueAt?.getTime() ?? null);
}

function hasEffectiveChange(existing: TransactionRecord, changes: BulkChanges): boolean {
  return categoryChanged(existing, changes) || subcategoryChanged(existing, changes) || statusChanged(existing, changes) || dueDateChanged(existing, changes);
}

function ensureVersion(existing: TransactionRecord, item: BulkItem): void {
  if (existing.version !== item.version) {
    throw new ConflictException('Um ou mais lançamentos foram alterados por outra solicitação. Atualize o histórico e tente novamente.');
  }
}

function ensureEditable(existing: TransactionRecord): void {
  if (existing.status === FinanceTransactionStatus.CANCELLED || existing.status === FinanceTransactionStatus.REVERSED || existing.adjustmentKind != null || existing.reversalOfId != null || existing.reversal != null) {
    throw new BadRequestException('Lançamentos cancelados, anulados ou ajustados não podem ser editados em lote.');
  }
}

function ensureStatusChangeAllowed(existing: TransactionRecord, changes: BulkChanges): void {
  if (existing.status === FinanceTransactionStatus.PAID && changes.status === FinanceTransactionStatus.PENDING) {
    throw new BadRequestException('Não é permitido alterar um lançamento pago para pendente.');
  }
}

function ensureCategoryAllowed(existing: TransactionRecord, changes: BulkChanges): void {
  if (changes.category !== undefined && !CATEGORIES_BY_TYPE[existing.type].includes(changes.category)) {
    throw new BadRequestException('A categoria não corresponde ao tipo de lançamento.');
  }
}

function validateRow(existing: TransactionRecord, item: BulkItem, changes: BulkChanges): void {
  ensureVersion(existing, item);
  ensureEditable(existing);
  ensureStatusChangeAllowed(existing, changes);
  ensureCategoryAllowed(existing, changes);
  if (!hasEffectiveChange(existing, changes)) throw new BadRequestException('A edição em lote não pode ser um no-op.');
}

function validateRows(rows: TransactionRecord[], input: BulkUpdateTransactionsDto, ids: string[], changes: BulkChanges): Map<string, TransactionRecord> {
  if (rows.length !== ids.length) throw new NotFoundException('Um ou mais lançamentos não foram encontrados nesta empresa.');
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const item of input.items) {
    const existing = byId.get(item.id);
    if (!existing) throw new NotFoundException('Lançamento não encontrado.');
    validateRow(existing, item, changes);
  }
  return byId;
}

@Injectable()
export class BulkTransactionService {
  constructor(private readonly prisma: PrismaService) {}

  async updateMany(principal: AuthPrincipal, input: BulkUpdateTransactionsDto) {
    const { ids, changes } = validateBulkInput(principal, input);
    const data = changedData(changes);
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, principal);
      const rows = await tx.financeTransaction.findMany({
        where: { companyId: principal.companyId, id: { in: ids } },
        select: transactionSelect
      });
      const byId = validateRows(rows, input, ids, changes);
      return this.applyUpdates({ tx, principal, items: input.items, byId, changes, data });
    });
  }

  private async applyUpdates(context: BulkUpdateContext): Promise<{ items: PublicTransaction[] }> {
    const { tx, principal, items, byId, changes, data } = context;
    const updated: PublicTransaction[] = [];
    for (const item of items) {
      const existing = byId.get(item.id)!;
      const guarded = await tx.financeTransaction.updateMany({
        where: { id: item.id, companyId: principal.companyId, version: item.version },
        data
      });
      if (guarded.count !== 1) {
        throw new ConflictException('Um ou mais lançamentos foram alterados por outra solicitação. Atualize o histórico e tente novamente.');
      }
      const after = await tx.financeTransaction.findFirst({
        where: { id: item.id, companyId: principal.companyId },
        select: transactionSelect
      });
      if (!after) throw new NotFoundException('Lançamento não encontrado após a atualização.');
      await tx.auditLog.create({
        data: {
          actorUserId: principal.userId,
          companyId: principal.companyId,
          action: 'FINANCE_TRANSACTIONS_BULK_UPDATED',
          entityType: 'FinanceTransaction',
          entityId: item.id,
          metadata: { before: snapshot(existing), after: snapshot(after), changes: changes as unknown as Prisma.InputJsonValue }
        }
      });
      updated.push(toPublicTransaction(after));
    }
    return { items: updated };
  }
}
