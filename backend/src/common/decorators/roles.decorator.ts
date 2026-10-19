import { SetMetadata } from '@nestjs/common';
import { CompanyRole } from '../../generated/prisma/client';

export const ROLES_KEY = 'requiredRoles';
export const Roles = (...roles: CompanyRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
