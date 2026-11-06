import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import storageModule from '../../dist/modules/finance/attachment-storage.js';

const {
  LocalAttachmentStorage,
  S3AttachmentStorage
} = storageModule;

const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error('S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY são obrigatórios.');
}

const config = {
  endpoint,
  region,
  bucket,
  accessKeyId,
  secretAccessKey,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
};
const clientOptions = {
  endpoint,
  region,
  forcePathStyle: config.forcePathStyle,
  credentials: { accessKeyId, secretAccessKey }
};
const client = new S3Client(clientOptions);
const storageFromReplicaA = new S3AttachmentStorage(config);
const storageFromReplicaB = new S3AttachmentStorage(config);
const startedAt = performance.now();
const localRoot = await mkdtemp(path.join(tmpdir(), 'gft-local-replica-'));
const companyA = 'company-a';
const companyB = 'company-b';
const transactionA = 'transaction-a';
const transactionB = 'transaction-b';
const keyA = `${companyA}/${transactionA}/attachment-a`;
const keyB = `${companyB}/${transactionB}/attachment-b`;
const bytesA = Buffer.from('anexo real gravado pela replica A\n');
const bytesB = Buffer.from('anexo da segunda empresa\n');
const checksumA = createHash('sha256').update(bytesA).digest('hex');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectReadFailure(storage, key) {
  try {
    await storage.read(key);
  } catch {
    return;
  }
  throw new Error(`A leitura deveria falhar para ${key}.`);
}

let created = false;
try {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  created = true;


  const localReplicaA = new LocalAttachmentStorage(path.join(localRoot, 'replica-a'));
  const localReplicaB = new LocalAttachmentStorage(path.join(localRoot, 'replica-b'));
  await localReplicaA.save(keyA, bytesA);
  await expectReadFailure(localReplicaB, keyA);
  console.log('LOCAL_REPLICA_VISIBILITY=not_shared (confirmado)');


  await storageFromReplicaA.save(keyA, bytesA);
  const downloadedA = await storageFromReplicaB.read(keyA);
  assert(downloadedA.equals(bytesA), 'Integridade do download S3 não confere.');
  assert(createHash('sha256').update(downloadedA).digest('hex') === checksumA, 'Checksum SHA-256 S3 não confere.');
  console.log(`S3_UPLOAD_DOWNLOAD=ok bytes=${downloadedA.length} sha256=${checksumA}`);

  await storageFromReplicaB.save(keyB, bytesB);
  const allObjects = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
  const allKeys = (allObjects.Contents ?? []).map((object) => object.Key).filter(Boolean);
  assert(allKeys.includes(keyA) && allKeys.includes(keyB), 'Listagem S3 não encontrou os dois prefixos de empresa.');
  const companyAObjects = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${companyA}/` }));
  const companyAKeys = (companyAObjects.Contents ?? []).map((object) => object.Key).filter(Boolean);
  assert(companyAKeys.length === 1 && companyAKeys[0] === keyA, 'Prefixo da empresa A não isolou seus objetos.');
  assert(!companyAKeys.some((key) => key.startsWith(`${companyB}/`)), 'Prefixo da empresa A expôs objeto da empresa B.');
  console.log(`S3_LIST_PREFIX=ok total=${allKeys.length} companyA=${companyAKeys.length}`);

  await storageFromReplicaA.remove(keyA);
  await expectReadFailure(storageFromReplicaB, keyA);
  const afterRemove = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${companyA}/` }));
  assert((afterRemove.Contents ?? []).length === 0, 'Remoção S3 não retirou o objeto do prefixo.');
  console.log('S3_REMOVE=ok');

  const objectCountAfterRemove = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
  assert((objectCountAfterRemove.Contents ?? []).length === 1, 'O objeto da empresa B deveria permanecer após remover A.');
  console.log(`S3_MULTI_REPLICA_VISIBILITY=shared companyB_objects=${objectCountAfterRemove.Contents.length}`);
} finally {
  if (created) {
    const remaining = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    const keys = (remaining.Contents ?? []).map((object) => object.Key).filter(Boolean);
    if (keys.length > 0) {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true }
      }));
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  }
  await rm(localRoot, { recursive: true, force: true });
}

console.log(`MINIO_E2E=passed duration_ms=${Math.round(performance.now() - startedAt)}`);
