import type { Prisma } from '../generated/prisma/client';
import type { AuthPrincipal } from '../common/auth-principal';


const RESTRICTED_ROLE = 'gft_app';

type TenantIdentity = Pick<AuthPrincipal, 'userId'> & {
  companyId: string | null;
};






export async function enterRestrictedRole(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL ROLE ${RESTRICTED_ROLE}`);
}





export async function setTenantContext(
  tx: Prisma.TransactionClient,
  identity: TenantIdentity
): Promise<void> {
  await enterRestrictedRole(tx);
  await tx.$queryRaw<Array<{ company_id: string | null; user_id: string | null }>>`
    SELECT
      pg_catalog.set_config('gft.company_id', ${identity.companyId}, true) AS company_id,
      pg_catalog.set_config('gft.user_id', ${identity.userId}, true) AS user_id
  `;
}
