import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PasswordResetConfirmDto, PasswordResetRequestDto } from './password-reset.dto';

describe('password reset DTOs', () => {
  it('normaliza e valida e-mail da solicitação', async () => {
    const dto = plainToInstance(PasswordResetRequestDto, { email: ' Pessoa@Empresa.Test ' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.email).toBe('pessoa@empresa.test');
  });

  it('recusa senha abaixo de 12 caracteres e acima de 72 bytes UTF-8', async () => {
    const shortDto = plainToInstance(PasswordResetConfirmDto, { token: 'abc', newPassword: 'curta' });
    expect((await validate(shortDto)).length).toBeGreaterThan(0);
    const longBytes = plainToInstance(PasswordResetConfirmDto, { token: 'abc', newPassword: 'é'.repeat(37) });
    expect((await validate(longBytes)).length).toBeGreaterThan(0);
  });

  it('recusa propriedades desconhecidas quando usado com ValidationPipe forbidNonWhitelisted', async () => {
    const dto = plainToInstance(PasswordResetConfirmDto, { token: 'abc', newPassword: 'senha-nova-segura', extra: true });
    expect((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).some((error) => error.property === 'extra')).toBe(true);
  });
});
