import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate
} from 'class-validator';

@ValidatorConstraint({ name: 'utf8PasswordBytes', async: false })
class Utf8PasswordBytesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72;
  }

  defaultMessage(): string {
    return 'A senha deve ocupar no máximo 72 bytes em UTF-8.';
  }
}

export class PasswordResetRequestDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class PasswordResetConfirmDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(12, { message: 'Use pelo menos 12 caracteres na nova senha.' })
  @MaxLength(72)
  @Validate(Utf8PasswordBytesConstraint)
  newPassword!: string;
}
