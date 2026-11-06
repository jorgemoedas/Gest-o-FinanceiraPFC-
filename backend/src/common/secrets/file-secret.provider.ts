import { Injectable } from '@nestjs/common';
import { lstat, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  assertSecretKey,
  SecretFileAccessError,
  SecretNotFoundError,
  SecretProvider,
  SecretValueTooLargeError
} from './secret-provider';

@Injectable()
export class FileSecretProvider implements SecretProvider {
  static readonly DEFAULT_DIRECTORY = '/run/secrets';
  static readonly DEFAULT_MAX_BYTES = 64 * 1024;

  private readonly directory: string;
  private readonly maxBytes: number;

  constructor(
    directory = FileSecretProvider.DEFAULT_DIRECTORY,
    maxBytes = FileSecretProvider.DEFAULT_MAX_BYTES
  ) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new RangeError('maxBytes must be a positive integer');
    this.directory = resolve(directory);
    this.maxBytes = maxBytes;
  }

  async get(key: string): Promise<string> {
    assertSecretKey(key);
    const filePath = join(this.directory, key);
    let directoryStat;
    try {
      directoryStat = await lstat(this.directory);
      if (!directoryStat.isDirectory() || (directoryStat.mode & 0o022) !== 0) throw new Error('directory permissions');
    } catch (error) {
      if (error instanceof SecretNotFoundError) throw error;
      throw new SecretFileAccessError(key);
    }

    let fileStat;
    try {
      fileStat = await lstat(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new SecretNotFoundError(key);
      throw new SecretFileAccessError(key);
    }
    if (!fileStat.isFile() || (fileStat.mode & 0o022) !== 0) throw new SecretFileAccessError(key);
    if (fileStat.size > this.maxBytes) throw new SecretValueTooLargeError(key);

    let value: Buffer;
    try {
      value = await readFile(filePath);
    } catch {
      throw new SecretFileAccessError(key);
    }
    if (value.byteLength > this.maxBytes) throw new SecretValueTooLargeError(key);
    const secret = value.toString('utf8').replace(/\r?\n$/, '');
    if (secret.length === 0) throw new SecretNotFoundError(key);
    return secret;
  }
}
