import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { FinanceCategory, FinanceEntryType, RecurrenceFrequency } from '../../../generated/prisma/client';

function trimValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateRecurrenceDto {
  @IsEnum(FinanceEntryType)
  type!: FinanceEntryType;

  @IsEnum(FinanceCategory)
  category!: FinanceCategory;

  @IsOptional()
  @Transform(({ value }) => value === null ? null : trimValue(value))
  @IsString()
  @Length(1, 80)
  subcategory?: string | null;

  @Transform(({ value }) => trimValue(value))
  @IsString()
  @Length(1, 160)
  description!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount!: number;

  @IsOptional()
  @IsUUID()
  counterpartyId?: string | null;

  @IsEnum(RecurrenceFrequency)
  frequency!: RecurrenceFrequency;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  intervalCount!: number;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;
}

export class UpdateRecurrenceDto {
  @IsOptional()
  @IsEnum(FinanceEntryType)
  type?: FinanceEntryType;

  @IsOptional()
  @IsEnum(FinanceCategory)
  category?: FinanceCategory;

  @IsOptional()
  @Transform(({ value }) => value === null ? null : trimValue(value))
  @IsString()
  @Length(1, 80)
  subcategory?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimValue(value))
  @IsString()
  @Length(1, 160)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  amount?: number;

  @IsOptional()
  @IsUUID()
  counterpartyId?: string | null;

  @IsOptional()
  @IsEnum(RecurrenceFrequency)
  frequency?: RecurrenceFrequency;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  intervalCount?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class SetRecurrenceActiveDto {
  @IsInt()
  @Min(1)
  version!: number;

  @Transform(({ value }) => value)
  @IsBoolean()
  isActive!: boolean;
}

export class RunDueRecurrencesDto {
  @IsDateString()
  until!: string;
}

export type RecurrenceInput = Omit<CreateRecurrenceDto, 'amount'> & { amount: number | string };
