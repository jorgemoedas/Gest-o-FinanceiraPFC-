import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min, ValidateNested } from 'class-validator';
import { FinanceCategory, FinanceTransactionStatus } from '../../../generated/prisma/client';

export class BulkTransactionItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(1)
  version!: number;
}

export class BulkTransactionChangesDto {
  @IsOptional()
  @IsIn(Object.values(FinanceCategory))
  category?: FinanceCategory;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  subcategory?: string | null;

  @IsOptional()
  @IsIn([FinanceTransactionStatus.PAID, FinanceTransactionStatus.PENDING])
  status?: 'PAID' | 'PENDING';

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;
}

export class BulkUpdateTransactionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BulkTransactionItemDto)
  items!: BulkTransactionItemDto[];

  @ValidateNested()
  @Type(() => BulkTransactionChangesDto)
  changes!: BulkTransactionChangesDto;
}
