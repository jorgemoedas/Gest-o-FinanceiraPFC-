import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createAttachmentStorage,
  LocalAttachmentStorage,
  resolveAttachmentRoot,
  resolveAttachmentStorageMode,
  resolveS3AttachmentStorageConfig,
  S3AttachmentStorage
} from './attachment-storage';

const testStorageRoot = path.join(tmpdir(), 'gft-attachment-test');
const customStorageRoot = path.join(tmpdir(), 'gft-custom-attachments');

describe('LocalAttachmentStorage', () => {
  it('creates nested directories and writes/read/removes a file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gft-attachments-'));
    const storage = new LocalAttachmentStorage(root);
    const bytes = Buffer.from('conteúdo');

    await storage.save('company/transaction/file', bytes);
    await expect(readFile(path.join(root, 'company/transaction/file'))).resolves.toEqual(bytes);
    await expect(storage.read('company/transaction/file')).resolves.toEqual(bytes);
    await expect(storage.remove('company/transaction/file')).resolves.toBeUndefined();
    await expect(storage.remove('company/transaction/file')).resolves.toBeUndefined();
  });

  it.each(['../outside', '/tmp/outside', 'company/../../outside', ''])('rejects an unsafe key: %s', async (key) => {
    const storage = new LocalAttachmentStorage(testStorageRoot);
    await expect(storage.save(key, Buffer.from('x'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(storage.read(key)).rejects.toBeInstanceOf(BadRequestException);
    await expect(storage.remove(key)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses only ATTACHMENT_STORAGE_DIR when configured', () => {
    const previous = process.env.ATTACHMENT_STORAGE_DIR;
    process.env.ATTACHMENT_STORAGE_DIR = customStorageRoot;
    expect(resolveAttachmentRoot()).toBe(customStorageRoot);
    if (previous === undefined) delete process.env.ATTACHMENT_STORAGE_DIR;
    else process.env.ATTACHMENT_STORAGE_DIR = previous;
  });
});

describe('Attachment storage selection and S3 adapter', () => {
  const s3Environment = {
    ATTACHMENT_STORAGE: 's3',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'attachments',
    S3_ACCESS_KEY_ID: 'test-access-key',
    S3_SECRET_ACCESS_KEY: 'test-secret-key',
    S3_FORCE_PATH_STYLE: 'true'
  };

  it('uses local storage by default and selects S3 only when explicitly configured', () => {
    expect(resolveAttachmentStorageMode({})).toBe('local');
    expect(createAttachmentStorage({ ATTACHMENT_STORAGE_DIR: path.join(tmpdir(), 'gft-test-attachments') })).toBeInstanceOf(LocalAttachmentStorage);
    expect(createAttachmentStorage(s3Environment)).toBeInstanceOf(S3AttachmentStorage);
    expect(resolveS3AttachmentStorageConfig(s3Environment)).toEqual({
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'attachments',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      forcePathStyle: true
    });
  });

  it('rejects an unknown mode, incomplete S3 configuration and invalid path-style flag', () => {
    expect(() => resolveAttachmentStorageMode({ ATTACHMENT_STORAGE: 'filesystem' })).toThrow('ATTACHMENT_STORAGE');
    expect(() => createAttachmentStorage({ ATTACHMENT_STORAGE: 's3' })).toThrow('S3_REGION');
    expect(() => resolveS3AttachmentStorageConfig({ ...s3Environment, S3_FORCE_PATH_STYLE: 'yes' })).toThrow('S3_FORCE_PATH_STYLE');
  });

  it('writes, reads and removes objects through the S3 command path without a network client', async () => {
    const objects = new Map<string, Buffer>();
    const requests: Array<{ command: string; bucket?: string; key?: string }> = [];
    const client = {
      send: async (command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand) => {
        const input = command.input;
        requests.push({ command: command.constructor.name, bucket: input.Bucket, key: input.Key });
        if (command instanceof PutObjectCommand) {
          objects.set(`${input.Bucket}/${input.Key}`, Buffer.from(command.input.Body as Uint8Array));
          return {};
        }
        if (command instanceof GetObjectCommand) {
          const bytes = objects.get(`${input.Bucket}/${input.Key}`);
          return { Body: { transformToByteArray: async () => Uint8Array.from(bytes ?? []) } };
        }
        objects.delete(`${input.Bucket}/${input.Key}`);
        return {};
      }
    };
    const storage = new S3AttachmentStorage({
      region: 'us-east-1',
      bucket: 'attachments',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      forcePathStyle: true
    }, client as never);
    const companyOneKey = 'company-one/transaction-one/attachment-one';
    const companyTwoKey = 'company-two/transaction-one/attachment-two';
    const bytes = Buffer.from('conteúdo S3');

    await storage.save(companyOneKey, bytes);
    await storage.save(companyTwoKey, Buffer.from('outro conteúdo'));
    await expect(storage.read(companyOneKey)).resolves.toEqual(bytes);
    expect(objects.has(`attachments/${companyTwoKey}`)).toBe(true);
    await storage.remove(companyOneKey);
    await expect(storage.read(companyOneKey)).resolves.toEqual(Buffer.alloc(0));
    expect(requests.map(({ command }) => command)).toEqual([
      'PutObjectCommand',
      'PutObjectCommand',
      'GetObjectCommand',
      'DeleteObjectCommand',
      'GetObjectCommand'
    ]);
    await expect(storage.save('../escape', bytes)).rejects.toBeInstanceOf(BadRequestException);
  });
});
