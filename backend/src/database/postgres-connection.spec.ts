import { isSupabasePostgresHost, normalizeCaCertificate, postgresAdapterOptions } from './postgres-connection';

const body = Buffer.from('certificate material for deterministic unit tests').toString('base64');
const compactPem = `-----BEGIN CERTIFICATE-----${body}-----END CERTIFICATE-----`;

describe('postgres connection options', () => {
  it('normalizes a collapsed PEM certificate into standard 64-column lines', () => {
    const normalized = normalizeCaCertificate(compactPem);
    expect(normalized.startsWith('-----BEGIN CERTIFICATE-----\n')).toBe(true);
    expect(normalized.endsWith('\n-----END CERTIFICATE-----\n')).toBe(true);
    expect(normalized.split('\n').slice(1, -2).join('')).toBe(body);
  });

  it('accepts escaped newline characters from environment-protected inputs', () => {
    const escaped = `-----BEGIN CERTIFICATE-----\\n${body}\\n-----END CERTIFICATE-----`;
    expect(normalizeCaCertificate(escaped)).toBe(normalizeCaCertificate(compactPem));
  });

  it('rejects malformed PEM instead of weakening TLS verification', () => {
    expect(() => normalizeCaCertificate('not a certificate')).toThrow('one PEM X.509 certificate');
    expect(() => normalizeCaCertificate('-----BEGIN CERTIFICATE-----!!!?-----END CERTIFICATE-----'))
      .toThrow('invalid base64');
  });

  it('recognizes Supabase pooler and direct database hostnames', () => {
    expect(isSupabasePostgresHost('aws-0-region.pooler.supabase.com')).toBe(true);
    expect(isSupabasePostgresHost('db.example-ref.supabase.co')).toBe(true);
    expect(isSupabasePostgresHost('localhost')).toBe(false);
  });

  it('uses the CA with hostname verification for Supabase and removes conflicting SSL URL parameters', () => {
    const options = postgresAdapterOptions(
      'postgresql://user:password@aws-0-region.pooler.supabase.com:5432/postgres?schema=public&sslmode=verify-full&sslrootcert=%2Ftmp%2Fca.pem',
      compactPem
    );
    expect(options.connectionString).toContain('schema=public');
    expect(options.connectionString).not.toMatch(/sslmode|sslrootcert/);
    expect(options.ssl).toEqual({ ca: normalizeCaCertificate(compactPem), rejectUnauthorized: true });
  });

  it('does not impose Supabase CA requirements on a local PostgreSQL URL', () => {
    expect(postgresAdapterOptions('postgresql://gft:local@localhost:5432/gft_dev?schema=gft_inteligente'))
      .toEqual({ connectionString: 'postgresql://gft:local@localhost:5432/gft_dev?schema=gft_inteligente' });
  });
});
