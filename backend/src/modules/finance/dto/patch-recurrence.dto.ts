import { IsBoolean, IsOptional } from 'class-validator';
import { UpdateRecurrenceDto } from './recurrence.dto';

export class PatchRecurrenceDto extends UpdateRecurrenceDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
