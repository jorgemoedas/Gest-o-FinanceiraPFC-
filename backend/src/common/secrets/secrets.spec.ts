import { mkdtemp, rm, chmod, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EnvironmentSecretProvider } from './environment-secret.provider';
import { FileSecretProvider } from './file-secret.provider';
import { SecretsModule } from './secrets.module';
import {
  InvalidSecretKeyError,
  SECRET_PROVIDER,
  SecretNotFoundError,
  SecretValueTooLargeError,
  SecretProvider
} from './secret-provider';

describe('EnvironmentSecretProvider', () => {
  it('obtém um segredo presente', async () => {
    const provider = new EnvironmentSecretProvider({ APP_SECRET: 'valor-secreto' });
    await expect(provider.get('APP_SECRET')).resolves.toBe('valor-secreto');
  });

  it('lança erro tipado quando o segredo está ausente', async () => {
    const provider = new EnvironmentSecretProvider({});
    await expect(provider.get('APP_SECRET')).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it('lança erro tipado para chave inválida', async () => {
    const provider = new EnvironmentSecretProvider({});
    await expect(provider.get('../APP_SECRET')).rejects.toBeInstanceOf(InvalidSecretKeyError);
  });
});

describe('FileSecretProvider', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gft-secrets-'));
    await chmod(directory, 0o700);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('obtém um segredo montado e remove somente a quebra de linha final', async () => {
    await writeFile(join(directory, 'APP_SECRET'), 'arquivo-secreto\n', { mode: 0o600 });
    await expect(new FileSecretProvider(directory).get('APP_SECRET')).resolves.toBe('arquivo-secreto');
  });

  it('lança erro tipado para segredo ausente', async () => {
    await expect(new FileSecretProvider(directory).get('APP_SECRET')).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it('recusa segredo acima do limite', async () => {
    await writeFile(join(directory, 'APP_SECRET'), '123456');
    await expect(new FileSecretProvider(directory, 5).get('APP_SECRET')).rejects.toBeInstanceOf(SecretValueTooLargeError);
  });

  it('recusa chave inválida sem acessar fora do diretório', async () => {
    await expect(new FileSecretProvider(directory).get('secret-file')).rejects.toBeInstanceOf(InvalidSecretKeyError);
  });
});

describe('SecretsModule', () => {
  const previousProvider = process.env.SECRETS_PROVIDER;
  const previousSecret = process.env.APP_SECRET;

  afterEach(() => {
    if (previousProvider === undefined) delete process.env.SECRETS_PROVIDER;
    else process.env.SECRETS_PROVIDER = previousProvider;
    if (previousSecret === undefined) delete process.env.APP_SECRET;
    else process.env.APP_SECRET = previousSecret;
  });

  it.each([
    ['env', EnvironmentSecretProvider],
    ['file', FileSecretProvider]
  ] as const)('seleciona o provedor %s pelo ambiente', async (mode, Provider) => {
    process.env.SECRETS_PROVIDER = mode;
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true }), SecretsModule]
    }).compile();
    expect(moduleRef.get<SecretProvider>(SECRET_PROVIDER)).toBeInstanceOf(Provider);
    await moduleRef.close();
  });
});
