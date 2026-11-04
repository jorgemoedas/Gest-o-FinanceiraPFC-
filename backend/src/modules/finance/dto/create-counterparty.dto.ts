import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CounterpartyRole } from '../../../generated/prisma/client';
import { normalizeCnpj } from '../../business-registry/cnpj';

export class CreateCounterpartyDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 160)
  @Matches(/^[^\u0000-\u001F\u007F]+$/u, { message: 'O nome não pode conter caracteres de controle.' })
  name!: string;

  @IsEnum(CounterpartyRole)
  role!: CounterpartyRole;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? normalizeCnpj(value) : value)
  @IsString()
  @Length(14, 14)
  @Matches(/^[A-Z0-9]{12}\d{2}$/, { message: 'Informe um CNPJ válido de 14 caracteres.' })
  cnpj?: string;
}
