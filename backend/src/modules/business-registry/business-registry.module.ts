import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BusinessRegistryController } from './business-registry.controller';
import { BusinessRegistryService } from './business-registry.service';
import { CompanyProfileService } from './company-profile.service';

@Module({
  imports: [AuditModule],
  controllers: [BusinessRegistryController],
  providers: [BusinessRegistryService, CompanyProfileService],
  exports: [BusinessRegistryService]
})
export class BusinessRegistryModule {}
