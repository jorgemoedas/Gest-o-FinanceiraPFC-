import { Type } from 'class-transformer';
import { IsIn, IsInt } from 'class-validator';

export class InsightsQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([3, 6, 12])
  months = 6;
}
