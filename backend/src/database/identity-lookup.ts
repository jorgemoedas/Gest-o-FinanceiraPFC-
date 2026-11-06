import type { Prisma } from '../generated/prisma/client';







export interface AuthUserLookup {
  id: string;
  email: string;
  passwordHash: string;
  status: string;
}

export interface ActiveMembershipLookup {
  companyId: string;
  role: string;
  companyName: string;
}

export interface ResetTokenLookup {
  id: string;
  userId: string;
  usedAt: Date | null;
  expiresAt: Date;
  userEmail: string;
}

type RestrictedClient = Prisma.TransactionClient;

export async function findAuthUserByEmail(
  client: RestrictedClient,
  email: string
): Promise<AuthUserLookup | null> {
  const rows = await client.$queryRaw<AuthUserLookup[]>`
    SELECT id, email, password_hash AS "passwordHash", status
    FROM gft_inteligente.auth_user_by_email(${email})
  `;
  return rows[0] ?? null;
}

export async function findActiveMembership(
  client: RestrictedClient,
  userId: string
): Promise<ActiveMembershipLookup | null> {
  const rows = await client.$queryRaw<ActiveMembershipLookup[]>`
    SELECT company_id AS "companyId", role, company_name AS "companyName"
    FROM gft_inteligente.auth_active_membership(${userId}::uuid)
  `;
  return rows[0] ?? null;
}

export async function findResetTokenByHash(
  client: RestrictedClient,
  tokenHash: string
): Promise<ResetTokenLookup | null> {
  const rows = await client.$queryRaw<ResetTokenLookup[]>`
    SELECT
      id,
      user_id AS "userId",
      used_at AS "usedAt",
      expires_at AS "expiresAt",
      user_email AS "userEmail"
    FROM gft_inteligente.auth_reset_token_by_hash(${tokenHash})
  `;
  return rows[0] ?? null;
}
