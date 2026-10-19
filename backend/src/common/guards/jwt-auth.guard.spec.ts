import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

function context(): ExecutionContext {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn()
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('allows an explicitly public route without invoking Passport', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as unknown as Reflector;
    const inheritedCanActivate = jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate');
    const guard = new JwtAuthGuard(reflector);

    expect(guard.canActivate(context())).toBe(true);
    expect(inheritedCanActivate).not.toHaveBeenCalled();
    inheritedCanActivate.mockRestore();
  });

  it('delegates a protected route to Passport JWT validation', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
    const inheritedCanActivate = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockReturnValue(true);
    const guard = new JwtAuthGuard(reflector);
    const executionContext = context();

    expect(guard.canActivate(executionContext)).toBe(true);
    expect(inheritedCanActivate).toHaveBeenCalledWith(executionContext);
    inheritedCanActivate.mockRestore();
  });
});
