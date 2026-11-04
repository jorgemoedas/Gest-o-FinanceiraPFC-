import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { CounterpartyRole } from '../../../generated/prisma/client';

export class CounterpartyListQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 100;

  @IsOptional()
  @IsEnum(CounterpartyRole)
  role?: CounterpartyRole;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 160)
  search?: string;
}
