#!/usr/bin/env node
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Mede Dashboard, listagem paginada e analítico com clientes concorrentes.
// A porta de entrada é limitada por um gate global para respeitar o rate limit da aplicação.
// Uso: node scripts/load/measure-concurrency.mjs [--clients=20,50] [--rate-per-minute=45] [--output=<arquivo-temporario>]

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE_URL = (process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3001/api/v1').replace(/\/+$/, '');
const ORIGIN = process.env.LOAD_ORIGIN ?? 'http://localhost:3000';
const CREDENTIALS_PATH = process.env.LOAD_CREDENTIALS ?? join(tmpdir(), 'gft-load-volume.json');

function option(name, fallback) {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : fallback;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const clients = String(option('clients', process.env.LOAD_CLIENTS ?? '20,50'))
  .split(',').map((value) => positiveInt(value.trim(), 0)).filter(Boolean);
const ratePerMinute = positiveInt(option('rate-per-minute', process.env.LOAD_RATE_PER_MINUTE ?? '45'), 45);
const pauseBetweenRoutesMs = positiveInt(option('pause-between-routes-ms', process.env.LOAD_PAUSE_BETWEEN_ROUTES_MS ?? '0'), 0);
const OUTPUT_PATH = option('output', process.env.LOAD_OUTPUT ?? join(tmpdir(), 'gft-load-concurrency.json'));
if (!clients.length || clients.some((value) => value > 200)) throw new Error('Use --clients com valores inteiros entre 1 e 200.');
if (ratePerMinute > 60) throw new Error('Use --rate-per-minute de no máximo 60 para respeitar o limitador da aplicação.');

const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

class RateGate {
  constructor(perMinute, burst) {
    this.perMinute = perMinute;
    this.spacingMs = 60_000 / perMinute;
    this.nextAt = Date.now() + this.spacingMs;
    this.burstRemaining = Math.min(perMinute, burst);
    this.windowStartedAt = Date.now();
  }

  async acquire() {
    const now = Date.now();
    if (now - this.windowStartedAt >= 60_000) {
      this.windowStartedAt = now;
      this.burstRemaining = Math.min(this.perMinute, 200);
      this.nextAt = now + this.spacingMs;
    }
    if (this.burstRemaining > 0) {
      this.burstRemaining -= 1;
      return;
    }
    const scheduled = Math.max(Date.now(), this.nextAt);
    this.nextAt = scheduled + this.spacingMs;
    await sleep(Math.max(0, scheduled - Date.now()));
  }
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return Number(sorted[index].toFixed(1));
}

function summary(samples) {
  const successes = samples.filter((sample) => sample.status >= 200 && sample.status < 300);
  const errors = samples.filter((sample) => sample.status < 200 || sample.status >= 300);
  const durations = samples.map((sample) => sample.ms);
  return {
    requisicoes: samples.length,
    respostas_ok: successes.length,
    respostas_com_erro: errors.length,
    taxa_erro_percentual: Number((errors.length * 100 / Math.max(1, samples.length)).toFixed(2)),
    codigos_erro: [...new Set(errors.map((sample) => sample.status))],
    minimo_ms: durations.length ? Number(Math.min(...durations).toFixed(1)) : null,
    p50_ms: percentile(durations, 0.50),
    p95_ms: percentile(durations, 0.95),
    p99_ms: percentile(durations, 0.99),
    maximo_ms: durations.length ? Number(Math.max(...durations).toFixed(1)) : null,
    ids_de_correlacao_observados: [...new Set(samples.map((sample) => sample.requestId).filter(Boolean))].length
  };
}

async function login() {
  const requestId = randomUUID();
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', origin: ORIGIN, 'x-request-id': requestId },
    body: JSON.stringify(credentials)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Login falhou com status ${response.status}.`);
  const token = payload?.accessToken ?? payload?.token ?? payload?.access_token;
  if (!token) throw new Error('Resposta de login sem token reconhecível.');
  return token;
}

async function measure(token, path, gate) {
  await gate.acquire();
  const started = process.hrtime.bigint();
  const requestId = randomUUID();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, origin: ORIGIN, 'x-request-id': requestId },
      signal: AbortSignal.timeout(60_000)
    });
    await response.arrayBuffer();
    return {
      status: response.status,
      ms: Number(process.hrtime.bigint() - started) / 1e6,
      requestId: response.headers.get('x-correlation-id') ?? response.headers.get('x-request-id') ?? requestId
    };
  } catch (error) {
    return { status: 0, ms: Number(process.hrtime.bigint() - started) / 1e6, requestId, erro: error instanceof Error ? error.message : String(error) };
  }
}

const targets = {
  dashboard: '/finance/dashboard?months=12',
  listagem_paginada: '/finance/transactions?page=1&limit=100&from=2025-01-01&to=2026-12-31',
  analitico: '/finance/analytics?months=12&projectionMonths=3'
};

const token = await login();
const resultado = {
  base_url: BASE_URL,
  controle_de_taxa: {
    requisicoes_por_minuto: ratePerMinute,
    pausa_entre_rotas_ms: pauseBetweenRoutesMs,
    explicacao: 'cada rota começa com o burst solicitado; a pausa evita que o próximo burst compartilhe a janela do limitador'
  },
  cenarios: {},
  executado_em: new Date().toISOString()
};

for (const concurrency of clients) {
  const gate = new RateGate(ratePerMinute, concurrency);
  const porRota = {};
  for (const [route, path] of Object.entries(targets)) {
    const samples = await Promise.all(Array.from({ length: concurrency }, () => measure(token, path, gate)));
    porRota[route] = { ...summary(samples), amostras: samples };
    if (pauseBetweenRoutesMs > 0 && route !== Object.keys(targets).at(-1)) await sleep(pauseBetweenRoutesMs);
  }
  resultado.cenarios[`clientes_${concurrency}`] = { concorrencia_solicitada: concurrency, por_rota: porRota };
  console.log(`Cenário ${concurrency} clientes concluído.`);
}

writeFileSync(OUTPUT_PATH, JSON.stringify(resultado, null, 2), { mode: 0o600 });
console.log(JSON.stringify(resultado, null, 2));
