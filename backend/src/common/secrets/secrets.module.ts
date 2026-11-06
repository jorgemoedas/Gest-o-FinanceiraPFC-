import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EnvironmentSecretProvider } from './environment-secret.provider';
import { FileSecretProvider } from './file-secret.provider';
import { SECRET_PROVIDER, SecretProvider } from './secret-provider';

export function createSecretProvider(config: ConfigService | NodeJS.ProcessEnv = process.env): SecretProvider {
  const read = typeof (config as ConfigService).get === 'function'
    ? (key: string, fallback: string) => (config as ConfigService).get<string>(key, fallback)
    : (key: string, fallback: string) => (config as NodeJS.ProcessEnv)[key] ?? fallback;
  const mode = read('SECRETS_PROVIDER', 'env').trim().toLowerCase();
  if (mode === 'env') return new EnvironmentSecretProvider();
  if (mode === 'file') {
    const directory = read('SECRETS_DIR', FileSecretProvider.DEFAULT_DIRECTORY);
    const configuredLimit = Number(read('SECRETS_MAX_BYTES', String(FileSecretProvider.DEFAULT_MAX_BYTES)));
    return new FileSecretProvider(directory, configuredLimit);
  }
  throw new Error('SECRETS_PROVIDER must be env or file');
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [{ provide: SECRET_PROVIDER, inject: [ConfigService], useFactory: createSecretProvider }],
  exports: [SECRET_PROVIDER]
})
export class SecretsModule {}
