import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { FinanceCategory, FinanceEntryType, FinanceTransactionStatus } from '../../../generated/prisma/client';

export class CreateTransactionDto {
  @IsEnum(FinanceEntryType)
  type!: FinanceEntryType;

  @IsEnum(FinanceCategory)
  category!: FinanceCategory;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 80)
  @Matches(/^[^\u0000-\u001F\u007F]+$/u, { message: 'A subcategoria não pode conter caracteres de controle.' })
  subcategory?: string | null;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 160)
  @Matches(/^[^\u0000-\u001F\u007F]+$/u, { message: 'A descrição não pode conter caracteres de controle.' })
  description!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount!: number;

  @IsDateString()
  occurredAt!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @IsOptional()
  @IsIn([FinanceTransactionStatus.PAID, FinanceTransactionStatus.PENDING])
  status?: FinanceTransactionStatus;

  @IsOptional()
  @IsUUID()
  counterpartyId?: string | null;
}
