import { CompanyRole } from '../generated/prisma/client';

export interface AuthPrincipal {
  userId: string;
  email: string;
  companyId: string;
  role: CompanyRole;
}
