import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

const statuses = ['PENDING', 'DONE', 'DISMISSED'] as const;

export class FiscalCalendarQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsIn(statuses)
  status?: (typeof statuses)[number];
}

export class CreateFiscalObligationDto {
  @IsString()
  @Length(1, 40)
  kind!: string;

  @IsString()
  @Length(1, 160)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(1, 400)
  description?: string | null;

  @IsDateString()
  dueAt!: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  periodKey?: string | null;
}

export class UpdateFiscalObligationStatusDto {
  @IsIn(statuses)
  status!: (typeof statuses)[number];

  @IsInt()
  @Min(1)
  version!: number;
}

export class GenerateDefaultFiscalCalendarDto {
  @IsIn(['MEI', 'SIMPLES_ME_EPP'])
  regime!: 'MEI' | 'SIMPLES_ME_EPP';

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

export class FiscalExportQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsIn(['csv', 'pdf'])
  format!: 'csv' | 'pdf';
}
