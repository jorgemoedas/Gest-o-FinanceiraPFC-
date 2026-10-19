import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsString, Length, Max, Min } from 'class-validator';
import { FinanceCategory, FinanceEntryType } from '../../../generated/prisma/client';

export class CreateTransactionDto {
  @IsEnum(FinanceEntryType)
  type!: FinanceEntryType;

  @IsEnum(FinanceCategory)
  category!: FinanceCategory;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 160)
  description!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount!: number;

  @IsDateString()
  occurredAt!: string;
}
