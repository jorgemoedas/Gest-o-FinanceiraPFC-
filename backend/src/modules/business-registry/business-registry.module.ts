import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BusinessRegistryController } from './business-registry.controller';
import { BusinessRegistryService } from './business-registry.service';

@Module({
  imports: [AuditModule],
  controllers: [BusinessRegistryController],
  providers: [BusinessRegistryService]
})
export class BusinessRegistryModule {}
