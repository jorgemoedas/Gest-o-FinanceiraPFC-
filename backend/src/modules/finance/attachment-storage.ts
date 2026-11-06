import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface AttachmentStorage {
  save(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export interface S3AttachmentStorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

interface ReadableS3Body {
  transformToByteArray?: () => Promise<Uint8Array>;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer | string>;
}

export function resolveAttachmentRoot(): string {
  return process.env.ATTACHMENT_STORAGE_DIR?.trim() || path.join(process.cwd(), 'var', 'attachments');
}

function assertSafeStorageKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.includes('\0') || key.startsWith('/') || key.includes('\\')) {
    throw new BadRequestException('A chave do anexo é inválida.');
  }

  const segments = key.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new BadRequestException('A chave do anexo não pode sair do diretório de armazenamento.');
  }
}

export class LocalAttachmentStorage implements AttachmentStorage {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  private resolveKey(key: string): string {
    assertSafeStorageKey(key);
    const resolved = path.resolve(this.rootDirectory, key);
    const relative = path.relative(this.rootDirectory, resolved);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new BadRequestException('A chave do anexo não pode sair do diretório de armazenamento.');
    }
    return resolved;
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
  }

  async save(key: string, bytes: Buffer): Promise<void> {
    const destination = this.resolveKey(key);
    await this.ensureRoot();
    await mkdir(path.dirname(destination), { recursive: true });

    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }
}

export class S3AttachmentStorage implements AttachmentStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3AttachmentStorageConfig, client?: S3Client) {
    this.bucket = config.bucket;
    this.client = client ?? new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  async save(key: string, bytes: Buffer): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentLength: bytes.length
    }));
  }

  async read(key: string): Promise<Buffer> {
    assertSafeStorageKey(key);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error('O armazenamento S3 retornou uma resposta sem conteúdo.');

    const body = response.Body as unknown as ReadableS3Body;
    if (typeof body.transformToByteArray === 'function') {
      return Buffer.from(await body.transformToByteArray());
    }
    if (typeof body[Symbol.asyncIterator] !== 'function') {
      throw new Error('O armazenamento S3 retornou um corpo ilegível.');
    }

    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async remove(key: string): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} é obrigatório quando ATTACHMENT_STORAGE=s3.`);
  return value;
}

function resolveBooleanEnvironmentValue(environment: NodeJS.ProcessEnv, name: string, defaultValue: boolean): boolean {
  const value = environment[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} deve ser true ou false.`);
}

export function resolveAttachmentStorageMode(environment: NodeJS.ProcessEnv = process.env): 'local' | 's3' {
  const mode = environment.ATTACHMENT_STORAGE?.trim().toLowerCase() || 'local';
  if (mode !== 'local' && mode !== 's3') {
    throw new Error('ATTACHMENT_STORAGE deve ser local ou s3.');
  }
  return mode;
}

export function resolveS3AttachmentStorageConfig(environment: NodeJS.ProcessEnv = process.env): S3AttachmentStorageConfig {
  return {
    endpoint: environment.S3_ENDPOINT?.trim() || undefined,
    region: requiredEnvironmentValue(environment, 'S3_REGION'),
    bucket: requiredEnvironmentValue(environment, 'S3_BUCKET'),
    accessKeyId: requiredEnvironmentValue(environment, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnvironmentValue(environment, 'S3_SECRET_ACCESS_KEY'),
    forcePathStyle: resolveBooleanEnvironmentValue(environment, 'S3_FORCE_PATH_STYLE', false)
  };
}

export function createAttachmentStorage(environment: NodeJS.ProcessEnv = process.env): AttachmentStorage {
  if (resolveAttachmentStorageMode(environment) === 'local') {
    return new LocalAttachmentStorage(environment.ATTACHMENT_STORAGE_DIR?.trim() || path.join(process.cwd(), 'var', 'attachments'));
  }
  return new S3AttachmentStorage(resolveS3AttachmentStorageConfig(environment));
}
