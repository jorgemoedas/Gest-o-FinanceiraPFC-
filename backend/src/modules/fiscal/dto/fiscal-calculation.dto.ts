import { IsBoolean, IsDefined, IsIn, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import type { CalculateMeiInput, CalculateSimplesInput, MeiActivity, SimplesAnnex } from '../fiscal-calculation.service';

const decimalPattern = /^\d+(?:\.\d{1,2})?$/;
const annexes = ['I', 'II', 'III', 'IV', 'V'] as const;
const meiActivities = ['GENERAL', 'TRANSPORTADOR_AUTONOMO_CARGAS'] as const;

export class FiscalCalculationDto {
  @IsIn(['SIMPLES_NACIONAL', 'MEI_SIMEI'])
  regime!: 'SIMPLES_NACIONAL' | 'MEI_SIMEI';

  @ValidateIf((input: FiscalCalculationDto) => input.regime === 'SIMPLES_NACIONAL')
  @IsDefined()
  @IsIn(annexes)
  annex?: SimplesAnnex;

  @ValidateIf((input: FiscalCalculationDto) => input.regime === 'SIMPLES_NACIONAL')
  @IsDefined()
  @IsString()
  @Matches(decimalPattern)
  rbt12?: string;

  @ValidateIf((input: FiscalCalculationDto) => input.regime === 'SIMPLES_NACIONAL')
  @IsDefined()
  @IsString()
  @Matches(decimalPattern)
  monthlyRevenue?: string;

  @ValidateIf((input: FiscalCalculationDto) => input.regime === 'MEI_SIMEI')
  @IsDefined()
  @IsString()
  @Matches(decimalPattern)
  annualRevenue?: string;

  @ValidateIf((input: FiscalCalculationDto) => input.regime === 'MEI_SIMEI')
  @IsOptional()
  @IsIn(meiActivities)
  activity?: MeiActivity;

  @ValidateIf((input: FiscalCalculationDto) => input.regime === 'MEI_SIMEI')
  @IsOptional()
  @IsBoolean()
  isIcmsTaxpayer?: boolean;

  @ValidateIf((input: FiscalCalculationDto) => input.regime === 'MEI_SIMEI')
  @IsOptional()
  @IsBoolean()
  isIssTaxpayer?: boolean;

  @ValidateIf((input: FiscalCalculationDto) => input.regime === 'MEI_SIMEI')
  @IsOptional()
  @IsIn([2026])
  year?: 2026;

  toInput(): CalculateSimplesInput | CalculateMeiInput {
    if (this.regime === 'SIMPLES_NACIONAL') {
      return { annex: this.annex!, rbt12: this.rbt12!, monthlyRevenue: this.monthlyRevenue! };
    }
    return {
      annualRevenue: this.annualRevenue!,
      activity: this.activity,
      isIcmsTaxpayer: this.isIcmsTaxpayer,
      isIssTaxpayer: this.isIssTaxpayer,
      year: this.year
    };
  }
}
