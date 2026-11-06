import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthPrincipal } from '../../common/auth-principal';
import { RateLimitException } from '../../common/exceptions/rate-limit.exception';
import { AlertsService } from '../../common/observability/alerts.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { CircuitOpenError, transientNetworkFailure, UpstreamResilience } from '../../common/resilience/upstream-resilience';
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
  stale?: true;
  availabilityNotice?: string;
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
  const cnpj = normalizeCnpj(text(payload.cnpj) ?? requestedCnpj);
  if (!isValidCnpj(cnpj) || cnpj !== requestedCnpj) {
    throw new BadGatewayException('A ReceitaWS devolveu um CNPJ inválido ou diferente do solicitado.');
  }
  const legalName = text(payload.nome);
  if (!legalName) throw new BadGatewayException('A ReceitaWS devolveu um cadastro sem razão social.');
  return {
    cnpj,
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
      postalCode: text(payload.cep)?.replace(/\D/g, '') ?? null
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
  private readonly cache = new Map<string, { expiresAt: number; value: BusinessRegistryRecord }>();
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly resilience: UpstreamResilience;
  private quotaWindowStartedAt = 0;
  private quotaRequests = 0;

  constructor(
    private readonly auditWriter: AuditLogWriter,
    @Optional() config?: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly alerts?: AlertsService
  ) {
    this.apiBase = (config?.get<string>('RECEITAWS_API_BASE_URL')?.trim() || API_BASE).replace(/\/+$/, '') + '/';
    this.timeoutMs = this.positiveConfig(config, 'RECEITAWS_TIMEOUT_MS', 4500);
    this.resilience = new UpstreamResilience({
      attempts: this.positiveConfig(config, 'UPSTREAM_MAX_ATTEMPTS', 2),
      baseDelayMs: this.positiveConfig(config, 'UPSTREAM_RETRY_BASE_DELAY_MS', 200),
      failureThreshold: this.positiveConfig(config, 'UPSTREAM_CIRCUIT_FAILURES', 3),
      recoveryMs: this.positiveConfig(config, 'UPSTREAM_CIRCUIT_RECOVERY_MS', 30000)
    });
  }

  private positiveConfig(config: ConfigService | undefined, key: string, fallback: number): number {
    const value = Number(config?.get<string>(key, String(fallback)) ?? fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private pruneExpiredCache(now: number): void {
    for (const [cnpj, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(cnpj);
    }
  }

  private reserveUpstreamCall(now: number): void {
    if (now - this.quotaWindowStartedAt >= UPSTREAM_WINDOW_MS) {
      this.quotaWindowStartedAt = now;
      this.quotaRequests = 0;
    }
    if (this.quotaRequests >= UPSTREAM_MAX_REQUESTS) {
      throw new RateLimitException('O limite compartilhado da consulta pública foi atingido. Tente novamente em até um minuto.');
    }
    this.quotaRequests += 1;
  }

  async lookup(input: string, principal: AuthPrincipal): Promise<BusinessRegistryRecord> {
    const cnpj = normalizeCnpj(input);
    if (!isValidCnpj(cnpj)) throw new BadRequestException('Informe um CNPJ válido de 14 caracteres.');

    const now = Date.now();
    this.pruneExpiredCache(now);
    const cached = this.cache.get(cnpj);
    if (cached && cached.expiresAt > now) {
      await this.auditLookup(principal, cnpj, 'local_cache_hit');
      return cached.value;
    }
    this.cache.delete(cnpj);
    if (this.resilience.isOpen()) {
      const mapped = this.mapNetworkError(new CircuitOpenError());
      this.metrics?.recordOperationalEvent('integration_failure', 'receitaws');
      this.alerts?.evaluate();
      await this.auditLookup(principal, cnpj, `failed_${mapped.getStatus()}`);
      throw mapped;
    }
    this.reserveUpstreamCall(now);

    let record: BusinessRegistryRecord;
    try {
      record = await this.resilience.execute(async () => {
        const response = await fetch(`${this.apiBase}${encodeURIComponent(cnpj)}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        if (response.status === 429) throw new RateLimitException('A ReceitaWS limitou as consultas. Aguarde antes de tentar novamente.');
        if (response.status === 402) throw new ServiceUnavailableException('A consulta foi recusada pelo limite/plano atual da ReceitaWS.');
        if (response.status === 504) throw new GatewayTimeoutException('A ReceitaWS excedeu o tempo de resposta. Tente novamente mais tarde.');
        if (response.status === 404) throw new NotFoundException('A ReceitaWS não localizou este CNPJ.');
        if (response.status >= 500) throw new ServiceUnavailableException('A ReceitaWS está temporariamente indisponível. Tente novamente em instantes.');
        if (!response.ok) throw new BadGatewayException('A ReceitaWS não conseguiu concluir a consulta.');
        let payload: ProviderPayload;
        try { payload = await response.json() as ProviderPayload; }
        catch { throw new BadGatewayException('A ReceitaWS retornou uma resposta inválida.'); }
        if (payload.status !== 'OK') throw providerError(payload);
        return normalizeProviderPayload(payload, cnpj);
      },
      (error) => transientNetworkFailure(error) || (error instanceof HttpException && [503, 504].includes(error.getStatus())),
      (error) => transientNetworkFailure(error) || (error instanceof HttpException && [503, 504].includes(error.getStatus())));
    } catch (error: unknown) {
      const mapped = this.mapNetworkError(error);
      if (mapped instanceof ServiceUnavailableException || mapped instanceof GatewayTimeoutException) {
        this.metrics?.recordOperationalEvent('integration_failure', 'receitaws');
        this.alerts?.evaluate();
      }
      await this.auditLookup(principal, cnpj, `failed_${mapped.getStatus()}`);
      throw mapped;
    }

    this.cache.set(cnpj, { expiresAt: Date.now() + CACHE_TTL_MS, value: record });
    await this.auditLookup(principal, cnpj, 'success');
    return record;
  }

  private mapNetworkError(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof CircuitOpenError) return new ServiceUnavailableException('A ReceitaWS está temporariamente indisponível após falhas repetidas. Tente novamente mais tarde.');
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
