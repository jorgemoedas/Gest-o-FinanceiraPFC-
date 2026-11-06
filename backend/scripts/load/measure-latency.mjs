#!/usr/bin/env node
import { tmpdir } from 'node:os';
import { join } from 'node:path';





import { readFileSync, writeFileSync } from 'node:fs';

const BASE_URL = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3001/api/v1';
const ORIGIN = process.env.LOAD_ORIGIN ?? 'http://localhost:3000';
const CREDENTIALS_PATH = process.env.LOAD_CREDENTIALS ?? join(tmpdir(), 'gft-load-volume.json');
const OUTPUT_PATH = process.env.LOAD_OUTPUT ?? join(tmpdir(), 'gft-load-result.json');

const rodadas = Number(process.argv[2] ?? 15);
const PAUSA_MS = 15000;
const CONCORRENCIA_LISTA = 5;
const CONCORRENCIA_DASHBOARD = 5;
const CONCORRENCIA_ANALITICO = 3;

const credenciais = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));

async function login() {
  const resposta = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(credenciais)
  });
  if (!resposta.ok) {
    throw new Error(`Login falhou com status ${resposta.status}.`);
  }
  const corpo = await resposta.json();
  const token = corpo.accessToken ?? corpo.token ?? corpo.access_token;
  if (!token) {
    throw new Error('Resposta de login sem token reconhecível.');
  }
  return token;
}

function percentil(valores, p) {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return Number(ordenados[indice].toFixed(1));
}

function resumo(amostras) {
  const ok = amostras.filter((a) => a.status >= 200 && a.status < 300).map((a) => a.ms);
  const falhas = amostras.filter((a) => a.status < 200 || a.status >= 300);
  return {
    requisicoes: amostras.length,
    respostas_ok: ok.length,
    respostas_com_erro: falhas.length,
    codigos: [...new Set(falhas.map((f) => f.status))],
    minimo_ms: ok.length ? Number(Math.min(...ok).toFixed(1)) : null,
    media_ms: ok.length ? Number((ok.reduce((a, b) => a + b, 0) / ok.length).toFixed(1)) : null,
    p50_ms: percentil(ok, 50),
    p95_ms: percentil(ok, 95),
    p99_ms: percentil(ok, 99),
    maximo_ms: ok.length ? Number(Math.max(...ok).toFixed(1)) : null
  };
}

async function medir(token, caminho) {
  const inicio = process.hrtime.bigint();
  try {
    const resposta = await fetch(`${BASE_URL}${caminho}`, {
      headers: { authorization: `Bearer ${token}`, origin: ORIGIN }
    });
    await resposta.arrayBuffer();
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    return { status: resposta.status, ms };
  } catch (erro) {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    return { status: 0, ms, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

const alvos = {
  dashboard: '/finance/dashboard?months=12',
  listagem: '/finance/transactions?page=1&limit=100&from=2025-01-01&to=2026-12-31',
  analitico: '/finance/analytics?months=12'
};

const amostras = { dashboard: [], listagem: [], analitico: [] };
const token = await login();
console.log(`Sessão obtida. Executando ${rodadas} rodadas com pausa de ${PAUSA_MS} ms.`);

for (let rodada = 1; rodada <= rodadas; rodada += 1) {
  const lote = [
    ...Array.from({ length: CONCORRENCIA_DASHBOARD }, () => medir(token, alvos.dashboard).then((r) => amostras.dashboard.push(r))),
    ...Array.from({ length: CONCORRENCIA_LISTA }, () => medir(token, alvos.listagem).then((r) => amostras.listagem.push(r))),
    ...Array.from({ length: CONCORRENCIA_ANALITICO }, () => medir(token, alvos.analitico).then((r) => amostras.analitico.push(r)))
  ];
  await Promise.all(lote);
  const p95Atual = percentil(amostras.dashboard.filter((a) => a.status === 200).map((a) => a.ms), 95);
  console.log(`Rodada ${rodada}/${rodadas} concluída. p95 parcial do Dashboard: ${p95Atual} ms.`);
  if (rodada < rodadas) {
    await new Promise((resolve) => setTimeout(resolve, PAUSA_MS));
  }
}

const resultado = {
  base_url: BASE_URL,
  rodadas,
  concurrency_por_rodada: {
    dashboard: CONCORRENCIA_DASHBOARD,
    listagem: CONCORRENCIA_LISTA,
    analitico: CONCORRENCIA_ANALITICO
  },
  aplicacao: Object.fromEntries(Object.entries(amostras).map(([nome, lista]) => [nome, resumo(lista)])),
  executado_em: new Date().toISOString()
};

writeFileSync(OUTPUT_PATH, JSON.stringify(resultado, null, 2));
console.log(JSON.stringify(resultado, null, 2));
