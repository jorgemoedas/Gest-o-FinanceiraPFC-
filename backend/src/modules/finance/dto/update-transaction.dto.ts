import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';
import { FinanceCategory, FinanceEntryType, FinanceTransactionStatus } from '../../../generated/prisma/client';

export class UpdateTransactionDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(FinanceEntryType)
  type?: FinanceEntryType;

  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(FinanceCategory)
  category?: FinanceCategory;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 80)
  subcategory?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 160)
  description?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn([FinanceTransactionStatus.PAID, FinanceTransactionStatus.PENDING])
  status?: FinanceTransactionStatus;

  @IsOptional()
  @IsUUID()
  counterpartyId?: string | null;
}
