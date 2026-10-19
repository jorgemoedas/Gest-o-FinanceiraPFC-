export interface PostgresAdapterOptions {
  connectionString: string;
  ssl?: {
    ca: string;
    rejectUnauthorized: true;
  };
}

const BEGIN_CERTIFICATE = '-----BEGIN CERTIFICATE-----';
const END_CERTIFICATE = '-----END CERTIFICATE-----';

export function isSupabasePostgresHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.endsWith('.pooler.supabase.com') || host.endsWith('.supabase.co');
}

export function normalizeCaCertificate(value: string): string {
  const input = value.trim().replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n');
  const match = input.match(/^-----BEGIN CERTIFICATE-----\s*([\s\S]+?)\s*-----END CERTIFICATE-----$/);
  if (!match) {
    throw new Error('DATABASE_CA_CERT must contain one PEM X.509 certificate.');
  }

  const body = match[1].replace(/\s/g, '');
  if (!body || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new Error('DATABASE_CA_CERT contains an invalid base64 certificate body.');
  }

  const lines = body.match(/.{1,64}/g) ?? [];
  return `${BEGIN_CERTIFICATE}\n${lines.join('\n')}\n${END_CERTIFICATE}\n`;
}

export function postgresAdapterOptions(databaseUrl: string, caCertificate?: string): PostgresAdapterOptions {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (!isSupabasePostgresHost(parsed.hostname)) {
    return { connectionString: databaseUrl };
  }

  if (!caCertificate?.trim()) {
    throw new Error('DATABASE_CA_CERT is required for certificate-verified Supabase PostgreSQL connections.');
  }

  const ca = normalizeCaCertificate(caCertificate);
  // node-postgres otherwise lets SSL query parameters override the `ssl` object.
  for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    parsed.searchParams.delete(parameter);
  }

  return {
    connectionString: parsed.toString(),
    ssl: { ca, rejectUnauthorized: true }
  };
}
