import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { normalizeCnpj } from './cnpj';

export class SaveCompanyProfileDto {
  @Transform(({ value }) => typeof value === 'string' ? normalizeCnpj(value) : value)
  @IsString()
  @Matches(/^[A-Z0-9]{12}\d{2}$/, { message: 'Informe um CNPJ válido de 14 caracteres.' })
  cnpj!: string;
}
