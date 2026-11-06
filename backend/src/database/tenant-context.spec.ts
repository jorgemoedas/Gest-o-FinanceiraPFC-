import { describe, expect, it, jest } from '@jest/globals';
import type { Prisma } from '../generated/prisma/client';
import { setTenantContext } from './tenant-context';

describe('setTenantContext', () => {
  const identity = {
    companyId: 'aa5dd750-8b65-4c2f-b4e8-2780b0d8a6a1',
    userId: 'bb5dd750-8b65-4c2f-b4e8-2780b0d8a6a2'
  };

  it('binds both identifiers as parameters with transaction-local settings', async () => {
    const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const role = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(0);
    await setTenantContext(
      { $executeRawUnsafe: role, $queryRaw: query } as unknown as Prisma.TransactionClient,
      identity
    );
    expect(role).toHaveBeenCalledWith('SET LOCAL ROLE gft_app');
    expect(query).toHaveBeenCalledTimes(1);
    const [parts, companyId, userId] = query.mock.calls[0] as [TemplateStringsArray, string, string];
    const sql = parts.join('?');
    expect(sql).toContain("pg_catalog.set_config('gft.company_id', ?, true)");
    expect(sql).toContain("pg_catalog.set_config('gft.user_id', ?, true)");
    expect(sql).not.toContain(identity.companyId);
    expect(sql).not.toContain(identity.userId);
    expect([companyId, userId]).toEqual([identity.companyId, identity.userId]);
  });

  it('propagates configuration failure before the caller can continue its transaction', async () => {
    const failure = new Error('transaction unavailable');
    const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockRejectedValue(failure);
    const role = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(0);
    await expect(
      setTenantContext({ $executeRawUnsafe: role, $queryRaw: query } as unknown as Prisma.TransactionClient, identity)
    ).rejects.toBe(failure);
  });
});
