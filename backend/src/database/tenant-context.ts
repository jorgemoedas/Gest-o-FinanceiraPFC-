import type { Prisma } from '../generated/prisma/client';
import type { AuthPrincipal } from '../common/auth-principal';

/** Papel sem BYPASSRLS usado por toda leitura e escrita da aplicação. */
const RESTRICTED_ROLE = 'gft_app';

type TenantIdentity = Pick<AuthPrincipal, 'userId'> & {
  companyId: string | null;
};

/**
 * Assume o papel restrito apenas dentro da transação corrente. A conexão da
 * plataforma é administrativa, então sem esta troca o RLS não valeria para a
 * aplicação.
 */
export async function enterRestrictedRole(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL ROLE ${RESTRICTED_ROLE}`);
}

/**
 * Define o ator e, quando houver, a empresa da transação. Os valores valem
 * somente até o fim da transação, o que mantém o pool de conexões seguro.
 */
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