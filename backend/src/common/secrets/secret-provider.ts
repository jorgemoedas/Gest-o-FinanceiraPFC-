export const SECRET_PROVIDER = Symbol('SECRET_PROVIDER');

export interface SecretProvider {
  get(key: string): Promise<string>;
}

export class SecretProviderError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'SecretProviderError';
  }
}

export class SecretNotFoundError extends SecretProviderError {
  constructor(key: string) {
    super(`Secret is not available: ${key}`, 'SECRET_NOT_FOUND');
    this.name = 'SecretNotFoundError';
  }
}

export class InvalidSecretKeyError extends SecretProviderError {
  constructor(key: string) {
    super(`Invalid secret key: ${key}`, 'INVALID_SECRET_KEY');
    this.name = 'InvalidSecretKeyError';
  }
}

export class SecretValueTooLargeError extends SecretProviderError {
  constructor(key: string) {
    super(`Secret value exceeds the maximum size for ${key}`, 'SECRET_VALUE_TOO_LARGE');
    this.name = 'SecretValueTooLargeError';
  }
}

export class SecretFileAccessError extends SecretProviderError {
  constructor(key: string) {
    super(`Secret file cannot be read: ${key}`, 'SECRET_FILE_ACCESS');
    this.name = 'SecretFileAccessError';
  }
}

export const SECRET_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function assertSecretKey(key: string): void {
  if (typeof key !== 'string' || !SECRET_KEY_PATTERN.test(key)) {
    throw new InvalidSecretKeyError(String(key));
  }
}
