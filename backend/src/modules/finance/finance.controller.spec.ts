import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { CompanyRole } from '../../generated/prisma/client';
import { FinanceController } from './finance.controller';

describe('FinanceController counterparty access', () => {
  it('allows writes only for OWNER, ADMIN, and MEMBER', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, FinanceController.prototype.createCounterparty);
    expect(roles).toEqual([CompanyRole.OWNER, CompanyRole.ADMIN, CompanyRole.MEMBER]);
    expect(roles).not.toContain(CompanyRole.READ_ONLY);
  });
});
