import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const begin = '-----BEGIN CERTIFICATE-----';
const end = '-----END CERTIFICATE-----';

function normalizeCertificate(value) {
  const input = value.trim().replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n');
  const match = input.match(/^-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----$/);
  if (!match) throw new Error('DATABASE_CA_CERT must contain one PEM X.509 certificate.');
  const body = match[1].replace(/\s/g, '');
  if (!body || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new Error('DATABASE_CA_CERT contains an invalid base64 certificate body.');
  }
  return `${begin}\n${(body.match(/.{1,64}/g) ?? []).join('\n')}\n${end}\n`;
}

function redact(text) {
  return text.replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, 'postgresql://[redacted]');
}

let directory;
try {
  const rawUrl = process.env.DATABASE_URL;
  const rawCertificate = process.env.DATABASE_CA_CERT;
  if (!rawUrl || !rawCertificate) throw new Error('DATABASE_URL and DATABASE_CA_CERT are required.');

  const url = new URL(rawUrl);
  if (!url.hostname.endsWith('.pooler.supabase.com') || Number(url.port || 5432) !== 5432) {
    throw new Error('Use the Supabase Session Pooler URL on port 5432.');
  }

  const certificate = normalizeCertificate(rawCertificate);
  directory = mkdtempSync(join(tmpdir(), 'gft-supabase-ca-'));
  const certificatePath = join(directory, 'root.crt');
  writeFileSync(certificatePath, certificate, { mode: 0o600 });

  for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(parameter);
  url.searchParams.set('schema', 'gft_inteligente');
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', certificatePath);

  const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--config', 'prisma.config.ts'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url.toString() },
    encoding: 'utf8'
  });

  if (result.stdout) process.stdout.write(redact(result.stdout));
  if (result.stderr) process.stderr.write(redact(result.stderr));
  if (result.error) {
    console.error(`Prisma migration could not start (${result.error.code || result.error.name || 'unknown'}).`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Supabase migration setup failed.');
  process.exitCode = 1;
} finally {
  if (directory) rmSync(directory, { recursive: true, force: true });
}
