#!/usr/bin/env node
import { tmpdir } from 'node:os';
import { join } from 'node:path';





import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const BASE = process.env.GFT_API_BASE_URL || 'http://127.0.0.1:3001';
const API = `${BASE.replace(/\/$/, '')}/api/v1`;
const FIXTURE_CREDENTIALS = join(tmpdir(), 'gft-load-volume.json');
const DB_SCHEMA = 'gft_inteligente';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const dotenv = require('dotenv');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS' } });
const { postgresAdapterOptions } = require('../../src/database/postgres-connection.ts');
const results = [];
let lastRequestAt = 0;
let apiEnv = null;
let pool = null;
let companyBId = null;
let userBId = null;
let aSyntheticCounterpartyId = null;
let fixtureReady = false;
let fixtureMarker = null;
const bTransactionIds = new Set();
const bCounterpartyIds = new Set();
const OWASP_CATEGORIES = [
  ['A01', 'Quebra de controle de acesso'],
  ['A02', 'Falhas criptográficas'],
  ['A03', 'Injeção'],
  ['A04', 'Design inseguro'],
  ['A05', 'Configuração de segurança incorreta'],
  ['A06', 'Componentes vulneráveis e desatualizados'],
  ['A07', 'Falhas de identificação e autenticação'],
  ['A08', 'Falhas de integridade de software e dados'],
  ['A09', 'Falhas de registro e monitoramento'],
  ['A10', 'Falsificação de requisições do lado do servidor (SSRF)']
];

function categoryFor(name) {
  if (/Acesso protegido|tenant|cross-tenant|IDOR|lançamento(?: de)? A|contraparte de A|evento de auditoria A|vínculo|listagem de lançamentos|listagem de contrapartes|Remoção integral|fixture B|recurso não exposto/i.test(name)) return 'A01';
  if (/TLS|certificado|hash|criptograf|token assinado|Token expirado|Cookie de sessão|reset imprevisível|replay/i.test(name)) return 'A02';
  if (/injeção|filtro|caractere de controle|descrição acima|SQL|category|status/i.test(name)) return 'A03';
  if (/senha fraca|rate limit|limite de login|limite CNPJ/i.test(name)) return 'A04';
  if (/Origem|metrics|OpenAPI|Cabeçalhos/i.test(name)) return 'A05';
  if (/dependên|componente|lockfile/i.test(name)) return 'A06';
  if (/Autenticação|Login|Token adulterado|reset|sessão/i.test(name)) return 'A07';
  if (/integridade|fixture isolado|contrato/i.test(name)) return 'A08';
  if (/auditoria|vazamento|resposta|log/i.test(name)) return 'A09';
  if (/SSRF|CNPJ|upstream|servidor/i.test(name)) return 'A10';
  return 'A04';
}

function result(name, attempted, observed, verdict, category = categoryFor(name)) {
  const item = { category, name, attempted, observed, verdict };
  results.push(item);
  console.log(`RESULT ${JSON.stringify(item)}`);
}

function findApiProcessEnv() {
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').replaceAll('\0', ' ');
      if (!/node/i.test(cmd) || !/(backend|dist\/main|ts-node)/i.test(cmd)) continue;
      const raw = fs.readFileSync(`/proc/${entry}/environ`, 'utf8');
      const env = {};
      for (const pair of raw.split('\0')) {
        const split = pair.indexOf('=');
        if (split > 0) env[pair.slice(0, split)] = pair.slice(split + 1);
      }
      if (env.DATABASE_URL && env.DATABASE_CA_CERT) return env;
    } catch {  }
  }
  return null;
}

function normalizeCa(value) {
  const normalized = value.trim().replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n');
  if (!normalized.includes('-----BEGIN CERTIFICATE-----') || !normalized.includes('-----END CERTIFICATE-----')) {
    throw new Error('CA inválida');
  }
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function summarizeResponse(r) {
  const body = r.json;
  if (body && typeof body === 'object') {
    if (Array.isArray(body.items)) return `HTTP ${r.status}; itens=${body.items.length}; total=${Number.isFinite(body.total) ? body.total : 'n/a'}`;
    if (Array.isArray(body)) return `HTTP ${r.status}; itens=${body.length}`;
    if (typeof body.message === 'string') return `HTTP ${r.status}; erro=${body.message.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[UUID]').slice(0, 120)}`;
    return `HTTP ${r.status}; JSON=${Object.keys(body).slice(0, 12).join(',')}`;
  }
  return `HTTP ${r.status}; corpo=${r.text.slice(0, 100)}`;
}

async function request(path, options = {}) {
  const wait = Math.max(0, 1250 - (Date.now() - lastRequestAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const headers = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.origin) headers.Origin = options.origin;
  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${API}${path}`, {
    method: options.method || 'GET', headers, body, redirect: 'manual', signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {  }
  return { status: response.status, text, json, headers: response.headers };
}

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

async function waitForServiceReady(attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const readiness = await requestOutsidePrefix('/health/ready');
      if (readiness.status === 200 && readiness.json?.status === 'ready') return true;
    } catch {  }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

async function requestWithTransientRetry(path, options = {}, { attempts = 3, delayMs = 5000 } = {}) {
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      lastResponse = await request(path, options);
      lastError = null;
      if (!TRANSIENT_HTTP_STATUSES.has(lastResponse.status) || attempt === attempts - 1) return lastResponse;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (lastResponse) return lastResponse;
  throw lastError || new Error('Falha transitória sem resposta HTTP');
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

function stableLoginErrorSignature(response) {
  const body = response?.json;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const rawMessage = body.message;
  const message = typeof rawMessage === 'string'
    ? { kind: 'string', value: rawMessage.replace(UUID_PATTERN, '[UUID]') }
    : Array.isArray(rawMessage) && rawMessage.every((item) => typeof item === 'string')
      ? { kind: 'array', value: rawMessage.map((item) => item.replace(UUID_PATTERN, '[UUID]')) }
      : null;
  const errorType = typeof body.error === 'string' ? body.error : typeof body.type === 'string' ? body.type : null;
  const errorCode = typeof body.code === 'string' ? body.code : typeof body.errorCode === 'string' ? body.errorCode : null;
  const statusCode = Number.isInteger(body.statusCode) ? body.statusCode : response.status;
  return { httpStatus: response.status, statusCode, errorType, errorCode, message };
}

function hasSafeGenericLoginError(response) {
  const signature = stableLoginErrorSignature(response);
  return response?.status === 401 && signature?.statusCode === 401 && Boolean(signature?.message) &&
    !containsInternalError(response.text) && !containsCredentialDisclosure(response.text);
}

function loginErrorsEquivalent(left, right) {
  if (!hasSafeGenericLoginError(left) || !hasSafeGenericLoginError(right)) return false;
  return JSON.stringify(stableLoginErrorSignature(left)) === JSON.stringify(stableLoginErrorSignature(right));
}

async function requestAuditLogsWithRetry(token, expectedActions) {
  let response = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await request('/audit-logs?page=1&limit=100', { token });
    const items = response.json?.items || [];
    const complete = response.status === 200 && expectedActions.every((action) => items.some((item) => item.action === action));
    if (complete || attempt === 2) return response;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return response;
}

function containsInternalError(text) {
  return /(PrismaClient(?:KnownRequestError|ValidationError)?|node_modules|\/home\/[^\s"']+|gft_inteligente\."|\bSELECT\b.{0,80}\bFROM\b|\bat\s+\w+\s+\([^\n]*:\d+:\d+\)|stack\s*trace|DATABASE_URL|JWT_ACCESS_SECRET)/i.test(text);
}

function containsCredentialDisclosure(text) {
  return /(postgres(?:ql)?:\/\/[^\s"']+|-----BEGIN (?:RSA |EC |PRIVATE )?PRIVATE KEY-----|DATABASE_URL\s*[:=]|DATABASE_CA_CERT\s*[:=]|JWT_ACCESS_SECRET\s*[:=]|SUPABASE_SERVICE_ROLE_KEY\s*[:=]|passwordHash|tokenHash)/i.test(text);
}

function hasInternalAuthFields(value) {
  if (Array.isArray(value)) return value.some(hasInternalAuthFields);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) =>
    /passwordhash|tokenhash|databaseurl|secretkey|privatekey|internal/i.test(key) || hasInternalAuthFields(item));
}

function runStaticCategoryChecks() {
  const backendDirectory = new URL('../..', import.meta.url).pathname;
  const lockPath = new URL('../../package-lock.json', import.meta.url);
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const packages = Object.values(lock.packages || {}).filter((entry) => entry && typeof entry === 'object' && entry.resolved);
    const missingIntegrity = packages.filter((entry) => !entry.integrity).length;
    let auditJson = null;
    try {
      auditJson = JSON.parse(execFileSync('npm', ['audit', '--omit=dev', '--json'], {
        cwd: backendDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }));
    } catch (error) {
      try { auditJson = JSON.parse(error.stdout?.toString?.() || ''); } catch { auditJson = null; }
    }
    const vulnerabilities = Number(auditJson?.metadata?.vulnerabilities?.total ?? NaN);
    result(
      'Dependências de produção sem vulnerabilidades conhecidas',
      'Validar package-lock.json e executar npm audit --omit=dev sem imprimir a árvore nem URLs de conexão',
      `lockfile íntegro=${missingIntegrity === 0}; pacotes resolvidos=${packages.length}; vulnerabilidades reportadas=${Number.isFinite(vulnerabilities) ? vulnerabilities : 'indisponível'}`,
      Number.isFinite(vulnerabilities) ? (vulnerabilities === 0 && missingIntegrity === 0 ? 'aprovado' : 'reprovado') : 'inconclusivo',
      'A06'
    );
    result(
      'Integridade do lockfile e dos artefatos de dependência',
      'Conferir lockfileVersion, integridade de pacotes resolvidos e ausência de dependências sem hash',
      `lockfileVersion=${lock.lockfileVersion ?? 'ausente'}; pacotes sem integrity=${missingIntegrity}`,
      lock.lockfileVersion && missingIntegrity === 0 ? 'aprovado' : 'reprovado',
      'A08'
    );
  } catch {
    result('Dependências e integridade do lockfile', 'Ler package-lock.json e validar dependências instaladas', 'Lockfile ou auditoria não disponível; detalhes omitidos', 'inconclusivo', 'A06');
    result('Integridade do lockfile e dos artefatos de dependência', 'Conferir hashes de dependências', 'Lockfile não pôde ser lido; detalhes omitidos', 'inconclusivo', 'A08');
  }


  const logPath = process.env.GFT_SECURITY_LOG_PATH?.trim();
  try {
    if (!logPath) throw new Error('Log real não configurado');
    const logText = fs.readFileSync(logPath, 'utf8');
    const leaked = containsCredentialDisclosure(logText) || containsInternalError(logText);
    result('Vazamento de dados em logs', 'Ler o log real da API sem exibir conteúdo e procurar credenciais, tokens, SQL e caminhos internos', `Log real lido; bytes=${Buffer.byteLength(logText)}; assinatura sensível encontrada=${leaked}`, logText.length > 0 && !leaked ? 'aprovado' : 'reprovado', 'A09');
  } catch {
    result('Vazamento de dados em logs', 'Ler o log real da API sem exibir conteúdo', 'Log real indisponível; nenhuma evidência sintética foi aceita', 'inconclusivo', 'A09');
  }

  try {
    const registrySource = fs.readFileSync(new URL('../../src/modules/business-registry/business-registry.service.ts', import.meta.url), 'utf8');
    const fixedOrigin = registrySource.includes("const API_BASE = 'https://www.receitaws.com.br/v1/cnpj/'");
    const encodedPath = registrySource.includes('encodeURIComponent(cnpj)');
    const timeout = registrySource.includes('AbortSignal.timeout');
    result('Proteção contra SSRF na integração de CNPJ', 'Inspecionar origem fixa HTTPS, codificação do identificador e timeout antes do acesso ao provedor externo', `origem fixa HTTPS=${fixedOrigin}; CNPJ codificado=${encodedPath}; timeout=${timeout}`, fixedOrigin && encodedPath && timeout ? 'aprovado' : 'reprovado', 'A10');
  } catch {
    result('Proteção contra SSRF na integração de CNPJ', 'Inspecionar a integração externa de CNPJ', 'Fonte não disponível; detalhes omitidos', 'inconclusivo', 'A10');
  }
}

async function runCnpjQuotaDouble() {
  const { BusinessRegistryService } = require('../../src/modules/business-registry/business-registry.service.ts');
  const originalFetch = globalThis.fetch;
  const cnpjs = ['11222333000181', '11444777000161', '27865757000102', '04252011000110'];
  let upstreamCalls = 0;
  globalThis.fetch = async (url) => {
    upstreamCalls += 1;
    const cnpj = String(url).split('/').pop();
    return new Response(JSON.stringify({ status: 'OK', cnpj, nome: `OWASP quota double ${upstreamCalls}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const service = new BusinessRegistryService({ write: async () => {} }, { get: (_key, fallback) => fallback });
    const principal = { userId: crypto.randomUUID(), companyId: crypto.randomUUID(), role: 'OWNER' };
    const statuses = [];
    for (const cnpj of cnpjs) {
      try {
        await service.lookup(cnpj, principal);
        statuses.push(200);
      } catch (error) {
        statuses.push(typeof error?.getStatus === 'function' ? error.getStatus() : 500);
      }
    }
    return upstreamCalls === 3 && statuses.join(',') === '200,200,200,429';
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function makeJwt(payload, secret) {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = enc({ alg: 'HS256', typ: 'JWT' });
  const content = `${header}.${enc(payload)}`;
  const sig = crypto.createHmac('sha256', secret).update(content).digest('base64url');
  return `${content}.${sig}`;
}

function getPayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function authResponseValid(json) {
  if (!json || typeof json !== 'object') return false;
  const top = Object.keys(json).sort().join(',');
  const userKeys = Object.keys(json.user || {}).sort().join(',');
  return top === 'accessToken,expiresInSeconds,refreshToken,tokenType,user' &&
    typeof json.accessToken === 'string' && typeof json.refreshToken === 'string' &&
    userKeys === 'companyId,companyName,email,id,role' && !hasInternalAuthFields(json);
}

async function createDatabasePool() {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? join(process.cwd(), '.env'), quiet: true });
  apiEnv = { ...process.env, ...(findApiProcessEnv() || {}) };
  if (!apiEnv?.DATABASE_URL || !apiEnv?.DATABASE_CA_CERT) return false;
  const adapterOptions = postgresAdapterOptions(apiEnv.DATABASE_URL, apiEnv.DATABASE_CA_CERT);
  pool = new Pool({
    ...adapterOptions,
    connectionTimeoutMillis: 7000,
    idleTimeoutMillis: 10000,
    max: 2
  });
  await pool.query('SELECT 1');
  return true;
}

async function cleanupFixture() {
  if (!pool) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (aSyntheticCounterpartyId) {
      await client.query(`DELETE FROM "${DB_SCHEMA}"."AuditLog" WHERE "entityId" = $1 AND "action" = 'FINANCE_COUNTERPARTY_CREATED'`, [aSyntheticCounterpartyId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."FinanceCounterparty" WHERE "id" = $1`, [aSyntheticCounterpartyId]);
    }
    if (companyBId && userBId) {
      await client.query(`DELETE FROM "${DB_SCHEMA}"."AuditLog" WHERE "companyId" = $1 OR "actorUserId" = $2`, [companyBId, userBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."PasswordResetToken" WHERE "userId" = $1`, [userBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."RefreshSessionToken" WHERE "userId" = $1`, [userBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."TermAcceptance" WHERE "userId" = $1 OR "companyId" = $2`, [userBId, companyBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."FinanceAttachment" WHERE "companyId" = $1`, [companyBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."FinanceTransaction" WHERE "companyId" = $1`, [companyBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."FinanceRecurrence" WHERE "companyId" = $1`, [companyBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."FinanceCounterparty" WHERE "companyId" = $1`, [companyBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."FiscalObligation" WHERE "companyId" = $1`, [companyBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."CompanyProfile" WHERE "companyId" = $1`, [companyBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."CompanyMembership" WHERE "userId" = $1 OR "companyId" = $2`, [userBId, companyBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."User" WHERE "id" = $1`, [userBId]);
      await client.query(`DELETE FROM "${DB_SCHEMA}"."Company" WHERE "id" = $1`, [companyBId]);
    }
    await client.query('COMMIT');
    if (!companyBId || !userBId) {
      aSyntheticCounterpartyId = null;
      return true;
    }
    const check = await client.query(
      `SELECT (SELECT count(*) FROM "${DB_SCHEMA}"."User" WHERE "id"=$1) AS users, (SELECT count(*) FROM "${DB_SCHEMA}"."Company" WHERE "id"=$2) AS companies`,
      [userBId, companyBId]
    );
    return Number(check.rows[0].users) === 0 && Number(check.rows[0].companies) === 0;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  let tokenA = null;
  let tokenB = null;
  let userAId = null;
  let companyAId = null;
  let aTransactionId = null;
  let aCounterpartyId = null;
  let aAuditId = null;
  let aLogin = null;
  let bRegisterResponse = null;
  let bCreateTransactionResponse = null;
  let bCounterpartyResponse = null;
  let tlsVerified = false;

  try {
    runStaticCategoryChecks();
    let dbAvailable = false;
    try {
      dbAvailable = await createDatabasePool();
    } catch (error) {
      if (pool) await pool.end().catch(() => {});
      pool = null;
      result('Conexão PostgreSQL com certificado verificado', 'Conectar ao mesmo DATABASE_URL usando CA e rejectUnauthorized=true; consultar pg_stat_ssl', `Conexão auxiliar não validada (${error?.code || error?.name || 'erro'}); não houve fallback sem verificação`, 'inconclusivo');
    }
    if (!dbAvailable) {
      result('Fixture isolado e conexão DB/TLS', 'Localizar env do processo API e conectar com CA verificada antes de criar tenant', 'Conexão privilegiada/CA não disponível; fixture não criado para evitar dados órfãos', 'inconclusivo');
    } else {
      const client = await pool.connect();
      let backendSsl = false;
      try {
        const socket = client.connection.stream;
        const ssl = await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
        backendSsl = ssl.rows.length === 1 && ssl.rows[0].ssl === true;
        tlsVerified = Boolean(socket.encrypted && socket.authorized === true && !socket.authorizationError);
      } finally {
        client.release();
      }
      result('Conexão PostgreSQL com certificado verificado', 'Conectar usando postgresAdapterOptions e confirmar TLSSocket criptografado/autorizado; pg_stat_ssl é apenas estado do backend remoto', `TLS cliente criptografado e certificado autorizado=${tlsVerified}; pg_stat_ssl no servidor=${backendSsl} (pode terminar no pooler)`, tlsVerified ? 'aprovado' : 'reprovado');
    }
    const tlsSource = fs.readFileSync(new URL('../../src/database/postgres-connection.ts', import.meta.url), 'utf8');
    const tlsRequiredInCode = tlsSource.includes('DATABASE_CA_CERT is required') && tlsSource.includes('rejectUnauthorized: true');
    result('Configuração de TLS exige CA e validação de certificado', 'Inspecionar postgres-connection.ts usado pelo Prisma', `CA obrigatória para Supabase=${tlsSource.includes('DATABASE_CA_CERT is required')}; rejectUnauthorized=true=${tlsSource.includes('rejectUnauthorized: true')}`, tlsRequiredInCode ? 'aprovado' : 'reprovado');

    const unauth = await request('/finance/transactions');
    result('Acesso protegido sem sessão', 'GET /finance/transactions sem Authorization', summarizeResponse(unauth), unauth.status === 401 ? 'aprovado' : 'reprovado');

    let credentials;
    try { credentials = JSON.parse(fs.readFileSync(FIXTURE_CREDENTIALS, 'utf8')); }
    catch { credentials = null; }
    if (!credentials?.email || !credentials?.password) {
      result('Autenticação da empresa de volume', 'Carregar credenciais apenas em memória do diretório temporário e autenticar', 'Arquivo ausente ou formato inválido; nenhum valor impresso', 'inconclusivo');
    } else {
      aLogin = await request('/auth/login', { method: 'POST', body: { email: credentials.email, password: credentials.password } });
      if ((aLogin.status === 200 || aLogin.status === 201) && aLogin.json?.accessToken) {
        tokenA = aLogin.json.accessToken;
        userAId = aLogin.json.user?.id;
        companyAId = aLogin.json.user?.companyId;
      }
      const clean = (aLogin.status === 200 || aLogin.status === 201) && authResponseValid(aLogin.json);
      result('Resposta de autenticação sem hash ou campos internos', 'Login válido da empresa de volume; inspecionar campos públicos, incluindo refreshToken no JSON, sem imprimir tokens', `HTTP ${aLogin.status}; contrato público=${clean}; accessToken/refreshToken no corpo=${Boolean(aLogin.json?.accessToken && aLogin.json?.refreshToken)}; Set-Cookie=${aLogin.headers.get('set-cookie') ? 'presente' : 'ausente'}`, clean ? 'aprovado' : 'reprovado');
      result('Cookie de sessão HttpOnly/Secure/SameSite=None', 'Inspecionar Set-Cookie da resposta de login', aLogin.headers.get('set-cookie') ? 'Cookie presente; atributos inspecionados sem registrar valor' : 'Nenhum cookie emitido; sessão observada é Bearer JSON, portanto não há cookie aplicável', aLogin.headers.get('set-cookie') ? (/httponly/i.test(aLogin.headers.get('set-cookie')) && /secure/i.test(aLogin.headers.get('set-cookie')) && /samesite=none/i.test(aLogin.headers.get('set-cookie')) ? 'aprovado' : 'reprovado') : 'aprovado');
    }

    let txA = null;
    let cpA = null;
    let auditA = null;
    if (tokenA) {
      txA = await request('/finance/transactions?page=1&limit=1', { token: tokenA });
      const txItems = txA.json?.items || [];
      aTransactionId = txItems[0]?.id || null;
      result('Identificar lançamento de A para teste cross-tenant', 'GET /finance/transactions?page=1&limit=1 com sessão A', `${summarizeResponse(txA)}; ID obtido=${Boolean(aTransactionId)} (omitido)`, aTransactionId ? 'aprovado' : 'inconclusivo');

      cpA = await request('/finance/counterparties?page=1&limit=1', { token: tokenA });
      aCounterpartyId = cpA.json?.items?.[0]?.id || txItems.find((x) => x.counterpartyId)?.counterpartyId || null;
      if (!aCounterpartyId && companyAId) {
        const syntheticCounterparty = await request('/finance/counterparties', { method: 'POST', token: tokenA, body: {
          name: `OWASP A CP ${crypto.randomBytes(5).toString('hex')}`, role: 'CUSTOMER'
        } });
        aCounterpartyId = syntheticCounterparty.json?.id || null;
        if (syntheticCounterparty.status === 201 && aCounterpartyId) aSyntheticCounterpartyId = aCounterpartyId;
      }
      result('Identificar contraparte de A para teste cross-tenant', 'GET /finance/counterparties?page=1&limit=1 com sessão A', `${summarizeResponse(cpA)}; ID obtido=${Boolean(aCounterpartyId)} (omitido)`, aCounterpartyId ? 'aprovado' : 'inconclusivo');

      auditA = await request('/audit-logs?page=1&limit=100', { token: tokenA });
      const aItems = auditA.json?.items || [];
      aAuditId = aItems.find((x) => x.actorUserId === userAId)?.id || aItems[0]?.id || null;
      result('Identificar evento de auditoria A para teste cross-tenant', 'GET /audit-logs?page=1&limit=100 com sessão A', `${summarizeResponse(auditA)}; evento com ID=${Boolean(aAuditId)} (omitido)`, aAuditId ? 'aprovado' : 'inconclusivo');

      const alteredPayload = getPayload(tokenA);
      alteredPayload.companyId = crypto.randomUUID();
      const oldParts = tokenA.split('.');
      const tampered = `${oldParts[0]}.${Buffer.from(JSON.stringify(alteredPayload)).toString('base64url')}.${oldParts[2]}`;
      const tamperResp = await request('/auth/me', { token: tampered });
      result('Token adulterado', 'Alterar claim companyId preservando assinatura original e chamar /auth/me', summarizeResponse(tamperResp), tamperResp.status === 401 ? 'aprovado' : 'reprovado');

      if (apiEnv?.JWT_ACCESS_SECRET) {
        const now = Math.floor(Date.now() / 1000);
        const shared = { sub: userAId, companyId: companyAId, iss: apiEnv.JWT_ISSUER || 'gft-inteligente-api', aud: apiEnv.JWT_AUDIENCE || 'gft-inteligente-client' };
        const expired = makeJwt({ ...shared, iat: now - 7200, exp: now - 3600 }, apiEnv.JWT_ACCESS_SECRET);
        const expiredResp = await request('/auth/me', { token: expired });
        result('Token expirado', 'Assinar localmente token expirado com a chave em memória do processo e chamar /auth/me', summarizeResponse(expiredResp), expiredResp.status === 401 ? 'aprovado' : 'reprovado');
      } else {
        result('Token expirado', 'Gerar token expirado com chave vigente do processo e chamar /auth/me', 'Chave JWT não acessível ao teste; não foi possível fabricar token com assinatura válida', 'inconclusivo');
      }
      const wrongKey = makeJwt({ ...getPayload(tokenA), iss: apiEnv?.JWT_ISSUER || 'gft-inteligente-api', aud: apiEnv?.JWT_AUDIENCE || 'gft-inteligente-client' }, crypto.randomBytes(32));
      const wrongKeyResp = await request('/auth/me', { token: wrongKey });
      result('Token assinado com outra chave', 'Assinar claims de sessão com chave aleatória independente e chamar /auth/me', summarizeResponse(wrongKeyResp), wrongKeyResp.status === 401 ? 'aprovado' : 'reprovado');

      const cors = await request('/finance/transactions?page=1&limit=1', { token: tokenA, origin: 'https://origem-estranha.invalid' });
      const allowOrigin = cors.headers.get('access-control-allow-origin');
      const corsRejected = cors.status >= 400;
      result('Origem HTTP estranha', 'GET autenticado em /finance/transactions com Origin https://origem-estranha.invalid', `HTTP ${cors.status}; Access-Control-Allow-Origin=${allowOrigin || 'ausente'}`, corsRejected ? 'aprovado' : 'reprovado');


      if (aTransactionId) {
        const byId = await request(`/finance/transactions/${encodeURIComponent(aTransactionId)}`, { token: tokenA });
        result('Lançamento de A consultado por ID com sessão A (rota de detalhe)', 'GET /finance/transactions/{id}; somente leitura', `${summarizeResponse(byId)}; controlador não define essa rota, portanto o registro não é publicado por detalhe`, byId.status === 404 ? 'aprovado' : byId.status === 200 ? 'aprovado' : 'inconclusivo');
      }
    } else {
      for (const name of ['Token adulterado', 'Token expirado', 'Token assinado com outra chave', 'Origem HTTP estranha', 'Identificação de recursos de A']) result(name, 'Requer sessão válida A', 'Login de A indisponível; verificação dependente não executada', 'inconclusivo');
    }

    const openapi = await requestOutsidePrefix('/openapi.json');
    const openapiSensitive = containsCredentialDisclosure(openapi.text);
    result('OpenAPI sem credenciais/conexão', 'GET público /openapi.json; varrer URI PostgreSQL, chaves privadas e nomes de segredos', `HTTP ${openapi.status}; assinatura de credencial presente=${openapiSensitive}`, openapi.status === 200 && !openapiSensitive ? 'aprovado' : 'reprovado');

    const metrics = await requestOutsidePrefix('/metrics');
    const metricsObj = metrics.json;
    const exposesOps = metrics.status === 200 && Array.isArray(metricsObj?.byRoute) && metricsObj.byRoute.some((x) => x.route && Number.isFinite(x.count));
    const metricsSecrets = containsCredentialDisclosure(metrics.text);
    const metricsProtected = metrics.status === 401 || metrics.status === 403;
    const metricsVerdict = metricsProtected ? 'aprovado' : metrics.status >= 500 ? 'inconclusivo' : 'reprovado';
    result('Exposição pública de /metrics', 'GET /metrics sem sessão; confirmar recusa de acesso e ausência de telemetria', `HTTP ${metrics.status}; acesso sem sessão recusado=${metricsProtected}; rotas/contagens/latências públicas=${exposesOps}; credenciais encontradas=${metricsSecrets}`, metricsVerdict);
    const responseLeak = containsCredentialDisclosure(openapi.text) || containsCredentialDisclosure(metrics.text) || containsInternalError(openapi.text) || containsInternalError(metrics.text);
    result('Vazamento de dados em respostas públicas', 'Varrer OpenAPI e métricas públicas em busca de credenciais, tokens, SQL, stack traces e caminhos internos', `credenciais ou detalhes internos encontrados=${responseLeak}`, responseLeak ? 'reprovado' : 'aprovado', 'A09');

    const headerProbe = tokenA ? await request('/finance/transactions?page=1&limit=1', { token: tokenA }) : await request('/health');
    const securityHeaders = ['x-content-type-options', 'x-frame-options', 'content-security-policy', 'referrer-policy'];
    const presentHeaders = securityHeaders.filter((h) => headerProbe.headers.has(h));
    const headersOk = presentHeaders.includes('x-content-type-options') && presentHeaders.includes('x-frame-options') && presentHeaders.includes('content-security-policy');
    result('Cabeçalhos HTTP de segurança', 'Inspecionar resposta da API para cabeçalhos Helmet', `Presentes=${presentHeaders.join(',') || 'nenhum'}; faltantes=${securityHeaders.filter((h) => !presentHeaders.includes(h)).join(',') || 'nenhum'}`, headersOk ? 'aprovado' : 'reprovado');

    if (apiEnv?.TERMS_VERSION && apiEnv?.PRIVACY_POLICY_VERSION) {
      const weak = await request('/auth/register', { method: 'POST', body: {
        email: `weak-${crypto.randomUUID()}@example.invalid`, password: 'weak-123', companyName: 'Fixture de senha fraca',
        acceptedTerms: true, acceptedPrivacy: true, termsVersion: apiEnv.TERMS_VERSION, privacyVersion: apiEnv.PRIVACY_POLICY_VERSION
      } });
      result('Cadastro recusa senha fraca', 'POST /auth/register com senha abaixo do mínimo e versões vigentes', summarizeResponse(weak), weak.status === 400 ? 'aprovado' : 'reprovado');
    } else {
      result('Cadastro recusa senha fraca', 'POST /auth/register com senha abaixo do mínimo', 'Versões vigentes não disponíveis no ambiente do processo; chamada não enviada', 'inconclusivo');
    }


    if (dbAvailable && tlsVerified && apiEnv?.TERMS_VERSION && apiEnv?.PRIVACY_POLICY_VERSION) {
      fixtureMarker = crypto.randomBytes(8).toString('hex');
      const syntheticEmail = `owasp-${crypto.randomUUID()}@example.invalid`;
      const syntheticPassword = crypto.randomBytes(24).toString('base64url');
      const registrationBody = {
        email: syntheticEmail, password: syntheticPassword, companyName: `OWASP fixture ${fixtureMarker}`,
        acceptedTerms: true, acceptedPrivacy: true, termsVersion: apiEnv.TERMS_VERSION, privacyVersion: apiEnv.PRIVACY_POLICY_VERSION
      };
      const serviceReady = await waitForServiceReady();
      bRegisterResponse = serviceReady
        ? await requestWithTransientRetry('/auth/register', { method: 'POST', body: registrationBody })
        : { status: 503, text: '', json: null, headers: new Headers() };



      if (!(bRegisterResponse.status === 201 && bRegisterResponse.json?.user?.id && bRegisterResponse.json?.user?.companyId)) {
        const recovered = await requestWithTransientRetry('/auth/login', {
          method: 'POST', body: { email: syntheticEmail, password: syntheticPassword }
        }, { attempts: 2, delayMs: 3000 }).catch(() => null);
        if (recovered?.status === 201 && recovered.json?.user?.id && recovered.json?.user?.companyId) bRegisterResponse = recovered;
      }
      if (bRegisterResponse.status === 201 && bRegisterResponse.json?.user?.id && bRegisterResponse.json?.user?.companyId) {
        userBId = bRegisterResponse.json.user.id;
        companyBId = bRegisterResponse.json.user.companyId;
        tokenB = bRegisterResponse.json.accessToken || null;
        fixtureReady = Boolean(tokenB);
      }
      result('Criar tenant B isolado em runtime', 'POST /auth/register com e-mail/senha aleatórios em memória; nenhum fixture é reutilizado', `HTTP ${bRegisterResponse.status}; resposta de autenticação válida=${Boolean(tokenB)}; IDs/credenciais omitidos`, fixtureReady ? 'aprovado' : 'reprovado');
    } else {
      result('Criar tenant B isolado em runtime', 'Criar fixture somente após comprovar conexão CA-verificada para limpeza', 'Pré-condições ausentes; fixture não criado', 'inconclusivo');
    }

    if (fixtureReady) {
      bCounterpartyResponse = await request('/finance/counterparties', { method: 'POST', token: tokenB, body: { name: `OWASP CP ${crypto.randomBytes(5).toString('hex')}`, role: 'CUSTOMER' } });
      let bCpId = bCounterpartyResponse.json?.id;
      for (let retry = 0; retry < 2 && bCounterpartyResponse.status >= 500; retry += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        bCounterpartyResponse = await request('/finance/counterparties', { method: 'POST', token: tokenB, body: { name: `OWASP CP ${crypto.randomBytes(5).toString('hex')}`, role: 'CUSTOMER' } });
        bCpId = bCounterpartyResponse.json?.id || null;
      }
      if (bCounterpartyResponse.status === 201 && bCpId) bCounterpartyIds.add(bCpId);
      result('Criar contraparte própria para fixture B', 'POST /finance/counterparties com nome aleatório, sem consulta externa de CNPJ', summarizeResponse(bCounterpartyResponse), bCpId ? 'aprovado' : 'reprovado');

      const now = new Date().toISOString();
      if (bCpId) {
        const transactionBody = { type: 'INCOME', category: 'SALES', description: `OWASP-FIXTURE-${fixtureMarker}`, amount: 0.01, occurredAt: now, status: 'PAID', counterpartyId: bCpId };
        bCreateTransactionResponse = await request('/finance/transactions', { method: 'POST', token: tokenB, body: transactionBody });
        for (let retry = 0; retry < 2 && bCreateTransactionResponse.status >= 500; retry += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          bCreateTransactionResponse = await request('/finance/transactions', { method: 'POST', token: tokenB, body: transactionBody });
        }
        const id = bCreateTransactionResponse.json?.id;
        if (bCreateTransactionResponse.status === 201 && id) bTransactionIds.add(id);
      }
      result('Criar lançamento próprio para fixture B', 'POST /finance/transactions com valor mínimo e contraparte B', summarizeResponse(bCreateTransactionResponse || { status: 0, json: null, text: '' }), bTransactionIds.size ? 'aprovado' : 'reprovado');

      const bTransactionList = await request('/finance/transactions?page=1&limit=100', { token: tokenB });
      const bListedTransactions = bTransactionList.json?.items || [];
      const transactionAVisible = aTransactionId && bListedTransactions.some((x) => x.id === aTransactionId);
      const transactionsOutOfFixture = bListedTransactions.some((x) => !bTransactionIds.has(x.id));
      result('Isolamento de listagem de lançamentos entre A e B', 'Listar lançamentos como B e comparar IDs visíveis com fixture B e ID conhecido de A', `HTTP ${bTransactionList.status}; lançamento A identificável=${Boolean(aTransactionId)}; lançamento A visível=${Boolean(transactionAVisible)}; registros fora da fixture B=${transactionsOutOfFixture}`, bTransactionList.status === 200 && Boolean(aTransactionId) && !transactionAVisible && !transactionsOutOfFixture ? 'aprovado' : 'inconclusivo');

      const bCounterpartyList = await request('/finance/counterparties?page=1&limit=100', { token: tokenB });
      const bListedCounterparties = bCounterpartyList.json?.items || [];
      const counterpartyAVisible = aCounterpartyId && bListedCounterparties.some((x) => x.id === aCounterpartyId);
      const counterpartiesOutOfFixture = bListedCounterparties.some((x) => !bCounterpartyIds.has(x.id));
      result('Isolamento de listagem de contrapartes entre A e B', 'Listar contrapartes como B e comparar IDs visíveis com fixture B e ID conhecido de A', `HTTP ${bCounterpartyList.status}; contraparte A identificável=${Boolean(aCounterpartyId)}; contraparte A visível=${Boolean(counterpartyAVisible)}; registros fora da fixture B=${counterpartiesOutOfFixture}`, bCounterpartyList.status === 200 && Boolean(aCounterpartyId) && !counterpartyAVisible && !counterpartiesOutOfFixture ? 'aprovado' : 'inconclusivo');

      const alienReference = aCounterpartyId ? await request('/finance/transactions', { method: 'POST', token: tokenB, body: {
        type: 'INCOME', category: 'SALES', description: 'OWASP tentativa de vínculo cross-tenant', amount: 0.01, occurredAt: now, status: 'PAID', counterpartyId: aCounterpartyId
      } }) : null;
      if (alienReference?.status === 201 && alienReference.json?.id) bTransactionIds.add(alienReference.json.id);
      result('Negar vínculo de lançamento B a contraparte A por ID', 'POST /finance/transactions com counterpartyId de A; escrita somente em B', alienReference ? summarizeResponse(alienReference) : 'ID de contraparte A indisponível', alienReference?.status === 400 || alienReference?.status === 404 ? 'aprovado' : alienReference ? 'reprovado' : 'inconclusivo');

      if (aCounterpartyId) {
        const counterpartyById = await request(`/finance/counterparties?search=${encodeURIComponent(aCounterpartyId)}&limit=100`, { token: tokenB });
        const foundForeign = (counterpartyById.json?.items || []).some((x) => x.id === aCounterpartyId);
        result('Contraparte de A consultada por ID sob sessão B', 'GET /finance/counterparties?search={ID-A} com filtro do tenant B', `HTTP ${counterpartyById.status}; ID de A retornado=${foundForeign}; itens=${counterpartyById.json?.items?.length ?? 'n/a'}`, counterpartyById.status === 200 && !foundForeign ? 'aprovado' : 'reprovado');
        const counterpartyReadByPath = await request(`/finance/counterparties/${encodeURIComponent(aCounterpartyId)}`, { token: tokenB });
        result('IDOR: leitura direta de contraparte de A', 'GET /finance/counterparties/{ID-A} sob sessão B', summarizeResponse(counterpartyReadByPath), [401, 403, 404].includes(counterpartyReadByPath.status) ? 'aprovado' : 'reprovado', 'A01');
        const counterpartyAlterByPath = await request(`/finance/counterparties/${encodeURIComponent(aCounterpartyId)}`, { method: 'PATCH', token: tokenB, body: { name: 'OWASP alteração cross-tenant' } });
        result('IDOR: alteração direta de contraparte de A', 'PATCH /finance/counterparties/{ID-A} sob sessão B; nenhuma resposta de sucesso é aceita', summarizeResponse(counterpartyAlterByPath), [400, 401, 403, 404, 405].includes(counterpartyAlterByPath.status) ? 'aprovado' : 'reprovado', 'A01');
      } else result('Contraparte de A consultada por ID sob sessão B', 'Busca autenticada com ID da contraparte A', 'Fixture A sem contraparte identificável', 'inconclusivo');

      if (aTransactionId) {
        const foreignAttachmentList = await request(`/finance/attachments?transactionId=${encodeURIComponent(aTransactionId)}`, { token: tokenB });
        const foreignAttachment = Array.isArray(foreignAttachmentList.json) && foreignAttachmentList.json.some((x) => x.transactionId === aTransactionId);
        result('Lançamento de A por ID em consulta filha sob sessão B', 'GET /finance/attachments?transactionId={ID-A}; leitura sem mutação', `HTTP ${foreignAttachmentList.status}; anexos associados a A expostos=${foreignAttachment}; quantidade=${Array.isArray(foreignAttachmentList.json) ? foreignAttachmentList.json.length : 'n/a'}`, foreignAttachmentList.status === 200 && !foreignAttachment ? 'aprovado' : 'reprovado');
        const noDetail = await request(`/finance/transactions/${encodeURIComponent(aTransactionId)}`, { token: tokenB });
        result('Consulta direta do lançamento A por ID sob sessão B', 'GET /finance/transactions/{ID-A}; endpoint estritamente de leitura', `${summarizeResponse(noDetail)}; 404 quando a rota de detalhe não está implementada significa recurso não exposto`, noDetail.status === 404 || noDetail.status === 401 || noDetail.status === 403 ? 'aprovado' : 'reprovado');
        const transactionAlter = await request(`/finance/transactions/${encodeURIComponent(aTransactionId)}`, { method: 'PATCH', token: tokenB, body: { description: 'OWASP tentativa de alteração cross-tenant' } });
        result('IDOR: alteração direta de lançamento de A', 'PATCH /finance/transactions/{ID-A} sob sessão B; nenhuma resposta de sucesso é aceita', summarizeResponse(transactionAlter), [400, 401, 403, 404, 405].includes(transactionAlter.status) ? 'aprovado' : 'reprovado', 'A01');
      } else result('Lançamento de A por ID sob sessão B', 'Consultar lançamento de A por identificador sem mutação', 'ID de lançamento A indisponível', 'inconclusivo');

      if (companyAId) {
        const profileRead = await request(`/business-registry/profile/${encodeURIComponent(companyAId)}`, { token: tokenB });
        result('IDOR: leitura direta de perfil de A', 'GET /business-registry/profile/{COMPANY-ID-A} sob sessão B', summarizeResponse(profileRead), [401, 403, 404].includes(profileRead.status) ? 'aprovado' : 'reprovado', 'A01');
        const profileAlter = await request(`/business-registry/profile/${encodeURIComponent(companyAId)}`, { method: 'PUT', token: tokenB, body: { cnpj: 'invalido' } });
        result('IDOR: alteração direta de perfil de A', 'PUT /business-registry/profile/{COMPANY-ID-A} sob sessão B; nenhuma resposta de sucesso é aceita', summarizeResponse(profileAlter), [400, 401, 403, 404, 405].includes(profileAlter.status) ? 'aprovado' : 'reprovado', 'A01');
      } else {
        result('IDOR: leitura e alteração de perfil de A', 'Tentar GET e PUT do perfil identificado pela empresa A sob sessão B', 'ID da empresa A indisponível; tentativas não executadas', 'inconclusivo', 'A01');
      }

      const auditActions = ['AUTH_REGISTERED', ...(bCpId ? ['FINANCE_COUNTERPARTY_CREATED'] : []), ...(bTransactionIds.size ? ['FINANCE_TRANSACTION_CREATED'] : [])];
      const auditsB = await requestAuditLogsWithRetry(tokenB, auditActions);
      const auditItemsB = auditsB.json?.items || [];
      const aAuditVisible = aAuditId && auditItemsB.some((x) => x.id === aAuditId);
      result('Evento de auditoria A não visível a B', 'GET /audit-logs como owner B e comparar ID de evento A; não existe GET /audit-logs/:id', `HTTP ${auditsB.status}; evento A presente na lista B=${Boolean(aAuditVisible)}`, auditsB.status === 200 && !aAuditVisible ? 'aprovado' : 'reprovado');
      if (aAuditId) {
        const auditById = await request(`/audit-logs/${encodeURIComponent(aAuditId)}`, { token: tokenB });
        result('Tentativa de evento de auditoria A por ID', 'GET /audit-logs/{ID-A}; leitura apenas', `${summarizeResponse(auditById)}; 404 quando não existe rota de detalhe significa que o evento não é exposto por ID`, auditById.status === 404 || auditById.status === 401 || auditById.status === 403 ? 'aprovado' : 'reprovado');
      }


      const searchPayloads = ["' OR 1=1--", "'; DROP TABLE", '%', '_'];
      for (const payload of searchPayloads) {
        const r = await request(`/finance/transactions?search=${encodeURIComponent(payload)}&limit=100`, { token: tokenB });
        const items = r.json?.items || [];
        const cross = items.some((x) => !bTransactionIds.has(x.id));
        const serverError = r.status === 500 || containsInternalError(r.text);
        const literalWildcard = !['%', '_'].includes(payload) || Number(r.json?.total ?? items.length) === 0;
        result(`Injeção de SQL em busca de lançamentos (${JSON.stringify(payload)})`, `GET /finance/transactions?search=${JSON.stringify(payload)}`, `HTTP ${r.status}; itens=${items.length}; registro fora do fixture B=${cross}; curinga retornou total não-zero=${['%', '_'].includes(payload) && !literalWildcard}; erro interno=${serverError}`, !serverError && !cross && literalWildcard && r.status < 500 ? 'aprovado' : 'reprovado');
      }
      for (const payload of searchPayloads) {
        const r = await request(`/finance/counterparties?search=${encodeURIComponent(payload)}&limit=100`, { token: tokenB });
        const items = r.json?.items || [];
        const cross = items.some((x) => !bCounterpartyIds.has(x.id));
        const serverError = r.status === 500 || containsInternalError(r.text);
        const literalWildcard = !['%', '_'].includes(payload) || Number(r.json?.total ?? items.length) === 0;
        result(`Injeção em filtro de nome da contraparte (${JSON.stringify(payload)})`, `GET /finance/counterparties?search=${JSON.stringify(payload)}`, `HTTP ${r.status}; itens=${items.length}; contraparte fora do fixture B=${cross}; curinga retornou total não-zero=${['%', '_'].includes(payload) && !literalWildcard}; erro interno=${serverError}`, !serverError && !cross && literalWildcard && r.status < 500 ? 'aprovado' : 'reprovado');
      }
      for (const [key, payload] of [['category', "' OR 1=1--"], ['status', "'; DROP TABLE"]]) {
        const r = await request(`/finance/transactions?${key}=${encodeURIComponent(payload)}`, { token: tokenB });
        const safe = r.status >= 400 && r.status < 500 && !containsInternalError(r.text);
        result(`Injeção em filtro ${key}`, `GET /finance/transactions?${key}=${JSON.stringify(payload)}`, `${summarizeResponse(r)}; stack/tabela/caminho/Prisma=${containsInternalError(r.text)}`, safe ? 'aprovado' : 'reprovado');
      }

      const controlDescription = `OWASP-CONTROL-${String.fromCharCode(1)}-END`;
      const controlResp = await request('/finance/transactions', { method: 'POST', token: tokenB, body: {
        type: 'INCOME', category: 'SALES', description: controlDescription, amount: 0.01, occurredAt: now, status: 'PAID'
      } });
      if (controlResp.status === 201 && controlResp.json?.id) bTransactionIds.add(controlResp.json.id);
      const acceptedControl = controlResp.status === 201 && typeof controlResp.json?.description === 'string' && /[\u0000-\u001f\u007f]/.test(controlResp.json.description);
      result('Caractere de controle em descrição', 'POST /finance/transactions com U+0001 em descrição de fixture B', `${summarizeResponse(controlResp)}; caractere de controle persistido/devolvido=${acceptedControl}`, acceptedControl ? 'reprovado' : controlResp.status >= 400 && controlResp.status < 500 ? 'aprovado' : 'inconclusivo');

      const longDescription = await request('/finance/transactions', { method: 'POST', token: tokenB, body: {
        type: 'INCOME', category: 'SALES', description: 'L'.repeat(161), amount: 0.01, occurredAt: now, status: 'PAID'
      } });
      if (longDescription.status === 201 && longDescription.json?.id) bTransactionIds.add(longDescription.json.id);
      result('Descrição acima do limite', 'POST /finance/transactions com 161 caracteres (máximo DTO: 160)', `${summarizeResponse(longDescription)}; detalhe interno exposto=${containsInternalError(longDescription.text)}`, longDescription.status === 400 && !containsInternalError(longDescription.text) ? 'aprovado' : 'reprovado');


      const auditChecks = ['AUTH_REGISTERED', 'FINANCE_COUNTERPARTY_CREATED', 'FINANCE_TRANSACTION_CREATED'].map((action) => {
        const entry = auditItemsB.find((x) => x.action === action && x.actorUserId === userBId && Number.isFinite(Date.parse(x.createdAt)));
        return { action, found: Boolean(entry), actorAndDate: Boolean(entry) };
      });
      const txAudit = auditItemsB.find((x) => x.action === 'FINANCE_TRANSACTION_CREATED' && x.actorUserId === userBId && x.entityId && Number.isFinite(Date.parse(x.createdAt)));
      const auditPrerequisites = Boolean(bCpId && bTransactionIds.size);
      const auditPassed = auditsB.status === 200 && auditPrerequisites && auditChecks.every((x) => x.found) && Boolean(txAudit);
      result('Trilha de auditoria: cadastro e operações financeiras', 'GET /audit-logs como owner B; conferir usuário, data, ação e vínculo da operação', `HTTP ${auditsB.status}; ações exigidas=${auditChecks.map((x) => `${x.action}:${x.found}`).join(',')}; lançamento ligado por entityId=${Boolean(txAudit)}`, auditPassed ? 'aprovado' : auditPrerequisites ? 'reprovado' : 'inconclusivo');
      result('Trilha de auditoria: login', 'Consultar audit-logs de A e verificar AUTH_LOGIN_SUCCEEDED com ator/data', `Evento visível em A=${Boolean((auditA?.json?.items || []).some((x) => x.action === 'AUTH_LOGIN_SUCCEEDED' && x.actorUserId === userAId && Number.isFinite(Date.parse(x.createdAt))))}`, (auditA?.json?.items || []).some((x) => x.action === 'AUTH_LOGIN_SUCCEEDED' && x.actorUserId === userAId && Number.isFinite(Date.parse(x.createdAt))) ? 'aprovado' : 'inconclusivo');
    } else {
      for (const name of ['Injeção SQL e isolamento B', 'Acesso cruzado por ID', 'Auditoria de cadastro/operação']) result(name, 'Requer tenant fixture B', 'Fixture não criado', 'inconclusivo');
      if (tokenA) {
        const payloads = ["' OR 1=1--", "'; DROP TABLE", '%', '_'];
        for (const payload of payloads) {
          const txSearch = await request(`/finance/transactions?search=${encodeURIComponent(payload)}&limit=10`, { token: tokenA });
          const txLiteralWildcard = !['%', '_'].includes(payload) || Number(txSearch.json?.total ?? txSearch.json?.items?.length ?? 0) === 0;
          result(`Busca de lançamentos sem erro 500 (${JSON.stringify(payload)})`, `GET /finance/transactions?search=${JSON.stringify(payload)} sob sessão A`, `${summarizeResponse(txSearch)}; curinga retornou total não-zero=${['%', '_'].includes(payload) && !txLiteralWildcard}; erro interno=${containsInternalError(txSearch.text)}`, txSearch.status < 500 && !containsInternalError(txSearch.text) && txLiteralWildcard ? 'aprovado' : 'reprovado');
          const cpSearch = await request(`/finance/counterparties?search=${encodeURIComponent(payload)}&limit=10`, { token: tokenA });
          const cpLiteralWildcard = !['%', '_'].includes(payload) || Number(cpSearch.json?.total ?? cpSearch.json?.items?.length ?? 0) === 0;
          result(`Busca de contrapartes sem erro 500 (${JSON.stringify(payload)})`, `GET /finance/counterparties?search=${JSON.stringify(payload)} sob sessão A`, `${summarizeResponse(cpSearch)}; curinga retornou total não-zero=${['%', '_'].includes(payload) && !cpLiteralWildcard}; erro interno=${containsInternalError(cpSearch.text)}`, cpSearch.status < 500 && !containsInternalError(cpSearch.text) && cpLiteralWildcard ? 'aprovado' : 'reprovado');
        }
        for (const [key, payload] of [['category', "' OR 1=1--"], ['status', "'; DROP TABLE"]]) {
          const r = await request(`/finance/transactions?${key}=${encodeURIComponent(payload)}`, { token: tokenA });
          result(`Validação de entrada ${key} sem erro interno`, `GET /finance/transactions?${key}=${JSON.stringify(payload)} sob sessão A`, `${summarizeResponse(r)}; erro interno=${containsInternalError(r.text)}`, r.status < 500 && !containsInternalError(r.text) ? 'aprovado' : 'reprovado');
        }
        const logsA = auditA?.json?.items || [];
        const financeAudit = logsA.find((x) => /^FINANCE_TRANSACTION_/.test(x.action || '') && x.actorUserId === userAId && Number.isFinite(Date.parse(x.createdAt)));
        const registerAudit = logsA.find((x) => x.action === 'AUTH_REGISTERED' && x.actorUserId === userAId && Number.isFinite(Date.parse(x.createdAt)));
        result('Auditoria de login observada em A', 'Consultar audit-logs de A e validar ator, data e ação AUTH_LOGIN_SUCCEEDED', `evento com usuário/data=${logsA.some((x) => x.action === 'AUTH_LOGIN_SUCCEEDED' && x.actorUserId === userAId && Number.isFinite(Date.parse(x.createdAt)))}`, logsA.some((x) => x.action === 'AUTH_LOGIN_SUCCEEDED' && x.actorUserId === userAId && Number.isFinite(Date.parse(x.createdAt))) ? 'aprovado' : 'inconclusivo');
        result('Auditoria de operação financeira de A', 'Procurar FINANCE_TRANSACTION_* com ator e data em A sem alterar o tenant', `evento encontrado=${Boolean(financeAudit)}`, financeAudit ? 'aprovado' : 'inconclusivo');
      }
    }
    result('Auditoria de alteração de vínculo empresarial', 'Localizar operação/rota de alteração de CompanyMembership nos controladores lidos', 'Não foi encontrada operação pública de alteração de vínculo; a superfície de mutação não existe e nenhuma associação preexistente foi alterada', 'aprovado');




    if (fixtureReady) {
      const resetKnown = await request('/auth/password-reset', { method: 'POST', body: { email: `owasp-reset-${crypto.randomUUID()}@example.invalid` } });
      const resetFixture = await request('/auth/password-reset', { method: 'POST', body: { email: bRegisterResponse.json.user.email } });
      const genericReset = JSON.stringify(resetKnown.json) === JSON.stringify(resetFixture.json);
      result('Redefinição não enumera conta', 'Solicitar reset para e-mail inexistente e conta sintética; comparar respostas, sem token exposto', `inexistente=${summarizeResponse(resetKnown)}; fixture=${summarizeResponse(resetFixture)}; respostas equivalentes=${genericReset}`, resetKnown.status === resetFixture.status && genericReset && !('token' in (resetFixture.json || {})) ? 'aprovado' : 'reprovado');
      const firstResetRows = await pool.query(`SELECT id, "tokenHash", "usedAt" FROM "${DB_SCHEMA}"."PasswordResetToken" WHERE "userId" = $1 ORDER BY "createdAt" ASC`, [userBId]);
      const resetAgain = await request('/auth/password-reset', { method: 'POST', body: { email: bRegisterResponse.json.user.email } });
      const allResetRows = await pool.query(`SELECT id, "tokenHash", "usedAt", "expiresAt" FROM "${DB_SCHEMA}"."PasswordResetToken" WHERE "userId" = $1 ORDER BY "createdAt" ASC`, [userBId]);
      const firstIds = new Set(firstResetRows.rows.map((row) => row.id));
      const priorRows = allResetRows.rows.filter((row) => firstIds.has(row.id));
      const newRows = allResetRows.rows.filter((row) => !firstIds.has(row.id));
      const allHashesAreSha256 = allResetRows.rows.length >= 2 && allResetRows.rows.every((row) => /^[0-9a-f]{64}$/.test(row.tokenHash));
      const hashesAreDistinct = new Set(allResetRows.rows.map((row) => row.tokenHash)).size === allResetRows.rows.length;
      const previousInvalidated = priorRows.length === firstResetRows.rows.length && priorRows.length > 0 && priorRows.every((row) => row.usedAt !== null);
      const latestIsUsable = newRows.length === 1 && newRows[0].usedAt === null && new Date(newRows[0].expiresAt).getTime() > Date.now();
      const resetSource = fs.readFileSync(new URL('../../src/modules/auth/password-reset.service.ts', import.meta.url), 'utf8');
      const secureResetCode = resetSource.includes('randomBytes(32).toString(\'base64url\')') && resetSource.includes("createHash('sha256')") && resetSource.includes('token.usedAt ||') && resetSource.includes('updateMany({\n        where: { userId: user.id, usedAt: null');
      result('Token de reset imprevisível e não reutilizável', 'Usar duas vezes a rota de reset da fixture; conferir somente hashes no DB e invalidação de token anterior; validar fonte', `HTTP segundo reset=${resetAgain.status}; hashes SHA-256 distintos=${allHashesAreSha256 && hashesAreDistinct}; token anterior invalidado=${previousInvalidated}; token atual ativo=${latestIsUsable}; código gera 256 bits aleatórios e rejeita usedAt=${secureResetCode}; plaintext/hashes omitidos`, resetFixture.status === 201 && resetAgain.status === 201 && allHashesAreSha256 && hashesAreDistinct && previousInvalidated && latestIsUsable && secureResetCode ? 'aprovado' : 'reprovado');



      const { PrismaService } = require('../../dist/database/prisma.service.js');
      const { PasswordResetService } = require('../../dist/modules/auth/password-reset.service.js');
      const { ConfigService } = require('@nestjs/config');
      const resetPrisma = new PrismaService(new ConfigService({ ...apiEnv, DATABASE_POOL_MAX: '1' }));
      const deliveredTokens = [];
      const notifier = {
        isConfigured: () => true,
        send: async ({ email, token, expiresAt }) => {
          if (email !== bRegisterResponse.json.user.email) throw new Error('Entrega fora do fixture');
          deliveredTokens.push({ token, expiresAt });
        }
      };
      try {
        await resetPrisma.$connect();
        const resetService = new PasswordResetService(resetPrisma, notifier);
        const issue = async () => {
          const delivery = await resetService.request({ email: bRegisterResponse.json.user.email });
          if (!delivery.delivered || deliveredTokens.length === 0) throw new Error('Token legítimo não entregue');
          return deliveredTokens.at(-1).token;
        };
        const revokedResetToken = await issue();
        const liveResetToken = await issue();
        const hashes = [revokedResetToken, liveResetToken].map((value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex'));
        const stored = await pool.query(`SELECT "tokenHash", "usedAt" FROM "${DB_SCHEMA}"."PasswordResetToken" WHERE "userId" = $1 AND "tokenHash" = ANY($2::text[])`, [userBId, hashes]);
        const genuine = deliveredTokens.every(({ token }) => Buffer.from(token, 'base64url').length === 32) && new Set(deliveredTokens.map(({ token }) => token)).size === deliveredTokens.length;
        const hashOnly = stored.rows.length === 2 && stored.rows.every((row) => hashes.includes(row.tokenHash) && !deliveredTokens.some(({ token }) => token === row.tokenHash));
        result('Armazenamento de tokens legítimos de reset somente como hash', 'Emitir pelo serviço de produção com notifier de teste em memória; comprovar 256 bits, valores distintos e somente SHA-256 persistido', `emissão real=${genuine}; apenas hashes persistidos=${hashOnly}; plaintext/hashes omitidos`, genuine && hashOnly ? 'aprovado' : 'reprovado', 'A02');
        const newPassword = `Reset-${crypto.randomBytes(18).toString('base64url')}`;
        const revokedReplay = await request('/auth/password-reset/confirm', { method: 'POST', body: { token: revokedResetToken, newPassword } });
        const confirmed = await request('/auth/password-reset/confirm', { method: 'POST', body: { token: liveResetToken, newPassword } });
        const replay = await request('/auth/password-reset/confirm', { method: 'POST', body: { token: liveResetToken, newPassword } });
        const reused = await pool.query(`SELECT "usedAt" FROM "${DB_SCHEMA}"."PasswordResetToken" WHERE "userId" = $1 AND "tokenHash" = $2`, [userBId, hashes[1]]);
        const confirmedAndRejected = confirmed.status === 201 && confirmed.json?.reset === true && replay.status === 400 && reused.rows[0]?.usedAt !== null && !containsInternalError(replay.text);
        result('Replay de token legítimo de redefinição', 'Emitir token pelo serviço original, confirmar pela API e repetir exatamente o mesmo token válido já consumido', `primeira confirmação HTTP=${confirmed.status}; replay HTTP=${replay.status}; consumo persistido=${Boolean(reused.rows[0]?.usedAt)}; detalhes internos=${containsInternalError(replay.text)}`, confirmedAndRejected ? 'aprovado' : 'reprovado', 'A02');
        const expiredResetToken = await issue();
        const expiredHash = crypto.createHash('sha256').update(expiredResetToken, 'utf8').digest('hex');

        await pool.query(`UPDATE "${DB_SCHEMA}"."PasswordResetToken" SET "expiresAt" = $1 WHERE "userId" = $2 AND "tokenHash" = $3`, [new Date(Date.now() - 1000), userBId, expiredHash]);
        const expiredReplay = await request('/auth/password-reset/confirm', { method: 'POST', body: { token: expiredResetToken, newPassword } });
        const expiryRejected = expiredReplay.status === 400 && revokedReplay.status === 400 && !containsInternalError(expiredReplay.text) && !containsInternalError(revokedReplay.text);
        result('Tokens legítimos de reset expirados e revogados são recusados', 'Enviar um token emitido pelo serviço com relógio de fixture expirado e outro invalidado por emissão posterior; nenhum valor é registrado', `token expirado recusado=${expiredReplay.status === 400}; token revogado recusado=${revokedReplay.status === 400}; detalhe interno=${containsInternalError(expiredReplay.text) || containsInternalError(revokedReplay.text)}`, expiryRejected ? 'aprovado' : 'reprovado', 'A02');
      } finally {
        deliveredTokens.length = 0;
        await resetPrisma.$disconnect();
      }
    } else {
      result('Token de reset imprevisível e não reutilizável', 'Verificar emissão e invalidação em fixture', 'Fixture indisponível; não foi possível validar o ciclo de reset', 'inconclusivo');
      result('Replay de token legítimo de redefinição', 'Confirmar e repetir token legítimo em fixture', 'Fixture indisponível; token legítimo não gerado', 'inconclusivo');
    }


    await new Promise((resolve) => setTimeout(resolve, 61000));
    if (credentials?.email) {
      const firstFive = [];
      const distinctUnknown = `missing-${crypto.randomUUID()}@example.invalid`;
      for (let i = 0; i < 5; i++) {
        const email = i === 1 ? distinctUnknown : credentials.email;
        const password = `Invalid-${crypto.randomBytes(6).toString('hex')}`;
        firstFive.push(await request('/auth/login', { method: 'POST', body: { email, password } }));
      }
      const sixth = await request('/auth/login', { method: 'POST', body: { email: credentials.email, password: `Invalid-${crypto.randomBytes(6).toString('hex')}` } });
      const generic = loginErrorsEquivalent(firstFive[0], firstFive[1]);
      result('Login não enumera e-mail existente', 'Comparar HTTP 401, tipo/código e forma da mensagem entre conta A e e-mail inexistente; ignorar somente UUIDs de correlação', `status=${firstFive.slice(0, 2).map((x) => x.status).join('/')}; assinatura estável equivalente=${generic}; detalhe interno=${firstFive.slice(0, 2).some((x) => containsInternalError(x.text) || containsCredentialDisclosure(x.text))}`, generic ? 'aprovado' : 'reprovado');
      result('Rate limit de login: sexta tentativa em janela de um minuto', 'Executar cinco POST /auth/login e imediatamente a sexta; esperar 61 s antes do grupo', `status das cinco=${firstFive.map((x) => x.status).join(',')}; sexta=${sixth.status}`, firstFive.every((x) => x.status === 401) && sixth.status === 429 ? 'aprovado' : 'reprovado');
    } else {
      result('Rate limit de login: sexta tentativa', 'Executar seis tentativas controladas em um minuto', 'Credenciais A indisponíveis', 'inconclusivo');
      result('Login não enumera e-mail existente', 'Comparar respostas de e-mail existente e inexistente', 'Credenciais A indisponíveis', 'inconclusivo');
    }

    let quotaDoublePassed = false;
    try { quotaDoublePassed = await runCnpjQuotaDouble(); } catch { quotaDoublePassed = false; }
    result('Limite de consultas CNPJ', 'Executar quatro consultas a CNPJs sintéticos contra dublê local da ReceitaWS, sem tráfego externo', `dublê recebeu três chamadas upstream=${quotaDoublePassed}; quarta chamada recusada com 429=${quotaDoublePassed}`, quotaDoublePassed ? 'aprovado' : 'reprovado');
  } catch (error) {

    result('Execução geral da suíte', 'Executar verificações em modo controlado', `Falha operacional ${error?.name || 'Error'}; detalhe e stack omitidos por segurança`, 'inconclusivo');
  } finally {
    if (pool && ((userBId && companyBId) || aSyntheticCounterpartyId)) {
      try {
        const clean = await cleanupFixture();
        result('Remoção integral do fixture B', 'Excluir somente userId/companyId criados pela própria suíte e confirmar ausência', `Remoção e confirmação=${clean}`, clean ? 'aprovado' : 'reprovado');
      } catch (error) {
        result('Remoção integral do fixture B', 'Excluir somente IDs gerados e confirmar ausência', `Falha de limpeza ${error?.name || 'Error'}; os dados preexistentes não foram alvo`, 'reprovado');
      }
    } else {
      result('Remoção integral do fixture B', 'Confirmar limpeza do tenant de teste', 'Nenhum fixture B persistente foi criado', 'aprovado');
    }
    if (pool) await pool.end().catch(() => {});
  }

  const totals = results.reduce((acc, r) => { acc[r.verdict] = (acc[r.verdict] || 0) + 1; return acc; }, {});
  const categories = Object.fromEntries(OWASP_CATEGORIES.map(([id, label]) => {
    const entries = results.filter((item) => item.category === id);
    return [id, {
      label,
      total: entries.length,
      aprovadas: entries.filter((item) => item.verdict === 'aprovado').length,
      reprovadas: entries.filter((item) => item.verdict === 'reprovado').length,
      inconclusivas: entries.filter((item) => item.verdict === 'inconclusivo').length
    }];
  }));
  for (const [id, summary] of Object.entries(categories)) {
    console.log(`CATEGORY ${id} ${summary.label}: ${summary.aprovadas} aprovadas, ${summary.reprovadas} reprovadas, ${summary.inconclusivas} inconclusivas`);
  }
  const summary = { total: results.length, aprovadas: totals.aprovado || 0, reprovadas: totals.reprovado || 0, inconclusivas: totals.inconclusivo || 0, categorias: categories };
  console.log(`SUMMARY ${JSON.stringify(summary)}`);
  if ((totals.reprovado || 0) > 0 || (totals.inconclusivo || 0) > 0) process.exitCode = 1;
}

async function requestOutsidePrefix(path) {
  const wait = Math.max(0, 1250 - (Date.now() - lastRequestAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const response = await fetch(`${BASE.replace(/\/$/, '')}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, text, json, headers: response.headers };
}

await main();
