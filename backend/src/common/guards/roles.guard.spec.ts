import { CompanyRole } from '../../generated/prisma/client';
import { RolesGuard } from './roles.guard';

function makeContext(user?: { role: CompanyRole }) {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user }) })
  } as never;
}

describe('RolesGuard', () => {
  it('allows a route with no role requirement', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const guard = new RolesGuard(reflector as never);
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('allows a user with one of the required company roles', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([CompanyRole.OWNER, CompanyRole.ADMIN]) };
    const guard = new RolesGuard(reflector as never);
    expect(guard.canActivate(makeContext({ role: CompanyRole.OWNER }))).toBe(true);
  });

  it('denies a user with a non-privileged role', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([CompanyRole.OWNER, CompanyRole.ADMIN]) };
    const guard = new RolesGuard(reflector as never);
    expect(guard.canActivate(makeContext({ role: CompanyRole.MEMBER }))).toBe(false);
  });

  it('denies a protected role route without an authenticated principal', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([CompanyRole.OWNER]) };
    const guard = new RolesGuard(reflector as never);
    expect(guard.canActivate(makeContext())).toBe(false);
  });
});
