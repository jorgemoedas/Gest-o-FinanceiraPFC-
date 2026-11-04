#!/usr/bin/env node
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Rode o backend separado com URLs inacessíveis antes de executar este roteiro:
// RECEITAWS_API_BASE_URL=http://127.0.0.1:9/v1/cnpj/
// GEMINI_INTERACTIONS_URL=http://127.0.0.1:9/gemini
// UPSTREAM_MAX_ATTEMPTS=1 UPSTREAM_CIRCUIT_FAILURES=3 ALERT_INTEGRATION_FAILURES_THRESHOLD=1 ALERT_SILENCE_SECONDS=300
// Uso: node scripts/load/simulate-upstream-failure.mjs --cnpj=11378117000120

import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const BASE_URL = (process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3001/api/v1').replace(/\/+$/, '');
const ORIGIN = process.env.LOAD_ORIGIN ?? 'http://localhost:3000';
const credentialsPath = process.env.LOAD_CREDENTIALS ?? join(tmpdir(), 'gft-load-volume.json');
const outputPath = process.env.LOAD_OUTPUT ?? join(tmpdir(), 'gft-upstream-failure.json');
const metricsUrl = process.env.LOAD_METRICS_URL ?? `${BASE_URL.replace(/\/api\/v1$/, '')}/metrics`;
const circuitCheckDelayMs = Math.max(0, Number(process.env.LOAD_CIRCUIT_CHECK_DELAY_MS ?? 65_000) || 0);
const cnpj = process.argv.find((value) => value.startsWith('--cnpj='))?.slice(7) ?? '11378117000120';
const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function login() {
  const id = randomUUID();
  const response = await fetch(`${BASE_URL}/auth/login`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', origin: ORIGIN, 'x-request-id': id }, body: JSON.stringify(credentials) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Login falhou com status ${response.status}.`);
  return payload?.accessToken ?? payload?.token ?? payload?.access_token;
}

async function callUrl(token, url, init = {}) {
  const requestId = randomUUID();
  const started = process.hrtime.bigint();
  const response = await fetch(url, { ...init, headers: { Accept: 'application/json', origin: ORIGIN, Authorization: `Bearer ${token}`, 'x-request-id': requestId, ...(init.headers ?? {}) } });
  const payload = await response.json().catch(() => null);
  return { status: response.status, ms: Number(process.hrtime.bigint() - started) / 1e6, requestId: response.headers.get('x-correlation-id') ?? response.headers.get('x-request-id') ?? requestId, payload };
}
async function call(token, path, init = {}) { return callUrl(token, `${BASE_URL}${path}`, init); }
async function exercise(token, path, init = {}) {
  const calls = [];
  for (let index = 0; index < 4; index += 1) {
    calls.push(await call(token, path, init));
    if (index === 2 && circuitCheckDelayMs > 0) await sleep(circuitCheckDelayMs);
  }
  return calls;
}

const token = await login();
const receita = await exercise(token, `/business-registry/cnpj/${cnpj}`);
const gemini = await exercise(token, '/finance/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months: 3 }) });
const metrics = await callUrl(token, metricsUrl);
const resultado = {
  receita: receita.map(({ status, ms, requestId, payload }) => ({ status, ms: Number(ms.toFixed(1)), requestId, payload })),
  gemini: gemini.map(({ status, ms, requestId, payload }) => ({ status, ms: Number(ms.toFixed(1)), requestId, payload })),
  metricas: metrics.payload,
  controle_circuito: { falhas_antes_da_verificacao: 3, espera_antes_da_quarta_chamada_ms: circuitCheckDelayMs, metrics_url: metricsUrl },
  observacao: 'As três primeiras chamadas provocam falhas externas; a quarta é feita após a espera necessária para ultrapassar o throttle específico da ReceitaWS, mas ainda dentro da recuperação do circuito. A deduplicação deve ser verificada no stdout JSON do backend: uma entrada de alerta por integração dentro da janela ALERT_SILENCE_SECONDS.',
  executado_em: new Date().toISOString()
};
writeFileSync(outputPath, JSON.stringify(resultado, null, 2), { mode: 0o600 });
console.log(JSON.stringify(resultado, null, 2));
