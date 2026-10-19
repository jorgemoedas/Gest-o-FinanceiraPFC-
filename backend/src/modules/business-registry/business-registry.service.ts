import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { AuthPrincipal } from '../../common/auth-principal';
import { RateLimitException } from '../../common/exceptions/rate-limit.exception';
import { AuditLogWriter } from '../audit/audit-log-writer.service';
import { isValidCnpj, maskCnpj, normalizeCnpj } from './cnpj';

const API_BASE = 'https://www.receitaws.com.br/v1/cnpj/';
const CACHE_TTL_MS = 15 * 60_000;
const UPSTREAM_WINDOW_MS = 60_000;
const UPSTREAM_MAX_REQUESTS = 3;

type ProviderPayload = {
  status?: unknown;
  message?: unknown;
  cnpj?: unknown;
  nome?: unknown;
  fantasia?: unknown;
  situacao?: unknown;
  tipo?: unknown;
  porte?: unknown;
  abertura?: unknown;
  logradouro?: unknown;
  numero?: unknown;
  complemento?: unknown;
  bairro?: unknown;
  municipio?: unknown;
  uf?: unknown;
  cep?: unknown;
  atividade_principal?: unknown;
};

export interface BusinessRegistryRecord {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  registrationStatus: string | null;
  companyType: string | null;
  size: string | null;
  openingDate: string | null;
  mainActivity: { code: string | null; description: string | null } | null;
  address: {
    street: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  source: 'ReceitaWS';
  sourceUpdatedAt: string;
}

const cache = new Map<string, { expiresAt: number; value: BusinessRegistryRecord }>();
let quotaWindowStartedAt = 0;
let quotaRequests = 0;

function pruneExpiredCache(now: number): void {
  for (const [cnpj, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(cnpj);
  }
}

function reserveUpstreamCall(now: number): void {
  if (now - quotaWindowStartedAt >= UPSTREAM_WINDOW_MS) {
    quotaWindowStartedAt = now;
    quotaRequests = 0;
  }
  if (quotaRequests >= UPSTREAM_MAX_REQUESTS) {
    throw new RateLimitException('O limite compartilhado da consulta pública foi atingido. Tente novamente em até um minuto.');
  }
  quotaRequests += 1;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function activity(value: unknown): { code: string | null; description: string | null } | null {
  if (!Array.isArray(value) || value.length === 0 || typeof value[0] !== 'object' || value[0] === null) return null;
  const first = value[0] as Record<string, unknown>;
  return { code: text(first.code), description: text(first.text) };
}

function normalizeProviderPayload(payload: ProviderPayload, requestedCnpj: string): BusinessRegistryRecord {
  const legalName = text(payload.nome);
  if (!legalName) throw new BadGatewayException('A ReceitaWS devolveu um cadastro sem razão social.');
  return {
    cnpj: normalizeCnpj(text(payload.cnpj) ?? requestedCnpj),
    legalName,
    tradeName: text(payload.fantasia),
    registrationStatus: text(payload.situacao),
    companyType: text(payload.tipo),
    size: text(payload.porte),
    openingDate: text(payload.abertura),
    mainActivity: activity(payload.atividade_principal),
    address: {
      street: text(payload.logradouro),
      number: text(payload.numero),
      complement: text(payload.complemento),
      district: text(payload.bairro),
      city: text(payload.municipio),
      state: text(payload.uf),
      postalCode: text(payload.cep)
    },
    source: 'ReceitaWS',
    sourceUpdatedAt: new Date().toISOString()
  };
}

function providerError(payload: ProviderPayload): Error {
  const message = typeof payload.message === 'string' ? payload.message.toLowerCase() : '';
  if (/cache|não encontrado|nao encontrado|not found|não está disponível/i.test(message)) {
    return new NotFoundException('A consulta pública da ReceitaWS não tem este CNPJ disponível no cache.');
  }
  if (/limite|rate limit|requests per minute/i.test(message)) {
    return new RateLimitException('A ReceitaWS limitou as consultas. Aguarde antes de tentar novamente.');
  }
  return new BadGatewayException('A ReceitaWS não conseguiu concluir a consulta deste CNPJ.');
}

@Injectable()
export class BusinessRegistryService {
  constructor(private readonly auditWriter: AuditLogWriter) {}

  async lookup(input: string, principal: AuthPrincipal): Promise<BusinessRegistryRecord> {
    const cnpj = normalizeCnpj(input);
    if (!isValidCnpj(cnpj)) throw new BadRequestException('Informe um CNPJ válido de 14 caracteres.');

    const now = Date.now();
    pruneExpiredCache(now);
    const cached = cache.get(cnpj);
    if (cached && cached.expiresAt > now) {
      await this.auditLookup(principal, cnpj, 'local_cache_hit');
      return cached.value;
    }
    cache.delete(cnpj);
    reserveUpstreamCall(now);

    let record: BusinessRegistryRecord;
    try {
      const response = await fetch(`${API_BASE}${encodeURIComponent(cnpj)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000)
      });

      if (response.status === 429) throw new RateLimitException('A ReceitaWS limitou as consultas. Aguarde antes de tentar novamente.');
      if (response.status === 402) throw new ServiceUnavailableException('A consulta foi recusada pelo limite/plano atual da ReceitaWS.');
      if (response.status === 504) throw new GatewayTimeoutException('A ReceitaWS excedeu o tempo de resposta. Tente novamente mais tarde.');
      if (response.status === 404) throw new NotFoundException('A ReceitaWS não localizou este CNPJ.');
      if (!response.ok) throw new BadGatewayException('A ReceitaWS está temporariamente indisponível.');

      const payload = await response.json() as ProviderPayload;
      if (payload.status !== 'OK') throw providerError(payload);
      record = normalizeProviderPayload(payload, cnpj);
    } catch (error: unknown) {
      const mapped = this.mapNetworkError(error);
      await this.auditLookup(principal, cnpj, `failed_${mapped.getStatus()}`);
      throw mapped;
    }

    cache.set(cnpj, { expiresAt: Date.now() + CACHE_TTL_MS, value: record });
    await this.auditLookup(principal, cnpj, 'success');
    return record;
  }

  private mapNetworkError(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new GatewayTimeoutException('A consulta à ReceitaWS excedeu o tempo de resposta.');
    }
    return new ServiceUnavailableException('Não foi possível alcançar a ReceitaWS neste momento.');
  }

  private async auditLookup(principal: AuthPrincipal, cnpj: string, result: string): Promise<void> {
    await this.auditWriter.write({
      actorUserId: principal.userId,
      companyId: principal.companyId,
      action: 'BUSINESS_REGISTRY_CNPJ_LOOKUP',
      entityType: 'BusinessRegistry',
      metadata: { provider: 'ReceitaWS', cnpjMasked: maskCnpj(cnpj), result }
    });
  }
}
