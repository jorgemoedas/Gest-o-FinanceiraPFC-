import { Type } from 'class-transformer';
import { IsIn, IsInt } from 'class-validator';

export class DashboardQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([3, 6, 12])
  months = 6;
}
