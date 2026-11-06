import { isSupabasePostgresHost, normalizeCaCertificate } from '../database/postgres-connection';

function requireValues(values: Record<string, string>): void {
  for (const key of ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'TERMS_VERSION', 'PRIVACY_POLICY_VERSION']) {
    if (!values[key]?.trim()) throw new Error(`Missing required environment variable: ${key}`);
  }
}

function validateDatabase(values: Record<string, string>): void {
  if (!/^postgres(ql)?:\/\//i.test(values.DATABASE_URL)) throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  let hostname: string;
  try {
    hostname = new URL(values.DATABASE_URL).hostname;
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!isSupabasePostgresHost(hostname)) return;
  try {
    values.DATABASE_CA_CERT = normalizeCaCertificate(values.DATABASE_CA_CERT || '');
  } catch {
    throw new Error('DATABASE_CA_CERT must contain the Supabase project CA certificate in PEM format.');
  }
}

function validateNumericSettings(values: Record<string, string>): void {
  const bcryptCost = Number(values.BCRYPT_COST || 12);
  if (!Number.isInteger(bcryptCost) || bcryptCost < 10 || bcryptCost > 14) throw new Error('BCRYPT_COST must be an integer between 10 and 14.');
  const tokenTtl = Number(values.JWT_ACCESS_TTL_SECONDS || 900);
  if (!Number.isInteger(tokenTtl) || tokenTtl < 60 || tokenTtl > 3600) throw new Error('JWT_ACCESS_TTL_SECONDS must be between 60 and 3600 seconds.');
}

export function validateEnvironment(config: Record<string, unknown>): Record<string, string> {
  const values = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, value == null ? '' : String(value)])
  );

  requireValues(values);
  validateDatabase(values);

  if (values.JWT_ACCESS_SECRET.length < 32 || values.JWT_ACCESS_SECRET.startsWith('SUBSTITUIR_')) {
    throw new Error('JWT_ACCESS_SECRET must be a locally generated secret of at least 32 characters.');
  }

  validateNumericSettings(values);

  values.PORT ||= '3001';
  values.FRONTEND_ORIGIN ||= 'http://localhost:3000';
  values.JWT_ACCESS_TTL_SECONDS ||= '900';
  values.JWT_ISSUER ||= 'gft-inteligente-api';
  values.JWT_AUDIENCE ||= 'gft-inteligente-client';
  values.BCRYPT_COST ||= '12';
  values.GEMINI_MODEL ||= 'gemini-3.8-flash';

  return values;
}
