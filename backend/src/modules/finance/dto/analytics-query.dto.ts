import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([3, 6, 12])
  months: 3 | 6 | 12 = 6;

  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 3, 6])
  projectionMonths: 1 | 3 | 6 = 3;
}