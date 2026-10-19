import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength
} from 'class-validator';

export class RegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(160)
  companyName!: string;

  @IsBoolean()
  @Equals(true, { message: 'É necessário aceitar os Termos de Uso.' })
  acceptedTerms!: boolean;

  @IsBoolean()
  @Equals(true, { message: 'É necessário aceitar a Política de Privacidade.' })
  acceptedPrivacy!: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  termsVersion!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  privacyVersion!: string;
}
