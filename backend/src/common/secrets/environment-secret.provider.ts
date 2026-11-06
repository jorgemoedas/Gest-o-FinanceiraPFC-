import { Injectable } from '@nestjs/common';
import { assertSecretKey, SecretNotFoundError, SecretProvider } from './secret-provider';

@Injectable()
export class EnvironmentSecretProvider implements SecretProvider {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  async get(key: string): Promise<string> {
    assertSecretKey(key);
    const value = this.environment[key];
    if (value === undefined || value.length === 0) throw new SecretNotFoundError(key);
    return value;
  }
}
